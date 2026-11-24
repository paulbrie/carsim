// A database for a test file: a schema of its own (test_…) in the development Postgres, brought up by the
// migrations and dropped at the end. TEST_DATABASE_URL, else DATABASE_URL, else docker-compose.yml's.
import crypto from 'node:crypto';
import pg from 'pg';
import { openDb } from '../lib/db/index.mjs';
import { migrate } from '../lib/db/migrate.mjs';

export const TEST_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgres://carsim:carsim@127.0.0.1:5554/carsim';

export async function testDb() {
  const schema = `test_${crypto.randomBytes(6).toString('hex')}`;
  const admin = async sql => {
    const c = new pg.Client(TEST_URL);
    try { await c.connect(); await c.query(sql); }
    catch (e) { throw new Error(`The tests need Postgres (docker compose up -d, or TEST_DATABASE_URL): ${e.message || e.code}`, { cause: e }); }
    finally { await c.end().catch(() => { }); }
  };
  await admin(`create schema "${schema}"`);
  const db = openDb(TEST_URL, { searchPath: schema, max: 4 });
  await migrate(db);
  return {
    db, schema,
    /** empty tables, for the next test */
    reset: () => db.pool.query('truncate maps, records, autopilots, app_meta'),
    drop: async () => { await db.pool.end(); await admin(`drop schema "${schema}" cascade`); },
  };
}
