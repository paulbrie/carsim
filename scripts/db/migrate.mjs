// Applies the pending migrations (the server does the same when it starts).
//   npm run db:migrate
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
const { getDb, closeDb } = await import('../../lib/db/index.mjs');
const { migrate } = await import('../../lib/db/migrate.mjs');
await migrate(getDb());
console.log('[db] up to date');
await closeDb();
