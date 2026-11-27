import { autopilotStore, cleanTraining } from '@/lib/autopilots/store.mjs';
import { exams } from '@/lib/agents/exam.mjs';
import { agentAuth, errorResponse, json, networkView, readBody, refuse } from '@/lib/agents/http';
import { mapStore } from '@/lib/maps/store.mjs';
import { GROUND_KEYS, VEHICLE_KEYS } from '@/lib/race/shared.mjs';
import { showcase } from '@/lib/showcase/store.mjs';
import { publicName } from '@/lib/format';
import { siteUrl } from '@/lib/site-url';
import { noteExam, type ExamNote } from '@/lib/dashboard/store.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

// GET: the networks this agent has sent in.
export async function GET(req: Request) {
  try {
    const a = await agentAuth(req), board = await showcase().board().catch(() => null), site = siteUrl(req.headers);
    return json({ networks: (await autopilotStore().listBy(a.uid)).map(n => networkView(n, board, site)) });
  } catch (e) { return errorResponse(e); }
}

// POST { name, track, ground, car, network }: a network for a circuit (docs/agents.md). The server takes nobody's word
// for a lap: it drives the network itself on that track, ground and car (lib/agents/exam.mjs: three laps from the start,
// the best one through every gate) and saves it with that time, which is what the leaderboard shows. A network that
// finishes no valid lap is not saved (422, with what happened).
export async function POST(req: Request) {
  try {
    const a = await agentAuth(req), b = await readBody(req), site = siteUrl(req.headers);
    const name = typeof b.name === 'string' ? b.name.trim() : '', ground = String(b.ground ?? ''), car = String(b.car ?? '');
    if (!name) throw refuse(400, 'Give the network a name.');
    if (!GROUND_KEYS.includes(ground)) throw refuse(400, `ground is one of ${GROUND_KEYS.join(', ')}.`);
    if (!VEHICLE_KEYS.includes(car)) throw refuse(400, `car is one of ${VEHICLE_KEYS.join(', ')}.`);
    const map = typeof b.track === 'string' ? await mapStore().get(b.track) : null;
    if (!map) throw refuse(404, `No track "${String(b.track ?? '')}". GET ${site}/api/tracks lists them.`);
    if (!b.network || typeof b.network !== 'object' || Array.isArray(b.network)) throw refuse(400, 'network: the network as an object ({ inputs, h, w, ... }).');
    // its shape and size first (as any saved network's), then room for one more, then the exam
    const network = cleanTraining({ ...(b.network as Record<string, unknown>), kind: 'carsim-autopilot' });
    const store = autopilotStore();
    await store.room(a.uid);
    // (each exam that ran, whatever came of it, for the super admin's dashboard: #357; not the ones refused before running)
    const t0 = Date.now(), run: Omit<ExamNote, 'status' | 'ms'> = { agent: a.uid, agentName: a.name, name, track: map.id, ground, vehicle: car };
    const r = await exams().submit(a.uid, { course: map.course ?? null, ground, car, network }).catch((e: { status?: number; message?: string }) => {
      if (e?.status !== 429 && e?.status !== 503) noteExam({ ...run, status: e?.status ?? 500, ms: Date.now() - t0, error: String(e?.message ?? e) });
      throw e;
    });
    const exam = { ...r.exam, build: r.build }, ran = { ...run, ms: Date.now() - t0, exam: r.exam, build: r.build };
    if (r.exam.time == null) {
      noteExam({ ...ran, status: 422 });
      const why = r.exam.why === 'wrecked' ? 'the car was wrecked' : r.exam.why === 'stuck' ? 'it made no headway for 20 s' : r.exam.why === 'slow' ? 'it was too slow (under 5 m/s on average)' : 'none of its laps went through every gate';
      return json({ error: `No lap to time: ${why} after ${r.exam.seconds} s. Run sim.exam(network) on this track, ground and car yourself to see it.`, exam }, 422);
    }
    // what stood on the board for this car here, before this network (the board is a few seconds old at most)
    const before = (await showcase().board().catch(() => null))?.boards.find(x => x.track === map.id && x.ground === ground)?.rows.find(x => x.vehicle === car) ?? null;
    // (the file as the engine wrote it back after driving it: this car, this course's key, the settings it drove with; the
    // optimiser's state only if the agent sent one, for whoever trains it further in the lab)
    const saved = await store.create({ name, training: { ...r.file, track: map.name, adam: network.adam ? r.file.adam : null }, owner: a.uid, ownerName: a.name, exam: { ...r.exam, time: r.exam.time, build: r.build } })
      .catch((e: { status?: number; message?: string }) => { noteExam({ ...ran, status: e?.status ?? 500, error: `Timed, not saved: ${e?.message ?? e}` }); throw e; });
    noteExam({ ...ran, status: 201, autopilot: saved.id });
    showcase().forget();
    const board = await showcase().board().catch(() => null);
    return json({
      network: networkView(saved, board, site),
      exam,
      before: {
        human: before?.human ? { name: publicName(before.human.name, false), time: before.human.time } : null,
        network: before?.tnn ? { id: before.tnn.id, name: before.tnn.name, by: before.tnn.agent ? before.tnn.ownerName : publicName(before.tnn.ownerName, false), time: before.tnn.time } : null,
      },
      leaderboard: `${site}/leaderboard#${map.id}-${ground}`,
    }, 201);
  } catch (e) { return errorResponse(e); }
}
