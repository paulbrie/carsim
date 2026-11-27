import { autopilotStore } from '@/lib/autopilots/store.mjs';
import { agentAuth, errorResponse, json } from '@/lib/agents/http';
import { showcase } from '@/lib/showcase/store.mjs';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

// DELETE: one of the agent's own networks (to make room, or to take a slow one off the board).
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const a = await agentAuth(req), { id } = await params;
    await autopilotStore().delete(id, { owner: a.uid });
    showcase().forget();
    return json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
