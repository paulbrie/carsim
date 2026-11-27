import { showcase } from '@/lib/showcase/store.mjs';
import { publicName } from '@/lib/format';
import { json } from '@/lib/maps/http';
import { siteUrl } from '@/lib/site-url';

export const dynamic = 'force-dynamic';

// GET: the leaderboard as data, for agents (docs/agents.md): what the leaderboard page shows a visitor, no more. For
// each track and ground with a lap on it, car by car: the best human lap and the best network lap, on the track as it
// is laid out now. ?track=<id>&ground=<key>&car=<key> narrow it. People's names as the public pages write them.
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams, site = siteUrl(req.headers), b = await showcase().board();
    const boards = b.boards.filter(x => (!q.get('track') || x.track === q.get('track')) && (!q.get('ground') || x.ground === q.get('ground'))).map(x => ({
      track: x.track, ground: x.ground,
      cars: x.rows.filter(r => !q.get('car') || r.vehicle === q.get('car')).map(r => ({
        car: r.vehicle,
        human: r.human ? { name: publicName(r.human.name, false), time: r.human.time } : null,
        network: r.tnn ? {
          id: r.tnn.saved ? r.tnn.id : null, name: r.tnn.name, by: r.tnn.agent ? r.tnn.ownerName : publicName(r.tnn.ownerName, false), agent: r.tnn.agent,
          time: r.tnn.time, timed: r.tnn.timed, weights: r.tnn.weights, hidden: r.tnn.h, ...(r.tnn.saved ? { url: `${site}/api/networks/${r.tnn.id}` } : {}),
        } : null,
      })),
    })).filter(x => x.cars.length);
    return json({ tracks: b.tracks.map(t => ({ id: t.id, name: t.name, length: t.length, key: t.key })), boards }, 200, { 'cache-control': 'public, max-age=10' });
  } catch (e) {
    console.error('[leaderboard]', e);
    return json({ error: 'The leaderboard could not be read.' }, 500);
  }
}
