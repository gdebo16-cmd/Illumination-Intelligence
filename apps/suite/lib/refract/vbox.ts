import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { powerActionAllowed, type PowerAction } from "./power";
import { applyVrdeWhilePoweredOff, ensureVrde } from "./vrde";

const execFileAsync = promisify(execFile);

/** The only VM this app talks to. The name is fixed so a request can't point VBoxManage at anything else. */
export const VM_NAME = "Refract";

export type VmSnapshot = {
  id: string;
  name: string;
  current: boolean;
};

export type VmStatus = {
  name: string;
  state: string;
  memoryMB: number;
  cpus: number;
  currentSnapshot: string | null;
  session: string | null;
  snapshots: VmSnapshot[];
};

function vboxManagePath(): string {
  const fromEnv = process.env.VBOX_MSI_INSTALL_PATH || process.env.VBOX_INSTALL_PATH;
  const candidates = [
    fromEnv ? path.join(fromEnv, "VBoxManage.exe") : "",
    "C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "VBoxManage";
}

async function vbox(args: string[], timeout = 15_000): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(vboxManagePath(), args, { timeout, windowsHide: true, encoding: "utf8" });
}

/** Turn VBoxManage --machinereadable lines (key="value") into a map. Only known keys are read later. */
function parseMachineReadable(stdout: string): Record<string, string> {
  const info: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq);
    let value = line.slice(eq + 1);
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    info[key] = value;
  }
  return info;
}

/** A snapshot name you'll type: trimmed, no control characters, not a flag. */
export function cleanSnapshotName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/[\u0000-\u001f]/g, "");
  if (!name || name.length > 80 || name.startsWith("-")) return null;
  return name;
}

function parseSnapshotList(stdout: string): VmSnapshot[] {
  const info = parseMachineReadable(stdout);
  const currentId = info.CurrentSnapshotUUID || null;
  const snapshots: VmSnapshot[] = [];
  for (const [key, name] of Object.entries(info)) {
    const match = key.match(/^SnapshotName((?:-\d+)*)$/);
    if (!match || !name) continue;
    const id = info[`SnapshotUUID${match[1]}`];
    if (!id) continue;
    snapshots.push({ id, name, current: id === currentId });
  }
  return snapshots;
}

/** The VM's snapshots, in the order VirtualBox lists them (parent, then children). */
async function listSnapshots(): Promise<VmSnapshot[]> {
  try {
    const { stdout } = await vbox(["snapshot", VM_NAME, "list", "--machinereadable"]);
    return parseSnapshotList(stdout);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const stderr = err && typeof err === "object" && "stderr" in err ? String((err as { stderr: unknown }).stderr) : "";
    if (/does not have any snapshots/i.test(`${message}\n${stderr}`)) return [];
    throw err;
  }
}

/** Ask VirtualBox how the Refract VM is doing: on/off, memory, CPUs, and the real snapshot list. */
export async function getVmStatus(): Promise<VmStatus> {
  const { stdout } = await vbox(["showvminfo", VM_NAME, "--machinereadable"]);
  const info = parseMachineReadable(stdout);
  const snapshot = info.CurrentSnapshotName?.trim() || null;
  const session = info.SessionName && info.SessionName !== "null" ? info.SessionName : null;
  let snapshots: VmSnapshot[] = [];
  try {
    snapshots = await listSnapshots();
  } catch {
    // Status is still useful if the snapshot list fails on its own.
  }
  return {
    name: info.name || VM_NAME,
    state: info.VMState || "unknown",
    memoryMB: Number(info.memory) || 0,
    cpus: Number(info.cpus) || 0,
    currentSnapshot: snapshot,
    session,
    snapshots,
  };
}

/** Only one take, restore or power action at a time in this server, so they can't overlap. */
let vmBusy = false;

/** Thrown when a restore, snapshot or power action is already in progress in this server. */
export class VmBusyError extends Error {}

/**
 * Take a snapshot of the current state.
 * If the VM is running, --live keeps it running while the snapshot is taken.
 */
export async function takeSnapshot(name: string, live: boolean): Promise<void> {
  if (vmBusy) throw new VmBusyError("The VM is busy.");
  vmBusy = true;
  try {
    const args = ["snapshot", VM_NAME, "take", name];
    if (live) args.push("--live");
    await vbox(args, 180_000);
  } finally {
    vmBusy = false;
  }
}

const SNAPSHOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A snapshot UUID from a request: strict UUID shape only, so it can never be read as a flag or a name. */
export function cleanSnapshotId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim().toLowerCase();
  return SNAPSHOT_ID.test(id) ? id : null;
}

/** Thrown when the requested snapshot isn't one of the Refract VM's snapshots. */
export class UnknownSnapshotError extends Error {}

export type RestoreResult = {
  /** The VM was running before the restore and was started again afterwards. */
  restarted: boolean;
  /** The restore worked, but starting the VM again afterwards didn't. */
  restartFailed: boolean;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The VM's VirtualBox state (running, poweroff, saved...). One quick showvminfo call. */
export async function readVmState(): Promise<string> {
  const { stdout } = await vbox(["showvminfo", VM_NAME, "--machinereadable"]);
  return parseMachineReadable(stdout).VMState || "unknown";
}

/** Poll showvminfo until the VM is in one of the wanted states. */
async function waitForState(wanted: string[], timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let state = "unknown";
    try {
      state = await readVmState();
    } catch {
      // A busy VM can briefly refuse showvminfo; try again.
    }
    if (wanted.includes(state)) return state;
    if (Date.now() > deadline) throw new Error(`The VM didn't reach ${wanted.join("/")} in time.`);
    await sleep(1_000);
  }
}

const SETTLED_STATES = ["running", "paused", "saved", "poweroff", "aborted", "stuck"];
const OFF_STATES = ["poweroff", "aborted"];


/**
 * Roll the Refract VM back to one of its snapshots.
 * VirtualBox won't restore a running, paused or saved VM, so this first powers it off hard
 * (or discards its saved state); whatever state it had is being thrown away by the restore anyway.
 * Snapshots are never deleted. If the VM was running before, it's started again headless afterwards.
 */
export async function restoreSnapshot(id: string): Promise<RestoreResult> {
  if (vmBusy) throw new VmBusyError("The VM is busy.");
  vmBusy = true;
  try {
    const snapshot = (await listSnapshots()).find((s) => s.id.toLowerCase() === id);
    if (!snapshot) throw new UnknownSnapshotError("No such snapshot.");

    // Let a VM that's mid-change (starting, stopping, saving...) settle first.
    let state = await readVmState();
    if (!SETTLED_STATES.includes(state)) state = await waitForState(SETTLED_STATES, 120_000);
    const wasRunning = state === "running";

    if (state === "running" || state === "paused" || state === "stuck") {
      // Hard power off, not ACPI: ACPI can hang, and the current state is discarded anyway.
      try {
        await vbox(["controlvm", VM_NAME, "poweroff"], 120_000);
      } catch {
        // Check the state below; it may have powered off despite the error.
      }
      await waitForState(OFF_STATES, 180_000);
    } else if (state === "saved") {
      await vbox(["discardstate", VM_NAME], 60_000);
      await waitForState(OFF_STATES, 60_000);
    }

    // The session lock can linger a moment after power off, so give the restore a few tries.
    let restored = false;
    for (let attempt = 1; attempt <= 3 && !restored; attempt += 1) {
      try {
        await vbox(["snapshot", VM_NAME, "restore", snapshot.id], 600_000);
        restored = true;
      } catch (err) {
        if (attempt === 3) throw err;
        await sleep(3_000);
      }
    }

    // Re-apply remote-display settings while the VM is still off (modifyvm is refused while it's running).
    try {
      await applyVrdeWhilePoweredOff();
    } catch {
      console.error("[refract] couldn't apply remote-display settings after restore");
    }

    if (!wasRunning) return { restarted: false, restartFailed: false };
    try {
      await vbox(["startvm", VM_NAME, "--type", "headless"], 120_000);
      await waitForState(["running"], 180_000);
      // Turn the remote display on now that the VM is running.
      void ensureVrde();
      return { restarted: true, restartFailed: false };
    } catch {
      return { restarted: false, restartFailed: true };
    }
  } finally {
    vmBusy = false;
  }
}

/** Thrown when a power action doesn't fit the VM's current state (e.g. reset while it's off). */
export class PowerStateError extends Error {}

export type PowerResult = {
  /** Stop only: the guest didn't shut down on the ACPI power button in time, so it was powered off hard. */
  forced: boolean;
};

/** How long a guest gets to shut down cleanly after the ACPI power button before it's powered off hard. */
const ACPI_SHUTDOWN_MS = 90_000;

/**
 * Start, stop or reset the Refract VM. Shares the take/restore lock, so none of them can overlap.
 * - start: startvm headless (resumes a saved VM), then waits for running.
 * - stop:  ACPI power button first so the guest shuts down cleanly; if it isn't off within
 *          ACPI_SHUTDOWN_MS (or the VM is paused/stuck, where ACPI can't work), hard poweroff.
 * - reset: controlvm reset (a cold reset, like the reset button), then waits for running.
 */
export async function powerVm(action: PowerAction): Promise<PowerResult> {
  if (vmBusy) throw new VmBusyError("The VM is busy.");
  vmBusy = true;
  try {
    const state = await readVmState();
    if (!powerActionAllowed(action, state)) throw new PowerStateError("Not in this state.");

    if (action === "start") {
      if (state === "poweroff" || state === "aborted") {
        try {
          await applyVrdeWhilePoweredOff();
        } catch {
          console.error("[refract] couldn't apply remote-display settings before Start");
        }
      }
      await vbox(["startvm", VM_NAME, "--type", "headless"], 120_000);
      await waitForState(["running"], 180_000);
      // Make sure the virtual remote can connect (VRDE on, 127.0.0.1 only). Doesn't hold up Start.
      void ensureVrde();
      return { forced: false };
    }

    if (action === "reset") {
      await vbox(["controlvm", VM_NAME, "reset"], 60_000);
      await waitForState(["running"], 60_000);
      return { forced: false };
    }

    if (state === "running") {
      let acpiSent = false;
      try {
        await vbox(["controlvm", VM_NAME, "acpipowerbutton"], 30_000);
        acpiSent = true;
      } catch {
        // Fall through to the hard power off.
      }
      if (acpiSent) {
        try {
          await waitForState(OFF_STATES, ACPI_SHUTDOWN_MS);
          return { forced: false };
        } catch {
          // The guest ignored or didn't finish the shutdown in time.
        }
      }
    }
    try {
      await vbox(["controlvm", VM_NAME, "poweroff"], 120_000);
    } catch {
      // Check the state below; it may have powered off despite the error (or just finished shutting down).
    }
    await waitForState(OFF_STATES, 120_000);
    return { forced: true };
  } finally {
    vmBusy = false;
  }
}