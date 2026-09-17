/**
 * Next runs this once when the server starts. Migrating and seeding here means
 * a deploy is self-sufficient: no CLI, no terminal, no one remembering to run a
 * command against production before the app is usable.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { runMigrations } = await import('./lib/migrate');
  const { seedBaseline } = await import('./lib/seedBaseline');

  try {
    await runMigrations();
    await seedBaseline();
  } catch (err) {
    // Deliberately fatal. An app whose schema didn't migrate will fail in
    // confusing ways on the first real request; failing at boot puts the actual
    // reason at the top of the deploy logs instead.
    console.error('Startup migration/seed failed:', err);
    throw err;
  }
}
