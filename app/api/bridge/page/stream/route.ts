import { auth } from '@/auth';
import { bridgeOn, bridgeReady } from '@/lib/bridge/store.mjs';
import { json } from '@/lib/bridge/http';

export const dynamic = 'force-dynamic';
// GET ?pageId=&t=<pageToken> (EventSource can't set headers): server-sent events: status, command, ended, ping.
export async function GET(req: Request) {
  if (!bridgeOn()) return json({ error: 'Not found.' }, 404);
  const user = (await auth())?.user?.id;
  if (!user) return json({ error: 'Sign in to pair the sim with an agent.' }, 403);
  const q = new URL(req.url).searchParams, enc = new TextEncoder(), br = await bridgeReady();   // (the kept pairings read in: a page back after a restart)
  let detach: (() => void) | null = null, ping: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    start(c) {
      const send = (event: string, data: unknown) => { try { c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* closed */ } };
      try { detach = br.attach(q.get('pageId') || '', q.get('t') || '', send, user); }
      catch (e) { send('ended', { why: (e as Error).message }); c.close(); return; }
      ping = setInterval(() => send('ping', {}), 15_000);
      req.signal.addEventListener('abort', () => { if (ping) clearInterval(ping); detach?.(); try { c.close(); } catch { /* closed */ } });
    },
    cancel() { if (ping) clearInterval(ping); detach?.(); },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no', connection: 'keep-alive' } });
}
