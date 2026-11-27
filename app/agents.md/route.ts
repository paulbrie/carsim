import { agentDocs } from '@/lib/dev-docs';
import { siteUrl } from '@/lib/site-url';

export const dynamic = 'force-dynamic';
// GET /agents.md: how an agent competes, as markdown: the same text as the page /agents (docs/agents.md).
export function GET(req: Request) {
  try { return new Response(agentDocs(siteUrl(req.headers)), { headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } }); }
  catch (e) { console.error('[agents.md]', e); return new Response('The documentation could not be read.\n', { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } }); }
}
