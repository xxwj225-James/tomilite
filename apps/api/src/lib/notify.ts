import { prisma } from '@tomilite/database';

// ─── OS Notification helper ───
//
// The one delivery path to a Windows toast: Electron's main process listens on
// 127.0.0.1:3191 and shows the notification + bumps the tray badge. Lives here
// rather than in server.ts because background sweeps (meeting reminders) need it
// too, and importing the whole server module for one function is not a thing.
//
// Deliberately swallows every error: the notification host is optional (a
// headless/dev API has nothing listening on :3191), and a missing toast must
// never take down the caller that was only trying to be helpful.
export async function sendNotification(title: string, body: string) {
  try {
    await fetch('http://127.0.0.1:3191/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title, body: body }),
    });
    // Increment notification count
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'notifyCount' } });
    const count = (cfg ? parseInt(cfg.value) || 0 : 0) + 1;
    await prisma.systemConfig.upsert({
      where: { key: 'notifyCount' },
      create: { key: 'notifyCount', value: String(count) },
      update: { value: String(count) },
    });
  } catch {}
}
