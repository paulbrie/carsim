import { bridgeReady } from '@/lib/bridge/store.mjs';
import { body, errorResponse, json, pageAuth } from '@/lib/bridge/http';

export const dynamic = 'force-dynamic';
// POST { pageId }: the user disconnects; the agent's token ends with it.
export async function POST(req: Request) {
  try { const { user, pageToken } = await pageAuth(req); const b = await body(req); (await bridgeReady()).close(String(b.pageId), pageToken, user); return json({ ok: true }); } catch (e) { return errorResponse(e); }
}
