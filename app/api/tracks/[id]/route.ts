import { mapStore } from '@/lib/maps/store.mjs';
import { json } from '@/lib/maps/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

// GET: a track's course (null: the sim's own figure-8), to drive it alone (#329): no sign-in. Only what the sim
// needs: id, name, v (its last save) and the course; ?v=<v> (the list's) makes the answer cacheable.
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const map = await mapStore().get(id);
    if (!map) return json({ error: 'No such track.' }, 404);
    const v = new URL(req.url).searchParams.get('v');
    const cache: Record<string, string> = v != null && v === String(map.updatedAt) ? { 'cache-control': 'public, max-age=31536000, immutable' } : {};
    return json({ track: { id: map.id, name: map.name, v: map.updatedAt, course: map.course ?? null } }, 200, cache);
  } catch (e) {
    console.error('[tracks]', e);
    return json({ error: 'The track could not be read.' }, 500);
  }
}
