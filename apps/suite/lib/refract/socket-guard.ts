// Shared by the Refract sockets (terminal.ts and remote.ts): who may open one. A WebSocket upgrade
// is accepted only from a signed-in suite profile, on a page from this server or one of the hosts
// below, so another site can't ride the cookie.

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { USERS } from "../profiles";

// Pages that may open the socket (on top of "same host as the request").
const ALLOWED_ORIGIN_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "192.168.1.50",
  "192.168.1.114",
  "100.98.151.55",
  "illumination.shrimp-bitterling.ts.net",
]);

export function pathOf(url: string | undefined): string {
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
export function isSignedIn(req: IncomingMessage): boolean {
  const id = cookieValue(req.headers.cookie, "assistant-user");
  return !!id && Object.hasOwn(USERS, id);
}

/** Browsers always send Origin on WebSocket upgrades; refuse other sites riding the cookie. */
export function originAllowed(req: IncomingMessage): boolean {
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

export function reject(socket: Duplex, status: number, reason: string) {
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
