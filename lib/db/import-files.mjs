// The data of before the database (ticket #318): until then the maps, the best laps, their ghosts and the saved
// autopilots were files under DATA_DIR (default ./data). The server reads them into the database once, the first
// time it starts with one (server.mjs), and remembers that it did (app_meta: files_imported): a map deleted
// afterwards does not come back from its old file. Nothing already in the database is overwritten, and the files
// are left as they are. By hand: `npm run db:import` (`-- --force` to read them again).
//   <dir>/maps/<id>.json                { id, name, course, createdAt, updatedAt, updatedBy }
//   <dir>/records.json                  { records: [{ map, mv, ground, vehicle, id, name, image, time, splits, at, ghost? }] }
//   <dir>/ghosts/<sha1 of the key>.json { key, trace }       key: map|ground|vehicle|id
//   <dir>/autopilots/<id>.json          { id, name, owner, ownerName, savedAt, …the training }
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { appMeta, autopilots, maps, records } from './schema.mjs';

const MARK = 'files_imported';
const fin = x => typeof x === 'number' && Number.isFinite(x);
const str = x => typeof x === 'string' && x.length > 0;
const date = x => new Date(fin(x) ? x : 0);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') console.warn(`[import] ${file}: ${e.message}`); return null; }
}
function jsonFiles(dir) {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort(); }
  catch (e) { if (e.code !== 'ENOENT') throw e; return []; }
}

/**
 * @param {{ q: any }} db
 * @param {string} dir the old DATA_DIR
 * @returns what was added ({ maps, records, ghosts, autopilots }), or null when there was nothing to do
 *   (already done once, or no such directory)
 */
export async function importFiles(db, dir, { force = false, now = Date.now } = {}) {
  if (!fs.existsSync(dir)) return null;
  return db.q.transaction(async tx => {
    if (!force && (await tx.select({ key: appMeta.key }).from(appMeta).where(eq(appMeta.key, MARK))).length) return null;
    const added = { maps: 0, records: 0, ghosts: 0, autopilots: 0 };

    for (const f of jsonFiles(path.join(dir, 'maps'))) {
      const m = readJson(path.join(dir, 'maps', f));
      if (!m || m.id !== f.slice(0, -5) || !str(m.name)) continue;
      const rows = await tx.insert(maps).values({ id: m.id, name: m.name, course: m.course ?? null, createdAt: date(m.createdAt), updatedAt: date(m.updatedAt), updatedBy: str(m.updatedBy) ? m.updatedBy : null })
        .onConflictDoNothing().returning({ id: maps.id });
      added.maps += rows.length;
    }

    const recs = readJson(path.join(dir, 'records.json'));
    for (const r of Array.isArray(recs?.records) ? recs.records : []) {
      if (!r || !str(r.map) || !str(r.ground) || !str(r.vehicle) || !str(r.id) || !fin(r.time)) continue;
      const key = `${r.map}|${r.ground}|${r.vehicle}|${r.id}`;
      const g = r.ghost ? readJson(path.join(dir, 'ghosts', crypto.createHash('sha1').update(key).digest('hex') + '.json')) : null;
      const trace = g && g.key === key && str(g.trace) ? g.trace : null;
      const rows = await tx.insert(records).values({
        map: r.map, ground: r.ground, vehicle: r.vehicle, driverId: r.id, driverName: str(r.name) ? r.name : 'Driver', driverImage: str(r.image) ? r.image : null,
        mapVersion: fin(r.mv) ? Math.round(r.mv) : 0, time: r.time, splits: Array.isArray(r.splits) ? r.splits : [], setAt: date(r.at), trace,
      }).onConflictDoNothing().returning({ id: records.driverId });
      added.records += rows.length; if (rows.length && trace) added.ghosts++;
    }

    for (const f of jsonFiles(path.join(dir, 'autopilots'))) {
      const a = readJson(path.join(dir, 'autopilots', f));
      if (!a || a.id !== f.slice(0, -5) || !str(a.name) || !str(a.owner) || a.kind !== 'carsim-autopilot') continue;
      const { id, name, owner, ownerName, savedAt, ...training } = a;
      const rows = await tx.insert(autopilots).values({ id, name, owner, ownerName: str(ownerName) ? ownerName : 'Driver', savedAt: date(savedAt), training })
        .onConflictDoNothing().returning({ id: autopilots.id });
      added.autopilots += rows.length;
    }

    const mark = { key: MARK, value: { dir: path.resolve(dir), added }, at: new Date(now()) };
    await tx.insert(appMeta).values(mark).onConflictDoUpdate({ target: appMeta.key, set: { value: mark.value, at: mark.at } });
    return added;
  });
}
