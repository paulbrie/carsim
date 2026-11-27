import { auth } from '@/auth';
import { armNetStore } from '@/lib/arm/store.mjs';
import { publicName } from '@/lib/format';
import { errorResponse, json, notSignedIn } from '@/lib/arm/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

// GET: one, with its network, to load it on /arm; anyone (#362).
export async function GET(_req: Request, { params }: Ctx) {
  const session = await auth(), me = session?.user?.id ?? null;
  const { id } = await params;
  const a = await armNetStore().get(id);
  if (!a) return json({ error: 'No such network.' }, 404);
  const { owner, ...n } = a;
  return json({ network: { ...n, ownerName: publicName(n.ownerName, !!me), mine: owner === me } });
}

// DELETE: whoever saved it, or the super admin.
export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user) return notSignedIn();
  const { id } = await params;
  try {
    await armNetStore().delete(id, { owner: session.user.id, admin: !!session.user.admin });
    return json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
