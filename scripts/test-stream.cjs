// Simulate agent stream with the user's conversation to reproduce DeepSeek 400
const https = require('https');
const http = require('http');

async function main() {
  // Read LLM config from DB
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient({ datasources: { db: { url: `file:${require('os').homedir()}/.tomilite/dev.db` } } });

  const provider = await p.llmProvider.findFirst({ where: { isActive: true } });
  if (!provider?.apiKey) { console.log('No active LLM provider'); process.exit(1); }

  const master = await p.llmProviderMaster.findFirst({ where: { providers: { some: { id: provider.id } } } });
  const cfg = await p.llmConfig.findFirst();
  const baseUrl = master?.apiBaseUrl || 'https://api.deepseek.com';
  const model = cfg?.proModel || cfg?.flashModel || 'deepseek-v4-pro';

  // Decrypt API key
  const { decrypt } = await import('../apps/api/src/lib/crypto.js');
  const apiKey = await decrypt(provider.apiKey);

  // Build the exact messages that would be sent
  const systemPrompt = `You are Tomi, a dev companion. Use tools when needed.`;

  const history = [
    { role: 'user', content: '如果要做一个兼职，该如何规划时间管理' },
    { role: 'assistant', content: '说到兼职时间管理，核心就三个字：稳、准、狠 🎯\n\n需要我帮你建几个任务卡片，把兼职规划落地成可执行的计划吗？📋' },
  ];

  const userMessage = '好的';

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  // Same tools as the agent
  const tools = [
    { type: 'function', function: { name: 'create_issue', parameters: { type: 'object', properties: { title: { type: 'string' }, type: { type: 'string' }, priority: { type: 'string' }, description: { type: 'string' } }, required: ['title'] } } },
  ];

  const body = JSON.stringify({ model, stream: false, messages, tools, tool_choice: 'auto', max_tokens: 500 });

  console.log('Model:', model);
  console.log('Messages:', messages.length, 'items');
  console.log('Body length:', body.length);
  console.log('Sending...\n');

  const url = new URL(baseUrl + '/chat/completions');
  const fetcher = url.protocol === 'https:' ? https : http;

  const req = fetcher.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
  }, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      console.log('Status:', res.statusCode);
      if (res.statusCode !== 200) {
        console.log('Error body:', data.substring(0, 500));
      } else {
        const d = JSON.parse(data);
        console.log('Content:', d.choices?.[0]?.message?.content?.substring(0, 300));
        console.log('Tool calls:', d.choices?.[0]?.message?.tool_calls?.length || 0);
      }
    });
  });
  req.on('error', e => console.error('Network error:', e.message));
  req.write(body);
  req.end();

  await p.$disconnect();
}

main().catch(e => console.error(e.message));
