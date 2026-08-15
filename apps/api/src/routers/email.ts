import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomilite/database';
import { encrypt, decrypt } from '../lib/crypto';
import { emailManager, sendSMTP } from '@tomilite/email';
export const emailRouter = router({
  // ─── Smart Email list (for notification badge + Task panel) ───
  listSmartEmails: publicProcedure
    .input(z.object({ limit: z.number().default(50), unprocessedOnly: z.boolean().default(false) }))
    .query(async ({ input }) => {
      const where: any = {};
      if (input.unprocessedOnly) where.isProcessed = false;
      return prisma.smartEmail.findMany({
        where: Object.assign({}, where, { archived: false }),
        orderBy: { createdAt: 'desc' },
        take: input.limit,
      });
    }),

  // ─── Fetch full email body from IMAP on demand (by UID) ───
  fetchFullEmail: publicProcedure
    .input(z.object({ smartEmailId: z.string() }))
    .query(async ({ input }) => {
      const email = await prisma.smartEmail.findUnique({ where: { id: input.smartEmailId } });
      if (!email) return { ok: false, error: 'Email not found' };
      const integration = await prisma.integration.findFirst({ where: { type: 'imap', enabled: true } });
      if (!integration) return { ok: false, error: 'No active IMAP connection' };
      const connector = emailManager.getConnector?.(integration.id);
      if (!connector?.fetchFullMessage) return { ok: false, error: 'Connector not available' };
      try {
        // Try UID first (fast), fallback to messageId search if UID stale
        let full;
        try {
          full = await connector.fetchFullMessage(email.uid);
        } catch {
          full = await connector.fetchFullMessage(email.uid); // retry once
        }
        return { ok: true, html: full.html, text: full.text };
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    }),

  // ─── Get single SmartEmail body for "Read Original" ───
  getBody: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const email = await prisma.smartEmail.findUnique({ where: { id: input.id }, select: { bodySnapshot: true } });
      return email?.bodySnapshot || null;
    }),

  // ─── Mark as read ───
  markRead: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      return prisma.smartEmail.update({
        where: { id: input.id },
        data: { isRead: true },
      }).catch(() => null);
    }),

  // ─── Mark as processed ───
  markProcessed: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      try {
        return await prisma.smartEmail.update({
          where: { id: input.id },
          data: { isProcessed: true, isRead: true },
        });
      } catch {
        return { ok: false };
      }
    }),

  // ─── Manual cleanup trigger ───
  cleanup: publicProcedure.mutation(async () => {
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
    const deleted = await prisma.smartEmail.deleteMany({
      where: { isProcessed: true, processedAt: { lt: cutoff } },
    });
    return { ok: true, deleted: deleted.count };
  }),

  // ─── Integration config ───
  getConfig: publicProcedure.query(async () => {
    const configs = await prisma.integration.findMany({ where: { type: { in: ['imap', 'gmail', 'smtp'] } } });
    for (const c of configs) {
      try {
        const cfg = JSON.parse(c.config);
        if (cfg.password) cfg.password = await decrypt(cfg.password);
        if (cfg.pass) cfg.pass = await decrypt(cfg.pass);
        c.config = JSON.stringify(cfg);
      } catch {}
    }
    return configs;
  }),

  // Send report via SMTP — backend handles SMTP config/decryption, not frontend
  sendReport: publicProcedure
    .input(z.object({
      to: z.string(),
      cc: z.string().optional(),
      subject: z.string(),
      html: z.string(),
      attachments: z.array(z.object({ filename: z.string(), content: z.string(), contentType: z.string() })).optional(),
    }))
    .mutation(async ({ input }) => {
      const smtp = await prisma.integration.findFirst({ where: { type: 'smtp', enabled: true } });
      if (!smtp) return { ok: false, error: 'No SMTP config found' };
      const cfg = JSON.parse(smtp.config);
      if (!cfg.host || !cfg.port || !cfg.user) return { ok: false, error: `SMTP config incomplete: host=${cfg.host}, port=${cfg.port}, user=${cfg.user}` };
      if (cfg.pass) cfg.pass = await decrypt(cfg.pass);
      if (cfg.password) cfg.password = await decrypt(cfg.password);
      const pass = cfg.pass || cfg.password || '';
      if (!pass) return { ok: false, error: 'SMTP password not configured' };
      // F5: frontend stores tls field as 'starttls'
      const tls = cfg.starttls !== undefined ? cfg.starttls : (cfg.port === 587);
      // F6: use fromName for display name in From header
      const fromName = cfg.fromName || '';
      const from = fromName ? `${fromName} <${cfg.user}>` : cfg.user;
      try {
        await sendSMTP({ host: cfg.host, port: cfg.port, user: cfg.user, password: pass, tls, from, to: input.to + (input.cc ? ', ' + input.cc : ''), subject: input.subject, html: input.html, attachments: input.attachments || [], rejectUnauthorized: false });
        return { ok: true };
      } catch (e: any) { return { ok: false, error: e.message }; }
    }),

  saveIMAP: publicProcedure
    .input(z.object({
      host: z.string(), port: z.number().default(993),
      user: z.string(), password: z.string(),
      tls: z.boolean().default(true),
      mailbox: z.string().default('INBOX'),
      pollIntervalSeconds: z.number().default(60),
      smtp: z.object({
        host: z.string(), port: z.number(),
        user: z.string(), password: z.string(),
        tls: z.boolean().default(true),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      const encryptedPass = await encrypt(input.password);
      const cfg: any = { ...input, password: encryptedPass };
      if (input.smtp) {
        cfg.smtp = { ...input.smtp, password: await encrypt(input.smtp.password) };
      }
      const config = JSON.stringify(cfg);
      const existing = await prisma.integration.findFirst({ where: { type: 'imap' } });
      const saved = existing
        ? await prisma.integration.update({ where: { id: existing.id }, data: { config, enabled: true } })
        : await prisma.integration.create({ data: { type: 'imap', config, enabled: true } });
      return { ...saved, connected: false };
    }),

  getDraft: publicProcedure
    .input(z.object({ issueId: z.string() }))
    .query(async ({ input }) => {
      const email = await prisma.smartEmail.findFirst({ where: { issueId: input.issueId }, select: { replyDraft: true } });
      return { draft: email?.replyDraft || '' };
    }),

  saveDraft: publicProcedure
    .input(z.object({ issueId: z.string().optional(), smartEmailId: z.string().optional(), draft: z.string() }))
    .mutation(async ({ input }) => {
      if (input.smartEmailId) {
        await prisma.smartEmail.update({ where: { id: input.smartEmailId }, data: { replyDraft: input.draft } });
      } else if (input.issueId) {
        await prisma.smartEmail.updateMany({ where: { issueId: input.issueId }, data: { replyDraft: input.draft } });
      }
      return { ok: true };
    }),

  generateDraft: publicProcedure
    .input(z.object({ subject: z.string(), fromAddr: z.string(), body: z.string(), lang: z.string().default('en'), issueId: z.string().optional(), smartEmailId: z.string().optional() }))
    .mutation(async ({ input }) => {
      const provider = await prisma.llmProvider.findFirst({ where: { isActive: true } });
      if (!provider?.apiKey) return { draft: '', error: 'No LLM API key configured' };
      const master = await prisma.llmProviderMaster.findFirst({ where: { providers: { some: { id: provider.id } } } });
      const cfg = await prisma.llmConfig.findFirst();
      const baseUrl = master?.apiBaseUrl ;
      const model = cfg?.flashModel ;
      if (!baseUrl || !model) return { draft: '', error: 'LLM config incomplete' };
      const apiKey = await decrypt(provider.apiKey);
      const langLabel = input.lang === 'zh' ? 'Chinese' : input.lang === 'ja' ? 'Japanese' : 'English';
      let draft = '', errMsg = '';
      try {
        const body: any = { model, messages: [{ role: 'user', content: `Write a brief professional reply draft (under 100 words) in ${langLabel} for this email.\nSubject: ${input.subject}\nFrom: ${input.fromAddr}\nBody: ${input.body.substring(0, 1000)}\n\nReply draft in ${langLabel}:` }], max_tokens: 200 };
        if (baseUrl?.includes('moonshot') || baseUrl?.includes('deepseek')) { body.thinking = { type: 'disabled' }; }
        else if (baseUrl?.includes('dashscope')) { body.enable_thinking = false; }
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        });
        if (resp.ok) {
          const d = await resp.json();
          draft = d.choices?.[0]?.message?.content || '';
        } else {
          const body = await resp.text().catch(() => '');
          errMsg = `HTTP ${resp.status}: ${body.substring(0, 200)}`;
        }
      } catch (e: any) {
        errMsg = e.message || 'Network error';
      }
      // Save to DB via issueId or smartEmailId
      if (draft) {
        if (input.issueId) {
          try { await prisma.smartEmail.updateMany({ where: { issueId: input.issueId }, data: { replyDraft: draft } }); } catch {}
        } else if (input.smartEmailId) {
          try { await prisma.smartEmail.update({ where: { id: input.smartEmailId }, data: { replyDraft: draft } }); } catch {}
        }
      }
      return { draft, error: errMsg || undefined };
    }),

  imapStatus: publicProcedure.query(async () => {
    // Returns { [integrationId]: { connected, ... } } — frontend expects object keyed by integration ID
    return emailManager.getStatus();
  }),

  connectIMAP: publicProcedure.mutation(async () => {
    const integration = await prisma.integration.findFirst({ where: { type: 'imap', enabled: true } });
    if (!integration) return { ok: false, error: 'No IMAP config found. Save config first.' };
    try {
      const cfg = JSON.parse(integration.config);
      cfg.password = await decrypt(cfg.password);
      if (cfg.smtp?.password) cfg.smtp.password = await decrypt(cfg.smtp.password);
      await emailManager.startIMAP(integration.id, cfg);
      return { ok: true, status: emailManager.getStatus() };
    } catch (e: any) {
      return { ok: false, error: e.message?.substring(0, 200) };
    }
  }),

  disconnectIMAP: publicProcedure.mutation(async () => {
    const integration = await prisma.integration.findFirst({ where: { type: 'imap' } });
    if (!integration) return { ok: false, error: 'No IMAP config found' };
    try {
      await emailManager.stopOne(integration.id);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message?.substring(0, 200) };
    }
  }),

  // ─── Generic save (SMTP, MCP, etc.) — encrypts secrets ───
  saveConfig: publicProcedure
    .input(z.object({
      type: z.enum(['imap', 'gmail', 'smtp']),
      config: z.string(),
    }))
    .mutation(async ({ input }) => {
      const cfg = JSON.parse(input.config);
      // Encrypt all sensitive fields
      if (cfg.pass) cfg.pass = await encrypt(cfg.pass);
      if (cfg.password) cfg.password = await encrypt(cfg.password);
      if (cfg.apiKey) cfg.apiKey = await encrypt(cfg.apiKey);
      if (cfg.token) cfg.token = await encrypt(cfg.token);
      const encryptedConfig = JSON.stringify(cfg);
      const existing = await prisma.integration.findFirst({ where: { type: input.type } });
      if (existing) {
        return prisma.integration.update({ where: { id: existing.id }, data: { config: encryptedConfig } });
      }
      return prisma.integration.create({ data: { type: input.type, config: encryptedConfig } });
    }),


  // ─── SMTP Send ───
  sendEmail: publicProcedure
    .input(z.object({
      host: z.string(), port: z.number(),
      user: z.string(), password: z.string(),
      tls: z.boolean().default(true),
      from: z.string(), to: z.string(), cc: z.string().optional(),
      subject: z.string(), html: z.string(),
      inReplyTo: z.string().optional(),
      attachments: z.array(z.object({ filename: z.string(), content: z.string(), contentType: z.string().optional() })).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        await sendSMTP({ ...input, rejectUnauthorized: false });
        return { ok: true };
      } catch (e: any) {
        console.error('[sendEmail] Failed:', e.message || e);
        return { ok: false, error: e.message?.substring(0, 200) || String(e).substring(0, 200) };
      }
    }),

  // ─── Test SMTP connection ───
  testSmtp: publicProcedure
    .input(z.object({
      host: z.string(), port: z.number(), user: z.string(), pass: z.string(),
      starttls: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      try {
        const nodemailer = await import('nodemailer');
        const transporter = nodemailer.default.createTransport({
          host: input.host, port: input.port, secure: input.port === 465,
          auth: { user: input.user, pass: input.pass },
          ...(input.starttls && input.port !== 465 ? { requireTLS: true } : {}),
          tls: { rejectUnauthorized: false },
          connectionTimeout: 10000, greetingTimeout: 10000,
        });
        await transporter.verify();
        return { ok: true };
      } catch (e: any) {
        return { ok: false, error: e.message?.substring(0, 200) || 'Connection failed' };
      }
    }),

  testIMAP: publicProcedure
    .input(z.object({
      host: z.string(), port: z.number(), user: z.string(), password: z.string(),
      tls: z.boolean().default(true), mailbox: z.string().default('INBOX'),
    }))
    .mutation(async ({ input }) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- avoids circular import at load time
        const { createIMAPConnector } = require('@tomilite/email');
        const connector = createIMAPConnector({
          host: input.host, port: input.port, user: input.user, password: input.password,
          tls: input.tls, mailbox: input.mailbox, pollIntervalSeconds: 60,
        });
        await connector.startWatching();
        await connector.stopWatching();
        return { ok: true };
      } catch (e: any) {
        return { ok: false, error: e.message?.substring(0, 200) || 'Connection failed' };
      }
    }),

  // ─── Stats ───
  stats: publicProcedure.query(async () => {
    const [total, unprocessed] = await Promise.all([
      prisma.smartEmail.count(),
      prisma.smartEmail.count({ where: { isProcessed: false } }),
    ]);
    return { total, unprocessed };
  }),

  // ─── Create linked task from email (AI generates title + description) ───
  createLinkedTask: publicProcedure
    .input(z.object({ smartEmailId: z.string(), lang: z.string().default('en') }))
    .mutation(async ({ input }) => {
      const email = await prisma.smartEmail.findUnique({ where: { id: input.smartEmailId } });
      if (!email) return { ok: false, error: 'Email not found' };
      if (email.issueId) return { ok: false, error: 'Task already linked' };

      // AI generate task title + description + type
      let taskTitle = (email.subject || 'No subject').replace(/^📥\s*/, '');
      let taskDesc = `**来自**: ${email.fromAddr}\n**AI 摘要**: ${email.summary || ''}`;
      let taskType = 'task';
      try {
        const provider = await prisma.llmProvider.findFirst({ where: { isActive: true } });
        if (provider?.apiKey) {
          const master = await prisma.llmProviderMaster.findFirst({ where: { providers: { some: { id: provider.id } } } });
          const cfg = await prisma.llmConfig.findFirst();
          const apiKey = await decrypt(provider.apiKey);
          const langLabel = input.lang === 'zh' ? 'Chinese' : 'English';
          const base = master?.apiBaseUrl || '';
          const body: any = {
            model: cfg?.flashModel || 'deepseek-chat',
            messages: [{
              role: 'user',
              content: `Generate a task from this email. Determine type (task/bug/story):\n- bug: error report, incident, broken feature\n- story: feature request, new requirement\n- task: general work item, action required\n\nFrom: ${email.fromAddr}\nSubject: ${email.subject}\nSummary: ${email.summary || ''}\n\nOutput ONLY valid JSON in ${langLabel}:\n{"type":"task|bug|story","title":"under 50 chars","description":"Markdown, 2-3 bullet points"}`,
            }],
            max_tokens: 350, temperature: 0,
          };
          if (base.includes('moonshot') || base.includes('deepseek')) body.thinking = { type: 'disabled' };
          else if (base.includes('dashscope')) body.enable_thinking = false;
          const resp = await fetch(`${base}/chat/completions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10000),
          });
          if (resp.ok) {
            const d = await resp.json();
            const raw = (d.choices?.[0]?.message?.content || '{}').replace(/^```json?\s*/, '').replace(/\s*```$/, '').trim();
            try {
              const ai = JSON.parse(raw);
              if (ai.title) taskTitle = ai.title;
              if (ai.description) taskDesc = ai.description;
              if (['task', 'bug', 'story'].includes(ai.type)) taskType = ai.type;
            } catch { /* keep defaults */ }
          }
        }
      } catch { /* keep defaults */ }

      // Create Issue
      const maxNum = await prisma.issue.aggregate({ where: { projectId: 'proj-default' }, _max: { issueNumber: true } });
      const nowStr = new Date().toLocaleString('sv-SE').replace('T', ' ');
      const issue = await prisma.issue.create({
        data: {
          projectId: 'proj-default',
          issueNumber: (maxNum._max.issueNumber ?? 0) + 1,
          title: taskTitle,
          description: taskDesc,
          type: taskType,
          status: 'todo',
          priority: email.category === 1 ? 'critical' : email.category === 2 ? 'high' : 'medium',
          createdAt: nowStr, updatedAt: nowStr,
        },
      });
      await prisma.smartEmail.update({ where: { id: input.smartEmailId }, data: { issueId: issue.id } });
      return { ok: true, issue: { id: issue.id, issueNumber: issue.issueNumber, title: issue.title, status: issue.status, priority: issue.priority } };
    }),

  // ─── Unlink and delete task ───
  unlinkTask: publicProcedure
    .input(z.object({ smartEmailId: z.string() }))
    .mutation(async ({ input }) => {
      const email = await prisma.smartEmail.findUnique({ where: { id: input.smartEmailId } });
      if (!email?.issueId) return { ok: false, error: 'No linked task' };
      try {
        await prisma.issue.delete({ where: { id: email.issueId } });
      } catch { /* already deleted */ }
      await prisma.smartEmail.update({ where: { id: input.smartEmailId }, data: { issueId: null } });
      return { ok: true };
    }),

  // ─── AI Sub-Group by Category (flash model) ───
  subGroupByCategory: publicProcedure
    .input(z.object({ emailIds: z.array(z.string()), category: z.number(), lang: z.string().default('en') }))
    .mutation(async ({ input }) => {
      if (!input.emailIds.length) return { groups: [] };
      const emails = await prisma.smartEmail.findMany({
        where: { id: { in: input.emailIds } },
        select: { id: true, subject: true, fromAddr: true, summary: true, category: true, date: true, isRead: true, isReplied: true, issueId: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!emails.length) return { groups: [] };

      const provider = await prisma.llmProvider.findFirst({ where: { isActive: true } });
      if (!provider?.apiKey) return { groups: [], error: 'no provider' };
      const master = await prisma.llmProviderMaster.findFirst({ where: { providers: { some: { id: provider.id } } } });
      if (!master?.apiBaseUrl) return { groups: [], error: 'no master' };
      const cfg = await prisma.llmConfig.findFirst().catch(() => null);
      const apiKey = await decrypt(provider.apiKey);

      const emailList = emails.slice(0, 20).map(e =>
        `[${e.id}] ${e.subject} | ${(e.summary || '').substring(0, 100)}`
      ).join('\n');

      // Category-specific prompts — groupKey is the contract, label is for LLM context only
      const prompts: Record<number, string> = {
        1: `Group these urgent emails into sub-groups by topic. Use groupKeys: "incident", "escalation", "other".
Output JSON: {"groups":[{"groupKey":"incident","emailIds":["id1"]},{"groupKey":"other","emailIds":["id2"]}]}

Emails:\n${emailList}`,
        2: `Group these action-required emails into sub-groups by topic. Use groupKeys: "review", "task", "question", "other".
Output JSON: {"groups":[{"groupKey":"review","emailIds":["id1"]},{"groupKey":"task","emailIds":["id2"]}]}

Emails:\n${emailList}`,
        3: `Group these notification emails into sub-groups by content. Use groupKeys: "security", "system", "report", "other".
Output JSON: {"groups":[{"groupKey":"security","emailIds":["id1"]},{"groupKey":"system","emailIds":["id2"]}]}

Emails:\n${emailList}`,
        4: `Group these low-priority emails into sub-groups by content. Use groupKeys: "promo", "digest", "other".
Output JSON: {"groups":[{"groupKey":"promo","emailIds":["id1"]},{"groupKey":"digest","emailIds":["id2"]}]}

Emails:\n${emailList}`,
      };
      const promptContent = prompts[input.category];
      if (!promptContent) return { groups: [], error: 'no prompt for cat ' + input.category };

      let groups: Array<{ groupKey: string; label: string; emailIds: string[] }> = [];
      try {
        const model = cfg?.flashModel || cfg?.proModel || 'deepseek-chat';
        const body: any = {
          model, max_tokens: 400, temperature: 0,
          messages: [{ role: 'user', content: promptContent }],
        };
        const baseUrl = master.apiBaseUrl || '';
        if (baseUrl.includes('moonshot') || baseUrl.includes('deepseek')) body.thinking = { type: 'disabled' };
        else if (baseUrl.includes('dashscope')) body.enable_thinking = false;
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(12000),
        });
        if (resp.ok) {
          const d = await resp.json();
          const raw = d.choices?.[0]?.message?.content || '{}';
          const json = raw.replace(/^```json?\s*/, '').replace(/\s*```$/, '').trim();
          let parsed: any = {};
          try { parsed = JSON.parse(json); } catch {
            const m = raw.match(/\{[\s\S]*\}/);
            if (m) try { parsed = JSON.parse(m[0]); } catch { /* fall through */ }
          }
          groups = (parsed.groups || []).map((g: any) => ({
            groupKey: g.groupKey || 'other',
            label: g.label || g.groupKey || 'Other',
            emailIds: g.emailIds || [],
          }));
        }
      } catch (e: any) {
        console.error('[subGroupByCategory] cat=' + input.category + ' err:', e.message || e);
      }

      // Always add uncategorized emails as "other"
      const groupedIds = new Set(groups.flatMap((g) => g.emailIds));
      const otherIds = emails.filter(e => !groupedIds.has(e.id)).map(e => e.id);
      if (otherIds.length) {
        const otherLabel = input.lang === 'zh' ? '其他' : input.lang === 'ja' ? 'その他' : 'Other';
        groups.push({ groupKey: 'other', label: otherLabel, emailIds: otherIds });
      }
      return { groups: groups.filter((g) => g.emailIds.length > 0) };
    }),

  // ─── AI Topic Grouping ───
  groupByTopic: publicProcedure
    .input(z.object({ emailIds: z.array(z.string()), lang: z.string().default('en') }))
    .mutation(async ({ input }) => {
      if (!input.emailIds.length) return { groups: [] };
      const emails = await prisma.smartEmail.findMany({
        where: { id: { in: input.emailIds } },
        select: { id: true, subject: true, fromAddr: true, summary: true, category: true, date: true, isRead: true, isReplied: true, issueId: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!emails.length) return { groups: [] };

      const provider = await prisma.llmProvider.findFirst({ where: { isActive: true } });
      if (!provider?.apiKey) return { groups: [{ topic: 'All', emails }] };
      const master = await prisma.llmProviderMaster.findFirst({ where: { providers: { some: { id: provider.id } } } });
      const cfg = await prisma.llmConfig.findFirst();
      const apiKey = await decrypt(provider.apiKey);
      const langLabel = input.lang === 'zh' ? 'Chinese' : input.lang === 'ja' ? 'Japanese' : 'English';

      const emailList = emails.map(e =>
        `[${e.id}] ${e.subject} | from: ${e.fromAddr?.replace(/<[^>]+>/, '').replace(/"/g, '').trim().substring(0, 20)} | ${(e.summary || '').substring(0, 80)}`
      ).join('\n');

      try {
        const base = master?.apiBaseUrl || '';
        const reqBody: any = {
          model: cfg?.flashModel || 'deepseek-chat',
          messages: [{
            role: 'user',
            content: `Group these emails into 2-4 topic clusters by subject/project. Output JSON array.\n\nEmails:\n${emailList}\n\nOutput ONLY valid JSON:\n[{"topic":"Short topic name in ${langLabel}","emailIds":["id1","id2"]}]`,
          }],
          max_tokens: 500, temperature: 0,
        };
        if (base.includes('moonshot') || base.includes('deepseek')) reqBody.thinking = { type: 'disabled' };
        else if (base.includes('dashscope')) reqBody.enable_thinking = false;
        const resp = await fetch(`${base}/chat/completions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(reqBody),
          signal: AbortSignal.timeout(15000),
        });
        if (!resp.ok) return { groups: [{ topic: input.lang === 'zh' ? '全部' : 'All', emails }] };
        const d = await resp.json();
        const raw = d.choices?.[0]?.message?.content || '{}';
        const json = raw.replace(/^```json?\s*/, '').replace(/\s*```$/, '').trim();
        let parsed: any = {};
        try { parsed = JSON.parse(json); } catch {
          const m = raw.match(/\{[\s\S]*\}/);
          if (m) try { parsed = JSON.parse(m[0]); } catch { return { groups: [{ topic: input.lang === 'zh' ? '全部' : 'All', emails }] }; }
        }
        const groups = (parsed.groups || []).map((g: any) => ({
          topic: g.topic,
          emails: (g.emailIds || []).map((id: string) => emails.find(e => e.id === id)).filter(Boolean),
        }));
        // Add uncategorized emails as "Other"
        const groupedIds = new Set(groups.flatMap((g: any) => g.emails.map((e: any) => e.id)));
        const other = emails.filter(e => !groupedIds.has(e.id));
        const otherTopic = input.lang === 'zh' ? '其他' : input.lang === 'ja' ? 'その他' : 'Other';
        if (other.length) groups.push({ topic: otherTopic, emails: other });
        // Persist topicGroup to all emails (awaited — must complete before response)
        const topicMap: Record<string, string> = {};
        for (const g of groups) for (const e of g.emails) topicMap[e.id] = g.topic;
        await Promise.all(Object.entries(topicMap).map(([id, topic]) =>
          prisma.smartEmail.update({ where: { id }, data: { topicGroup: topic } }).catch(() => {})
        )).catch(() => {});
        return { groups: groups.filter((g: any) => g.emails.length > 0) };
      } catch {
        return { groups: [{ topic: input.lang === 'zh' ? '全部' : 'All', emails }] };
      }
    }),
});
