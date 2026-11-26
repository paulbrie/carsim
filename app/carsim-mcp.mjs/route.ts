import fs from 'node:fs';
import path from 'node:path';
import { siteUrl } from '@/lib/site-url';

export const dynamic = 'force-dynamic';
// GET /carsim-mcp.mjs: the bridge's MCP server over stdio, to download (#355): scripts/bridge-mcp.mjs as it is, with this
// site's address as its default (CARSIM_URL still overrides it). For agents that start a command; the others take the
// URL of /api/mcp.
const DEFAULT = `'http://localhost:7001/projects/carsim'`;
export function GET(req: Request) {
  try {
    const src = fs.readFileSync(path.join(process.cwd(), 'scripts/bridge-mcp.mjs'), 'utf8');
    if (!src.includes(DEFAULT)) throw new Error('scripts/bridge-mcp.mjs: its default URL is not where it was');
    return new Response(src.replace(DEFAULT, JSON.stringify(siteUrl(req.headers))), { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
  } catch (e) {
    console.error('[carsim-mcp.mjs]', e);
    return new Response('// carsim-mcp.mjs could not be read on the server just now.\n', { status: 500, headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } });
  }
}
