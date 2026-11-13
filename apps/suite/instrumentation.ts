// Next.js runs register() once when the server starts. We use it to start Umbra's task scheduler,
// the timer that frees idle graphics cards (lib/gpu/idle.ts), Refract's SSH terminal socket
// (lib/refract/terminal.ts) and Refract's virtual remote socket (lib/refract/remote.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('./lib/umbra/scheduler');
    startScheduler();
    const { startIdleUnloader } = await import('./lib/gpu/idle');
    startIdleUnloader();
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
