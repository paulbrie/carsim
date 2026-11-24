// The race maps (courses): one row each in Postgres (table maps, lib/db/schema.mjs; ticket #318).
// The super admin creates and edits them (app/maps, app/api/maps); every room races one of them.
// The figure-8 is built in: its course is the sim's own default until the admin saves an edit of it,
// and it can't be deleted.
//
// A course is the sim's COURSE object (public/sim/engine.js), as its editor's Export writes it:
//   { wp: [[x, z], …], bank, level, even: [[first, last] waypoint], …], grade, ops: [{ t, x, z, r, s?, h?, v? }, …], base, road, bridges: [{x, z}], noBridge: [{x, z}] }
// course: null stands for the sim's default figure-8.
import crypto from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { getDb, isUniqueViolation } from '../db/index.mjs';
import { maps } from '../db/schema.mjs';

export const DEFAULT_MAP_ID = 'figure-8';
export const DEFAULT_MAP_NAME = 'Figure-8';
// the sim's own figure-8 (DEFAULT_WP in public/sim/engine.js): the waypoints of a map whose course is null
export const DEFAULT_WP = Array.from({ length: 16 }, (_, i) => { const t = (i + 0.5) / 16 * Math.PI * 2; return [+(118 * Math.sin(t)).toFixed(1), +(62 * Math.sin(2 * t)).toFixed(1)]; });
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
    // even-grade sections: [first, last] waypoint indices, distinct, of this course (ticket #300)
    even: (Array.isArray(c.even) ? c.even : []).filter(r => Array.isArray(r) && r.length === 2 && r.every(i => Number.isInteger(i) && i >= 0 && i < wp.length) && r[0] !== r[1]).slice(0, 40).map(r => [r[0], r[1]]),
    grade: fin(c.grade) && Math.round(c.grade) > 0 ? Math.max(3, Math.min(15, Math.round(c.grade))) : 0,   // max. grade, % (0: none; ticket #302)
    ops: cleanOps,
    base: c.base === 'earth' ? 'earth' : 'sand',
    road: !!c.road,
    bridges: pts(c.bridges),
    noBridge: pts(c.noBridge),
  };
}

const slug = s => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36);

// every change is announced on this Postgres channel (NOTIFY): the race server keeps a list of the maps (live.mjs)
export const MAPS_CHANNEL = 'carsim_maps';

const builtin = () => ({ id: DEFAULT_MAP_ID, name: DEFAULT_MAP_NAME, course: null, createdAt: 0, updatedAt: 0, updatedBy: null });
const fromRow = r => ({ id: r.id, name: r.name, course: r.course ?? null, createdAt: r.createdAt.getTime(), updatedAt: r.updatedAt.getTime(), updatedBy: r.updatedBy ?? null });

export class MapStore {
  /** @param {{ pool: import('pg').Pool, q: any }} db the database (lib/db/index.mjs) */
  constructor(db, { now = Date.now } = {}) { this.db = db; this.now = now; }

  async #read(id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return null;
    const [r] = await this.db.q.select().from(maps).where(eq(maps.id, id));
    return r ? fromRow(r) : null;
  }

  // tell whoever listens (the race server's list of maps); the change itself is already saved
  async #changed(id) {
    try { await this.db.pool.query('select pg_notify($1, $2)', [MAPS_CHANNEL, id]); }
    catch (e) { console.warn(`[maps] could not announce ${id}: ${e.message}`); }
  }

  /** A map with its course, or null. */
  async get(id) {
    const m = await this.#read(id);
    if (m) return { ...m, builtin: id === DEFAULT_MAP_ID };
    return id === DEFAULT_MAP_ID ? { ...builtin(), builtin: true } : null;
  }

  /** What a room needs to know: id, name, and v, which changes with every save. */
  async info(id) {
    const m = typeof id === 'string' ? await this.get(id) : null;
    return m ? { id: m.id, name: m.name, v: m.updatedAt } : null;
  }

  /** info() of every saved map (the built-in figure-8 only once it has been edited). */
  async infos() {
    const rows = await this.db.q.select({ id: maps.id, name: maps.name, updatedAt: maps.updatedAt }).from(maps);
    return rows.map(r => ({ id: r.id, name: r.name, v: r.updatedAt.getTime() }));
  }

  /** Every map, without courses: the figure-8 first, then by name. */
  async list() {
    const n = (expr, d) => sql`coalesce(${expr}, ${d})`.mapWith(Number);
    const rows = await this.db.q.select({
      id: maps.id, name: maps.name, createdAt: maps.createdAt, updatedAt: maps.updatedAt, updatedBy: maps.updatedBy,
      waypoints: n(sql`jsonb_array_length(${maps.course}->'wp')`, 16), strokes: n(sql`jsonb_array_length(${maps.course}->'ops')`, 0),
      bank: n(sql`(${maps.course}->>'bank')::numeric`, 0), bridges: n(sql`jsonb_array_length(${maps.course}->'bridges')`, 0),
      wp: sql`${maps.course}->'wp'`,                                   // to draw it (the pickers' outlines, #320)
    }).from(maps);
    const out = rows.map(r => ({
      id: r.id, name: r.name, builtin: r.id === DEFAULT_MAP_ID, createdAt: r.createdAt.getTime(), updatedAt: r.updatedAt.getTime(), updatedBy: r.updatedBy ?? null,
      waypoints: r.waypoints, strokes: r.strokes, bank: r.bank, bridges: r.bridges, wp: Array.isArray(r.wp) ? r.wp : DEFAULT_WP,
    }));
    if (!out.some(m => m.id === DEFAULT_MAP_ID)) { const b = builtin(); out.push({ id: b.id, name: b.name, builtin: true, createdAt: 0, updatedAt: 0, updatedBy: null, waypoints: 16, strokes: 0, bank: 0, bridges: 0, wp: DEFAULT_WP }); }
    return out.sort((a, b) => (b.id === DEFAULT_MAP_ID) - (a.id === DEFAULT_MAP_ID) || a.name.localeCompare(b.name));
  }

  /** A new map, a copy of the course of `from` (the figure-8 by default) or the course given. */
  async create({ name, from, course, by }) {
    const n = cleanName(name);
    let c = null;
    if (course !== undefined && course !== null) c = cleanCourse(course);
    else if (from) { const src = await this.get(String(from)); if (!src) throw new MapError(404, 'The map to copy is gone.'); c = src.course; }
    const base = slug(n) || 'map', t = this.now();
    // the name's id, or with a few random letters when it is taken (the figure-8's always is)
    for (let i = 0; ; i++) {
      const id = i === 0 && base !== DEFAULT_MAP_ID ? base : `${base.slice(0, 40)}-${crypto.randomBytes(3).toString('hex')}`;
      const map = { id, name: n, course: c, createdAt: t, updatedAt: t, updatedBy: by || null };
      try { await this.db.q.insert(maps).values({ ...map, createdAt: new Date(t), updatedAt: new Date(t) }); }
      catch (e) { if (isUniqueViolation(e) && i < 5) continue; throw e; }
      await this.#changed(id);
      return { ...map, builtin: false };
    }
  }

  /** Rename and/or replace the course. */
  async update(id, { name, course, by }) {
    const m = await this.get(id);
    if (!m) throw new MapError(404, 'No such map.');
    const next = { id: m.id, name: name !== undefined ? cleanName(name) : m.name, course: course !== undefined ? (course === null ? null : cleanCourse(course)) : m.course, createdAt: m.createdAt, updatedAt: Math.max(this.now(), m.updatedAt + 1), updatedBy: by || null };
    // (an insert for the built-in figure-8's first edit; the version never goes back, whoever else saved meanwhile)
    const [r] = await this.db.q.insert(maps).values({ ...next, createdAt: new Date(next.createdAt), updatedAt: new Date(next.updatedAt) })
      .onConflictDoUpdate({ target: maps.id, set: { name: next.name, course: next.course, updatedBy: next.updatedBy, updatedAt: sql`greatest(excluded.updated_at, ${maps.updatedAt} + interval '1 millisecond')` } })
      .returning({ updatedAt: maps.updatedAt });
    await this.#changed(id);
    return { ...next, updatedAt: r.updatedAt.getTime(), builtin: m.builtin };
  }

  async delete(id) {
    if (id === DEFAULT_MAP_ID) throw new MapError(400, 'The figure-8 is built in: it can be edited, not deleted.');
    const gone = typeof id === 'string' && ID_RE.test(id) ? await this.db.q.delete(maps).where(eq(maps.id, id)).returning({ id: maps.id }) : [];
    if (!gone.length) throw new MapError(404, 'No such map.');
    await this.#changed(id);
  }
}

/** The app's store, on the app's database (DATABASE_URL). */
export function mapStore() {
  return new MapStore(getDb());
}
