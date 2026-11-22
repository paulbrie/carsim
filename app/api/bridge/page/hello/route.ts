import { bridge } from '@/lib/bridge/store.mjs';
import { body, errorResponse, json, pageAuth } from '@/lib/bridge/http';

export const dynamic = 'force-dynamic';
// POST { pageId, url, title }: where the page is (on connect); 404 if the pairing is gone.
export async function POST(req: Request) {
  try { const { pageToken } = await pageAuth(req); const b = await body(req); return json(bridge().hello(String(b.pageId), pageToken, b)); } catch (e) { return errorResponse(e); }
}
