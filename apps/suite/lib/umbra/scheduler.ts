// lib/umbra/scheduler.ts — the timer that runs Umbra's scheduled tasks.
//
// Every 30 seconds it runs any task that's due. It starts when the app starts (see
// instrumentation.ts). It runs in production (`npm run prod`), the copy that's always on;
// in dev mode it stays off unless UMBRA_SCHEDULER=1, so a test copy doesn't run your tasks.

import 'server-only';
import { markInterruptedRuns, runDueTasks } from './tasks';

const EVERY_MS = 30_000;

export function startScheduler(): void {
  const g = globalThis as unknown as { umbraScheduler?: boolean };
  if (g.umbraScheduler) return; // already running in this process
  const enabled = process.env.NODE_ENV === 'production' || process.env.UMBRA_SCHEDULER === '1';
  if (!enabled) return;
  g.umbraScheduler = true;

  markInterruptedRuns();
  let busy = false;
  const tick = async () => {
    if (busy) return; // a long task is still going; check again next time
    busy = true;
    try {
      const ran = await runDueTasks();
      if (ran) console.log(`Umbra scheduler: ran ${ran} task${ran === 1 ? '' : 's'}`);
    } catch (err) {
      console.error('Umbra scheduler error:', err);
    } finally {
      busy = false;
    }
  };
  setInterval(tick, EVERY_MS);
  setTimeout(tick, 5_000); // first check shortly after start, to catch tasks missed while off
  console.log('Umbra scheduler: on (checks every 30 seconds)');
}
