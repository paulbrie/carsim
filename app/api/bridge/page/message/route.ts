import { bridgeReady } from '@/lib/bridge/store.mjs';
import { body, errorResponse, json, pageAuth } from '@/lib/bridge/http';

export const dynamic = 'force-dynamic';
// POST { pageId, text }: the user writes to the agent.
export async function POST(req: Request) {
  try { const { pageToken } = await pageAuth(req); const b = await body(req); return json((await bridgeReady()).message(String(b.pageId), pageToken, b.text)); } catch (e) { return errorResponse(e); }
}
