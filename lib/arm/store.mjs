// The arm sim's saved networks (ticket #362): a person's trained network for one arm and one scenario, saved from /arm to
// load back, share and watch. One row each (table arm_networks, lib/db/schema.mjs). A network is checked by the sim's own
// notNet (lib/arm/core.mjs: its inputs, size, control, arm and weights fit together) and kept to the last digit (a rounded
// one takes another exam). Its exam is the one the saver's browser ran (done of of, in time), as a car network's best lap is
// its browser's: shown, not ranked. Anyone may list and load them; only whoever saved one (or the super admin) deletes it.
import crypto from 'node:crypto';
import { and, count, desc, eq } from 'drizzle-orm';
import { getDb, isUniqueViolation } from '../db/index.mjs';
import { armNetworks } from '../db/schema.mjs';
import { ARMS, TASKS, netKey, notNet, shape, taskOf } from './core.mjs';
import { cleanScenario } from './scenario.mjs';

export const ARM_NET_LIMITS = { nameMax: 60, perOwner: 50, bytesMax: 128 * 1024, list: 200 };

export class ArmNetError extends Error {
  constructor(status, message) { super(message); this.name = 'ArmNetError'; this.status = status; }
}

const ID_RE = /^[a-z0-9]{12}$/;
const fin = x => typeof x === 'number' && Number.isFinite(x);
const newId = () => crypto.randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '0').slice(0, 12);

/** a network as the page sends it, checked and cut to what drives it; throws ArmNetError(400) when it isn't one */
export function cleanNet(d) {
  const bad = msg => { throw new ArmNetError(400, msg); };
  if (!d || typeof d !== 'object' || Array.isArray(d)) bad('Not an arm network.');
  const task = d.task ?? 'grab';
  if (typeof task !== 'string' || (!Object.hasOwn(TASKS, task) && task !== 'custom')) bad(`Its scenario is one of ${Object.keys(TASKS).join(', ')}, or "custom" (one's own, #365: with its scenario).`);
  const why = notNet(d);
  if (why) bad(`Not an arm network: ${why}.`);
  const arm = d.arm ?? 'desk';
  // one's own scenario (#365) goes with its network: its exam is that scenario's (kept as the page's editor writes it)
  const net = { kind: 'armsim-network', ...(arm !== 'desk' && { arm }), task, ...(task === 'custom' && { scenario: cleanScenario(d.scenario) }), control: d.control, roll: !!d.roll, inputs: [...d.inputs], h: d.h, w: [...d.w] };
  if (fin(d.generation)) net.generation = Math.max(0, Math.round(d.generation));
  if (fin(d.generations)) net.generations = Math.max(0, Math.round(d.generations));
  return net;
}
/** the exam as the browser ran it: { done, of, time } for this scenario's placements, or null. task: a key of TASKS, or a scenario's file (#365) */
export function cleanExam(e, task) {
  if (e == null) return null;
  const T = taskOf(task), of = T.exam;
  if (!e || typeof e !== 'object' || !Number.isInteger(e.done) || e.of !== of || e.done < 0 || e.done > of || !fin(e.time) || e.time < 0 || e.time > of * T.limit + 1e-6)
    throw new ArmNetError(400, `An exam is { done, of: ${of}, time } for ${T.name}.`);
  return { done: e.done, of, time: Math.round(e.time * 1000) / 1000 };
}

const summary = r => ({ id: r.id, name: r.name, owner: r.owner, ownerName: r.ownerName, savedAt: r.savedAt instanceof Date ? r.savedAt.getTime() : r.savedAt,
  arm: r.arm, task: r.task, weights: r.weights, h: r.net?.h ?? 0, control: r.net?.control ?? 'hand', exam: r.exam ?? null });

export class ArmNetStore {
  /** @param {{ q: any }} db the database (lib/db/index.mjs) */
  constructor(db, { now = Date.now } = {}) { this.db = db; this.now = now; }

  /** one, with its network, or null */
  async get(id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return null;
    const [r] = await this.db.q.select().from(armNetworks).where(eq(armNetworks.id, id));
    return r ? { ...summary(r), net: r.net } : null;
  }

  /** without their weights, the best exams first (then the newest); for one arm and scenario, or an owner's */
  async list({ arm, task, owner } = {}) {
    const where = [arm && eq(armNetworks.arm, arm), task && eq(armNetworks.task, task), owner && eq(armNetworks.owner, owner)].filter(Boolean);
    const rows = await this.db.q.select({ id: armNetworks.id, name: armNetworks.name, owner: armNetworks.owner, ownerName: armNetworks.ownerName, savedAt: armNetworks.savedAt,
      arm: armNetworks.arm, task: armNetworks.task, weights: armNetworks.weights, exam: armNetworks.exam })
      .from(armNetworks).where(where.length ? and(...where) : undefined).orderBy(desc(armNetworks.savedAt)).limit(ARM_NET_LIMITS.list);
    const rank = s => s.exam ? [s.exam.done, -s.exam.time] : [-1, 0];
    return rows.map(r => summary({ ...r, net: null })).sort((a, b) => { const x = rank(a), y = rank(b); return y[0] - x[0] || y[1] - x[1] || b.savedAt - a.savedAt; });
  }

  /** save a network under a name, for its owner; throws ArmNetError(409) past ARM_NET_LIMITS.perOwner */
  async create({ name, net, exam = null, owner, ownerName }) {
    const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, ARM_NET_LIMITS.nameMax) : '';
    if (!n) throw new ArmNetError(400, 'Give it a name.');
    const clean = cleanNet(net), ex = cleanExam(exam, clean.task === 'custom' ? clean.scenario : clean.task);
    if (JSON.stringify(clean).length > ARM_NET_LIMITS.bytesMax) throw new ArmNetError(413, 'That network is too big.');
    const [{ n: have }] = await this.db.q.select({ n: count() }).from(armNetworks).where(eq(armNetworks.owner, String(owner)));
    if (have >= ARM_NET_LIMITS.perOwner) throw new ArmNetError(409, `You have ${ARM_NET_LIMITS.perOwner} arm networks saved already: delete one first.`);
    const row = { name: n, owner: String(owner), ownerName: String(ownerName || 'Driver').slice(0, 60), savedAt: new Date(this.now()),
      arm: clean.arm ?? 'desk', task: netKey(clean), weights: shape(clean).weights, net: clean, exam: ex };
    for (let i = 0; ; i++) {
      const id = newId();
      try { await this.db.q.insert(armNetworks).values({ id, ...row }); }
      catch (e) { if (isUniqueViolation(e) && i < 3) continue; throw e; }
      return summary({ id, ...row });
    }
  }

  /** only its owner, or the super admin */
  async delete(id, { owner, admin = false }) {
    const a = await this.get(id);
    if (!a) throw new ArmNetError(404, 'No such network.');
    if (a.owner !== owner && !admin) throw new ArmNetError(403, 'Only whoever saved it can delete it.');
    await this.db.q.delete(armNetworks).where(eq(armNetworks.id, id));
  }
}

/** The app's, on the app's database. */
export function armNetStore() {
  return new ArmNetStore(getDb());
}
