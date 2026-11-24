// Adds a map from a file to the app's maps (the database, as lib/maps/store.mjs keeps them; DATABASE_URL from .env.local).
//   node scripts/maps/add.mjs scripts/maps/serpentine.json [--name "Serpentine"] [--replace]
// The file is a course as the editor's Export course writes it (the sim's COURSE); the map's name is
// --name, or the file's (serpentine.json: Serpentine).
// A map of that name already there is left alone unless --replace, which saves
// the file's course over it (a new version of the map: its best laps then show as an earlier layout).
// The super admin can do the same in the app: Maps → New map, from a course file (the name typed in).
import fs from 'node:fs';
import path from 'node:path';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
const { mapStore } = await import('../../lib/maps/store.mjs');
const { closeDb } = await import('../../lib/db/index.mjs');

const args = process.argv.slice(2), ni = args.indexOf('--name'), replace = args.includes('--replace');
const file = args.find((a, i) => !a.startsWith('--') && (ni < 0 || i !== ni + 1));
if (!file) { console.error('usage: node scripts/maps/add.mjs <course.json> [--name <name>] [--replace]'); process.exit(1); }
const course = JSON.parse(fs.readFileSync(file, 'utf8'));
const name = ni >= 0 ? args[ni + 1] : path.basename(file, '.json').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const store = mapStore(), had = (await store.list()).find(m => m.name === name);
if (had && !replace) console.log(`${had.id}: already there (updated ${new Date(had.updatedAt).toISOString()}), left alone; --replace to save this course over it`);
else {
  const m = had ? await store.update(had.id, { course, by: 'scripts/maps/add.mjs' }) : await store.create({ name, course, by: 'scripts/maps/add.mjs' });
  console.log(`${m.id}: ${had ? 'replaced' : 'added'} (${m.course.wp.length} waypoints) in the database`);
}
await closeDb();
