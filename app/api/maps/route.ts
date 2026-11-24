import { auth } from '@/auth';
import { mapStore } from '@/lib/maps/store.mjs';
import { errorResponse, json, notAdmin, notSignedIn, readBody } from '@/lib/maps/http';

export const dynamic = 'force-dynamic';

// GET: every map (no courses), for anyone signed in: the room host picks one.
export async function GET() {
  const session = await auth();
  if (!session?.user) return notSignedIn();
  return json({ maps: await mapStore().list() });
}

// POST { name, from?: map id to copy, course?: a course (an editor Export) }: a new map. Super admin only.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return notSignedIn();
  if (!session.user.admin) return notAdmin();
  try {
    const b = await readBody(req);
    const map = await mapStore().create({ name: b.name, from: typeof b.from === 'string' ? b.from : null, course: b.course, by: session.user.email ?? session.user.id });
    return json({ map: { id: map.id, name: map.name, updatedAt: map.updatedAt } }, 201);
  } catch (e) { return errorResponse(e); }
}
