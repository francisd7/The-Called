/**
 * Connection for the CLI scripts. Separate from src/db/index.ts on purpose:
 * that one is built for Next's bundler (extensionless imports, a hot-reload
 * cache) and Node's ESM loader resolves neither.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/db/schema.ts';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

export const sql = postgres(connectionString, { max: 4 });
export const db = drizzle(sql, { schema });
export { schema };
