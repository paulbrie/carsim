import { bridgeReady } from '@/lib/bridge/store.mjs';
import { body, errorResponse, json, pageAuth } from '@/lib/bridge/http';

export const dynamic = 'force-dynamic';
// POST { standing? }: a new pairing: { pageId, pageToken, code, expiresAt } (the code is shown in the sim for the agent to
// claim; standing: the page paired by itself, for an agent with the server's key, #348: the super admin's pages only).
export async function POST(req: Request) {
  try { const { user, admin } = await pageAuth(req); const b = await body(req); return json((await bridgeReady()).pair(user, { standing: admin && b.standing === true, admin })); } catch (e) { return errorResponse(e); }
}
