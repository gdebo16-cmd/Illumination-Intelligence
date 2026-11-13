// Refract virtual remote, VirtualBox side: makes sure the Refract VM's built-in remote display (VRDE,
// VirtualBox's own RDP server, built into the base package since 7.2) is on, bound to 127.0.0.1 only,
// and requires a password, before the suite's server connects to it.
//
// Why this runs every time the remote is opened (and after Start / a restore restarts the VM): VRDE
// settings belong to the VM's configuration, so restoring an older snapshot such as clean-install
// brings back "remote display off". The settings are re-applied here instead of being baked into a
// snapshot.
//
// How: when the VM is off, `VBoxManage modifyvm` writes the remote-display settings (localhost
// only, TLS, password auth). When the VM is running, `VBoxManage controlvm` turns VRDE on and
// sets the properties it can change on a live VM. We do not use PowerShell or VirtualBox's COM
// API: Norton Behavioral Protection treats encoded PowerShell as malware and kills it, which
// made the virtual remote hang. If the display is already listening on the loopback port, Connect
// skips setup and opens the screen immediately.
//
// Secrets: the remote-display password is in a user-only file next to the other Refract VM
// secrets. Node reads it to sign in and, when needed, stores only its SHA-256 (VBoxAuthSimple's
// format) in the VM's extradata. The password and hash are never logged or sent to a browser.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/** The only VM. Fixed here so nothing a browser sends can point this at another VM. */
const VM_NAME = "Refract";

/** Where the VRDE server listens. Loopback only; nothing on the LAN or Tailscale can reach it. */
export const VRDE_HOST = "127.0.0.1";
export const VRDE_PORT = 33890;
/** The VBoxAuthSimple user the suite signs in as. */
export const VRDE_USER = "illumination";

/** True when VirtualBox is already accepting remote-display connections on the loopback port. */
export function isVrdeListening(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let socket: net.Socket;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(hard);
      try {
        socket.removeAllListeners();
        socket.on("error", () => {});
        socket.destroy();
      } catch {}
      resolve(ok);
    };
    // A timer that does not depend on the socket, in case the TCP stack never fires timeout.
    const hard = setTimeout(() => finish(false), 500);
    socket = net.connect({ host: VRDE_HOST, port: VRDE_PORT });
    socket.setTimeout(400, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

// Built at run time so the bundler never traces or copies the secret file.
const VRDE_PASSWORD_PATH = path.join(os.homedir(), ".cursor", "refract", "vrde-password.txt");

export type VrdeResult = "ready" | "off" | "failed";

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

function run(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err: Error | null, stdout?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(hard);
      if (err) reject(err);
      else resolve(stdout ?? "");
    };
    const child = execFile(file, args, { timeout, windowsHide: true, encoding: "utf8", killSignal: "SIGKILL" }, (err, stdout) => {
      done(err, stdout);
    });
    // execFile's timeout does not always kill the process on Windows; this backs it up.
    const hard = setTimeout(() => {
      try { child.kill(); } catch {}
      done(new Error("vbox timeout"));
    }, timeout + 1000);
  });
}

/** The VM's state from showvminfo ("running", "poweroff", ...), or "unknown". */
export async function readVmState(): Promise<string> {
  try {
    const stdout = await run(vboxManagePath(), ["showvminfo", VM_NAME, "--machinereadable"], 15_000);
    const match = stdout.match(/^VMState="([^"]*)"/m);
    return match ? match[1] : "unknown";
  } catch {
    return "unknown";
  }
}

/** The password the suite signs in to VRDE with. Throws if the file is missing. Never log the result. */
export function readVrdePassword(): string {
  return readFileSync(VRDE_PASSWORD_PATH, "utf8").trim();
}

const DISABLED_CLIENT_PROPS = [
  "Client/DisableClipboard",
  "Client/DisableUSB",
  "Client/DisableAudio",
  "Client/DisableUpstreamAudio",
  "Client/DisableRDPDR",
] as const;

async function vboxRun(args: string[], timeout = 5_000): Promise<string> {
  return run(vboxManagePath(), args, timeout);
}

/** Make sure VBoxAuthSimple has the current password hash. Does not log the hash or the password. */
async function ensureAuthHash(): Promise<void> {
  const password = readVrdePassword();
  if (password.length < 16) throw new Error("secret");
  const expected = createHash("sha256").update(password, "utf8").digest("hex");
  let raw = "";
  try {
    raw = await vboxRun(["getextradata", VM_NAME, `VBoxAuthSimple/users/${VRDE_USER}`]);
  } catch {
    raw = "";
  }
  const value = (raw.match(/^Value:\s*(\S+)/m) ?? [])[1] ?? "";
  if (value.toLowerCase() === expected.toLowerCase()) return;
  await vboxRun(["setextradata", VM_NAME, `VBoxAuthSimple/users/${VRDE_USER}`, expected]);
}

/**
 * Write the full remote-display config. Only call this while the VM is powered off
 * (including just after a snapshot restore). `modifyvm` is refused on a running VM.
 */
export async function applyVrdeWhilePoweredOff(): Promise<void> {
  await ensureAuthHash();
  const args = [
    "modifyvm", VM_NAME,
    "--vrde=on",
    `--vrde-address=${VRDE_HOST}`,
    `--vrde-port=${VRDE_PORT}`,
    "--vrde-auth-type=external",
    "--vrde-auth-library=VBoxAuthSimple",
    "--vrde-multi-con=on",
    "--vrde-reuse-con=off",
    "--vrde-property=Security/Method=TLS",
  ];
  for (const key of DISABLED_CLIENT_PROPS) {
    args.push(`--vrde-property=${key}=1`);
  }
  await vboxRun(args);
}

async function applyVrdeWhileRunning(): Promise<void> {
  await ensureAuthHash();
  const props: Array<[string, string]> = [
    ["TCP/Address", VRDE_HOST],
    ["TCP/Ports", String(VRDE_PORT)],
    ["Security/Method", "TLS"],
    ...DISABLED_CLIENT_PROPS.map((key) => [key, "1"] as [string, string]),
  ];
  for (const [key, value] of props) {
    await vboxRun(["controlvm", VM_NAME, "vrdeproperty", `${key}=${value}`]);
  }
  await vboxRun(["controlvm", VM_NAME, "vrdeport", String(VRDE_PORT)]);
  await vboxRun(["controlvm", VM_NAME, "vrde", "on"]);
}

let inFlight: Promise<VrdeResult> | null = null;

async function ensureOnce(): Promise<VrdeResult> {
  try {
    if (await isVrdeListening()) return "ready";
    const state = await readVmState();
    if (state !== "running") return "off";
    await applyVrdeWhileRunning();
    if (await isVrdeListening()) return "ready";
    console.error("[refract-remote] remote display not listening after setup");
    return "failed";
  } catch {
    console.error("[refract-remote] couldn't configure the remote display");
    return "failed";
  }
}

/**
 * Make sure VRDE is on, on 127.0.0.1:33890, with VBoxAuthSimple auth. Safe to call often:
 * if the port is already listening, this returns immediately. Concurrent callers share one run.
 */
export function ensureVrde(): Promise<VrdeResult> {
  inFlight ??= Promise.race([
    ensureOnce(),
    new Promise<VrdeResult>((resolve) => setTimeout(() => resolve("failed"), 8_000)),
  ]).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
