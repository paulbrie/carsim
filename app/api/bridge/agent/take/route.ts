import { bridgeReady } from '@/lib/bridge/store.mjs';
import { body, errorResponse, json } from '@/lib/bridge/http';

export const dynamic = 'force-dynamic';
// POST { pageId?, agent } (header x-bridge-key): take that page, or the newest connected one, without a code (#348)
// → { agentToken, pageId }.
export async function POST(req: Request) {
  try {
    const b = await body(req);
    return json((await bridgeReady()).take(req.headers.get('x-bridge-key'), typeof b.pageId === 'string' ? b.pageId : '', b.agent));
  } catch (e) { return errorResponse(e); }
}
