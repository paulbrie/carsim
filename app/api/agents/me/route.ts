import { agentStore } from '@/lib/agents/store.mjs';
import { autopilotStore } from '@/lib/autopilots/store.mjs';
import { agentAuth, agentView, errorResponse, json, networkView } from '@/lib/agents/http';
import { showcase } from '@/lib/showcase/store.mjs';
import { siteUrl } from '@/lib/site-url';

export const dynamic = 'force-dynamic';

// GET: the agent itself (its key in the Authorization header) and the networks it has sent in.
export async function GET(req: Request) {
  try {
    const a = await agentAuth(req), board = await showcase().board().catch(() => null), site = siteUrl(req.headers);
    return json({ agent: agentView(a), networks: (await autopilotStore().listBy(a.uid)).map(n => networkView(n, board, site)) });
  } catch (e) { return errorResponse(e); }
}

// DELETE: the account and its networks, gone.
export async function DELETE(req: Request) {
  try {
    const a = await agentAuth(req);
    await agentStore().remove(a.id, { agent: a.id });
    showcase().forget();
    return json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
