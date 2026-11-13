// Refract virtual remote, VirtualBox side: makes sure the Refract VM's built-in remote display (VRDE,
// VirtualBox's own RDP server, built into the base package since 7.2) is on, bound to 127.0.0.1 only,
// and requires a password, before the suite's server connects to it.
//
// Why this runs every time the remote is opened (and after Start / a restore restarts the VM): VRDE
// settings belong to the VM's configuration, so restoring an older snapshot such as clean-install
// brings back "remote display off". The settings are re-applied here instead of being baked into a
// snapshot.
//
// How: `VBoxManage modifyvm` can't touch a running VM, so a short PowerShell script uses VirtualBox's
// COM API with a shared session lock (the same thing the VirtualBox GUI does when you change Remote
// Display on a running VM). It only changes values that are wrong, so viewers that are already
// connected aren't kicked, and it switches the server on last, only after it has re-read the address
// and auth type. If anything isn't right it switches VRDE off instead.
//
// Secrets: the remote-display password lives in C:\Users\gdebo\.cursor\refract\vrde-password.txt
// (owner + SYSTEM only). The script reads it itself and stores only its SHA-256 (VBoxAuthSimple's
// format) in the VM's extradata; Node reads it only to sign in. Neither is logged or sent to a browser.

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** The only VM. Fixed here so nothing a browser sends can point this at another VM. */
const VM_NAME = "Refract";

/** Where the VRDE server listens. Loopback only; nothing on the LAN or Tailscale can reach it. */
export const VRDE_HOST = "127.0.0.1";
export const VRDE_PORT = 33890;
/** The VBoxAuthSimple user the suite signs in as. */
export const VRDE_USER = "illumination";

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
    execFile(file, args, { timeout, windowsHide: true, encoding: "utf8" }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
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

// Fixed script; nothing from a request is ever put into it. AuthType 1 = External (the auth library),
// LockType 1 = Shared. Prints exactly one word on success: READY, OFF or a FAIL code.
const ENSURE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$vmName = '${VM_NAME}'
$addr = '${VRDE_HOST}'
$port = '${VRDE_PORT}'
$user = '${VRDE_USER}'
$pwFile = Join-Path $env:USERPROFILE '.cursor\refract\vrde-password.txt'
try {
  $pw = [IO.File]::ReadAllText($pwFile).Trim()
  if ($pw.Length -lt 16) { 'FAIL-SECRET'; exit 0 }
  $sha = [Security.Cryptography.SHA256]::Create()
  $hash = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($pw)) | ForEach-Object { $_.ToString('x2') })
  $pw = $null
} catch { 'FAIL-SECRET'; exit 0 }
$vbox = New-Object -ComObject VirtualBox.VirtualBox
$m = $vbox.FindMachine($vmName)
# MachineState 6 = Running (VirtualBox 7.x numbering). Leave an off, paused or saved VM alone.
if ($m.State -ne 6) { 'OFF'; exit 0 }
$s = New-Object -ComObject VirtualBox.Session
$m.LockMachine($s, 1)
try {
  $sm = $s.Machine
  $r = $sm.VRDEServer
  $changed = $false
  if ($sm.GetExtraData("VBoxAuthSimple/users/$user") -ne $hash) { $sm.SetExtraData("VBoxAuthSimple/users/$user", $hash); $changed = $true }
  $hash = $null
  # Anything that would make the server listen somewhere else or without a password: switch it off first.
  $unsafe = ($r.GetVRDEProperty('TCP/Address') -ne $addr) -or ($r.AuthType -ne 1) -or ($r.AuthLibrary -ne 'VBoxAuthSimple')
  if ($unsafe -and $r.Enabled) { $r.Enabled = 0; $changed = $true }
  if ($r.GetVRDEProperty('TCP/Address') -ne $addr) { $r.SetVRDEProperty('TCP/Address', $addr); $changed = $true }
  if ($r.GetVRDEProperty('TCP/Ports') -ne $port) { $r.SetVRDEProperty('TCP/Ports', $port); $changed = $true }
  if ($r.GetVRDEProperty('Security/Method') -ne 'TLS') { $r.SetVRDEProperty('Security/Method', 'TLS'); $changed = $true }
  if ($r.AuthLibrary -ne 'VBoxAuthSimple') { $r.AuthLibrary = 'VBoxAuthSimple'; $changed = $true }
  if ($r.AuthType -ne 1) { $r.AuthType = 1; $changed = $true }
  if ($r.AuthTimeout -ne 5000) { $r.AuthTimeout = 5000; $changed = $true }
  if (-not $r.AllowMultiConnection) { $r.AllowMultiConnection = 1; $changed = $true }
  if ($r.ReuseSingleConnection) { $r.ReuseSingleConnection = 0; $changed = $true }
  foreach ($k in 'Client/DisableClipboard', 'Client/DisableUSB', 'Client/DisableAudio', 'Client/DisableUpstreamAudio', 'Client/DisableRDPDR') {
    if ($r.GetVRDEProperty($k) -ne '1') { $r.SetVRDEProperty($k, '1'); $changed = $true }
  }
  $safe = ($r.GetVRDEProperty('TCP/Address') -eq $addr) -and ($r.GetVRDEProperty('TCP/Ports') -eq $port) -and ($r.AuthType -eq 1) -and ($r.AuthLibrary -eq 'VBoxAuthSimple')
  if (-not $safe) {
    if ($r.Enabled) { $r.Enabled = 0 }
    $sm.SaveSettings()
    'FAIL-VERIFY'
    exit 0
  }
  if (-not $r.Enabled) { $r.Enabled = 1; $changed = $true }
  if ($changed) { $sm.SaveSettings() }
  'READY'
} finally {
  $s.UnlockMachine()
}
`;

function encodedCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

let inFlight: Promise<VrdeResult> | null = null;

async function ensureOnce(): Promise<VrdeResult> {
  let stdout: string;
  try {
    stdout = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand(ENSURE_SCRIPT)],
      45_000,
    );
  } catch {
    console.error("[refract-remote] couldn't configure the remote display");
    return "failed";
  }
  const word = stdout.trim().split(/\s+/).pop() ?? "";
  if (word === "READY") return "ready";
  if (word === "OFF") return "off";
  console.error("[refract-remote] remote display not ready:", /^FAIL-[A-Z]+$/.test(word) ? word : "unexpected output");
  return "failed";
}

/**
 * Make sure VRDE is on, on 127.0.0.1:33890, with VBoxAuthSimple auth. Safe to call often: it changes
 * nothing when everything is already right. Concurrent callers share one run.
 */
export function ensureVrde(): Promise<VrdeResult> {
  inFlight ??= ensureOnce().finally(() => {
    inFlight = null;
  });
  return inFlight;
}