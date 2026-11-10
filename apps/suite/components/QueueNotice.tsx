'use client';

// Shows "Request in queue" while this user's request waits for a graphics card
// (because the other person, or a background job, is using it), and then, for pictures and
// videos, "Running on Alienware" (or Raider) once a machine has picked it up. Closable.

import { useEffect, useState } from 'react';

const POLL_MS = 1500;

export default function QueueNotice({ active }: { active: boolean }) {
  const [place, setPlace] = useState(0);
  const [runningOn, setRunningOn] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!active) return;
    let stopped = false;

    const check = async () => {
      try {
        const res = await fetch('/api/queue', { cache: 'no-store' });
        const data = (await res.json()) as { waiting: boolean; place: number; runningOn?: string | null };
        if (stopped) return;
        setPlace(data.waiting ? data.place : 0);
        setRunningOn(data.runningOn ?? null);
      } catch {
        // Status is a nice-to-have; ignore failures.
      }
    };

    // Short delay first, so a request that starts right away never flashes the notice.
    const first = setTimeout(check, 400);
    const timer = setInterval(check, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
      setPlace(0);
      setRunningOn(null);
      setDismissed(false); // the next request gets a fresh notice
    };
  }, [active]);

  if (!active || dismissed || (place === 0 && !runningOn)) return null;

  return (
    <div className="queue-notice" role="status" aria-live="polite">
      <span>
        {place > 0 ? (
          <>
            Request in queue, currently <strong>{place}</strong> in line
          </>
        ) : (
          <>
            Running on <strong>{runningOn}</strong>
          </>
        )}
      </span>
      <button type="button" className="queue-notice-close" onClick={() => setDismissed(true)} aria-label="Close">
        &times;
      </button>
    </div>
  );
}
