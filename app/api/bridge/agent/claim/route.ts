import { bridgeReady } from '@/lib/bridge/store.mjs';
import { body, errorResponse, json } from '@/lib/bridge/http';

export const dynamic = 'force-dynamic';
// POST { code, agent }: take the page showing that code → { agentToken, pageId }.
export async function POST(req: Request) {
  try { const b = await body(req); return json((await bridgeReady()).claim(b.code, b.agent)); } catch (e) { return errorResponse(e); }
}
