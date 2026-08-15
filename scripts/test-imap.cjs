/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS script */
// Test IMAP connectivity and new message detection
const { execSync } = require('child_process');
const path = require('path');

// Read IMAP config from DB
const dbPath = path.join(require('os').homedir(), '.tomilite', 'dev.db');
console.log('DB path:', dbPath);

(async () => {
try {
  // Get IMAP config
  const integrations = JSON.parse(execSync(
    `node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient({datasources:{db:{url:'file:${dbPath.replace(/\\/g,'\\\\')}'}}});p.integration.findMany({where:{type:'imap',enabled:true}}).then(r=>{console.log(JSON.stringify(r));process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})"`,
    { timeout: 10000, stdio: 'pipe' }
  ).toString().trim());

  console.log('IMAP configs found:', integrations.length);
  if (!integrations.length) { console.log('No enabled IMAP integration found!'); process.exit(1); }

  const cfg = JSON.parse(integrations[0].config);
  // Decrypt password (same as app does)
  const { decrypt } = await import('../apps/api/src/lib/crypto.js');
  const pass = await decrypt(cfg.pass || cfg.password || '');
  console.log('Connecting to:', cfg.host, cfg.port, 'user:', cfg.user, 'pass len:', pass.length);

  // Test IMAP connection using imapflow
  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({
    host: cfg.host,
    port: parseInt(cfg.port),
    secure: true,
    auth: { user: cfg.user, pass },
    logger: false,
  });

  (async () => {
    try {
      await client.connect();
      console.log('✅ IMAP connected');

      const lock = await client.getMailboxLock('INBOX');
      try {
        const status = await client.status('INBOX', { messages: true, uidNext: true, unseen: true });
        console.log('Mailbox status:', status);

        // Fetch last 5 messages
        const count = status.messages || 0;
        const fetchRange = `${Math.max(1, count - 4)}:${count}`;
        console.log('Fetching range:', fetchRange);

        const msgs = [];
        for await (const msg of client.fetch(fetchRange, { uid: true, flags: true, envelope: true })) {
          msgs.push({ uid: msg.uid, seq: msg.seq, subject: msg.envelope?.subject, date: msg.envelope?.date });
        }
        console.log('Last 5 messages:');
        msgs.forEach(m => console.log('  UID:', m.uid, 'Subject:', m.subject, 'Date:', m.date));

        // Check for new messages by UID
        const uidNext = status.uidNext || 1;
        console.log('Next UID would be:', uidNext, '(messages with UID >= this are new)');
      } finally {
        lock.release();
      }
      await client.logout();
      console.log('✅ Test complete');
    } catch (e) {
      console.error('❌ IMAP error:', e.message);
    }
    process.exit(0);
  })();
} catch (e) {
  console.error('Failed:', e.message);
  process.exit(1);
}
})();
