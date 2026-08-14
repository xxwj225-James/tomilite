import type { NormalizedMessage, ClassificationResult } from './types.js';

const CLASSIFY_PROMPT = `You are a personal email secretary for a developer. Analyze email headers and preview, output JSON.

Categories:
1 - Urgent: security incidents, account anomalies, production outages, boss escalation. Classify here even if no reply is possible
2 - Needs reply today: work collaboration, task assignments, review requests. ⚠️ Check sender: noreply/no-reply/system@ addresses CANNOT be cat 2
3 - FYI only (no reply needed): CI/CD notifications, weekly reports, system alerts, security notices (noreply), billing
4 - Low priority: newsletters, digests, marketing

⚠️ Critical: security/account notifications (login alerts, password changes, anomaly detection) are important but don't need reply → cat 3 or cat 1 (if real threat). NEVER cat 2.
⚠️ Emails from noreply/no-reply/service@ cannot be replied to → NEVER cat 2.

Summary format:
- cat 1: 2-3 sentences describing the issue + action needed
- cat 2: 2-3 sentences + direction for reply
- cat 3: within 150 chars, format "Summary: xxx\\nKey points:\\n- ⚠️ xxx\\n- ⚠️ xxx"
- cat 4: one sentence

Priority mapping: cat 1 → critical, cat 2 → high, cat 3 → medium, cat 4 → low

Output pure JSON (no markdown fences):
{"category":1,"summary":"brief summary","priority":"critical"}`;

export async function classifyEmail(
  msg: NormalizedMessage,
  apiKey: string,
  baseUrl: string,
  flashModel: string,
): Promise<ClassificationResult> {
  const userContent = `发件人: ${msg.from}\n主题: ${msg.subject}\n日期: ${msg.receivedAt}\n预览:\n${(msg.body || '').substring(0, 1000)}`;

  const body: any = {
    model: flashModel,
    messages: [
      { role: 'user', content: CLASSIFY_PROMPT },
      { role: 'user', content: userContent },
    ],
    max_tokens: 350, temperature: 0,
    response_format: { type: 'json_object' },
  };
  if (baseUrl.includes('moonshot') || baseUrl.includes('deepseek')) body.thinking = { type: 'disabled' };
  else if (baseUrl.includes('dashscope')) body.enable_thinking = false;

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) throw new Error(`Classifier API error ${resp.status}`);

  const d = await resp.json();
  const raw = d.choices?.[0]?.message?.content || '{}';
  // Strip markdown code fences if present
  const json = raw.replace(/^```json?\s*/, '').replace(/\s*```$/, '').trim();
  let parsed: any = {};
  try {
    parsed = JSON.parse(json);
  } catch (e: any) {
    console.error('[EmailClassifier] JSON parse failed:', e.message, 'Raw:', raw.substring(0, 200));
    // Try to extract JSON object from the raw text as fallback
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) try { parsed = JSON.parse(m[0]); } catch {}
  }

  return {
    category: parsed.category || 3,
    summary: parsed.summary || msg.subject,
    priority: parsed.priority || 'medium',
    replyDraft: undefined, // draft generated on-demand when user views the email
  };
}

/** Fallback when LLM unavailable — language-independent heuristic using email metadata */
export function heuristicClassify(msg: NormalizedMessage): ClassificationResult {
  const from = (msg.from || '').toLowerCase();
  const subject = msg.subject || '';
  const body = (msg.body || '').substring(0, 500).toLowerCase();

  // ── Sender signals (language-independent) ──
  const isNoreply = /noreply|no-reply|donotreply/i.test(from);
  const isSystem = /service@|notification@|alert@|billing@|info@|support@|admin@/i.test(from);

  // ── Subject signals ──
  const isReply = /^re:|^aw:|^fwd:|^fw:|答复:|回复:|转发:/i.test(subject.trim());
  const hasQuestion = /\?|？/.test(subject);

  // ── Body signals (check both subject and body) ──
  const isUrgent = /urgent|alert|critical|security|breach|incident|crash|down|outage|⚠|🚨/i.test(subject)
    || /urgent|alert|critical|security|breach|incident|crash|down|outage/i.test(body);
  const isAutomated = /unsubscribe|view in browser|privacy policy|opt.out|mailing list|if you no longer wish/i.test(body);
  const isPromo = /offer|discount|sale|promo|newsletter|digest|weekly roundup/i.test(body);

  // ── Classify ──
  // cat 1: Urgent signals in subject or body (regardless of sender)
  if (isUrgent) {
    return { category: 1, summary: subject, priority: 'critical' };
  }

  // cat 2: Human conversation — reply/forward prefix, question, or personal sender
  // Also check body for actionable content from personal senders
  if (isReply || hasQuestion) {
    return { category: 2, summary: subject, priority: 'high' };
  }
  // Personal sender (not noreply/system) → likely needs attention
  if (!isNoreply && !isSystem) {
    return { category: 2, summary: subject, priority: 'high' };
  }

  // cat 3: System/automated but not urgent
  if (isNoreply || isSystem || isAutomated) {
    return { category: 3, summary: subject, priority: 'medium' };
  }

  // cat 4: Marketing/promotions
  if (isPromo) {
    return { category: 4, summary: subject, priority: 'low' };
  }

  // Default: needs attention
  return { category: 2, summary: subject, priority: 'high' };
}
