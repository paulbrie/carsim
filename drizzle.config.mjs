// drizzle-kit: `npm run db:generate` compares lib/db/schema.mjs with migrations/ and writes the next SQL file.
export default {
  dialect: 'postgresql',
  schema: './lib/db/schema.mjs',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL || 'postgres://carsim:carsim@127.0.0.1:5554/carsim' },
};
