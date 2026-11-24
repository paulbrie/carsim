// Reads the files of before the database (DATA_DIR, default ./data) into it: lib/db/import-files.mjs.
// The server does it once by itself; this is for doing it by hand.
//   npm run db:import [-- --force] [-- <dir>]
import path from 'node:path';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
const { getDb, closeDb } = await import('../../lib/db/index.mjs');
const { migrate } = await import('../../lib/db/migrate.mjs');
const { importFiles } = await import('../../lib/db/import-files.mjs');
const args = process.argv.slice(2), force = args.includes('--force');
const dir = args.find(a => !a.startsWith('--')) || process.env.DATA_DIR || path.join(process.cwd(), 'data');
const db = getDb();
await migrate(db);
const added = await importFiles(db, dir, { force });
console.log(added ? `[import] from ${dir}: ${added.maps} maps, ${added.records} best laps (${added.ghosts} with a ghost), ${added.autopilots} autopilots added`
  : `[import] nothing to do: ${dir} is missing, or it was imported before (--force reads it again)`);
await closeDb();
