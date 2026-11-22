// Trained autopilots (ticket #311): the sim's autopilot networks, saved by the drivers to share and load back.
// One JSON file each in <DATA_DIR>/autopilots (default ./data), like the maps. A training is what the sim's
// "Save to file" writes (scripts/patches/autopilot.py: kind 'carsim-autopilot', its inputs, outputs and weights,
// the generations, its chart), checked here for shape and size only: the sim checks it against its inputs when it
// loads it. Everyone signed in can list and load them all; only whoever saved one (or the super admin) deletes it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
  if (t.h !== 0 && t.h !== 8) bad('An autopilot has no hidden layer or one of 8.');
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

export class AutopilotStore {
  /** @param {string} dir where the files live (created on first write) */
  constructor(dir, { now = Date.now } = {}) { this.dir = dir; this.now = now; }

  #file(id) { return path.join(this.dir, `${id}.json`); }
  #read(id) {
    if (!ID_RE.test(id)) return null;
    try { return JSON.parse(fs.readFileSync(this.#file(id), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; console.warn(`[autopilots] ${id}: ${e.message}`); return null; }
  }

  /** a saved autopilot with its weights, or null */
  get(id) { return typeof id === 'string' ? this.#read(id) : null; }

  /** every saved autopilot, without weights, newest first */
  list() {
    let files = [];
    try { files = fs.readdirSync(this.dir).filter(f => f.endsWith('.json')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const out = [];
    for (const f of files) { const a = this.#read(f.slice(0, -5)); if (a) out.push(summary(a)); }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  }

  /** save a training under a name, for its owner */
  create({ name, training, owner, ownerName }) {
    const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, AUTOPILOT_LIMITS.nameMax) : '';
    if (!n) throw new AutopilotError(400, 'Give it a name.');
    const t = cleanTraining(training);
    if (this.list().filter(a => a.owner === owner).length >= AUTOPILOT_LIMITS.perOwner) throw new AutopilotError(409, `You have ${AUTOPILOT_LIMITS.perOwner} saved already: delete one first.`);
    const a = { id: crypto.randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '0').slice(0, 12), name: n, owner: String(owner), ownerName: str(ownerName, 60) || 'Driver', savedAt: this.now(), ...t };
    const text = JSON.stringify(a);
    if (text.length > AUTOPILOT_LIMITS.bytesMax) throw new AutopilotError(413, 'That training is too big.');
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.#file(`${a.id}.${crypto.randomBytes(4).toString('hex')}.tmp`);
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, this.#file(a.id));
    return summary(a);
  }

  /** only its owner, or the super admin */
  delete(id, { owner, admin = false }) {
    const a = this.get(id);
    if (!a) throw new AutopilotError(404, 'No such autopilot.');
    if (a.owner !== owner && !admin) throw new AutopilotError(403, 'Only whoever saved it can delete it.');
    fs.unlinkSync(this.#file(id));
  }
}

function summary(a) {
  return {
    id: a.id, name: a.name, owner: a.owner, ownerName: a.ownerName, savedAt: a.savedAt, vehicle: a.vehicle, vehicleName: a.vehicleName,
    course: a.course, ground: a.ground, h: a.h, inputs: a.inputs, handbrake: a.handbrake, keyPedals: a.keyPedals, keySteering: a.keySteering, noBrake: !!a.noBrake,
    weights: a.weights, gen: a.gen, bestLap: a.bestLap, bestFit: a.bestFit,
  };
}

/** The app's store: <DATA_DIR>/autopilots, DATA_DIR defaulting to ./data (as the maps). */
export function autopilotStore() {
  return new AutopilotStore(path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'autopilots'));
}
