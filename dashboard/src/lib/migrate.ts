import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Applies pending migrations at boot, using drizzle-orm's runtime migrator
 * rather than the drizzle-kit CLI - drizzle-kit is a devDependency and may be
 * pruned from a production install, so it can't be relied on at start time.
 *
 * Drizzle records applied migrations in its own table, so this is a no-op on
 * every boot after the first.
 */
export async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — cannot migrate');
  }

  // A dedicated single connection: the app's pool outlives this, and holding a
  // pooled connection open through a migration is a good way to deadlock.
  const client = postgres(connectionString, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
    console.log('Migrations up to date.');
  } finally {
    await client.end();
  }
}
