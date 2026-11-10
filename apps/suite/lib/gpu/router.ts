// lib/gpu/router.ts — which machine should run a ComfyUI job?
//
// Every job says what it needs (GpuNeeds below). Every machine has a profile
// (config/gpu-workers.ts) and a live state (lib/gpu/health.ts). rankWorkers() lists the machines
// that CAN run the job, best first. The queue (lib/queue.ts) then takes the first one that's free.
//
// The rules, in order:
//   1. The machine must be online and have every model file the job loads.
//   2. RAM-heavy jobs go to the machine with the most ordinary memory first.
//   3. A machine whose card fits the whole model beats one that has to spill part of it into RAM.
//   4. Among machines that fit, the SMALLEST card wins, so the big card stays free for big jobs.
//      (A FLUX.2 Klein picture prefers the Alienware's 8 GB and overflows to the Raider's 16 GB.)
//   5. Among machines that have to spill, the BIGGEST card wins, since it spills the least.
//      (A big video model prefers the Raider and overflows to the Alienware, if it has the files.)

import type { WorkerState } from './health.ts';

export interface GpuNeeds {
  /** What the job is, for logs and messages: e.g. "FLUX.2 Klein picture". */
  label: string;
  /** About how much graphics-card memory (VRAM) the model needs, in GB. */
  vramGB: number;
  /** True for jobs that use lots of ordinary memory (RAM): they prefer the machine with the most. */
  ramHeavy?: boolean;
  /** Every model file the job's recipe loads. A machine missing any of them can't run it. */
  files: string[];
}

// How much of a machine's RAM a model may spill into. ComfyUI can keep part of a model in RAM
// when the card is too small; it's slower, but it works. Half the RAM leaves room for Windows.
const RAM_SPILL_SHARE = 0.5;

const fitsOnCard = (needs: GpuNeeds, s: WorkerState) => s.worker.vramGB >= needs.vramGB;
const fitsWithSpill = (needs: GpuNeeds, s: WorkerState) =>
  s.worker.vramGB + s.worker.ramGB * RAM_SPILL_SHARE >= needs.vramGB;

/** The machines that can run this job, best first. Empty when none can. */
export function rankWorkers(needs: GpuNeeds, states: WorkerState[]): WorkerState[] {
  const able = states.filter(
    (s) => s.online && needs.files.every((file) => s.files.has(file)) && fitsWithSpill(needs, s),
  );
  return able.sort((a, b) => {
    if (needs.ramHeavy && a.worker.ramGB !== b.worker.ramGB) return b.worker.ramGB - a.worker.ramGB;
    const aFits = fitsOnCard(needs, a);
    const bFits = fitsOnCard(needs, b);
    if (aFits !== bFits) return aFits ? -1 : 1;
    return aFits ? a.worker.vramGB - b.worker.vramGB : b.worker.vramGB - a.worker.vramGB;
  });
}

/** A message for when no machine can run the job: what's missing, in plain words. */
export function noWorkerMessage(needs: GpuNeeds, states: WorkerState[]): string {
  const online = states.filter((s) => s.online);
  if (!online.length) return 'ComfyUI isn’t running on any machine. Start it with run_nvidia_gpu.bat and try again.';
  const missing = needs.files.filter((file) => !online.some((s) => s.files.has(file)));
  if (missing.length) {
    return `${needs.label}: the model isn’t downloaded into ComfyUI on any machine yet (missing ${missing.join(', ')}). Pick another model, or add its files first.`;
  }
  return `${needs.label}: no machine has every file it needs, or enough memory for it.`;
}
