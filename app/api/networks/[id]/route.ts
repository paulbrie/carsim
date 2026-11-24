import { auth } from '@/auth';
import { autopilotStore } from '@/lib/autopilots/store.mjs';
import { json } from '@/lib/autopilots/http';
import { publicName } from '@/lib/format';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

// GET: a saved network, to watch it drive (#336: the networks page's Watch it drive, /sim/index.html?net=<id>). No
// sign-in, as the page itself: only what it takes to drive (its inputs, size and driving weights: the best ones) and
// what the page already shows about it. Not the optimiser's state, the chart or who saved it beyond the page's name.
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const a = await autopilotStore().get(id);
    if (!a) return json({ error: 'No such network.' }, 404);
    const session = await auth();
    return json({
      network: {
        id: a.id, name: a.name, by: publicName(a.ownerName ?? 'Driver', !!session?.user), vehicle: a.vehicle, course: a.course, ground: String(a.ground ?? '').toLowerCase(),
        h: a.h, inputs: a.inputs, handbrake: !!a.handbrake, keyPedals: !!a.keyPedals, keySteering: !!a.keySteering, noBrake: !!a.noBrake,
        weights: a.weights, w: a.best ?? a.w, gen: a.gen, bestLap: a.bestLap ?? null,
      },
    });
  } catch (e) {
    console.error('[networks]', e);
    return json({ error: 'The network could not be read.' }, 500);
  }
}
