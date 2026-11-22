import { bridge } from '@/lib/bridge/store.mjs';
import { agentToken, errorResponse, json } from '@/lib/bridge/http';

export const dynamic = 'force-dynamic';
// GET ?after=<seq>&wait=<s>: the user's messages since after, waiting up to wait s (25 at most) for one.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try { return json(await bridge().events(agentToken(req), Number(q.get('after')) || 0, Math.min(25, Number(q.get('wait')) || 0) * 1000)); } catch (e) { return errorResponse(e); }
}
