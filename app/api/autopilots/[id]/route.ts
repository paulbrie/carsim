import { auth } from '@/auth';
import { autopilotStore } from '@/lib/autopilots/store.mjs';
import { agentIdOf, agentStore } from '@/lib/agents/store.mjs';
import { showcase } from '@/lib/showcase/store.mjs';
import { errorResponse, json, notSignedIn } from '@/lib/autopilots/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

// GET: one, with its weights, for anyone signed in (to load it into their sim).
export async function GET(_req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user) return notSignedIn();
  const { id } = await params;
  const a = await autopilotStore().get(id);
  if (!a) return json({ error: 'No such autopilot.' }, 404);
  return json({ autopilot: { ...a, mine: a.owner === session.user.id, owner: undefined } });
}

// DELETE: whoever saved it, or the super admin; an agent's network: whoever claimed the agent (lib/agents).
export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user) return notSignedIn();
  const { id } = await params;
  try {
    const a = await autopilotStore().get(id), agent = a ? agentIdOf(a.owner) : null;
    const theirs = !!agent && (await agentStore().get(agent))?.owner === session.user.id;
    await autopilotStore().delete(id, { owner: session.user.id, admin: !!session.user.admin || theirs });
    showcase().forget();
    return json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
