// Next.js runs register() once when the server starts. We use it to start Umbra's task scheduler,
// the timer that frees idle graphics cards (lib/gpu/idle.ts), picks up Flicker runs a restart cut off (lib/umbra/runs.ts), Refract's SSH terminal socket
// (lib/refract/terminal.ts) and Refract's virtual remote socket (lib/refract/remote.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('./lib/umbra/scheduler');
    startScheduler();
    const { startIdleUnloader } = await import('./lib/gpu/idle');
    startIdleUnloader();
    // Flicker replies that were in progress when the last server stopped carry on from where they
    // were (lib/umbra/runs.ts). Checked a few times: a run is only picked up once its old heartbeat
    // has gone quiet, and the old server may have stopped only seconds ago.
    for (const delay of [5_000, 25_000, 70_000]) {
      setTimeout(() => {
        import('./lib/umbra/runs')
          .then(({ resumeOrphanedRuns }) => {
            const resumed = resumeOrphanedRuns();
            if (resumed) console.log(`[umbra-runs] picked up ${resumed} run(s) after a restart`);
          })
          .catch((err) => console.error('[umbra-runs] could not check for runs to pick up', (err as Error)?.message));
      }, delay).unref?.();
    }
    try {
      const { installRefractTerminal } = await import('./lib/refract/terminal');
      installRefractTerminal();
    } catch {
      // The rest of the suite keeps working without the terminal.
      console.error('[refract-terminal] could not start');
    }
    try {
      const { installRefractRemote } = await import('./lib/refract/remote');
      installRefractRemote();
    } catch {
      // The rest of the suite (and the terminal) keeps working without the virtual remote.
      console.error('[refract-remote] could not start');
    }
  }
}
