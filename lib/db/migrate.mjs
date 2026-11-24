// Brings the database up to migrations/ (the numbered SQL files drizzle-kit writes from schema.mjs).
// Under a Postgres advisory lock: two processes starting together apply them once, one after the other.
// The server runs it before it listens (server.mjs); `npm run db:migrate` does it by hand.
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as run } from 'drizzle-orm/node-postgres/migrator';

const FOLDER = fileURLToPath(new URL('../../migrations', import.meta.url));
const LOCK = 318_000_001;      // any number of our own

/** @param {{ pool: import('pg').Pool, searchPath: string | null }} db */
export async function migrate(db, { folder = FOLDER } = {}) {
  const client = await db.pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK]);
    try { await run(drizzle(client), { migrationsFolder: folder, migrationsSchema: db.searchPath || 'drizzle' }); }
    finally { await client.query('select pg_advisory_unlock($1)', [LOCK]); }
  } finally { client.release(); }
}
