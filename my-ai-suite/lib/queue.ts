// lib/queue.ts - runs one GPU job at a time; live chat ('high') jumps ahead of background work ('low').
// Works for a single Node process (npm run dev / npm start). The queue resets on restart.

type Job = {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

class GpuQueue {
  private high: Job[] = [];
  private low: Job[] = [];
  private running = false;

  add<T>(run: () => Promise<T>, priority: 'high' | 'low' = 'high'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: Job = { run, resolve: resolve as (v: unknown) => void, reject };
      (priority === 'high' ? this.high : this.low).push(job);
      void this.next();
    });
  }

  private async next(): Promise<void> {
    if (this.running) return;
    const job = this.high.shift() ?? this.low.shift();
    if (!job) return;

    this.running = true;
    try {
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
const g = globalThis as unknown as { gpuQueue?: GpuQueue };
export const gpuQueue = (g.gpuQueue ??= new GpuQueue());
