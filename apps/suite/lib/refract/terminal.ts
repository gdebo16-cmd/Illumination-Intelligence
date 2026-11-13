// Refract SSH terminal: a WebSocket on the suite's own HTTP server (port 3000) that opens one
// interactive SSH shell to the Refract VM per browser tab.
//
// `next start` has no WebSocket routes, but Next leaves upgrade requests for paths it doesn't own
// alone, so instrumentation.ts installs a small hook that takes upgrades for TERMINAL_PATH only and
// passes every other event straight through to Next.
//
// Security: the SSH target (host, port, user, key) is fixed here; the browser can only send keystrokes
// and its window size. The key is read on the server and never leaves it. Only signed-in suite
// profiles (the assistant-user cookie, same as getCurrentUserId) can open a session.

import http from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { Client, type ClientChannel } from "ssh2";
import { USERS } from "../users";

export const TERMINAL_PATH = "/api/refract/terminal";

// The only machine this terminal can reach: the Refract VM's forwarded SSH port on this PC.
const SSH_HOST = "127.0.0.1";
const SSH_PORT = 2222;
const SSH_USER = "refract";
// Built at run time (C:\Users\gdebo\.cursor\refract\refract_ed25519) so the bundler never traces or copies the key.
const SSH_KEY_PATH = path.join(os.homedir(), ".cursor", "refract", "refract_ed25519");
const KNOWN_HOSTS_PATH = path.join(os.homedir(), ".ssh", "known_hosts");
const KNOWN_HOST_NAME = `[${SSH_HOST}]:${SSH_PORT}`;

// Pages that may open the socket (on top of "same host as the request").
const ALLOWED_ORIGIN_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "192.168.1.50",
  "192.168.1.114",
  "100.98.151.55",
  "illumination.shrimp-bitterling.ts.net",
]);

const MAX_SESSIONS = 6;
const MAX_INPUT_BYTES = 64 * 1024;
// Output flow control: stop reading from SSH while this much is waiting to reach the browser,
// so a runaway `yes` slows the VM's output instead of piling up in memory.
const SEND_HIGH_WATER = 512 * 1024;
const SEND_LOW_WATER = 128 * 1024;
const PING_MS = 25_000;

const MESSAGES = {
  unreachable: "Couldn't reach the virtual machine over SSH. It may be off or still starting.",
  hostKey: "The virtual machine's identity didn't match what this PC expects, so the connection was stopped.",
  auth: "The virtual machine refused the sign-in.",
  busy: "Too many terminals are open. Close one and try again.",
  failed: "The terminal session couldn't be started.",
  ended: "The session ended.",
} as const;

let activeSessions = 0;

function pathOf(url: string | undefined): string {
  if (!url) return "";
  const q = url.indexOf("?");
  return q < 0 ? url : url.slice(0, q);
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** Same rule as getCurrentUserId(): the assistant-user cookie must name a known profile. */
function isSignedIn(req: IncomingMessage): boolean {
  const id = cookieValue(req.headers.cookie, "assistant-user");
  return !!id && Object.hasOwn(USERS, id);
}

/** Browsers always send Origin on WebSocket upgrades; refuse other sites riding the cookie. */
function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  const hosts = [req.headers.host, req.headers["x-forwarded-host"]].flat().filter(Boolean) as string[];
  if (hosts.some((h) => h.split(",")[0].trim().toLowerCase() === originUrl.host.toLowerCase())) return true;
  return ALLOWED_ORIGIN_HOSTS.has(originUrl.hostname.toLowerCase());
}

function reject(socket: Duplex, status: number, reason: string) {
  const body = reason;
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      "Cache-Control: no-store\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
      body,
  );
  socket.destroy();
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Host key check that matches `ssh -o StrictHostKeyChecking=accept-new` after the first connect:
 *  the key must already be in this PC's known_hosts for [127.0.0.1]:2222 (plain or hashed entries). */
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

function hostPatternMatches(hosts: string): boolean {
  if (hosts.startsWith("|1|")) {
    const [, , salt, hash] = hosts.split("|");
    if (!salt || !hash) return false;
    const digest = createHmac("sha1", Buffer.from(salt, "base64")).update(KNOWN_HOST_NAME).digest("base64");
    return digest === hash;
  }
  return hosts.split(",").some((h) => h === KNOWN_HOST_NAME);
}

type ClientMessage =
  | { t: "i"; d: string } // keystrokes
  | { t: "r"; c: number; r: number } // window size
  | { t: "p" } // browser is behind: pause output
  | { t: "g" }; // browser caught up: resume output

function sendStatus(ws: WebSocket, state: "connected" | "closed", message?: string) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ t: "s", s: state, m: message }));
}

function friendlyError(err: unknown): string {
  const e = err as { code?: string; level?: string; message?: string } | null;
  if (e?.level === "client-authentication") return MESSAGES.auth;
  if (e?.message && /host.*(verif|key)/i.test(e.message)) return MESSAGES.hostKey;
  if (e?.level === "client-timeout" || e?.level === "client-socket") return MESSAGES.unreachable;
  if (e?.code && ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"].includes(e.code)) {
    return MESSAGES.unreachable;
  }
  return MESSAGES.failed;
}

function startSession(ws: WebSocket, req: IncomingMessage) {
  activeSessions += 1;
  const params = new URL(req.url ?? "/", "http://localhost").searchParams;
  let cols = clampInt(params.get("cols"), 10, 500, 80);
  let rows = clampInt(params.get("rows"), 4, 200, 24);

  const conn = new Client();
  let stream: ClientChannel | null = null;
  let closed = false;
  let pending = 0; // bytes handed to ws.send that haven't gone out yet
  let pausedForBrowser = false;
  let alive = true;
  let hostKeyRejected = false;

  const updateFlow = () => {
    if (!stream) return;
    const shouldPause = pausedForBrowser || pending > SEND_HIGH_WATER;
    if (shouldPause && !stream.isPaused()) stream.pause();
    else if (!shouldPause && stream.isPaused() && pending <= SEND_LOW_WATER) stream.resume();
  };

  const finish = (message?: string) => {
    if (closed) return;
    closed = true;
    activeSessions = Math.max(0, activeSessions - 1);
    clearInterval(pinger);
    try {
      stream?.close();
    } catch {}
    try {
      conn.end();
    } catch {}
    if (ws.readyState === WebSocket.OPEN) {
      sendStatus(ws, "closed", message ?? MESSAGES.ended);
      ws.close(1000);
    } else if (ws.readyState === WebSocket.CONNECTING) {
      ws.terminate();
    }
  };

  // Notice browsers that vanished (phone locked, Wi-Fi dropped) so their SSH session is closed.
  const pinger = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    try {
      ws.ping();
    } catch {}
  }, PING_MS);
  ws.on("pong", () => {
    alive = true;
  });

  ws.on("message", (data: RawData, isBinary: boolean) => {
    if (isBinary) return;
    const text = data.toString();
    if (text.length > MAX_INPUT_BYTES) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.t === "i" && typeof msg.d === "string") {
      stream?.write(msg.d);
    } else if (msg.t === "r") {
      cols = clampInt(msg.c, 10, 500, cols);
      rows = clampInt(msg.r, 4, 200, rows);
      stream?.setWindow(rows, cols, 0, 0);
    } else if (msg.t === "p") {
      pausedForBrowser = true;
      updateFlow();
    } else if (msg.t === "g") {
      pausedForBrowser = false;
      updateFlow();
    }
  });
  ws.on("close", () => finish());
  ws.on("error", () => finish());

  conn.on("ready", () => {
    if (closed) {
      conn.end();
      return;
    }
    conn.shell({ term: "xterm-256color", cols, rows }, (err, channel) => {
      if (err || closed) {
        if (channel) channel.close();
        finish(MESSAGES.failed);
        return;
      }
      stream = channel;
      sendStatus(ws, "connected");
      const forward = (chunk: Buffer) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        pending += chunk.length;
        ws.send(chunk, { binary: true }, () => {
          pending -= chunk.length;
          updateFlow();
        });
        updateFlow();
      };
      channel.on("data", forward);
      channel.stderr.on("data", forward);
      channel.on("close", () => finish(MESSAGES.ended));
    });
  });
  conn.on("error", (err) => {
    console.error("[refract-terminal] ssh error", (err as { level?: string }).level ?? "", (err as { code?: string }).code ?? "");
    finish(hostKeyRejected ? MESSAGES.hostKey : friendlyError(err));
  });
  conn.on("close", () => finish());

  let privateKey: Buffer;
  try {
    privateKey = readFileSync(SSH_KEY_PATH);
  } catch {
    console.error("[refract-terminal] ssh key unavailable");
    finish(MESSAGES.failed);
    return;
  }
  try {
    conn.connect({
      host: SSH_HOST,
      port: SSH_PORT,
      username: SSH_USER,
      privateKey,
      tryKeyboard: false,
      readyTimeout: 15_000,
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
}

let wss: WebSocketServer | null = null;

function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  socket.on("error", () => {});
  if (!isSignedIn(req)) return reject(socket, 401, "Unauthorized");
  if (!originAllowed(req)) return reject(socket, 403, "Forbidden");
  if (activeSessions >= MAX_SESSIONS) return reject(socket, 503, "Service Unavailable");
  wss ??= new WebSocketServer({ noServer: true, maxPayload: MAX_INPUT_BYTES * 2, perMessageDeflate: false });
  wss.handleUpgrade(req, socket, head, (ws) => startSession(ws, req));
}

const INSTALLED = Symbol.for("illumination.refract.terminal.installed");

/** Called once from instrumentation.ts. Only upgrades for TERMINAL_PATH are taken; everything else
 *  (pages, API routes, Next's own handling) goes through untouched. */
export function installRefractTerminal() {
  const g = globalThis as unknown as Record<symbol, boolean>;
  if (g[INSTALLED]) return;
  g[INSTALLED] = true;
  const originalEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function emit(this: http.Server, event: string | symbol, ...args: unknown[]) {
    if (event === "upgrade") {
      const req = args[0] as IncomingMessage;
      if (pathOf(req?.url) === TERMINAL_PATH) {
        const socket = args[1] as Duplex;
        try {
          handleUpgrade(req, socket, args[2] as Buffer);
        } catch {
          console.error("[refract-terminal] upgrade failed");
          socket.destroy();
        }
        return true;
      }
    }
    return Reflect.apply(originalEmit, this, [event, ...args]) as boolean;
  } as typeof originalEmit;
}
