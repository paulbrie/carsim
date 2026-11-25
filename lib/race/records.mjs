// Best lap times (ticket #304): each driver's fastest valid lap per map, ground and car, in Postgres (table
// records, lib/db/schema.mjs; ticket #318). The race server (lib/race/hub.mjs) is the only writer and answers
// its rooms from memory: the records are read once, when the server starts (load), and every new best is
// written through as it is set. The write only replaces a slower time, whatever this process believes.
// A record keeps the map version it was set on (mv): an edited map keeps its times, and the room
// shows the older ones as set on an earlier layout (their checkpoint splits no longer line up).
// Ghosts (#310): a record can come with the lap's path (the sim's trace, see GHOST below), in the record's own
// row (trace), read when a player wants to race it.
// A network's lap (#333) is a record like a human's, under a driver of its own (the hub's netLap): net says whose
// network it is ({ autopilot, name, creator, weights, h, image? }: image, its maker's picture, #354); a human's record has none.
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/index.mjs';
import { records } from '../db/schema.mjs';

export const RECORD_LIMITS = { minLap: 5, maxLap: 3600, splitsMax: 64, listMax: 50, saveTries: 4, saveRetryMs: 500 };
// a trace: base64 of little-endian int16s, GHOST.fields per sample, a sample every GHOST.dt s:
// x, y, z (in GHOST.posUnit m), the orientation's qx, qy, qz, qw (× 32767), steer (× 10000 rad)
export const GHOST = { dt: 0.1, fields: 8, posUnit: 0.02, maxChars: 60_000, cacheMax: 40 };
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** a trace as the sim sends it, or null */
export function cleanTrace(t, time) {
  if (typeof t !== 'string' || t.length > GHOST.maxChars || t.length % 4 || !B64.test(t)) return null;
  const bytes = t.length / 4 * 3 - (t.endsWith('==') ? 2 : t.endsWith('=') ? 1 : 0), n = bytes / (2 * GHOST.fields);
  // whole samples, covering the lap (give or take a sample)
  return Number.isInteger(n) && n >= 2 && Math.abs((n - 1) * GHOST.dt - time) <= 2 * GHOST.dt ? t : null;
}

const fin = x => typeof x === 'number' && Number.isFinite(x);
const keyOf = r => `${r.map}|${r.ground}|${r.vehicle}|${r.id}`;
const ok = r => r && typeof r === 'object' && typeof r.map === 'string' && typeof r.ground === 'string' && typeof r.vehicle === 'string'
  && typeof r.id === 'string' && fin(r.time);

/** checkpoint times from the lap's start (index i: gate i; 0, the start, is null), or [] */
export function cleanSplits(s, time) {
  if (!Array.isArray(s) || s.length > RECORD_LIMITS.splitsMax) return [];
  return s.map(x => fin(x) && x > 0 && x < time ? Math.round(x * 1000) / 1000 : null);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const str = (s, n) => typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, n) : '';
const count = (x, max) => Number.isInteger(x) && x >= 0 && x <= max ? x : 0;
/** a network's mark on its record (#333): which saved network (or null), its name, who made it, its size */
export function cleanNet(n) {
  return { autopilot: typeof n?.autopilot === 'string' && n.autopilot ? str(n.autopilot, 40) : null, name: str(n?.name, 60) || 'Unsaved network',
    creator: str(n?.creator, 60) || 'Driver', weights: count(n?.weights, 100_000), h: count(n?.h, 1000), ...(imageUrl(n?.image) ? { image: n.image } : {}) };
}
/** a user's picture (their sign-in's): an http(s) address, or nothing */
export const imageUrl = x => typeof x === 'string' && x.length <= 1000 && /^https?:\/\//.test(x) ? x : null;
const where = r => and(eq(records.map, r.map), eq(records.ground, r.ground), eq(records.vehicle, r.vehicle), eq(records.driverId, r.id));

export class RecordStore {
  /** @param {{ q: any } | null} db the database (lib/db/index.mjs), or null: in memory only (tests) */
  constructor(db, { now = Date.now, retryMs = RECORD_LIMITS.saveRetryMs } = {}) {
    this.db = db; this.now = now; this.retryMs = retryMs;
    /** @type {Map<string, any>} */ this.byKey = new Map();
    /** @type {Map<string, string>} the last ghosts read or written (all of them, without a database) */ this.ghosts = new Map();
    /** the writes under way, one after the other */ this.writes = Promise.resolve();
  }

  /** Read every record (not the ghosts' paths): once, before the first room opens. */
  async load() {
    if (!this.db) return this;
    const rows = await this.db.q.select({
      map: records.map, mv: records.mapVersion, ground: records.ground, vehicle: records.vehicle, id: records.driverId, name: records.driverName, image: records.driverImage,
      time: records.time, splits: records.splits, at: records.setAt, ghost: sql`${records.trace} is not null`.mapWith(Boolean), net: records.net,
    }).from(records);
    this.byKey.clear();
    for (const { ghost, at, net, ...r } of rows) {
      const rec = { ...r, splits: Array.isArray(r.splits) ? r.splits : [], at: at.getTime() };
      if (ghost) rec.ghost = true;
      if (net && typeof net === 'object') rec.net = cleanNet(net);
      if (ok(rec)) this.byKey.set(keyOf(rec), rec);
    }
    return this;
  }

  /** every record on a map and ground, fastest first */
  list(map, ground) {
    const out = [];
    for (const r of this.byKey.values()) if (r.map === map && r.ground === ground) out.push(r);
    return out.sort((a, b) => a.time - b.time || a.at - b.at);
  }

  /**
   * A valid lap: kept if it is the driver's best with that car there.
   * @param {{ map: string, mv: number, ground: string, vehicle: string, user: { id: string, name: string, image?: string | null }, time: number, splits?: unknown, trace?: unknown, net?: object | null }} lap
   *   net: a network drove it (#333; user: the network as a driver)
   * @returns the new record, or null if it isn't one
   */
  submit({ map, mv, ground, vehicle, user, time, splits, trace, net = null }) {
    if (!fin(time) || time < RECORD_LIMITS.minLap || time > RECORD_LIMITS.maxLap) return null;
    const t = Math.round(time * 1000) / 1000;
    const r = { map, mv, ground, vehicle, id: user.id, name: user.name, image: user.image || null, time: t, splits: cleanSplits(splits, t), at: this.now() };
    if (net) r.net = cleanNet(net);
    const k = keyOf(r), old = this.byKey.get(k);
    if (old && old.time <= t) return null;
    const g = cleanTrace(trace, time);
    if (g) { r.ghost = true; this.#cache(k, g); }
    else this.ghosts.delete(k);                                       // the old path is not this lap's
    this.byKey.set(k, r);
    this.#save(r, g);
    return r;
  }

  /** a record's lap path (a trace), or null */
  async ghost(map, ground, vehicle, id) {
    const k = keyOf({ map, ground, vehicle, id }), r = this.byKey.get(k);
    if (!r?.ghost) return null;
    let g = this.ghosts.get(k);
    if (g == null && this.db) {
      try { g = (await this.db.q.select({ trace: records.trace }).from(records).where(where(r)))[0]?.trace; }
      catch (e) { console.warn(`[records] ghost: ${e.message}`); }
      // (not a path that was replaced while we were reading)
      if (typeof g === 'string' && this.byKey.get(k) === r) this.#cache(k, g);
    }
    return typeof g === 'string' && this.byKey.get(k) === r ? g : null;
  }

  #cache(k, g) {
    this.ghosts.delete(k); this.ghosts.set(k, g);
    if (this.db) while (this.ghosts.size > GHOST.cacheMax) this.ghosts.delete(this.ghosts.keys().next().value);
  }

  // a new best goes to the database, after the writes already under way; a failed write is tried again
  #save(r, trace) {
    if (!this.db) return;
    const row = { map: r.map, ground: r.ground, vehicle: r.vehicle, driverId: r.id, driverName: r.name, driverImage: r.image, mapVersion: r.mv, time: r.time, splits: r.splits, setAt: new Date(r.at), trace: trace ?? null, net: r.net ?? null };
    const { map: _m, ground: _g, vehicle: _v, driverId: _d, ...rest } = row;
    this.writes = this.writes.then(async () => {
      for (let i = 1; ; i++) {
        try {
          await this.db.q.insert(records).values(row)
            .onConflictDoUpdate({ target: [records.map, records.ground, records.vehicle, records.driverId], set: rest, setWhere: sql`${records.time} > excluded.time_s` });
          return;
        } catch (e) {
          if (i >= RECORD_LIMITS.saveTries) { console.error(`[records] NOT SAVED: ${keyOf(r)} ${r.time}: ${e.message}`); return; }
          console.warn(`[records] could not save (try ${i}): ${e.message}`);
          await sleep(this.retryMs * 2 ** (i - 1));
        }
      }
    });
  }

  /** wait for the writes under way (on shutdown, and in tests) */
  async flush() { await this.writes; }
}

/** The app's store, on the app's database (DATABASE_URL): load() it before use. */
export function recordStore() {
  return new RecordStore(getDb());
}
