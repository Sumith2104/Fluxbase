export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runMigrations } = await import('./lib/migrate');
    const { startWorkers } = await import('./lib/workers');

    try {
      await runMigrations();
      startWorkers();
    } catch (err) {
      console.error('[Instrumentation] Error during gateway initialization:', err);
    }
  }
}
