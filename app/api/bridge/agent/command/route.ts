import { bridgeReady } from '@/lib/bridge/store.mjs';
import { agentToken, body, errorResponse, json } from '@/lib/bridge/http';

export const dynamic = 'force-dynamic';
// POST { type, args }: a command to the page, answered within 30 s → { ok, data? , error? } (504 if it didn't answer).
export async function POST(req: Request) {
  try {
    const b = await body(req), r = await (await bridgeReady()).command(agentToken(req), { type: b.type, args: b.args });
    return json(r, r.timeout ? 504 : 200);
  } catch (e) { return errorResponse(e); }
}
