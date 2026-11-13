// lib/queue.ts - decides when (and, for ComfyUI jobs, WHERE) each GPU job runs.
// Live work ('high') goes ahead of background work ('low'). Works for a single Node process
// (npm run dev / npm start). The queue resets on restart.
//
// Machines: config/gpu-workers.ts lists the computers with a graphics card (this Raider, and the
// Alienware on the home network). Each one runs ONE job at a time.
//   - Ollama jobs (Lumen, Umbra's chat) always run here, on the local machine.
//   - ComfyUI jobs (Prism pictures and videos) say what they need (`needs`: model files, memory),
//     and lib/gpu/router.ts ranks the machines that can do it. The job takes the best one that's
//     free. If none is free, it waits its turn here like before. If a machine drops off the
//     network (or runs out of memory) mid-job, the job moves on to the next machine that can do it.
//
// This machine's card is shared: Lumen (Ollama) and Prism (ComfyUI) models don't both fit.
// Before a job runs HERE the queue makes sure the OTHER engine has nothing on the card. It checks
// every time rather than remembering, because something outside this queue (another copy of the
// app, or Lumen's memory search) can load a model too. Jobs on the Alienware skip this.
//
// Switching Ollama models: when a job says which model it needs, the queue unloads the other
// chat models itself and waits until they are really gone before the new one loads. Letting
// Ollama evict a model while loading another was crashing its runner on this card ("CUDA error:
// shared object initialization failed" -> HTTP 500). If a 500 still happens, the queue clears
// Ollama and tries the job once more.
//
// Two people share the cards: within each priority, jobs alternate between users, so one person's
// burst of work (a bot taking six tool steps, say) can't hold the other one up for long.
// statusFor(userId) tells the page where that user's live request is in line, or which machine
// is running it.

import { GPU_WORKERS, LOCAL_WORKER, type GpuWorker } from '../config/gpu-workers.ts';
import { checkWorkers, forgetStatus, forgetWorker, type WorkerState } from './gpu/health.ts';
import { noWorkerMessage, rankWorkers, type GpuNeeds } from './gpu/router.ts';

type Engine = 'ollama' | 'comfy';
export type Priority = 'high' | 'low';
export type { GpuWorker } from '../config/gpu-workers.ts';
export type { GpuNeeds } from './gpu/router.ts';

/** Optional details about a job. */
interface JobInfo {
  /** Who it's for (for taking turns, and the "in line" notice). */
  userId?: string;
  /** Which Ollama model it will load. */
  model?: string;
  /**
   * ComfyUI jobs: what the job needs, so the router can pick a machine.
   * Leave it out and the job runs on this machine only (the old behaviour).
   */
  needs?: GpuNeeds;
}

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';

/** Context window for chat requests. Ollama's default (4096) was silently cutting off long chats. */
export const OLLAMA_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX) || 16384;

/**
 * How long Ollama keeps a chat model on the card after Lumen or Umbra last used it, so the next
 * message doesn't wait for it to load again. Ollama's own default is 5 minutes. Set
 * OLLAMA_KEEP_ALIVE_APP in apps/suite/.env to change it: "10m", "1h", or a number of seconds.
 * (The queue still clears models right away when Prism needs this machine's card.)
 */
const keepAliveSetting = process.env.OLLAMA_KEEP_ALIVE_APP?.trim() || '10m';
export const OLLAMA_KEEP_ALIVE: string | number = /^-?\d+$/.test(keepAliveSetting) ? Number(keepAliveSetting) : keepAliveSetting;

type Job = {
  /** The work itself. It's told which machine it got, so it talks to that machine's ComfyUI. */
  run: (worker: GpuWorker) => Promise<unknown>;
  engine: Engine;
  priority: Priority;
  userId?: string;
  model?: string;
  needs?: GpuNeeds;
  /** Machines that already failed this job; it won't be sent back to them. */
  tried: Set<string>;
  lastError?: unknown;
  /** The machine running it right now. */
  worker?: GpuWorker;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

interface QueueStatus {
  /** The user has a live request that hasn't started yet. */
  waiting: boolean;
  /** Their place in line (1 = next up). 0 when not waiting. */
  place: number;
  /** Jobs in front of them, counting the ones running now. */
  ahead: number;
  /** When their live picture or video job is running: the machine's name, e.g. "Alienware". */
  runningOn: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// "qwen3" and "qwen3:latest" are the same model to Ollama.
const fullName = (model: string) => (model.includes(':') ? model : `${model}:latest`);
// Embedding models are tiny and used between jobs (memory search); leave them loaded.
const isEmbedModel = (name: string) => /embed/i.test(name);

async function loadedOllamaModels(): Promise<string[]> {
  const res = await fetch(`${OLLAMA_URL}/api/ps`);
  const { models = [] } = (await res.json()) as { models?: { name: string }[] };
  return models.map((m) => m.name);
}

/**
 * Unload Ollama models from the card and wait until they're gone.
 * keep: a model to leave loaded. Embedding models stay unless everything must go (for ComfyUI).
 */
async function unloadOllama(options: { keep?: string; all?: boolean } = {}): Promise<void> {
  const keep = options.keep ? fullName(options.keep) : undefined;
  const shouldGo = (name: string) => name !== keep && (options.all || !isEmbedModel(name));

  const toUnload = (await loadedOllamaModels()).filter(shouldGo);
  if (toUnload.length === 0) return;

  await Promise.all(
    toUnload.map((name) =>
      fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name, keep_alive: 0 }),
      }),
    ),
  );

  // keep_alive: 0 returns before the memory is actually free. Wait (up to 15 s) until it is.
  for (let i = 0; i < 60; i++) {
    if (!(await loadedOllamaModels()).some(shouldGo)) break;
    await sleep(250);
  }
  await sleep(300); // a moment for the driver to release the memory
}

// Ask this machine's ComfyUI to drop its models from the card.
async function unloadComfy(): Promise<void> {
  await fetch(`${LOCAL_WORKER.url}/free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  });
}

// Ollama answers 500 when its model runner crashes (usually while loading).
const isOllamaCrash = (err: unknown) => /\b500\b|terminated|CUDA/i.test((err as Error)?.message ?? '');

// Problems with the MACHINE rather than the job: it can't be reached, it stopped answering, or it
// ran out of memory. Another machine might manage, so the job moves on instead of failing.
const isMachineTrouble = (err: unknown) =>
  /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|timeout|aborted|read_file_slice|error=1450|out of memory|allocation on device/i.test(
    (err as Error)?.message ?? String(err),
  );

class GpuQueue {
  private high: Job[] = [];
  private low: Job[] = [];
  /** What each machine is doing: machine id -> its job. */
  private running = new Map<string, Job>();
  /** When each machine last finished a job (see idleSince). */
  private idleFrom = new Map<string, number>();
  private readonly startedAt = Date.now();
  private lastUser: string | undefined;
  // next() runs one planning pass at a time; a call during a pass asks for one more pass.
  private planning = false;
  private planAgain = false;

  add<T>(
    run: (worker: GpuWorker) => Promise<T>,
    priority: Priority = 'high',
    engine: Engine = 'ollama',
    info: JobInfo = {},
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: Job = { run, engine, priority, ...info, tried: new Set(), resolve: resolve as (v: unknown) => void, reject };
      (priority === 'high' ? this.high : this.low).push(job);
      void this.next();
    });
  }

  /**
   * Since when a machine has had nothing to do for us: no job of ours running on it, and no
   * ComfyUI job waiting in line (it might be about to go there). null while it's in use.
   * A machine that hasn't run anything since the server started counts from the start.
   * lib/gpu/idle.ts uses this to free a machine's graphics card after a while.
   */
  idleSince(workerId: string): number | null {
    if (this.running.has(workerId)) return null;
    if ([...this.high, ...this.low].some((j) => j.engine === 'comfy')) return null;
    return this.idleFrom.get(workerId) ?? this.startedAt;
  }

  /** Where this user's live request is in line, or which machine is running it. */
  statusFor(userId: string): QueueStatus {
    const order = this.plannedOrder();
    const index = order.findIndex((j) => j.userId === userId && j.priority === 'high');
    if (index !== -1) return { waiting: true, place: index + 1, ahead: index + this.running.size, runningOn: null };
    const mine = [...this.running.values()].find((j) => j.userId === userId && j.priority === 'high' && j.engine === 'comfy');
    return { waiting: false, place: 0, ahead: 0, runningOn: mine?.worker?.name ?? null };
  }

  // Take turns between users: prefer the oldest job from someone other than whoever went last.
  private static pickIndex(list: Job[], lastUser: string | undefined): number {
    const other = list.findIndex((j) => j.userId !== lastUser);
    return other === -1 ? 0 : other;
  }

  // The order waiting jobs will run in if nothing new arrives.
  private plannedOrder(): Job[] {
    const high = [...this.high];
    const low = [...this.low];
    let last = this.lastUser;
    const order: Job[] = [];
    while (high.length || low.length) {
      const list = high.length ? high : low;
      const [job] = list.splice(GpuQueue.pickIndex(list, last), 1);
      if (job.userId) last = job.userId;
      order.push(job);
    }
    return order;
  }

  /**
   * The machines this job may run on, best first. When it can't run anywhere, the `reason`
   * (an error) it gets turned down with instead.
   */
  private choicesFor(job: Job, states: WorkerState[]): { workers: WorkerState[] } | { reason: unknown } {
    // Chat, and ComfyUI jobs that didn't say what they need: this machine only.
    if (job.engine === 'ollama' || !job.needs) {
      return { workers: [{ worker: LOCAL_WORKER, online: true, comfyBusy: false, files: new Set() }] };
    }
    const untried = states.filter((s) => !job.tried.has(s.worker.id));
    const workers = rankWorkers(job.needs, untried);
    if (workers.length) return { workers };
    // Nowhere left: give back the last machine's error if it had one, otherwise say why.
    return { reason: job.lastError ?? new Error(noWorkerMessage(job.needs, states)) };
  }

  private async next(): Promise<void> {
    if (this.planning) {
      this.planAgain = true;
      return;
    }
    this.planning = true;
    try {
      do {
        this.planAgain = false;
        await this.startWhatWeCan();
      } while (this.planAgain);
    } catch (err) {
      console.error('GPU queue: planning failed', err);
    } finally {
      this.planning = false;
    }
  }

  /** One planning pass: walk the line in order and start every job that has a free machine. */
  private async startWhatWeCan(): Promise<void> {
    const waiting = this.plannedOrder();
    if (!waiting.length) return;
    // Only ask the machines how they're doing when a ComfyUI job is waiting.
    const states = waiting.some((j) => j.engine === 'comfy' && j.needs) ? await checkWorkers(GPU_WORKERS) : [];

    // Machines promised to a job earlier in line that's still waiting for them. A later job
    // can't take them, so a big job that only fits one machine isn't skipped over forever.
    const promised = new Set<string>();

    for (const job of waiting) {
      const choice = this.choicesFor(job, states);
      if ('reason' in choice) {
        this.remove(job);
        job.reject(choice.reason);
        continue;
      }
      const free = choice.workers.filter((s) => !this.running.has(s.worker.id) && !promised.has(s.worker.id));
      // Best machine that's completely idle; else the best one this app isn't using
      // (ComfyUI then holds the job in its own line until it's done with the other work).
      const pick = free.find((s) => !s.comfyBusy) ?? free[0];
      if (pick) this.start(job, pick.worker);
      else for (const s of choice.workers) promised.add(s.worker.id);
    }
  }

  private remove(job: Job): void {
    for (const list of [this.high, this.low]) {
      const i = list.indexOf(job);
      if (i !== -1) list.splice(i, 1);
    }
  }

  private start(job: Job, worker: GpuWorker): void {
    this.remove(job);
    if (job.userId) this.lastUser = job.userId;
    job.worker = worker;
    this.running.set(worker.id, job);
    this.idleFrom.delete(worker.id);
    const started = Date.now();
    if (job.needs) console.log(`GPU queue: ${job.needs.label} -> ${worker.name}`);

    void this.runJob(job, worker)
      .then(
        (value) => {
          if (job.needs) console.log(`GPU queue: ${job.needs.label} done on ${worker.name} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
          job.resolve(value);
        },
        (err) => this.failed(job, worker, err),
      )
      .finally(() => {
        this.running.delete(worker.id);
        this.idleFrom.set(worker.id, Date.now());
        forgetStatus(worker.id); // its ComfyUI queue just changed
        void this.next();
      });
  }

  // A job failed. If the machine was the problem, put the job back at the front of the line to
  // try the next machine that can do it; otherwise pass the error on.
  private failed(job: Job, worker: GpuWorker, err: unknown): void {
    if (job.engine === 'comfy' && job.needs && isMachineTrouble(err)) {
      console.warn(`GPU queue: ${worker.name} failed on ${job.needs.label} (${(err as Error)?.message}); trying another machine.`);
      job.tried.add(worker.id);
      job.lastError = err;
      job.worker = undefined;
      forgetWorker(worker.id); // ask it fresh next time: it may be offline now
      (job.priority === 'high' ? this.high : this.low).unshift(job);
      return;
    }
    job.reject(err);
  }

  private async prepareCard(job: Job, worker: GpuWorker): Promise<void> {
    // Only this machine's card is shared with Ollama.
    if (worker.id !== LOCAL_WORKER.id) return;
    try {
      // Best effort: if the other engine isn't running, there's nothing to free.
      if (job.engine === 'comfy') {
        await unloadOllama({ all: true });
      } else {
        await unloadComfy().catch(() => undefined);
        if (job.model) await unloadOllama({ keep: job.model });
      }
    } catch (err) {
      console.warn(`GPU handoff to ${job.engine}: could not unload the other models`, err);
    }
  }

  private async runJob(job: Job, worker: GpuWorker): Promise<unknown> {
    await this.prepareCard(job, worker);
    try {
      return await job.run(worker);
    } catch (err) {
      if (job.engine !== 'ollama' || !isOllamaCrash(err)) throw err;
      console.warn('Ollama crashed on this request; clearing the card and trying once more.', err);
      await unloadOllama().catch(() => undefined);
      await sleep(1500);
      return await job.run(worker);
    }
  }
}

// Keep a single instance even when Next reloads modules in dev.
// (The key changes whenever the class changes, so dev mode doesn't keep an outdated copy.
// Bump it too when lib/gpu/health.ts or lib/gpu/router.ts changes: the old queue keeps the old copy.)
const g = globalThis as unknown as { gpuQueueV8?: GpuQueue };
export const gpuQueue = (g.gpuQueueV8 ??= new GpuQueue());
