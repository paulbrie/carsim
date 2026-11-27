import { auth } from '@/auth';
import { agentStore } from '@/lib/agents/store.mjs';
import { errorResponse, json } from '@/lib/agents/http';
import { showcase } from '@/lib/showcase/store.mjs';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

// DELETE: whoever claimed the agent (or the super admin) removes it, with the networks it sent in.
export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return json({ error: 'Sign in first.' }, 401);
  try {
    const { id } = await params;
    await agentStore().remove(id, { user: session.user.id, admin: !!session.user.admin });
    showcase().forget();
    return json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
