// Trained autopilots (ticket #311): the sim's autopilot networks, saved by the drivers to share and load back.
// One row each in Postgres (table autopilots, lib/db/schema.mjs; ticket #318). A training is what the sim's
// "Save to file" writes (scripts/patches/autopilot.py: kind 'carsim-autopilot', its inputs, outputs and weights,
// the generations, its chart), checked here for shape and size only: the sim checks it against its inputs when it
// loads it. Everyone signed in can list and load them all; only whoever saved one (or the super admin) deletes it.
import crypto from 'node:crypto';
import { count, desc, eq, sql } from 'drizzle-orm';
import { getDb, isUniqueViolation } from '../db/index.mjs';
import { autopilots } from '../db/schema.mjs';

// the hidden layer's sizes the sim offers (AI_SIZES in scripts/patches/autopilot.py; 0: none)
export const AUTOPILOT_SIZES = [0, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64];
export const AUTOPILOT_LIMITS = { nameMax: 60, weightsMax: 2000, inputsMax: 24, histMax: 300, perOwner: 50, bytesMax: 256 * 1024 };

export class AutopilotError extends Error {
  constructor(status, message) { super(message); this.name = 'AutopilotError'; this.status = status; }
}

const ID_RE = /^[a-z0-9]{12}$/;
const fin = x => typeof x === 'number' && Number.isFinite(x);
const str = (x, n) => typeof x === 'string' ? x.slice(0, n) : '';
const nums = (a, n) => Array.isArray(a) && a.length <= n && a.every(fin);

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
  const hist = (Array.isArray(t.hist) ? t.hist : []).slice(-AUTOPILOT_LIMITS.histMax).filter(h => Array.isArray(h) && h.length <= 3 && h.every(x => x === null || fin(x)));
  return {
    kind: 'carsim-autopilot', version: fin(t.version) ? t.version : 2,
    vehicle: str(t.vehicle, 40), vehicleName: str(t.vehicleName, 60), course: str(t.course, 200), ground: str(t.ground, 20),
    h: t.h, inputs, handbrake: !!t.handbrake, keyPedals: !!t.keyPedals, keySteering: !!t.keySteering, noBrake: !!t.noBrake, weights: t.w.length,
    w: t.w, best: t.best ?? null, gen: Math.max(0, Math.round(fin(t.gen) ? t.gen : 0)),
    bestFit: fin(t.bestFit) ? t.bestFit : -1, bestLap: fin(t.bestLap) ? t.bestLap : null, hist, adam,
  };
}

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
      // not the weights, the optimiser's state or the chart: they are most of a training
      training: sql`${autopilots.training} - 'w' - 'best' - 'adam' - 'hist'`,
    }).from(autopilots).orderBy(desc(autopilots.savedAt));
    return rows.map(r => summary({ ...r.training, id: r.id, name: r.name, owner: r.owner, ownerName: r.ownerName, savedAt: r.savedAt.getTime() }));
  }

  /** save a training under a name, for its owner */
  async create({ name, training, owner, ownerName }) {
    const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, AUTOPILOT_LIMITS.nameMax) : '';
    if (!n) throw new AutopilotError(400, 'Give it a name.');
    const t = cleanTraining(training);
    const [{ n: have }] = await this.db.q.select({ n: count() }).from(autopilots).where(eq(autopilots.owner, String(owner)));
    if (have >= AUTOPILOT_LIMITS.perOwner) throw new AutopilotError(409, `You have ${AUTOPILOT_LIMITS.perOwner} saved already: delete one first.`);
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
    weights: a.weights, gen: a.gen, bestLap: a.bestLap, bestFit: a.bestFit,
  };
}

/** The app's store, on the app's database (DATABASE_URL). */
export function autopilotStore() {
  return new AutopilotStore(getDb());
}
