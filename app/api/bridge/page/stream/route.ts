import { adminSession } from '@/auth';
import { bridge } from '@/lib/bridge/store.mjs';
import { json } from '@/lib/bridge/http';

export const dynamic = 'force-dynamic';
// GET ?pageId=&t=<pageToken> (EventSource can't set headers): server-sent events: status, command, ended, ping.
export async function GET(req: Request) {
  if (!(await adminSession())) return json({ error: 'Only the super admin can pair the sim with Claude.' }, 403);
  const q = new URL(req.url).searchParams, enc = new TextEncoder();
  let detach: (() => void) | null = null, ping: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    start(c) {
      const send = (event: string, data: unknown) => { try { c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* closed */ } };
      try { detach = bridge().attach(q.get('pageId') || '', q.get('t') || '', send); }
      catch (e) { send('ended', { why: (e as Error).message }); c.close(); return; }
      ping = setInterval(() => send('ping', {}), 15_000);
      req.signal.addEventListener('abort', () => { if (ping) clearInterval(ping); detach?.(); try { c.close(); } catch { /* closed */ } });
    },
    cancel() { if (ping) clearInterval(ping); detach?.(); },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no', connection: 'keep-alive' } });
}
