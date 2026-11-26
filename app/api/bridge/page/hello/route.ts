import { bridgeReady } from '@/lib/bridge/store.mjs';
import { body, errorResponse, json, pageAuth } from '@/lib/bridge/http';

export const dynamic = 'force-dynamic';
// POST { pageId, url, title }: where the page is (on connect); 404 if the pairing is gone.
export async function POST(req: Request) {
  try { const { user, pageToken } = await pageAuth(req); const b = await body(req); return json((await bridgeReady()).hello(String(b.pageId), pageToken, b, user)); } catch (e) { return errorResponse(e); }
}
