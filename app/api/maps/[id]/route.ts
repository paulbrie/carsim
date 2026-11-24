import { auth } from '@/auth';
import { mapStore } from '@/lib/maps/store.mjs';
import { errorResponse, json, notAdmin, notSignedIn, readBody } from '@/lib/maps/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

// GET: a map with its course (null: the sim's own figure-8), for anyone signed in: every driver's sim loads it.
// ?v=<updatedAt> (what the room says) makes the answer cacheable: a save changes v.
export async function GET(req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user) return notSignedIn();
  const { id } = await params;
  const map = await mapStore().get(id);
  if (!map) return json({ error: 'No such map.' }, 404);
  const v = new URL(req.url).searchParams.get('v');
  const cache: Record<string, string> = v != null && v === String(map.updatedAt) ? { 'cache-control': 'private, max-age=31536000, immutable' } : {};
  return json({ map }, 200, cache);
}

// PUT { name?, course? }: rename it and/or save its course. Super admin only.
export async function PUT(req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user) return notSignedIn();
  if (!session.user.admin) return notAdmin();
  const { id } = await params;
  try {
    const b = await readBody(req);
    const map = await mapStore().update(id, { name: b.name, course: b.course, by: session.user.email ?? session.user.id });
    return json({ map: { id: map.id, name: map.name, updatedAt: map.updatedAt } });
  } catch (e) { return errorResponse(e); }
}

// DELETE: super admin only; the built-in figure-8 stays.
export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user) return notSignedIn();
  if (!session.user.admin) return notAdmin();
  const { id } = await params;
  try { await mapStore().delete(id); return json({ ok: true }); }
  catch (e) { return errorResponse(e); }
}
