// lib/refract/autostart.ts — lets a Flicker's workshop tools turn the Refract VM on by themselves.
//
// It reuses the control room's own Start (powerVm("start") in vbox.ts: VRDE settings while off,
// startvm headless, wait for running, then VRDE on). Nothing here talks to VirtualBox another way.
// "Running" isn't enough for the workshop tools, so after Start it waits until SSH on 2222 actually
// answers (lib/refract/ssh.ts) before the tool goes on.
//
// Only Flicker tools call this, from a signed-in profile's run (the run's userId); there is no
// route for it, so nothing unauthenticated can start the VM. A VM that's already running is left
// alone: no reset, no restart.

import "server-only";
import { execInVm, SSH_MESSAGES } from "./ssh";
import { powerVm, PowerStateError, readVmState, VmBusyError } from "./vbox";

/** Off states the control room's Start accepts (power.ts). */
const STARTABLE = ["poweroff", "aborted", "saved"];
/** VirtualBox is in the middle of something; wait for it to settle. */
const SETTLING = ["starting", "restoring", "saving", "stopping", "snapshotting", "livesnapshotting", "settingup", "deletingsnapshot", "deletingsnapshotlive", "onlinesnapshotting", "teleporting", "teleportingin", "teleportingpausedvm"];
const SETTLE_TIMEOUT_MS = 180_000;
/** How long the guest gets to boot far enough for SSH after the VM is running. */
const SSH_READY_TIMEOUT_MS = 150_000;
const SSH_PROBE_EVERY_MS = 3_000;

export class RefractStartError extends Error {}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function stateNow(): Promise<string> {
  try {
    return await readVmState();
  } catch {
    // Don't pass on VBoxManage's own text: it can include machine paths.
    throw new RefractStartError("Couldn't check whether the Refract virtual machine is on.");
  }
}

/** Wait while VirtualBox is busy changing state (or the control room holds the VM lock). */
async function waitToSettle(deadline: number): Promise<string> {
  for (;;) {
    let state = "unknown";
    try {
      state = await readVmState();
    } catch {
      // A busy VM can briefly refuse showvminfo; try again.
    }
    if (state === "running" || STARTABLE.includes(state) || state === "paused" || state === "stuck") return state;
    if (Date.now() > deadline) throw new RefractStartError("The Refract virtual machine didn't finish changing state in time. Try again in a minute.");
    await sleep(1_500);
  }
}

/** Poll SSH until a trivial command runs. Host-key or sign-in problems won't fix themselves, so they stop the wait. */
async function waitForSsh(): Promise<void> {
  const deadline = Date.now() + SSH_READY_TIMEOUT_MS;
  for (;;) {
    try {
      const probe = await execInVm("true", { timeoutMs: 10_000, maxBytes: 1_000 });
      if (probe.code === 0) return;
    } catch (err) {
      const message = (err as Error)?.message ?? "";
      if (message === SSH_MESSAGES.hostKey || message === SSH_MESSAGES.auth) throw new RefractStartError(message);
    }
    if (Date.now() > deadline) {
      throw new RefractStartError(
        "Refract started, but it didn't finish booting (no SSH answer) within 2½ minutes. Give it a minute and try again, or check it in the Refract app.",
      );
    }
    await sleep(SSH_PROBE_EVERY_MS);
  }
}

async function bringUp(first: string, say: (text: string) => void): Promise<{ started: boolean }> {
  let state = first;
  if (SETTLING.includes(state) || state === "unknown") {
    say("Waiting for Refract to finish changing state…");
    state = await waitToSettle(Date.now() + SETTLE_TIMEOUT_MS);
  }
  if (state === "paused" || state === "stuck") {
    throw new RefractStartError(`The Refract virtual machine is ${state}. Resume or stop it in the Refract app first.`);
  }
  let started = false;
  if (STARTABLE.includes(state)) {
    say("Starting Refract…");
    started = true;
    try {
      await powerVm("start");
    } catch (err) {
      if (err instanceof VmBusyError || err instanceof PowerStateError) {
        // The control room (or another Flicker) is already doing something with the VM. Wait for it.
        state = await waitToSettle(Date.now() + SETTLE_TIMEOUT_MS);
        if (state !== "running") throw new RefractStartError("The Refract virtual machine is busy. Try again in a moment.");
      } else {
        throw new RefractStartError("Couldn't start the Refract virtual machine.");
      }
    }
  }
  say(started ? "Refract is on, waiting for it to boot…" : "Waiting for Refract to boot…");
  await waitForSsh();
  return { started };
}

const g = globalThis as unknown as { refractBringUp?: Promise<{ started: boolean }> | null };

/**
 * Make sure the Refract VM is on and reachable over SSH before a workshop tool uses it.
 * - Already running: returns at once ({ started: false }); nothing is touched.
 * - Off / aborted / saved: starts it headless with the control room's Start, waits for SSH.
 * Several tools (or Flickers) asking at once share one start. `onStatus` gets short lines for the chat.
 */
export async function ensureRefractReady(opts: { userId: string; onStatus?: (text: string) => void }): Promise<{ started: boolean }> {
  if (!opts.userId) throw new RefractStartError("Only a signed-in profile's Flicker can start Refract.");
  const say = (text: string) => {
    try {
      opts.onStatus?.(text);
    } catch {}
  };
  const state = await stateNow();
  if (state === "running" && !g.refractBringUp) return { started: false };
  if (g.refractBringUp) {
    say("Waiting for Refract to start…");
    return g.refractBringUp;
  }
  const pending = bringUp(state, say);
  g.refractBringUp = pending;
  try {
    return await pending;
  } finally {
    if (g.refractBringUp === pending) g.refractBringUp = null;
  }
}
