import { bridge } from '@/lib/bridge/store.mjs';
import { errorResponse, json, pageAuth } from '@/lib/bridge/http';

export const dynamic = 'force-dynamic';
// POST: a new pairing: { pageId, pageToken, code, expiresAt } (the code is shown in the sim for the agent to claim).
export async function POST(req: Request) {
  try { const { user } = await pageAuth(req); return json(bridge().pair(user)); } catch (e) { return errorResponse(e); }
}
