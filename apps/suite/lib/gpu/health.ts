// lib/gpu/health.ts — asking each machine's ComfyUI how it's doing.
//
// For every worker in config/gpu-workers.ts the router wants three answers:
//   online?  does ComfyUI answer /system_stats within a moment?
//   busy?    does ComfyUI's own /queue have anything running or waiting?
//   files?   which model files can it load? (the lists its Load boxes show, from /object_info)
// Asking takes time, so answers are remembered for a few seconds (the file lists for a minute).

import type { GpuWorker } from '../../config/gpu-workers.ts';

export interface WorkerState {
  worker: GpuWorker;
  online: boolean;
  /** ComfyUI already has work running or waiting (maybe someone using its page directly). */
  comfyBusy: boolean;
  /** The model files this ComfyUI can load. Empty when it's offline. */
  files: Set<string>;
}

// The boxes that load a model file, and the setting in each that names the file.
export const LOADERS: Record<string, string> = {
  UNETLoader: 'unet_name',
  CLIPLoader: 'clip_name',
  VAELoader: 'vae_name',
  UpscaleModelLoader: 'model_name', // Prism's Upscale button
};

const ONLINE_FOR_MS = 3_000; // re-check a machine that answered after this long
const OFFLINE_FOR_MS = 15_000; // and one that didn't after this long
const FILES_FOR_MS = 60_000; // model files change rarely (only when you copy one in)
const ASK_TIMEOUT_MS = 1_500; // on the home network ComfyUI answers in a few milliseconds

async function getJson(url: string, timeoutMs = ASK_TIMEOUT_MS): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

/** The files ComfyUI offers in one kind of Load box: the same list its dropdown shows. */
export async function filesOffered(comfyUrl: string, loader: string): Promise<string[]> {
  const info = (await getJson(`${comfyUrl}/object_info/${loader}`, 5_000)) as Record<
    string,
    { input?: { required?: Record<string, unknown[]> } }
  >;
  const setting = info[loader]?.input?.required?.[LOADERS[loader]] ?? [];
  // Usually [[file, file, ...]]; some ComfyUI versions send ["COMBO", { options: [file, ...] }].
  if (Array.isArray(setting[0])) return setting[0] as string[];
  return (setting[1] as { options?: string[] } | undefined)?.options ?? [];
}

type Status = { at: number; online: boolean; comfyBusy: boolean };
const statuses = new Map<string, Status>();
const fileLists = new Map<string, { at: number; files: Set<string> }>();

async function askStatus(worker: GpuWorker): Promise<Status> {
  try {
    const [, queue] = await Promise.all([
      getJson(`${worker.url}/system_stats`),
      getJson(`${worker.url}/queue`) as Promise<{ queue_running?: unknown[]; queue_pending?: unknown[] }>,
    ]);
    const comfyBusy = Boolean(queue.queue_running?.length || queue.queue_pending?.length);
    return { at: Date.now(), online: true, comfyBusy };
  } catch {
    return { at: Date.now(), online: false, comfyBusy: false };
  }
}

/** How one machine is doing right now (from memory when we asked very recently). */
export async function checkWorker(worker: GpuWorker): Promise<WorkerState> {
  let status = statuses.get(worker.id);
  const maxAge = status?.online ? ONLINE_FOR_MS : OFFLINE_FOR_MS;
  if (!status || Date.now() - status.at > maxAge) {
    status = await askStatus(worker);
    statuses.set(worker.id, status);
  }
  if (!status.online) return { worker, online: false, comfyBusy: false, files: new Set() };

  let list = fileLists.get(worker.id);
  if (!list || Date.now() - list.at > FILES_FOR_MS) {
    try {
      const names = await Promise.all(Object.keys(LOADERS).map((loader) => filesOffered(worker.url, loader)));
      list = { at: Date.now(), files: new Set(names.flat()) };
      fileLists.set(worker.id, list);
    } catch {
      // It answered a moment ago but not now: treat it as offline for a while.
      statuses.set(worker.id, { at: Date.now(), online: false, comfyBusy: false });
      return { worker, online: false, comfyBusy: false, files: new Set() };
    }
  }
  return { worker, online: true, comfyBusy: status.comfyBusy, files: list.files };
}

/** How every machine is doing, all asked at the same time. */
export const checkWorkers = (workers: GpuWorker[]) => Promise.all(workers.map(checkWorker));

/** Forget what we know about a machine's queue, so the next check asks it again. */
export function forgetStatus(workerId: string): void {
  statuses.delete(workerId);
}

/** Forget everything about a machine (after it failed a job), files included. */
export function forgetWorker(workerId: string): void {
  statuses.delete(workerId);
  fileLists.delete(workerId);
}
