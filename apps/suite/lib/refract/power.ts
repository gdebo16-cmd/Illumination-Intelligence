// Which power actions make sense in which VirtualBox state. No server-only import, so the client
// uses the same rules to enable its buttons and the API uses them to refuse a bad request.

export type PowerAction = "start" | "stop" | "reset";

export const POWER_ACTIONS: readonly PowerAction[] = ["start", "stop", "reset"];

/**
 * start: off, crashed (aborted), or saved (startvm resumes a saved VM where it left off).
 * stop:  running or paused (and stuck, which only a hard power off can clear).
 *        A saved VM can't be stopped here; Start it first, so a saved session is never discarded by surprise.
 * reset: running only.
 */
const ALLOWED: Record<PowerAction, readonly string[]> = {
  start: ["poweroff", "aborted", "saved"],
  stop: ["running", "paused", "stuck"],
  reset: ["running"],
};

export function cleanPowerAction(raw: unknown): PowerAction | null {
  return typeof raw === "string" && (POWER_ACTIONS as readonly string[]).includes(raw) ? (raw as PowerAction) : null;
}

export function powerActionAllowed(action: PowerAction, state: string | null | undefined): boolean {
  return !!state && ALLOWED[action].includes(state);
}