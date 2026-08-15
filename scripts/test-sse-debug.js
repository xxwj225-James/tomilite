// Simulate the SSE event processing from App.tsx to debug JSON stripping

// Read App.tsx and extract the relevant logic
// Simulate: the SSE events that arrive during a create_issue call

const testEvents = [
  { event: 'token', data: { text: '创建任务，debug UI与agent会话的交互的C方案（新）0710-9' } },
  { event: 'thinking', data: { iteration: 1 } },
  { event: 'token', data: { text: '\nUsing force_create_issue\n' } },
  { event: 'token', data: { text: '{"description": "## C方案架构设计 (v0710-9) · 第37次创建\\n\\n### 完整架构\\n- EventBus / SessionStateMachine / AgentSessionManager\\n- UIAdapter / DedupGuard / SmartMerge\\n- AutoHeal / Observability\\n\\n### 关联: TL-40~TL-65 全系列", "priority": "high", "title": "debug UI与agent会话的交互的C方案（新）0710-9", "type": "bug"}' } },
  { event: 'tool_call', data: { tool: 'force_create_issue', args: '{"title":"debug UI与agent会话的交互的C方案（新）0710-9","type":"bug","priority":"high","description":"## C方案架构设计 (v0710-9) · 第37次创建\\n\\n### 完整架构"}' } },
  { event: 'tool_result', data: { tool: 'force_create_issue', result: { id: 'fake-uuid', key: 'TL-66', title: 'debug UI与agent会话的交互的C方案（新）0710-9', type: 'bug', priority: 'high', status: 'todo' } } },
];

// Simulate the exact App.tsx SSE processing logic
let fullText = '';
let currentEvent = '';
let cardBuilt = false;

for (const evt of testEvents) {
  if (evt.event === 'token') { currentEvent = 'token'; }
  else if (evt.event === 'tool_call') { currentEvent = 'tool_call'; }
  else if (evt.event === 'tool_result') { currentEvent = 'tool_result'; }
  else { currentEvent = evt.event; }

  const data = evt.data;

  // ===== EXACT LOGIC FROM App.tsx =====

  // clean_text handler
  if (currentEvent === 'clean_text') {
    fullText = data.text || fullText;
    continue;
  }

  // progress
  if (currentEvent === 'progress') { continue; }

  // tool_call status
  if (currentEvent === 'tool_call') {
    console.log('  [tool_call status set]');
  }

  // data.text
  if (data.text) {
    const before = fullText.length;
    fullText += data.text;
    console.log(`  [token] +${fullText.length - before}B → total ${fullText.length}B text="${data.text.substring(0,50)}..."`);
  }

  // data.tool && data.args
  if (data.tool && data.args) {
    const beforeLen = fullText.length;
    console.log(`\n=== TOOL_CALL: ${data.tool} ===`);
    console.log(`  fullText before cut: ${beforeLen}B`);
    console.log(`  last 100 chars: "${fullText.substring(Math.max(0, fullText.length - 100))}"`);

    // === THE CUT LOGIC ===
    const cut = fullText.lastIndexOf('{');
    console.log(`  lastIndexOf('{'): ${cut}`);
    if (cut >= 0) {
      fullText = fullText.substring(0, cut).trimEnd();
      console.log(`  after cut: ${fullText.length}B`);
    } else {
      console.log(`  ❌ NO {{ FOUND — cut not applied`);
    }

    let brief = '';
    try {
      const a = JSON.parse(data.args);
      brief = a.title ? ` ${String(a.title).substring(0, 40)}` : '';
      console.log(`  parsed args title: "${a.title?.substring(0,40)}"`);
    } catch (e) {
      console.log(`  ❌ JSON.parse args FAILED: ${e.message}`);
    }
    fullText += `\n🔧 ${data.tool}${brief}`;
    console.log(`  final fullText (${fullText.length}B):`);
    console.log(`  "${fullText}"`);
  }

  // data.tool && data.result
  if (data.tool && data.result) {
    const r = data.result;
    console.log(`\n=== TOOL_RESULT: ${data.tool} ===`);
    console.log(`  keys: ${Object.keys(r).join(', ')}`);
    if (r.key) {
      console.log(`  ✅ CARD: ${r.key} ${r.title}`);
      cardBuilt = true;
    } else if (r.blocked) {
      console.log(`  🚫 BLOCKED — ${r.duplicates?.length || 0} duplicates`);
    } else {
      console.log(`  ⚠️ unknown result`);
    }
  }
}

console.log(`\n=== RESULT ===`);
console.log(`  fullText: "${fullText.substring(0, 200)}..."`);
console.log(`  card built: ${cardBuilt}`);
console.log(`  fullText contains JSON: ${fullText.includes('{"description"') || fullText.includes('{"title"')}`);
