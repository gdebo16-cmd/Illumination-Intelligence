// lib/queue.ts - runs one GPU job at a time; live work ('high') jumps ahead of background work ('low').
// Works for a single Node process (npm run dev / npm start). The queue resets on restart.
//
// Lumen (Ollama) and Prism (ComfyUI) share one graphics card, and their models don't both fit.
// Each job says which engine it uses, and before it runs the queue makes sure the OTHER engine
// has nothing on the card. It checks every time rather than remembering, because something
// outside this queue (another copy of the app, or Lumen's memory search) can load a model too.
// Both checks take a split second when there's nothing to unload. The first job after a switch
// is a few seconds slower while its model loads.

export type Engine = 'ollama' | 'comfy';

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const COMFY_URL = process.env.COMFY_URL ?? 'http://127.0.0.1:8188';

type Job = {
  run: () => Promise<unknown>;
  engine: Engine;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

// Unload every chat model Ollama has on the card.
async function unloadOllama(): Promise<void> {
  const res = await fetch(`${OLLAMA_URL}/api/ps`);
  const { models = [] } = (await res.json()) as { models?: { name: string }[] };
  await Promise.all(
    models.map((m) =>
      fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: m.name, keep_alive: 0 }),
      }),
    ),
  );
}

// Ask ComfyUI to drop its models from the card.
async function unloadComfy(): Promise<void> {
  await fetch(`${COMFY_URL}/free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  });
}

class GpuQueue {
  private high: Job[] = [];
  private low: Job[] = [];
  private running = false;

  add<T>(run: () => Promise<T>, priority: 'high' | 'low' = 'high', engine: Engine = 'ollama'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: Job = { run, engine, resolve: resolve as (v: unknown) => void, reject };
      (priority === 'high' ? this.high : this.low).push(job);
      void this.next();
    });
  }

  private async clearCardFor(engine: Engine): Promise<void> {
    try {
      // Best effort: if the other engine isn't running, there's nothing to free.
      await (engine === 'comfy' ? unloadOllama() : unloadComfy());
    } catch (err) {
      console.warn(`GPU handoff to ${engine}: could not unload the other engine`, err);
    }
  }

  private async next(): Promise<void> {
    if (this.running) return;
    const job = this.high.shift() ?? this.low.shift();
    if (!job) return;

    this.running = true;
    try {
      await this.clearCardFor(job.engine);
      job.resolve(await job.run());
    } catch (err) {
      job.reject(err);
    } finally {
      this.running = false;
      void this.next();
    }
  }
}

// Keep a single instance even when Next reloads modules in dev.
// (The key changes whenever the class changes, so dev mode doesn't keep an outdated copy.)
const g = globalThis as unknown as { gpuQueueV3?: GpuQueue };
export const gpuQueue = (g.gpuQueueV3 ??= new GpuQueue());
