import { showcase } from '@/lib/showcase/store.mjs';
import { json } from '@/lib/maps/http';

export const dynamic = 'force-dynamic';

// GET: every track (the race rooms' maps), for the sim's start menu when it drives alone (#329): no sign-in, as
// the home page shows them. Each: id, name, v (its last save), the sim's course key, its waypoints (to draw
// it), its length in metres and its bridges. Read-only; who edited it is not said. The courses: /api/tracks/<id>.
export async function GET() {
  try {
    const tracks = (await showcase().tracks()).map(t => ({ id: t.id, name: t.name, v: t.v, key: t.key, wp: t.wp, length: t.length, bridges: t.bridges }));
    return json({ tracks }, 200, { 'cache-control': 'public, max-age=10' });
  } catch (e) {
    console.error('[tracks]', e);
    return json({ error: 'The tracks could not be read.' }, 500);
  }
}
