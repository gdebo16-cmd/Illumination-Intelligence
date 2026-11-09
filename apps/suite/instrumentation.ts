// Next.js runs register() once when the server starts. We use it to start Umbra's task scheduler.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('./lib/umbra/scheduler');
    startScheduler();
  }
}
