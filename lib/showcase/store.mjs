// What the public pages show (ticket #320): humans against tiny neural networks, from what the server already
// keeps. A track is a map; a human's lap is a best lap (table records, set in a race room); a network's lap is the
// best lap of a saved autopilot (table autopilots: its exam lap, as its browser timed it). A network says which
// course it was trained on by the sim's course key (courseKey in public/sim/engine.js), a hash of the course's
// shape: the same hash of a map's course tells which map that is, as it is laid out now.
// Read-only, and kept for a few seconds: the home page asks on every visit.
import { desc, sql } from 'drizzle-orm';
import { getDb } from '../db/index.mjs';
import { autopilots, maps, records } from '../db/schema.mjs';
import { DEFAULT_MAP_ID, DEFAULT_MAP_NAME, DEFAULT_WP } from '../maps/store.mjs';

export const DEFAULT_TRACK = { id: DEFAULT_MAP_ID, name: DEFAULT_MAP_NAME };

/** The sim's courseKey() of a course (null: its own figure-8). Keep in step with engine.js. */
export function courseKey(course) {
  const C = course ?? { wp: DEFAULT_WP };
  let h = 2166136261;
  const s = JSON.stringify(C.wp) + (C.bank ? 'b' + C.bank : '') + (C.level ? 'l' + C.level : '') + (C.grade ? 'g' + C.grade : '')
    + (C.even?.length ? 'e' + JSON.stringify(C.even) : '') + (C.bridges?.length || C.noBridge?.length ? JSON.stringify([C.bridges ?? [], C.noBridge ?? []]) : '');
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}

/** A closed course's length in metres, along the straight lines between its waypoints (a little short of the road's). */
export function courseLength(wp) {
  let d = 0;
  for (let i = 0; i < wp.length; i++) { const a = wp[i], b = wp[(i + 1) % wp.length]; d += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return d;
}

const GROUNDS = ['road', 'earth', 'sand'];
const TTL_MS = 10_000;

export class Showcase {
  /** @param {{ q: any }} db */
  constructor(db, { now = Date.now, ttlMs = TTL_MS } = {}) { this.db = db; this.now = now; this.ttlMs = ttlMs; this.cache = null; }

  /** Every track: its id and name, its course key, its waypoints (to draw it), the grounds' shape that matters here. */
  async tracks() {
    const rows = await this.db.q.select({
      id: maps.id, name: maps.name, updatedAt: maps.updatedAt,
      // the course without its terrain strokes: they are most of it, and nothing here needs them
      course: sql`${maps.course} - 'ops'`,
    }).from(maps);
    const out = rows.map(r => ({ id: r.id, name: r.name, v: r.updatedAt.getTime(), key: courseKey(r.course), wp: r.course?.wp ?? DEFAULT_WP, bridges: r.course?.bridges?.length ?? 0, length: Math.round(courseLength(r.course?.wp ?? DEFAULT_WP)) }));
    if (!out.some(t => t.id === DEFAULT_TRACK.id)) out.push({ ...DEFAULT_TRACK, v: 0, key: courseKey(null), wp: DEFAULT_WP, bridges: 0, length: Math.round(courseLength(DEFAULT_WP)) });
    return out.sort((a, b) => a.length - b.length || a.name.localeCompare(b.name));
  }

  /** Every saved network, newest first, with the weights it drives with (w: its best; null when asked without). */
  async networks({ weights = true } = {}) {
    const rows = await this.db.q.select({
      id: autopilots.id, name: autopilots.name, ownerName: autopilots.ownerName, savedAt: autopilots.savedAt,
      t: weights ? sql`${autopilots.training} - 'adam' - 'hist'` : sql`${autopilots.training} - 'adam' - 'hist' - 'w' - 'best'`,
    }).from(autopilots).orderBy(desc(autopilots.savedAt));
    return rows.map(({ t, ...r }) => ({
      id: r.id, name: r.name, ownerName: r.ownerName, savedAt: r.savedAt.getTime(),
      vehicle: String(t.vehicle ?? ''), course: String(t.course ?? ''), ground: String(t.ground ?? '').toLowerCase(),
      h: Number(t.h) || 0, inputs: Array.isArray(t.inputs) ? t.inputs : [], handbrake: !!t.handbrake, noBrake: !!t.noBrake, keyPedals: !!t.keyPedals, keySteering: !!t.keySteering,
      weights: Number(t.weights) || 0, gen: Number(t.gen) || 0, bestLap: typeof t.bestLap === 'number' ? t.bestLap : null,
      w: weights ? (Array.isArray(t.best) ? t.best : Array.isArray(t.w) ? t.w : null) : null,
    }));
  }

  /** Every human best lap, with the map version it was set on. */
  async laps() {
    const rows = await this.db.q.select({
      map: records.map, ground: records.ground, vehicle: records.vehicle, id: records.driverId, name: records.driverName, image: records.driverImage,
      mv: records.mapVersion, time: records.time, at: records.setAt,
    }).from(records);
    return rows.map(r => ({ ...r, at: r.at.getTime() }));
  }

  /**
   * The scoreboard: for each track and ground with a lap on it, car by car, the best human lap and the best
   * network lap on the track as it is now; and the networks, each with the track it was trained on (or none: a
   * course of its maker's own, or a layout since changed).
   */
  async board() {
    if (this.cache && this.now() - this.cache.at < this.ttlMs) return this.cache.value;
    const [tracks, nets, laps] = await Promise.all([this.tracks(), this.networks(), this.laps()]);
    const byKey = new Map(tracks.map(t => [t.key, t]));
    const networks = nets.map(n => ({ ...n, track: byKey.get(n.course)?.id ?? null }));
    const boards = [];
    for (const t of tracks) for (const ground of GROUNDS) {
      const humans = laps.filter(l => l.map === t.id && l.ground === ground && l.mv === t.v);
      const tnns = networks.filter(n => n.track === t.id && n.ground === ground && n.bestLap != null);
      if (!humans.length && !tnns.length) continue;
      const cars = new Map();
      const row = v => { let r = cars.get(v); if (!r) cars.set(v, r = { vehicle: v, human: null, tnn: null }); return r; };
      for (const l of humans) { const r = row(l.vehicle); if (!r.human || l.time < r.human.time) r.human = { id: l.id, name: l.name, image: l.image, time: l.time, at: l.at }; }
      for (const n of tnns) { const r = row(n.vehicle); if (!r.tnn || n.bestLap < r.tnn.time) r.tnn = { id: n.id, name: n.name, ownerName: n.ownerName, time: n.bestLap, weights: n.weights, h: n.h, gen: n.gen }; }
      const best = r => Math.min(r.human?.time ?? Infinity, r.tnn?.time ?? Infinity);
      const rows = [...cars.values()].sort((a, b) => best(a) - best(b));
      const top = k => rows.filter(r => r[k]).sort((a, b) => a[k].time - b[k].time)[0];
      const h = top('human'), n = top('tnn');
      boards.push({
        track: t.id, ground, rows,
        human: h ? { ...h.human, vehicle: h.vehicle } : null, tnn: n ? { ...n.tnn, vehicle: n.vehicle } : null,
        // the closest fight: the cars both have driven, the smallest gap first
        duels: rows.filter(r => r.human && r.tnn).map(r => ({ vehicle: r.vehicle, human: r.human, tnn: r.tnn, gap: r.tnn.time - r.human.time })).sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap)),
      });
    }
    const value = { tracks, boards, networks, at: this.now() };
    this.cache = { at: this.now(), value };
    return value;
  }
}

/** The app's, on the app's database: one for the process, so its few seconds of memory are shared. */
export function showcase() {
  return (globalThis.__carsimShowcase ??= new Showcase(getDb()));
}
