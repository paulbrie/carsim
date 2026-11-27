// Trained autopilots (ticket #311): the sim's autopilot networks, saved by the drivers to share and load back.
// One row each in Postgres (table autopilots, lib/db/schema.mjs; ticket #318). A training is what the sim's
// "Save to file" writes (scripts/patches/autopilot.py: kind 'carsim-autopilot', its inputs, outputs and weights,
// the generations, its chart; since #351 its configuration and the circuits it was trained on before, with their charts:
// scripts/patches/net-save.py), checked here for shape and size only: the sim checks it against its inputs when it
// loads it. Everyone signed in can list and load them all; only whoever saved one (or the super admin) deletes it.
// A network an agent sent in (docs/agents.md, lib/agents) is one too, its owner `agent:<id>`: its best lap is not what the
// file says but what the server timed (`exam`, lib/agents/exam.mjs), which only the server's own routes can set.
import crypto from 'node:crypto';
import { count, desc, eq, sql } from 'drizzle-orm';
import { getDb, isUniqueViolation } from '../db/index.mjs';
import { autopilots } from '../db/schema.mjs';

// the hidden layer's sizes the sim offers (AI_SIZES in scripts/patches/autopilot.py; 0: none)
export const AUTOPILOT_SIZES = [0, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64];
export const AUTOPILOT_LIMITS = { nameMax: 60, weightsMax: 2000, inputsMax: 24, histMax: 2000, perOwner: 50, bytesMax: 512 * 1024, pastMax: 16, pastHistMax: 300 };

export class AutopilotError extends Error {
  constructor(status, message) { super(message); this.name = 'AutopilotError'; this.status = status; }
}

const ID_RE = /^[a-z0-9]{12}$/;
const fin = x => typeof x === 'number' && Number.isFinite(x);
const str = (x, n) => typeof x === 'string' ? x.slice(0, n) : '';
const nums = (a, n) => Array.isArray(a) && a.length <= n && a.every(fin);
const histOf = (a, n) => (Array.isArray(a) ? a : []).slice(-n).filter(h => Array.isArray(h) && h.length <= 3 && h.every(x => x === null || fin(x)));
// a configuration (#351): the lab's settings as plain values (numbers, booleans, short strings), objects one level down
// (the penalties, the car's setup, the lap followed); anything else left out
function plain(o, depth = 1) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  for (const [k, v] of Object.entries(o).slice(0, 80)) {
    if (!/^[A-Za-z0-9_]{1,24}$/.test(k)) continue;
    if (fin(v) || typeof v === 'boolean' || v === null) out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 400);
    else if (depth > 0 && v && typeof v === 'object' && !Array.isArray(v)) out[k] = plain(v, depth - 1);
  }
  return out;
}
const gen = x => Math.max(0, Math.round(fin(x) ? x : 0));
// one circuit a network was trained on before this one (#351)
const stint = p => ({
  course: str(p.course, 200), track: typeof p.track === 'string' ? p.track.slice(0, 80) : null, ground: str(p.ground, 20), vehicle: str(p.vehicle, 40), vehicleName: str(p.vehicleName, 60),
  from: gen(p.from), to: gen(p.to), bestLap: fin(p.bestLap) ? p.bestLap : null, bestFit: fin(p.bestFit) ? p.bestFit : -1, config: plain(p.config), savedAt: typeof p.savedAt === 'string' ? p.savedAt.slice(0, 40) : null,
});

/** a training as the sim saves it, checked and trimmed; throws AutopilotError(400) when it isn't one */
export function cleanTraining(t) {
  const bad = msg => { throw new AutopilotError(400, msg); };
  if (!t || typeof t !== 'object' || t.kind !== 'carsim-autopilot') bad('Not an autopilot training.');
  if (!AUTOPILOT_SIZES.includes(t.h)) bad(`An autopilot has no hidden layer or one of ${AUTOPILOT_SIZES.slice(1).join(', ')} units.`);
  if (!nums(t.w, AUTOPILOT_LIMITS.weightsMax) || t.w.length < 3) bad('Its weights are missing.');
  if (t.best != null && (!nums(t.best, AUTOPILOT_LIMITS.weightsMax) || t.best.length !== t.w.length)) bad('Its best weights don\'t match.');
  const inputs = Array.isArray(t.inputs) ? t.inputs : [];
  if (!inputs.length || inputs.length > AUTOPILOT_LIMITS.inputsMax || !inputs.every(i => typeof i === 'string' && /^[a-z0-9]{1,16}$/.test(i))) bad('Its inputs are missing.');
  const adam = t.adam && nums(t.adam.m, t.w.length) && nums(t.adam.v, t.w.length) && t.adam.m.length === t.w.length && t.adam.v.length === t.w.length
    ? { m: t.adam.m, v: t.adam.v, k: Math.max(0, Math.round(fin(t.adam.k) ? t.adam.k : 0)) } : null;
  const hist = histOf(t.hist, AUTOPILOT_LIMITS.histMax);
  const L = AUTOPILOT_LIMITS, past = (Array.isArray(t.past) ? t.past : []).filter(p => p && typeof p === 'object').slice(-L.pastMax).map(stint);
  const ph = Array.isArray(t.pastHist) ? t.pastHist : [];                 // (the charts line up with the stints: the last ones)
  const pastHist = past.map((_, i) => { const x = ph[ph.length - past.length + i]; return x && typeof x === 'object' && Array.isArray(x.h) ? { step: Math.max(1, gen(x.step)), h: histOf(x.h, L.pastHistMax) } : null; });
  return {
    kind: 'carsim-autopilot', version: fin(t.version) ? t.version : 2,
    vehicle: str(t.vehicle, 40), vehicleName: str(t.vehicleName, 60), course: str(t.course, 200), ground: str(t.ground, 20),
    h: t.h, inputs, handbrake: !!t.handbrake, keyPedals: !!t.keyPedals, keySteering: !!t.keySteering, noBrake: !!t.noBrake, weights: t.w.length,
    w: t.w, best: t.best ?? null, gen: Math.max(0, Math.round(fin(t.gen) ? t.gen : 0)),
    bestFit: fin(t.bestFit) ? t.bestFit : -1, bestLap: fin(t.bestLap) ? t.bestLap : null, hist, adam,
    track: typeof t.track === 'string' ? t.track.slice(0, 80) : null, config: plain(t.config), from: gen(t.from), past, pastHist,   // (#351)
  };
}

// an exam by the server (lib/agents/exam.mjs): its time, the laps driven, the engine's build, when
const cleanExam = e => ({ time: e.time, laps: (Array.isArray(e.laps) ? e.laps : []).slice(0, 8).map(l => ({ time: fin(l?.time) ? l.time : null, valid: l?.valid === true })),
  why: str(e.why, 20), build: str(e.build, 40), at: fin(e.at) ? e.at : Date.now() });

const newId = () => crypto.randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '0').slice(0, 12);

export class AutopilotStore {
  /** @param {{ q: any }} db the database (lib/db/index.mjs) */
  constructor(db, { now = Date.now } = {}) { this.db = db; this.now = now; }

  /** a saved autopilot with its weights, or null */
  async get(id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return null;
    const [r] = await this.db.q.select().from(autopilots).where(eq(autopilots.id, id));
    return r ? { id: r.id, name: r.name, owner: r.owner, ownerName: r.ownerName, savedAt: r.savedAt.getTime(), ...r.training } : null;
  }

  /** every saved autopilot, without weights, newest first */
  async list() {
    const rows = await this.db.q.select({
      id: autopilots.id, name: autopilots.name, owner: autopilots.owner, ownerName: autopilots.ownerName, savedAt: autopilots.savedAt,
      // not the weights, the optimiser's state or the charts: they are most of a training
      training: sql`${autopilots.training} - 'w' - 'best' - 'adam' - 'hist' - 'pastHist'`,
    }).from(autopilots).orderBy(desc(autopilots.savedAt));
    return rows.map(r => summary({ ...r.training, id: r.id, name: r.name, owner: r.owner, ownerName: r.ownerName, savedAt: r.savedAt.getTime() }));
  }

  /** an owner's saved autopilots, without weights, newest first */
  async listBy(owner) {
    return (await this.list()).filter(a => a.owner === owner);
  }

  /** throws AutopilotError(409) when this owner has as many as one may keep */
  async room(owner) {
    const [{ n: have }] = await this.db.q.select({ n: count() }).from(autopilots).where(eq(autopilots.owner, String(owner)));
    if (have >= AUTOPILOT_LIMITS.perOwner) throw new AutopilotError(409, `You have ${AUTOPILOT_LIMITS.perOwner} saved already: delete one first.`);
  }

  /**
   * save a training under a name, for its owner. exam: the server's own timing of it ({ time, laps, why, build }: an
   * agent's network), which then is its best lap, whatever the file says
   */
  async create({ name, training, owner, ownerName, exam = null }) {
    const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, AUTOPILOT_LIMITS.nameMax) : '';
    if (!n) throw new AutopilotError(400, 'Give it a name.');
    const t = cleanTraining(training);
    if (exam) {
      if (!fin(exam.time) || exam.time <= 0) throw new AutopilotError(400, 'An exam without a lap.');
      t.bestLap = exam.time; t.exam = cleanExam({ ...exam, at: this.now() });
    }
    await this.room(owner);
    for (let i = 0; ; i++) {
      const a = { id: newId(), name: n, owner: String(owner), ownerName: str(ownerName, 60) || 'Driver', savedAt: this.now(), ...t };
      if (JSON.stringify(a).length > AUTOPILOT_LIMITS.bytesMax) throw new AutopilotError(413, 'That training is too big.');
      try { await this.db.q.insert(autopilots).values({ id: a.id, name: a.name, owner: a.owner, ownerName: a.ownerName, savedAt: new Date(a.savedAt), training: t }); }
      catch (e) { if (isUniqueViolation(e) && i < 3) continue; throw e; }
      return summary(a);
    }
  }

  /** only its owner, or the super admin */
  async delete(id, { owner, admin = false }) {
    const a = await this.get(id);
    if (!a) throw new AutopilotError(404, 'No such autopilot.');
    if (a.owner !== owner && !admin) throw new AutopilotError(403, 'Only whoever saved it can delete it.');
    await this.db.q.delete(autopilots).where(eq(autopilots.id, id));
  }
}

function summary(a) {
  return {
    id: a.id, name: a.name, owner: a.owner, ownerName: a.ownerName, savedAt: a.savedAt, vehicle: a.vehicle, vehicleName: a.vehicleName,
    course: a.course, ground: a.ground, h: a.h, inputs: a.inputs, handbrake: a.handbrake, keyPedals: a.keyPedals, keySteering: a.keySteering, noBrake: !!a.noBrake,
    weights: a.weights, gen: a.gen, bestLap: a.bestLap, bestFit: a.bestFit, track: a.track ?? null,
    timed: !!a.exam,                                                   // (its best lap is the server's timing: an agent's)
    // the circuits it was trained on before (#351), without their settings
    past: (Array.isArray(a.past) ? a.past : []).map(p => ({ course: p.course, track: p.track ?? null, ground: p.ground, vehicle: p.vehicle, vehicleName: p.vehicleName, from: p.from, to: p.to, bestLap: p.bestLap ?? null })),
  };
}

/** The app's store, on the app's database (DATABASE_URL). */
export function autopilotStore() {
  return new AutopilotStore(getDb());
}
