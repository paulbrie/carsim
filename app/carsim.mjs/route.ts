import { simModule } from '@/lib/sim-module/serve.mjs';

export const dynamic = 'force-dynamic';
// GET /carsim.mjs: the simulator as one module to download (#355, lib/sim-module): the engine as the game runs it, without
// a screen. For anyone, from anywhere (a browser may import it from another site: CORS is open; nothing in it is a
// visitor's). ETag: its build id, so it is fetched again only when the engine changed.
export function GET(req: Request) {
  try {
    const m = simModule(), etag = `"${m.build}"`;
    const head = { etag, 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*', 'x-carsim-build': m.build };
    if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: head });
    return new Response(m.source, { headers: { ...head, 'content-type': 'text/javascript; charset=utf-8' } });
  } catch (e) {
    console.error('[carsim.mjs]', e);
    return new Response('// carsim.mjs could not be built on the server just now.\n', { status: 500, headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } });
  }
}
