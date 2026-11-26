import { bridgeReady } from '@/lib/bridge/store.mjs';
import { body, errorResponse, json, pageAuth } from '@/lib/bridge/http';

export const dynamic = 'force-dynamic';
// POST { pageId, id, ok, data?, error? }: the page's answer to a command.
export async function POST(req: Request) {
  try { const { user, pageToken } = await pageAuth(req); const b = await body(req); return json({ taken: (await bridgeReady()).result(String(b.pageId), pageToken, { id: b.id, ok: b.ok, data: b.data, error: b.error }, user) }); } catch (e) { return errorResponse(e); }
}
