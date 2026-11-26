import { bridgeOn } from '@/lib/bridge/store.mjs';
import { agentToken, caller } from '@/lib/bridge/http';
import { mcpHandle } from '@/lib/bridge/mcp.mjs';

export const dynamic = 'force-dynamic';
// The agent bridge as an MCP server (#355, lib/bridge/mcp.mjs): POST a JSON-RPC message (or a batch), get its answer as
// JSON; the session comes back from `initialize` in Mcp-Session-Id. Open to anyone, as the claim route is: what a
// session may do is what the code it claimed lets it (a driver's own page). No cookies are read, so any origin may call
// it (a browser's MCP inspector): CORS is open.
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id',
  'access-control-expose-headers': 'mcp-session-id', 'access-control-max-age': '86400' };
const reply = (body: unknown, status = 200, more: Record<string, string> = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...(body === null ? {} : { 'content-type': 'application/json' }), 'cache-control': 'no-store', ...CORS, ...more } });
const rpcError = (message: string, status: number) => reply({ jsonrpc: '2.0', id: null, error: { code: -32600, message } }, status);

export async function POST(req: Request) {
  if (!bridgeOn()) return rpcError('Not found.', 404);
  const raw = await req.text();
  if (raw.length > 256 * 1024) return rpcError('Too big.', 413);
  let msg: unknown;
  try { msg = JSON.parse(raw); } catch { return reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Not JSON.' } }, 400); }
  const ctx = { session: req.headers.get('mcp-session-id') || '', bearer: agentToken(req), who: caller(req) };
  const list = Array.isArray(msg) ? msg.slice(0, 20) : [msg];
  if (!list.length) return rpcError('An empty batch.', 400);
  let session = '';
  const answers: object[] = [];
  for (const m of list) {
    const r = await mcpHandle(m, { ...ctx, session: session || ctx.session });
    if (r.session) session = r.session;
    if (r.answer) answers.push(r.answer);
  }
  const head: Record<string, string> = session ? { 'mcp-session-id': session } : {};
  if (!answers.length) return reply(null, 202, head);                    // only notifications
  return reply(Array.isArray(msg) ? answers : answers[0], 200, head);
}
// no stream from the server (nothing is pushed: sim_events waits instead), and a session ends with its pairing
export function GET() { return rpcError('This server answers POST only (no event stream).', 405); }
export function DELETE() { return reply(null, 204); }
export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }
