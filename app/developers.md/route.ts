import { devDocs } from '@/lib/dev-docs';
import { siteUrl } from '@/lib/site-url';

export const dynamic = 'force-dynamic';
// GET /developers.md: the developers' page as markdown, for agents (#355): the same text (docs/simulator.md).
export function GET(req: Request) {
  try { return new Response(devDocs(siteUrl(req.headers)), { headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } }); }
  catch (e) { console.error('[developers.md]', e); return new Response('The documentation could not be read.\n', { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } }); }
}
