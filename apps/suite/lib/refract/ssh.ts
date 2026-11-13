// Shared SSH access to the Refract VM: one-shot commands and file transfers for Flicker workshop
// tools. The interactive terminal (terminal.ts) is separate; both use the same key and host check.
//
// Security: the host, port, user, and key are fixed here and never sent to a browser or a Flicker.
// The key is read at run time so the bundler never copies it. Host keys must already be in this
// PC's known_hosts for [127.0.0.1]:2222.

import "server-only";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, type SFTPWrapper } from "ssh2";

const SSH_HOST = "127.0.0.1";
const SSH_PORT = 2222;
const SSH_USER = "refract";
const SSH_KEY_PATH = path.join(os.homedir(), ".cursor", "refract", "refract_ed25519");
const KNOWN_HOSTS_PATH = path.join(os.homedir(), ".ssh", "known_hosts");
const KNOWN_HOST_NAME = `[${SSH_HOST}]:${SSH_PORT}`;

const CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BYTES = 32_000;

const MESSAGES = {
  unreachable: "The Refract virtual machine isn't reachable over SSH. It may be off or still starting. Start it from the Refract app.",
  hostKey: "The virtual machine's identity didn't match what this PC expects, so the connection was stopped.",
  auth: "The virtual machine refused the sign-in.",
  failed: "Couldn't reach the virtual machine.",
  timeout: "The command in the virtual machine ran too long and was stopped.",
} as const;

function hostPatternMatches(hosts: string): boolean {
  if (hosts.startsWith("|1|")) {
    const parts = hosts.split("|");
    const salt = parts[2];
    const hash = parts[3];
    if (!salt || !hash) return false;
    const digest = createHmac("sha1", Buffer.from(salt, "base64")).update(KNOWN_HOST_NAME).digest("base64");
    return digest === hash;
  }
  return hosts.split(",").some((h) => h === KNOWN_HOST_NAME);
}

function hostKeyKnown(key: Buffer): boolean {
  let text: string;
  try {
    text = readFileSync(KNOWN_HOSTS_PATH, "utf8");
  } catch {
    return false;
  }
  let matched = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.split(/\s+/);
    let marker: string | null = null;
    if (fields[0].startsWith("@")) marker = fields.shift() ?? null;
    if (fields.length < 3) continue;
    const [hosts, , blob] = fields;
    if (!hostPatternMatches(hosts)) continue;
    let stored: Buffer;
    try {
      stored = Buffer.from(blob, "base64");
    } catch {
      continue;
    }
    if (!stored.equals(key)) continue;
    if (marker === "@revoked") return false;
    if (marker === null) matched = true;
  }
  return matched;
}

function friendlyError(err: unknown): Error {
  const e = err as { code?: string; level?: string; message?: string } | null;
  if (e?.level === "client-authentication") return new Error(MESSAGES.auth);
  if (e?.message && /host.*(verif|key)/i.test(e.message)) return new Error(MESSAGES.hostKey);
  if (e?.level === "client-timeout" || e?.level === "client-socket") return new Error(MESSAGES.unreachable);
  if (e?.code && ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"].includes(e.code)) {
    return new Error(MESSAGES.unreachable);
  }
  return new Error(MESSAGES.failed);
}

/** Single-quote a string for bash, so a workspace path can't break out of the command. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    let privateKey: Buffer;
    try {
      privateKey = readFileSync(SSH_KEY_PATH);
    } catch {
      console.error("[refract-ssh] ssh key unavailable");
      reject(new Error(MESSAGES.failed));
      return;
    }
    const conn = new Client();
    let hostKeyRejected = false;
    let settled = false;
    const finish = (err?: Error, client?: Client) => {
      if (settled) return;
      settled = true;
      if (err) {
        try {
          conn.end();
        } catch {}
        reject(err);
      } else {
        resolve(client as Client);
      }
    };
    conn.on("ready", () => finish(undefined, conn));
    conn.on("error", (err) => finish(hostKeyRejected ? new Error(MESSAGES.hostKey) : friendlyError(err)));
    try {
      conn.connect({
        host: SSH_HOST,
        port: SSH_PORT,
        username: SSH_USER,
        privateKey,
        tryKeyboard: false,
        readyTimeout: CONNECT_TIMEOUT_MS,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 4,
        hostVerifier: (key: Buffer) => {
          const ok = hostKeyKnown(key);
          if (!ok) hostKeyRejected = true;
          return ok;
        },
      });
    } catch (err) {
      finish(friendlyError(err));
    }
  });
}

export type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
};

/** Run one command as the refract user. `cwd` is a path already checked to be inside the workshop. */
export async function execInVm(
  command: string,
  opts: {
    cwd?: string;
    timeoutMs?: number;
    maxBytes?: number;
    /** Text written to the command's standard input, then closed. Used to hand over a secret
     *  (a GitHub token) without it ever appearing in a command line or a file. */
    stdin?: string;
  } = {},
): Promise<ExecResult> {
  const timeoutMs = Math.max(1_000, Math.min(300_000, opts.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS));
  const timeoutSec = Math.ceil(timeoutMs / 1000);
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const script = opts.cwd ? `cd -- ${shQuote(opts.cwd)} && ${command}` : command;
  // timeout(1) makes sure a runaway command is killed even if our socket close lags.
  const wrapped = `timeout --signal=TERM --kill-after=5 ${timeoutSec}s bash --login -c ${shQuote(script)}`;

  const conn = await connect();
  try {
    return await new Promise<ExecResult>((resolve, reject) => {
      conn.exec(wrapped, { pty: false }, (err, stream) => {
        if (err) {
          reject(friendlyError(err));
          return;
        }
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let stdoutSize = 0;
        let stderrSize = 0;
        let truncated = false;
        const take = (chunks: Buffer[], size: number, data: Buffer): number => {
          if (size >= maxBytes) {
            truncated = true;
            return size;
          }
          const room = maxBytes - size;
          chunks.push(data.length > room ? data.subarray(0, room) : data);
          if (data.length > room) truncated = true;
          return size + Math.min(data.length, room);
        };
        stream.on("data", (data: Buffer) => {
          stdoutSize = take(stdoutChunks, stdoutSize, data);
        });
        stream.stderr.on("data", (data: Buffer) => {
          stderrSize = take(stderrChunks, stderrSize, data);
        });
        stream.on("close", (code: number | null, signal: string | null) => {
          // GNU timeout exits 124 on timeout, 137 when SIGKILL'd after --kill-after.
          const timedOut = code === 124 || code === 137 || signal === "TERM" || signal === "KILL";
          resolve({
            code: timedOut ? 124 : (code ?? 1),
            stdout: Buffer.concat(stdoutChunks).toString("utf8"),
            stderr: Buffer.concat(stderrChunks).toString("utf8"),
            timedOut,
            truncated,
          });
        });
        stream.on("error", (e: Error) => reject(friendlyError(e)));
        if (opts.stdin !== undefined) {
          stream.write(opts.stdin);
          stream.end();
        }
      });
    });
  } finally {
    try {
      conn.end();
    } catch {}
  }
}

/** Open one SSH session, give the caller SFTP, and always close the connection. */
export async function withSftp<T>(fn: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
  const conn = await connect();
  try {
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      conn.sftp((err, sftpClient) => {
        if (err || !sftpClient) reject(err ?? new Error(MESSAGES.failed));
        else resolve(sftpClient);
      });
    });
    return await fn(sftp);
  } finally {
    try {
      conn.end();
    } catch {}
  }
}

export function sftpReadFile(sftp: SFTPWrapper, remotePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.readFile(remotePath, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

export function sftpWriteFile(sftp: SFTPWrapper, remotePath: string, data: Buffer | string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remotePath, data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function sftpStat(sftp: SFTPWrapper, remotePath: string): Promise<{ isDirectory: boolean; isFile: boolean; size: number }> {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, stats) => {
      if (err) reject(err);
      else resolve({ isDirectory: stats.isDirectory(), isFile: stats.isFile(), size: stats.size });
    });
  });
}

export function sftpReaddir(sftp: SFTPWrapper, remotePath: string): Promise<{ filename: string; longname: string; isDirectory: boolean }[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (err, list) => {
      if (err) reject(err);
      else {
        resolve(
          list.map((e) => ({
            filename: e.filename,
            longname: e.longname,
            isDirectory: (e.attrs as { isDirectory?: () => boolean }).isDirectory?.() ?? e.longname.startsWith("d"),
          })),
        );
      }
    });
  });
}

export { MESSAGES as SSH_MESSAGES };