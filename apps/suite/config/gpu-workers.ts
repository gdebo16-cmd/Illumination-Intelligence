// The computers that can run ComfyUI jobs for Prism (pictures and videos).
//
// The router in lib/gpu/router.ts picks one of these for every job. Each machine runs its own
// copy of ComfyUI. The app never needs to know which models a machine has: it asks that
// machine's ComfyUI (the same list its Load boxes show), so after you copy a model file into a
// machine's ComfyUI models folder, the router starts using it within about a minute.
//
// To change the list without editing code, set ILLUMINATION_WORKERS in apps/suite/.env to a
// JSON list in the same shape, e.g.
//   ILLUMINATION_WORKERS=[{"id":"raider","name":"Raider","url":"http://127.0.0.1:8188","vramGB":16,"ramGB":32,"local":true}]
// (Leave the Alienware out of that list to switch it off.)

export interface GpuWorker {
  /** A short id used in logs. */
  id: string;
  /** The name people see, e.g. "Running on Alienware". */
  name: string;
  /** Where its ComfyUI listens. */
  url: string;
  /** Graphics card memory (VRAM), in GB. */
  vramGB: number;
  /** Ordinary memory (RAM), in GB. ComfyUI can park part of a big model here, slowly. */
  ramGB: number;
  /** True for this computer: its card is shared with Ollama (Lumen and Umbra's chat). */
  local?: boolean;
}

const DEFAULT_WORKERS: GpuWorker[] = [
  {
    id: 'raider',
    name: 'Raider',
    // COMFY_URL is the older setting for this machine's ComfyUI; it still works.
    url: process.env.COMFY_URL ?? 'http://127.0.0.1:8188',
    vramGB: 16, // RTX 5080 Laptop
    ramGB: 32,
    local: true,
  },
  {
    id: 'alienware',
    name: 'Alienware',
    url: 'http://192.168.1.102:8188', // only reachable on the home network
    vramGB: 8, // RTX 3070 Laptop
    ramGB: 64,
  },
];

function workersFromEnv(): GpuWorker[] | null {
  const raw = process.env.ILLUMINATION_WORKERS;
  if (!raw) return null;
  try {
    const list = JSON.parse(raw) as GpuWorker[];
    if (Array.isArray(list) && list.length && list.every((w) => w.id && w.name && w.url)) return list;
  } catch {
    // fall through to the warning below
  }
  console.warn('ILLUMINATION_WORKERS is not a valid JSON list of workers; using the built-in list.');
  return null;
}

export const GPU_WORKERS: GpuWorker[] = workersFromEnv() ?? DEFAULT_WORKERS;

/** This computer: the one that also runs Ollama. Falls back to the first worker in the list. */
export const LOCAL_WORKER: GpuWorker = GPU_WORKERS.find((w) => w.local) ?? GPU_WORKERS[0];
