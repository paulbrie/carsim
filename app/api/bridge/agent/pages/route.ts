import { bridgeReady } from '@/lib/bridge/store.mjs';
import { errorResponse, json } from '@/lib/bridge/http';

export const dynamic = 'force-dynamic';
// GET (header x-bridge-key: the server's CLAUDE_BRIDGE_AGENT_KEY): the super admin's open sim pages, the newest first (#348).
export async function GET(req: Request) {
  try { return json({ pages: (await bridgeReady()).list(req.headers.get('x-bridge-key')) }); } catch (e) { return errorResponse(e); }
}
