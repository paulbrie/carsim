import { auth } from '@/auth';
import { autopilotStore } from '@/lib/autopilots/store.mjs';
import { json } from '@/lib/autopilots/http';
import { publicName } from '@/lib/format';

export const dynamic = 'force-dynamic';

// what it was timed with (#351's configuration): the lab's settings, the penalties and the car's setup, so the preview and the
// duel drive its exam's lap, not one with the visitor's settings. Not the lap it followed (whose it was); null: saved before #351
function driveConfig(c: unknown) {
  if (!c || typeof c !== 'object') return null;
  const { cfg, pen, setup } = c as Record<string, unknown>;
  return cfg && typeof cfg === 'object' ? { cfg, pen: pen ?? null, setup: setup ?? null } : null;
}
type Ctx = { params: Promise<{ id: string }> };

// GET: a saved network, to watch it drive (#336's preview; the duels' page, /duel, which drives it against a human's lap). No
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
        config: driveConfig(a.config),
      },
    });
  } catch (e) {
    console.error('[networks]', e);
    return json({ error: 'The network could not be read.' }, 500);
  }
}
