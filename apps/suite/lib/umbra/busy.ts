// lib/umbra/busy.ts — which chats are still working on a reply.
//
// A reply keeps going on this computer even if your phone drops the connection (you left the app,
// the screen locked). When you come back, the chat page asks whether a reply is still on its way and
// waits for it. Kept in memory, so a server restart forgets it (a reply in progress is lost then anyway).

type Work = { busy: boolean; error?: string };
const g = globalThis as unknown as { umbraBusy?: Map<string, Work> };
const chats: Map<string, Work> = (g.umbraBusy ??= new Map());

export const startWork = (key: string) => void chats.set(key, { busy: true });
export const workFailed = (key: string, error: string) => void chats.set(key, { busy: chats.get(key)?.busy ?? false, error });
export const endWork = (key: string) => void chats.set(key, { busy: false, error: chats.get(key)?.error });

// Headers for the chat history: X-Umbra-Busy says a reply is still coming; X-Umbra-Error carries a
// failure you missed while away (shown once).
export function workHeaders(key: string): Record<string, string> {
  const work = chats.get(key);
  const headers: Record<string, string> = { 'X-Umbra-Busy': work?.busy ? '1' : '0', 'Cache-Control': 'no-store' };
  if (work?.error && !work.busy) {
    headers['X-Umbra-Error'] = encodeURIComponent(work.error);
    chats.delete(key);
  }
  return headers;
}
