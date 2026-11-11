// lib/gpu/idle.ts — frees a machine's graphics card when Prism hasn't used it for a while.
//
// ComfyUI keeps its models on the card after a job, so the next picture starts faster. That's
// handy while you're working, but it means the Alienware sat at about 7 of its 8 GB all night.
// So once a minute this checks every machine in config/gpu-workers.ts. When one has had nothing
// to do for N minutes, it asks that machine's ComfyUI to let go of its models (POST /free).
//   - N is COMFY_IDLE_UNLOAD_MINUTES in apps/suite/.env (10 if it isn't set; 0 turns this off),
//     or a machine's own idleUnloadMinutes in config/gpu-workers.ts.
//   - "Nothing to do" means: no job of ours on it, none waiting in our queue (gpuQueue.idleSince),
//     and ComfyUI's own line is empty too (someone might be using its page directly).
//   - It frees a machine once per quiet stretch, not every minute.
//   - A machine that's switched off is skipped quietly.
// The next picture on that machine then takes a few seconds longer while the model loads again.
// (Ollama's chat models are separate: they unload themselves, see OLLAMA_KEEP_ALIVE in lib/queue.ts.)

import { GPU_WORKERS, type GpuWorker } from '../../config/gpu-workers.ts';
import { gpuQueue } from '../queue.ts';

const CHECK_EVERY_MS = 60_000;
const ASK_TIMEOUT_MS = 3_000;

function minutesFor(worker: GpuWorker): number {
  if (typeof worker.idleUnloadMinutes === 'number') return Math.max(0, worker.idleUnloadMinutes);
  const setting = process.env.COMFY_IDLE_UNLOAD_MINUTES;
  const minutes = setting === undefined || setting.trim() === '' ? 10 : Number(setting);
  return Number.isFinite(minutes) ? Math.max(0, minutes) : 10;
}

// When each machine was last freed, so a quiet stretch only frees it once.
const freedAt = new Map<string, number>();

// Is ComfyUI's own line empty? null when the machine doesn't answer (off, or asleep).
async function comfyQueueEmpty(worker: GpuWorker): Promise<boolean | null> {
  try {
    const res = await fetch(`${worker.url}/queue`, { signal: AbortSignal.timeout(ASK_TIMEOUT_MS) });
    if (!res.ok) return null;
    const queue = (await res.json()) as { queue_running?: unknown[]; queue_pending?: unknown[] };
    return !queue.queue_running?.length && !queue.queue_pending?.length;
  } catch {
    return null;
  }
}

async function checkWorker(worker: GpuWorker): Promise<void> {
  const minutes = minutesFor(worker);
  if (minutes <= 0) return;
  const since = gpuQueue.idleSince(worker.id);
  if (since === null) return; // in use
  if (Date.now() - since < minutes * 60_000) return; // not quiet for long enough yet
  if ((freedAt.get(worker.id) ?? 0) >= since) return; // already freed during this quiet stretch

  if ((await comfyQueueEmpty(worker)) !== true) return; // busy with someone else's work, or offline
  // A job could have started while we were asking; check once more right before freeing.
  if (gpuQueue.idleSince(worker.id) !== since) return;

  try {
    const res = await fetch(`${worker.url}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
    });
    if (!res.ok) return;
    freedAt.set(worker.id, Date.now());
    console.log(`GPU idle: freed ${worker.name}'s graphics card after ${minutes} min without Prism work.`);
  } catch {
    // Went offline in the last moment; it'll be checked again next minute.
  }
}

/**
 * Start the once-a-minute check. Called from instrumentation.ts when the server starts; it runs
 * only once per server, and never while `next build` is looking over the app.
 */
export function startIdleUnloader(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const g = globalThis as unknown as { gpuIdleUnloader?: boolean };
  if (g.gpuIdleUnloader) return; // already running in this process
  g.gpuIdleUnloader = true;

  let checking = false;
  const tick = async () => {
    if (checking) return; // the last check is still waiting on a slow machine
    checking = true;
    try {
      await Promise.all(GPU_WORKERS.map(checkWorker));
    } finally {
      checking = false;
    }
  };
  setInterval(() => void tick(), CHECK_EVERY_MS).unref?.();

  const plan = GPU_WORKERS.map((w) => `${w.name} ${minutesFor(w) || 'off'}${minutesFor(w) ? ' min' : ''}`).join(', ');
  console.log(`GPU idle: on (frees an idle graphics card after: ${plan})`);
}
