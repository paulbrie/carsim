// Best lap times (ticket #304): each driver's fastest valid lap per map, ground and car, in one JSON
// file, <DATA_DIR>/records.json (default ./data). The race server (lib/race/hub.mjs) is the only
// writer: one process, so the file is read once and written after each new best (debounced).
// A record keeps the map version it was set on (mv): an edited map keeps its times, and the room
// shows the older ones as set on an earlier layout (their checkpoint splits no longer line up).
// Ghosts (#310): a record can come with the lap's path (the sim's trace, see GHOST below), kept in a file of
// its own, <DATA_DIR>/ghosts/<sha1 of the record's key>.json, and read when a player wants to race it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const RECORD_LIMITS = { minLap: 5, maxLap: 3600, splitsMax: 64, listMax: 50, saveDelayMs: 1000 };
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

export class RecordStore {
  /** @param {string | null} file where they live (null: in memory only, for tests) */
  constructor(file, { now = Date.now, ghostDir = file ? path.join(path.dirname(file), 'ghosts') : null } = {}) {
    this.file = file; this.now = now; this.ghostDir = ghostDir;
    /** @type {Map<string, any>} */ this.byKey = new Map();
    /** @type {Map<string, string>} the last ghosts read or written (in memory only, without a ghostDir) */ this.ghosts = new Map();
    this.timer = null;
    if (!file) return;
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const r of Array.isArray(d.records) ? d.records : []) if (ok(r)) this.byKey.set(keyOf(r), r);
    } catch (e) { if (e.code !== 'ENOENT') console.warn(`[records] ${file}: ${e.message}`); }
  }

  /** every record on a map and ground, fastest first */
  list(map, ground) {
    const out = [];
    for (const r of this.byKey.values()) if (r.map === map && r.ground === ground) out.push(r);
    return out.sort((a, b) => a.time - b.time || a.at - b.at);
  }

  /**
   * A valid lap: kept if it is the driver's best with that car there.
   * @param {{ map: string, mv: number, ground: string, vehicle: string, user: { id: string, name: string, image?: string | null }, time: number, splits?: unknown, trace?: unknown }} lap
   * @returns the new record, or null if it isn't one
   */
  submit({ map, mv, ground, vehicle, user, time, splits, trace }) {
    if (!fin(time) || time < RECORD_LIMITS.minLap || time > RECORD_LIMITS.maxLap) return null;
    const t = Math.round(time * 1000) / 1000;
    const r = { map, mv, ground, vehicle, id: user.id, name: user.name, image: user.image || null, time: t, splits: cleanSplits(splits, t), at: this.now() };
    const old = this.byKey.get(keyOf(r));
    if (old && old.time <= t) return null;
    const g = cleanTrace(trace, time);
    if (g) { r.ghost = true; this.#putGhost(keyOf(r), g); }
    else if (old?.ghost) this.#dropGhost(keyOf(r));                   // the old path is not this lap's
    this.byKey.set(keyOf(r), r);
    this.#saveSoon();
    return r;
  }

  /** a record's lap path (a trace), or null */
  ghost(map, ground, vehicle, id) {
    const k = keyOf({ map, ground, vehicle, id }), r = this.byKey.get(k);
    if (!r?.ghost) return null;
    let g = this.ghosts.get(k);
    if (g == null && this.ghostDir) {
      try { g = JSON.parse(fs.readFileSync(this.#ghostFile(k), 'utf8')).trace; } catch (e) { if (e.code !== 'ENOENT') console.warn(`[records] ghost: ${e.message}`); }
      if (typeof g === 'string') this.#cache(k, g);
    }
    return typeof g === 'string' ? g : null;
  }

  #ghostFile(k) { return path.join(this.ghostDir, crypto.createHash('sha1').update(k).digest('hex') + '.json'); }
  #cache(k, g) {
    this.ghosts.delete(k); this.ghosts.set(k, g);
    if (this.ghostDir) while (this.ghosts.size > GHOST.cacheMax) this.ghosts.delete(this.ghosts.keys().next().value);
  }
  #putGhost(k, g) {
    this.#cache(k, g);
    if (!this.ghostDir) return;
    try {
      fs.mkdirSync(this.ghostDir, { recursive: true });
      const f = this.#ghostFile(k), tmp = `${f}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ key: k, trace: g }));
      fs.renameSync(tmp, f);
    } catch (e) { console.warn(`[records] could not save a ghost: ${e.message}`); }
  }
  #dropGhost(k) {
    this.ghosts.delete(k);
    if (this.ghostDir) try { fs.unlinkSync(this.#ghostFile(k)); } catch { }
  }

  #saveSoon() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, RECORD_LIMITS.saveDelayMs);
    this.timer.unref?.();
  }

  /** write now (also on shutdown) */
  flush() {
    if (!this.file) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ records: [...this.byKey.values()] }));
      fs.renameSync(tmp, this.file);
    } catch (e) { console.warn(`[records] could not save: ${e.message}`); }
  }
}

/** The app's store: <DATA_DIR>/records.json, DATA_DIR defaulting to ./data (as the maps). */
export function recordStore() {
  return new RecordStore(path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'records.json'));
}
