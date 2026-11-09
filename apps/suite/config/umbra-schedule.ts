// When an Umbra task runs. Safe to use in the browser and on the server.
//
// Times are in the PC's local time zone. A schedule is stored as a small object, e.g.
//   { kind: 'daily', time: '07:00' }                 every day at 7 am
//   { kind: 'weekdays', time: '08:30' }              Monday–Friday at 8:30 am
//   { kind: 'weekly', time: '18:00', day: 0 }        every Sunday at 6 pm   (0 = Sunday … 6 = Saturday)
//   { kind: 'hourly', hours: 3 }                     every 3 hours
//   { kind: 'once' }                                  just once (runs right away)

export type Schedule =
  | { kind: 'once' }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string }
  | { kind: 'weekly'; time: string; day: number }
  | { kind: 'hourly'; hours: number };

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Check a schedule from a form. Returns the cleaned schedule, or null if it's not valid. */
export function parseSchedule(input: unknown): Schedule | null {
  if (!input || typeof input !== 'object') return null;
  const s = input as Record<string, unknown>;
  const time = typeof s.time === 'string' && TIME.test(s.time) ? s.time : null;
  switch (s.kind) {
    case 'once':
      return { kind: 'once' };
    case 'daily':
    case 'weekdays':
      return time ? { kind: s.kind, time } : null;
    case 'weekly': {
      const day = Number(s.day);
      return time && Number.isInteger(day) && day >= 0 && day <= 6 ? { kind: 'weekly', time, day } : null;
    }
    case 'hourly': {
      const hours = Number(s.hours);
      return Number.isInteger(hours) && hours >= 1 && hours <= 24 ? { kind: 'hourly', hours } : null;
    }
    default:
      return null;
  }
}

/** "every day at 7:00 AM", for showing in the page. */
export function describeSchedule(s: Schedule): string {
  const at = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };
  switch (s.kind) {
    case 'once':
      return 'once';
    case 'daily':
      return `every day at ${at(s.time)}`;
    case 'weekdays':
      return `weekdays at ${at(s.time)}`;
    case 'weekly':
      return `every ${WEEKDAYS[s.day]} at ${at(s.time)}`;
    case 'hourly':
      return s.hours === 1 ? 'every hour' : `every ${s.hours} hours`;
  }
}

/** The next time this schedule should run after `from`. `once` has no next time after it ran. */
export function nextRun(s: Schedule, from: Date): Date | null {
  if (s.kind === 'once') return null;
  if (s.kind === 'hourly') return new Date(from.getTime() + s.hours * 3_600_000);

  const [h, m] = s.time.split(':').map(Number);
  // Try today at that time, then each following day, until one fits the schedule.
  for (let add = 0; add <= 7; add++) {
    const candidate = new Date(from.getFullYear(), from.getMonth(), from.getDate() + add, h, m, 0, 0);
    if (candidate <= from) continue;
    const weekday = candidate.getDay();
    if (s.kind === 'weekdays' && (weekday === 0 || weekday === 6)) continue;
    if (s.kind === 'weekly' && weekday !== s.day) continue;
    return candidate;
  }
  return null;
}
