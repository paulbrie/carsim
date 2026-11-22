import { auth } from '@/auth';
import { autopilotStore } from '@/lib/autopilots/store.mjs';
import { errorResponse, json, notSignedIn } from '@/lib/autopilots/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

// GET: one, with its weights, for anyone signed in (to load it into their sim).
export async function GET(_req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user) return notSignedIn();
  const { id } = await params;
  const a = autopilotStore().get(id);
  if (!a) return json({ error: 'No such autopilot.' }, 404);
  return json({ autopilot: { ...a, mine: a.owner === session.user.id, owner: undefined } });
}

// DELETE: whoever saved it, or the super admin.
export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user) return notSignedIn();
  const { id } = await params;
  try { autopilotStore().delete(id, { owner: session.user.id, admin: !!session.user.admin }); return json({ ok: true }); }
  catch (e) { return errorResponse(e); }
}
