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
import { USERS } from "../users";
import { ensureVrde, isVrdeListening, readVmState, readVrdePassword, VRDE_HOST, VRDE_PORT, VRDE_USER } from "./vrde";

export const REMOTE_PATH = "/api/refract/remote";

// Pages that may open the socket (on top of "same host as the request"). Same list as the terminal.
const ALLOWED_ORIGIN_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "192.168.1.50",
  "192.168.1.114",
  "100.98.151.55",
  "illumination.shrimp-bitterling.ts.net",
]);

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

type RdpBitmap = {
  destTop: number;
  destLeft: number;
  destBottom: number;
  destRight: number;
  width: number;
  height: number;
  bitsPerPixel: number;
  isCompress: boolean;
  decompressed?: boolean;
  data: ArrayBufferView;
};

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
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      "Cache-Control: no-store\r\n" +
      `Content-Length: ${Buffer.byteLength(reason)}\r\n\r\n` +
      reason,
  );
  socket.destroy();
}

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

class Framebuffer {
  width: number;
  height: number;
  pixels: Buffer; // RGBA, top-down
  // Changed area since the last send (inclusive-exclusive), or empty when x1 <= x0.
  x0 = 0;
  y0 = 0;
  x1 = 0;
  y1 = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 4);
    for (let i = 3; i < this.pixels.length; i += 4) this.pixels[i] = 255;
    this.markAll();
  }

  markAll() {
    this.x0 = 0;
    this.y0 = 0;
    this.x1 = this.width;
    this.y1 = this.height;
  }

  mark(x0: number, y0: number, x1: number, y1: number) {
    if (this.x1 <= this.x0) {
      this.x0 = x0;
      this.y0 = y0;
      this.x1 = x1;
      this.y1 = y1;
      return;
    }
    this.x0 = Math.min(this.x0, x0);
    this.y0 = Math.min(this.y0, y0);
    this.x1 = Math.max(this.x1, x1);
    this.y1 = Math.max(this.y1, y1);
  }

  get dirty(): boolean {
    return this.x1 > this.x0 && this.y1 > this.y0;
  }

  /** Copy one RDP bitmap rectangle in. Decompressed data is RGBA top-down; raw data is bottom-up BGR(X)/RGB565. */
  blit(b: RdpBitmap) {
    const left = b.destLeft;
    const top = b.destTop;
    if (left >= this.width || top >= this.height || b.width <= 0 || b.height <= 0) return;
    const w = Math.min(b.destRight - left + 1, b.width, this.width - left);
    const h = Math.min(b.destBottom - top + 1, b.height, this.height - top);
    if (w <= 0 || h <= 0) return;
    const src = Buffer.from(b.data.buffer, b.data.byteOffset, b.data.byteLength);
    const fb = this.pixels;
    if (b.decompressed) {
      const stride = b.width * 4;
      if (src.length < stride * h) return;
      for (let y = 0; y < h; y++) {
        src.copy(fb, ((top + y) * this.width + left) * 4, y * stride, y * stride + w * 4);
      }
    } else if (!b.isCompress) {
      const bytes = b.bitsPerPixel === 32 ? 4 : b.bitsPerPixel === 24 ? 3 : b.bitsPerPixel === 16 || b.bitsPerPixel === 15 ? 2 : 0;
      if (!bytes) return;
      const stride = (b.width * bytes + 3) & ~3;
      if (src.length < stride * b.height) return;
      for (let y = 0; y < h; y++) {
        const row = (b.height - 1 - y) * stride;
        let o = ((top + y) * this.width + left) * 4;
        for (let x = 0; x < w; x++, o += 4) {
          const i = row + x * bytes;
          if (bytes >= 3) {
            fb[o] = src[i + 2];
            fb[o + 1] = src[i + 1];
            fb[o + 2] = src[i];
          } else {
            const v = src[i] | (src[i + 1] << 8);
            if (b.bitsPerPixel === 16) {
              fb[o] = ((v >> 11) & 0x1f) << 3;
              fb[o + 1] = ((v >> 5) & 0x3f) << 2;
              fb[o + 2] = (v & 0x1f) << 3;
            } else {
              fb[o] = ((v >> 10) & 0x1f) << 3;
              fb[o + 1] = ((v >> 5) & 0x1f) << 3;
              fb[o + 2] = (v & 0x1f) << 3;
            }
          }
          fb[o + 3] = 255;
        }
      }
    } else {
      return;
    }
    this.mark(left, top, left + w, top + h);
  }

  /** The changed area as one message: x, y, w, h (uint16 LE) then RGBA rows. Clears the changed area. */
  takeDirty(): Buffer | null {
    if (!this.dirty) return null;
    const { x0, y0 } = this;
    const w = this.x1 - x0;
    const h = this.y1 - y0;
    this.x1 = this.x0 = this.y1 = this.y0 = 0;
    const out = Buffer.allocUnsafe(8 + w * h * 4);
    out.writeUInt16LE(x0, 0);
    out.writeUInt16LE(y0, 2);
    out.writeUInt16LE(w, 4);
    out.writeUInt16LE(h, 6);
    for (let y = 0; y < h; y++) {
      const start = ((y0 + y) * this.width + x0) * 4;
      this.pixels.copy(out, 8 + y * w * 4, start, start + w * 4);
    }
    return out;
  }
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