// Refract virtual remote: a WebSocket on the suite's own HTTP server (port 3000) that shows the Refract
// VM's actual screen in the browser and passes keyboard and mouse back.
//
// The suite server is the only RDP client. It connects to VirtualBox's built-in remote display (VRDE)
// on 127.0.0.1:33890 with a password the browser never sees, decodes the screen updates, and forwards
// plain pixel rectangles to the browser over this socket. The browser can only send key scancodes,
// pointer events and "Ctrl-Alt-Del"; it can't choose a host, port or credentials.
//
// Like the SSH terminal (terminal.ts), instrumentation.ts installs a hook that takes upgrades for
// REMOTE_PATH only and passes every other event through, so there is still one listener on port 3000.
// Only signed-in suite profiles (assistant-user cookie) from allowed origins can open a session.

import http from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { createRequire } from "node:module";
import path from "node:path";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { isSignedIn, originAllowed, pathOf, reject } from "./socket-guard";
import { Framebuffer, type RdpBitmap } from "./framebuffer";
import { ensureVrde, isVrdeListening, readVmState, readVrdePassword, VRDE_HOST, VRDE_PORT, VRDE_USER } from "./vrde";

export const REMOTE_PATH = "/api/refract/remote";

const MAX_SESSIONS = 4;
const MAX_INPUT_BYTES = 1024;
const MAX_INPUTS_PER_SECOND = 400;
const PING_MS = 25_000;
const CONNECT_TIMEOUT_MS = 8_000;
// Screen updates are batched and sent at most this often.
const FLUSH_MS = 40;
// Stop sending while this much is still waiting to reach the browser; changed areas are remembered and
// sent once it catches up, so a slow phone gets a current picture instead of a growing backlog.
const SEND_HIGH_WATER = 2 * 1024 * 1024;
// Asked for when connecting; VirtualBox decides the real size and the browser follows it.
const REQUEST_WIDTH = 1024;
const REQUEST_HEIGHT = 768;
const MAX_DIMENSION = 4096;

const MESSAGES = {
  off: "The virtual machine isn\u2019t running.",
  vrde: "The remote display couldn\u2019t be turned on.",
  unreachable: "Couldn\u2019t connect to the virtual machine\u2019s screen.",
  busy: "Too many remote views are open. Close one and try again.",
  failed: "The remote view couldn\u2019t be started.",
  ended: "The remote view closed.",
} as const;

// Scancodes (PS/2 set 1) used for Ctrl-Alt-Del and for letting go of stuck modifiers.
const SC_CTRL = 0x1d;
const SC_ALT = 0x38;
const SC_DELETE = 0x53; // extended
const SC_LSHIFT = 0x2a;
const SC_RSHIFT = 0x36;
const SC_LWIN = 0x5b; // extended

type RdpClient = {
  on(event: string, listener: (...args: never[]) => void): RdpClient;
  connect(host: string, port: number): RdpClient;
  sendKeyEventScancode(code: number, isPressed: boolean, extended?: boolean): void;
  sendPointerEvent(x: number, y: number, button: number, isPressed: boolean): void;
  sendWheelEvent(x: number, y: number, step: number, isNegative: boolean, isHorizontal: boolean): void;
  emit(event: string, ...args: unknown[]): boolean;
  connected: boolean;
  x224: { requestedProtocol: number };
  global: {
    removeAllListeners(event: string): void;
    on(event: string, listener: (err: unknown) => void): void;
    serverCapabilities: Record<number, { obj?: { desktopWidth?: { value: number }; desktopHeight?: { value: number } } }>;
  };
  bufferLayer: { socket?: { destroy(): void }; secureSocket?: { destroy(): void } | null };
};

type RdpLib = { createClient(config: Record<string, unknown>): RdpClient };

let rdpLib: RdpLib | null = null;

/** The vendored RDP client (vendor/refract-rdpjs, GPL-3.0), loaded from disk at run time, not bundled. */
function loadRdp(): RdpLib {
  if (!rdpLib) {
    const base = path.join(process.cwd(), "vendor", "refract-rdpjs");
    const load = createRequire(path.join(base, "package.json"));
    rdpLib = load(base) as RdpLib;
  }
  return rdpLib;
}

let activeSessions = 0;

function intIn(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value < min || value > max ? null : value;
}

type ClientMessage =
  | { t: "k"; c: number; e?: boolean; d: boolean } // key scancode, extended, down
  | { t: "m"; x: number; y: number; b: number; d?: boolean } // pointer: b 0 = move, 1 left, 2 right, 3 middle
  | { t: "w"; x: number; y: number; n: boolean } // wheel, n = scroll down
  | { t: "cad" } // Ctrl-Alt-Del
  | { t: "rel" }; // let go of modifiers

type Status = "connecting" | "connected" | "off" | "closed";

function sendStatus(ws: WebSocket, state: Status, extra?: { m?: string; w?: number; h?: number }) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ t: "s", s: state, ...extra }));
}

function destroyClient(client: RdpClient | null) {
  if (!client) return;
  try {
    client.bufferLayer.secureSocket?.destroy();
  } catch {}
  try {
    client.bufferLayer.socket?.destroy();
  } catch {}
}

function startSession(ws: WebSocket) {
  activeSessions += 1;
  let closed = false;
  let alive = true;
  let client: RdpClient | null = null;
  let fb: Framebuffer | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let everConnected = false;
  let inputWindowStart = Date.now();
  let inputCount = 0;

  const finish = (status: Status, message?: string) => {
    if (closed) return;
    closed = true;
    activeSessions = Math.max(0, activeSessions - 1);
    clearInterval(pinger);
    if (flushTimer) clearTimeout(flushTimer);
    if (connectTimer) clearTimeout(connectTimer);
    destroyClient(client);
    if (ws.readyState === WebSocket.OPEN) {
      sendStatus(ws, status, { m: message });
      ws.close(1000);
    } else if (ws.readyState === WebSocket.CONNECTING) {
      ws.terminate();
    }
  };

  // When the remote display drops, close immediately. Waiting on VirtualBox for the
  // VM's state can sit long enough that the browser gives up first.
  const finishAfterDrop = () => {
    if (closed) return;
    finish("closed", everConnected ? MESSAGES.ended : MESSAGES.unreachable);
  };

  const flush = () => {
    flushTimer = null;
    if (closed || !fb || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > SEND_HIGH_WATER) {
      flushTimer = setTimeout(flush, FLUSH_MS * 2);
      return;
    }
    const frame = fb.takeDirty();
    if (frame) ws.send(frame, { binary: true });
  };
  const scheduleFlush = () => {
    if (!flushTimer && !closed) flushTimer = setTimeout(flush, FLUSH_MS);
  };

  // Notice browsers that vanished (phone locked, Wi-Fi dropped) so their RDP connection is closed.
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

  const key = (code: number, down: boolean, extended = false) => {
    if (client?.connected) client.sendKeyEventScancode(code, down, extended);
  };

  ws.on("message", (data: RawData, isBinary: boolean) => {
    if (isBinary || closed || !client?.connected || !fb) return;
    const now = Date.now();
    if (now - inputWindowStart > 1000) {
      inputWindowStart = now;
      inputCount = 0;
    }
    if (++inputCount > MAX_INPUTS_PER_SECOND) return;
    const text = data.toString();
    if (text.length > MAX_INPUT_BYTES) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    try {
      if (msg.t === "k") {
        const code = intIn(msg.c, 1, 0x7f);
        if (code === null || typeof msg.d !== "boolean") return;
        key(code, msg.d, msg.e === true);
      } else if (msg.t === "m") {
        const x = intIn(msg.x, 0, fb.width - 1);
        const y = intIn(msg.y, 0, fb.height - 1);
        const b = intIn(msg.b, 0, 3);
        if (x === null || y === null || b === null) return;
        client.sendPointerEvent(x, y, b, b !== 0 && msg.d === true);
      } else if (msg.t === "w") {
        const x = intIn(msg.x, 0, fb.width - 1);
        const y = intIn(msg.y, 0, fb.height - 1);
        if (x === null || y === null) return;
        client.sendWheelEvent(x, y, 0x78, msg.n === true, false);
      } else if (msg.t === "cad") {
        key(SC_CTRL, true);
        key(SC_ALT, true);
        key(SC_DELETE, true, true);
        key(SC_DELETE, false, true);
        key(SC_ALT, false);
        key(SC_CTRL, false);
      } else if (msg.t === "rel") {
        for (const code of [SC_CTRL, SC_ALT, SC_LSHIFT, SC_RSHIFT]) key(code, false);
        key(SC_CTRL, false, true);
        key(SC_ALT, false, true);
        key(SC_LWIN, false, true);
      }
    } catch {
      // A bad input never takes the session down.
    }
  });
  ws.on("close", () => finish("closed"));
  ws.on("error", () => finish("closed"));

  sendStatus(ws, "connecting");

  void (async () => {
    const t0 = Date.now();
    const log = (s: string) => console.error(`[refract-remote] ${s} +${Date.now() - t0}ms`);

    let password: string;
    let lib: RdpLib;
    try {
      password = readVrdePassword();
      lib = loadRdp();
      log("client ready");
    } catch {
      console.error("[refract-remote] remote display client unavailable");
      return finish("closed", MESSAGES.failed);
    }

    const attempt = (timeoutMs: number): Promise<boolean> =>
      new Promise((resolve) => {
        if (closed) return resolve(false);
        let next: RdpClient;
        try {
          next = lib.createClient({
            userName: VRDE_USER,
            password,
            domain: "",
            autoLogin: true,
            decompress: true,
            screen: { width: REQUEST_WIDTH, height: REQUEST_HEIGHT },
            locale: "en",
            logLevel: "NONE",
          });
        } catch {
          return resolve(false);
        }
        client = next;
        const rdp = next;
        let live = false;
        let settled = false;
        const done = (ok: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (!ok) {
            destroyClient(rdp);
            if (client === rdp) client = null;
          }
          resolve(ok);
        };
        const timer = setTimeout(() => {
          log("rdp attempt timed out");
          done(false);
        }, timeoutMs);
        // TLS only (VirtualBox's VRDE is set to TLS); never NLA, never unencrypted standard RDP security.
        rdp.x224.requestedProtocol = 0x00000001;
        // The library rethrows some protocol errors from inside socket callbacks; turn them into events so
        // a bad packet can only end this session, never the suite server.
        rdp.global.removeAllListeners("error");
        rdp.global.on("error", (err) => {
          rdp.emit("error", err);
        });
        rdp.on("error", () => {
          if (closed) return;
          if (live) finishAfterDrop();
          else {
            log("rdp error");
            done(false);
          }
        });
        rdp.on("close", () => {
          if (closed) return;
          if (live) finishAfterDrop();
          else done(false);
        });
        rdp.on("connect", () => {
          if (closed) {
            done(false);
            return;
          }
          try {
            const cap = rdp.global.serverCapabilities[2]?.obj; // CAPSTYPE_BITMAP
            const w = intIn(cap?.desktopWidth?.value, 1, MAX_DIMENSION) ?? REQUEST_WIDTH;
            const h = intIn(cap?.desktopHeight?.value, 1, MAX_DIMENSION) ?? REQUEST_HEIGHT;
            if (!fb || fb.width !== w || fb.height !== h) fb = new Framebuffer(w, h);
            else fb.markAll();
            everConnected = true;
            live = true;
            if (connectTimer) {
              clearTimeout(connectTimer);
              connectTimer = null;
            }
            sendStatus(ws, "connected", { w, h });
            scheduleFlush();
            done(true);
          } catch {
            finish("closed", MESSAGES.failed);
            done(false);
          }
        });
        rdp.on("bitmap", (bitmap: RdpBitmap) => {
          if (closed || !fb) return;
          try {
            fb.blit(bitmap);
            scheduleFlush();
          } catch {
            // Skip a rectangle we can't read rather than dropping the session.
          }
        });
        try {
          log("rdp connect");
          rdp.connect(VRDE_HOST, VRDE_PORT);
        } catch {
          done(false);
        }
      });

    // Open the screen immediately. The display is usually already on, and a direct
    // RDP connection takes well under a second. VirtualBox setup only runs if that
    // first attempt fails, and is itself capped so it cannot outlast the browser.
    log("attempt 1");
    if (await attempt(6_000)) {
      log("connected");
      password = "";
      return;
    }
    if (closed) return;
    log("attempt 1 missed, checking display");
    const state = await Promise.race([
      readVmState(),
      new Promise<string>((r) => setTimeout(() => r("unknown"), 3_000)),
    ]);
    log("state=" + state);
    if (closed) return;
    if (state !== "running" && state !== "unknown") return finish("off", MESSAGES.off);

    const vrde = await ensureVrde();
    log("ensure=" + vrde);
    if (closed) return;
    if (vrde === "off") return finish("off", MESSAGES.off);

    log("attempt 2");
    if (await attempt(6_000)) {
      log("connected");
      password = "";
      return;
    }
    password = "";
    if (!closed) finish("closed", vrde === "ready" ? MESSAGES.unreachable : MESSAGES.vrde);
  })().catch(() => finish("closed", MESSAGES.failed));
}

let wss: WebSocketServer | null = null;

function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  socket.on("error", () => {});
  if (!isSignedIn(req)) return reject(socket, 401, "Unauthorized");
  if (!originAllowed(req)) return reject(socket, 403, "Forbidden");
  if (activeSessions >= MAX_SESSIONS) return reject(socket, 503, "Service Unavailable");
  wss ??= new WebSocketServer({
    noServer: true,
    maxPayload: MAX_INPUT_BYTES * 4,
    // Screen updates are mostly flat colour (a text console), so they compress very well for the phone.
    perMessageDeflate: {
      threshold: 512,
      zlibDeflateOptions: { level: 1 },
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
      concurrencyLimit: 4,
    },
  });
  wss.handleUpgrade(req, socket, head, (ws) => startSession(ws));
}

const INSTALLED = Symbol.for("illumination.refract.remote.installed");

/** Called once from instrumentation.ts. Only upgrades for REMOTE_PATH are taken; everything else
 *  (the terminal's hook, pages, API routes, Next's own handling) goes through untouched. */
export function installRefractRemote() {
  const g = globalThis as unknown as Record<symbol, boolean>;
  if (g[INSTALLED]) return;
  g[INSTALLED] = true;
  const originalEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function emit(this: http.Server, event: string | symbol, ...args: unknown[]) {
    if (event === "upgrade") {
      const req = args[0] as IncomingMessage;
      if (pathOf(req?.url) === REMOTE_PATH) {
        const socket = args[1] as Duplex;
        try {
          handleUpgrade(req, socket, args[2] as Buffer);
        } catch {
          console.error("[refract-remote] upgrade failed");
          socket.destroy();
        }
        return true;
      }
    }
    return Reflect.apply(originalEmit, this, [event, ...args]) as boolean;
  } as typeof originalEmit;
  // Confirm from this process that the screen is reachable, so a failed Connect
  // can be compared against a known-good (or known-blocked) RDP path. Never logs secrets.
  setTimeout(() => {
    void selfCheckVrde();
  }, 500);
}

async function selfCheckVrde() {
  const t0 = Date.now();
  try {
    if (!(await isVrdeListening())) {
      console.error("[refract-remote] self-check: display not listening");
      return;
    }
    const password = readVrdePassword();
    const lib = loadRdp();
    const client = lib.createClient({
      userName: VRDE_USER,
      password,
      domain: "",
      autoLogin: true,
      decompress: true,
      screen: { width: REQUEST_WIDTH, height: REQUEST_HEIGHT },
      locale: "en",
      logLevel: "NONE",
    });
    client.x224.requestedProtocol = 0x00000001;
    client.global.removeAllListeners("error");
    client.global.on("error", (err) => {
      client.emit("error", err);
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 8_000);
      client.on("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      client.on("error", () => {
        clearTimeout(timer);
        reject(new Error("error"));
      });
      client.connect(VRDE_HOST, VRDE_PORT);
    });
    destroyClient(client);
    console.error(`[refract-remote] self-check: ok in ${Date.now() - t0}ms`);
  } catch (err) {
    const raw = err instanceof Error ? err.message : "failed";
    const safe = raw.replace(/[A-Za-z0-9+/=_-]{12,}/g, "[redacted]").slice(0, 80);
    console.error(`[refract-remote] self-check: ${safe} +${Date.now() - t0}ms`);
  }
}