import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

type Db = PostgresJsDatabase<typeof schema>;

// Next evaluates modules during `next build` to collect page data, so
// connecting eagerly would make every build require a reachable database.
// Resolve on first query instead, and fail loudly then.
const globalForDb = globalThis as unknown as {
  __sql?: ReturnType<typeof postgres>;
  __db?: Db;
};

function getDb(): Db {
  if (globalForDb.__db) return globalForDb.__db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const sql = globalForDb.__sql ?? postgres(connectionString, { max: 10 });
  const instance = drizzle(sql, { schema });

  // Hot reload re-runs this module on every edit in dev; without the cache each
  // save would open another pool until Postgres refuses connections.
  globalForDb.__sql = sql;
  globalForDb.__db = instance;
  return instance;
}

export const db = new Proxy({} as Db, {
  get: (_target, prop, receiver) => Reflect.get(getDb(), prop, receiver),
});

export { schema };
