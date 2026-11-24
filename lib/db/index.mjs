// The database (ticket #318): Postgres, through one connection pool for the whole process.
// The race server (server.mjs) and Next's routes each load their own copy of this module, so the pool lives
// on globalThis. DATABASE_URL says where (docker-compose.yml for development; on Railway, the Postgres
// service's variable). The tables are in schema.mjs; migrate.mjs brings a database up to them.
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.mjs';

export function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Development: `docker compose up -d` and DATABASE_URL=postgres://carsim:carsim@127.0.0.1:5554/carsim in .env.local (see .env.example).');
  return url;
}

/**
 * A pool and Drizzle on it. searchPath: a schema of its own instead of public (the tests).
 * @param {string} [url]
 * @param {{ max?: number, searchPath?: string }} [opts]
 */
export function openDb(url = databaseUrl(), { max = 10, searchPath } = {}) {
  if (searchPath && !/^[a-z_][a-z0-9_]*$/.test(searchPath)) throw new Error('searchPath: a plain schema name');
  const pool = new pg.Pool({ connectionString: url, max, options: searchPath ? `-c search_path=${searchPath}` : undefined });
  pool.on('error', e => console.warn(`[db] ${e.message}`));          // an idle connection dropped: the pool opens another
  return { pool, q: drizzle(pool, { schema }), searchPath: searchPath || null };
}

/** The app's database, opened on first use. */
export function getDb() {
  return (globalThis.__carsimDb ??= openDb());
}

export async function closeDb() {
  const d = globalThis.__carsimDb;
  if (!d) return;
  globalThis.__carsimDb = undefined;
  await d.pool.end();
}

/** true when the database answers (the health check) */
export async function pingDb(ms = 2000) {
  try {
    await Promise.race([getDb().pool.query('select 1'), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms).unref?.())]);
    return true;
  } catch { return false; }
}

// 23505: unique_violation. Drizzle wraps the driver's error (cause).
export const isUniqueViolation = e => (e?.code ?? e?.cause?.code) === '23505';
