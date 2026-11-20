// The race maps (courses): one JSON file per map in <DATA_DIR>/maps (default ./data/maps).
// The super admin creates and edits them (app/maps, app/api/maps); every room races one of them.
// The figure-8 is built in: its course is the sim's own default until the admin saves an edit of it,
// and it can't be deleted.
//
// A course is the sim's COURSE object (public/sim/engine.js), as its editor's Export writes it:
//   { wp: [[x, z], …], bank, level, ops: [{ t, x, z, r, s?, h?, v? }, …], base, road, bridges: [{x, z}], noBridge: [{x, z}] }
// course: null stands for the sim's default figure-8.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_MAP_ID = 'figure-8';
export const DEFAULT_MAP_NAME = 'Figure-8';
export const MAP_LIMITS = { nameMax: 40, wpMin: 3, wpMax: 400, opsMax: 200_000, bridgesMax: 40, bankMax: 25, worldMax: 168, bytesMax: 16 * 1024 * 1024 };

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const OP_TYPES = new Set(['raise', 'lower', 'flatten', 'smooth', 'sand', 'earth', 'road', 'erase']);
const fin = x => typeof x === 'number' && Number.isFinite(x);
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

export class MapError extends Error {
  constructor(status, message) { super(message); this.name = 'MapError'; this.status = status; }
}

export function cleanName(name) {
  const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, MAP_LIMITS.nameMax) : '';
  if (!n) throw new MapError(400, 'A map needs a name.');
  return n;
}

/** A course as the sim reads it, checked and trimmed; throws MapError(400) when it isn't one. */
export function cleanCourse(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new MapError(400, 'Not a course.');
  const W = MAP_LIMITS.worldMax;
  if (!Array.isArray(c.wp) || c.wp.length < MAP_LIMITS.wpMin || c.wp.length > MAP_LIMITS.wpMax) throw new MapError(400, `A course has ${MAP_LIMITS.wpMin} to ${MAP_LIMITS.wpMax} waypoints.`);
  const wp = c.wp.map(p => {
    if (!Array.isArray(p) || !fin(p[0]) || !fin(p[1])) throw new MapError(400, 'A waypoint is [x, z].');
    return [round(Math.max(-W, Math.min(W, p[0])), 1), round(Math.max(-W, Math.min(W, p[1])), 1)];
  });
  const ops = Array.isArray(c.ops) ? c.ops : [];
  if (ops.length > MAP_LIMITS.opsMax) throw new MapError(400, `Too many terrain strokes (${ops.length}, at most ${MAP_LIMITS.opsMax}).`);
  const cleanOps = [];
  for (const o of ops) {
    if (!o || !OP_TYPES.has(o.t) || !fin(o.x) || !fin(o.z) || !fin(o.r) || o.r <= 0 || o.r > 100) continue;
    const op = { t: o.t, x: o.x, z: o.z, r: o.r };
    if (fin(o.s)) op.s = o.s;
    if (fin(o.h)) op.h = o.h;
    if (fin(o.v)) op.v = o.v;
    cleanOps.push(op);
  }
  const pts = a => (Array.isArray(a) ? a : []).filter(b => b && fin(b.x) && fin(b.z)).slice(0, MAP_LIMITS.bridgesMax).map(b => ({ x: +b.x, z: +b.z }));
  return {
    wp,
    bank: Math.max(0, Math.min(MAP_LIMITS.bankMax, Math.round(fin(c.bank) ? c.bank : 0))),
    level: Math.max(0, Math.min(100, Math.round(fin(c.level) ? c.level : 0))),          // % (ticket #290)
    ops: cleanOps,
    base: c.base === 'earth' ? 'earth' : 'sand',
    road: !!c.road,
    bridges: pts(c.bridges),
    noBridge: pts(c.noBridge),
  };
}

const slug = s => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36);

export class MapStore {
  /** @param {string} dir where the map files live (created on first write) */
  constructor(dir, { now = Date.now } = {}) { this.dir = dir; this.now = now; }

  #file(id) { return path.join(this.dir, `${id}.json`); }

  #read(id) {
    if (!ID_RE.test(id)) return null;
    try { return JSON.parse(fs.readFileSync(this.#file(id), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; console.warn(`[maps] ${id}: ${e.message}`); return null; }
  }

  #write(map) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.#file(`${map.id}.${crypto.randomBytes(4).toString('hex')}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(map));
    fs.renameSync(tmp, this.#file(map.id));            // atomic: a reader sees the old file or the new one
  }

  #builtin() { return { id: DEFAULT_MAP_ID, name: DEFAULT_MAP_NAME, course: null, createdAt: 0, updatedAt: 0, updatedBy: null }; }

  /** A map with its course, or null. */
  get(id) {
    const m = this.#read(id);
    if (m) return { ...m, builtin: id === DEFAULT_MAP_ID };
    return id === DEFAULT_MAP_ID ? { ...this.#builtin(), builtin: true } : null;
  }

  /** What a room needs to know: id, name, and v, which changes with every save. */
  info(id) {
    const m = typeof id === 'string' ? this.get(id) : null;
    return m ? { id: m.id, name: m.name, v: m.updatedAt } : null;
  }

  /** Every map, without courses: the figure-8 first, then by name. */
  list() {
    let files = [];
    try { files = fs.readdirSync(this.dir).filter(f => f.endsWith('.json')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const out = [];
    for (const f of files) {
      const m = this.#read(f.slice(0, -5));
      if (m && m.id === f.slice(0, -5)) out.push(summary(m));
    }
    if (!out.some(m => m.id === DEFAULT_MAP_ID)) out.push(summary(this.#builtin()));
    return out.sort((a, b) => (b.id === DEFAULT_MAP_ID) - (a.id === DEFAULT_MAP_ID) || a.name.localeCompare(b.name));
  }

  /** A new map, a copy of the course of `from` (the figure-8 by default) or the course given. */
  create({ name, from, course, by }) {
    const n = cleanName(name);
    let c = null;
    if (course !== undefined && course !== null) c = cleanCourse(course);
    else if (from) { const src = this.get(String(from)); if (!src) throw new MapError(404, 'The map to copy is gone.'); c = src.course; }
    let id = slug(n) || 'map';
    if (this.get(id)) id = `${id.slice(0, 40)}-${crypto.randomBytes(3).toString('hex')}`;
    const t = this.now();
    const map = { id, name: n, course: c, createdAt: t, updatedAt: t, updatedBy: by || null };
    this.#write(map);
    return { ...map, builtin: false };
  }

  /** Rename and/or replace the course. */
  update(id, { name, course, by }) {
    const m = this.get(id);
    if (!m) throw new MapError(404, 'No such map.');
    const next = { id: m.id, name: name !== undefined ? cleanName(name) : m.name, course: course !== undefined ? (course === null ? null : cleanCourse(course)) : m.course, createdAt: m.createdAt, updatedAt: Math.max(this.now(), m.updatedAt + 1), updatedBy: by || null };
    this.#write(next);
    return { ...next, builtin: m.builtin };
  }

  delete(id) {
    if (id === DEFAULT_MAP_ID) throw new MapError(400, 'The figure-8 is built in: it can be edited, not deleted.');
    if (!this.#read(id)) throw new MapError(404, 'No such map.');
    fs.unlinkSync(this.#file(id));
  }
}

function summary(m) {
  return {
    id: m.id, name: m.name, builtin: m.id === DEFAULT_MAP_ID, createdAt: m.createdAt, updatedAt: m.updatedAt, updatedBy: m.updatedBy ?? null,
    waypoints: m.course ? m.course.wp.length : 16, strokes: m.course ? m.course.ops.length : 0, bank: m.course ? m.course.bank : 0, bridges: m.course ? m.course.bridges.length : 0,
  };
}

/** The app's store: <DATA_DIR>/maps, DATA_DIR defaulting to ./data (on Railway, a volume's mount path). */
// (no state but the files: the race server and Next's routes, each with its own copy of this module, share them)
export function mapStore() {
  return new MapStore(path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'maps'));
}
