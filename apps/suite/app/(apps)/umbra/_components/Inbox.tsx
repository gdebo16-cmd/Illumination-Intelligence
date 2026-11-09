'use client';

// /umbra/inbox — reports from tasks your bots did on their own.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { flameColor } from '@/config/umbra';
import { MessageContent } from '@/components/MessageContent';
import Flame from './Flame';
import { Steps } from './Steps';
import type { Run } from './types';

async function fetchInbox(): Promise<Run[]> {
  const res = await fetch('/api/umbra/inbox');
  if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load your inbox.');
  return (await res.json()).runs;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function Inbox() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Load now, and check again every 15 seconds while the page is open (tasks finish in the background).
  useEffect(() => {
    const load = () =>
      fetchInbox()
        .then(setRuns)
        .catch((err: Error) => setError(err.message));
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, []);

  const toggle = async (run: Run) => {
    setOpen((id) => (id === run.id ? null : run.id));
    if (!run.read && run.status !== 'running') {
      setRuns((list) => list?.map((r) => (r.id === run.id ? { ...r, read: true } : r)) ?? null);
      await fetch(`/api/umbra/inbox/${run.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ read: true }) });
    }
  };

  const remove = async (run: Run) => {
    const res = await fetch(`/api/umbra/inbox/${run.id}`, { method: 'DELETE' });
    if (res.ok) setRuns((list) => list?.filter((r) => r.id !== run.id) ?? null);
  };

  return (
    <main className="umbra">
      <div className="umbra-page">
        <Link href="/umbra" className="umbra-back">← Your bots</Link>
        <div className="umbra-intro">
          <h1>Inbox</h1>
          <p>Reports from tasks your bots did on their own. Give a bot tasks from its chat (the Tasks button).</p>
        </div>

        {error && <p className="umbra-error" role="alert">{error}</p>}
        {runs === null && !error && <p className="umbra-muted">Loading…</p>}
        {runs?.length === 0 && <p className="umbra-muted">No reports yet.</p>}

        <ul className="umbra-inbox">
          {runs?.map((run) => (
            <li
              key={run.id}
              className={`umbra-report ${run.read ? '' : 'is-unread'} is-${run.status}`}
              style={{ '--bot-color': flameColor(run.botFlame) } as React.CSSProperties}
            >
              <button type="button" className="umbra-report-head" onClick={() => toggle(run)} aria-expanded={open === run.id}>
                <Flame flame={run.botFlame} size={40} still />
                <span className="umbra-report-who">
                  <span className="umbra-report-title">{run.title}</span>
                  <span className="umbra-report-meta">
                    {run.teamName ? `${run.teamName} (team)` : run.botName} · {when(run.startedAt)}
                    {run.status === 'running' && ' · working…'}
                    {run.status === 'error' && ' · didn’t finish'}
                  </span>
                </span>
                {!run.read && run.status !== 'running' && <span className="umbra-unread-dot" aria-label="Unread" />}
              </button>
              {open === run.id && (
                <div className="umbra-report-body">
                  {run.steps.length > 0 && <Steps steps={run.steps} />}
                  {run.status === 'running' ? (
                    <p className="umbra-thinking">{run.botName} is still working on this…</p>
                  ) : (
                    <MessageContent content={run.report ?? ''} />
                  )}
                  <div className="umbra-report-actions">
                    {run.teamId && run.teamName !== 'A deleted team' ? (
                      <Link href={`/umbra/teams/${run.teamId}`}>Chat with {run.teamName}</Link>
                    ) : (
                      <Link href={`/umbra/${run.botId}`}>Chat with {run.botName}</Link>
                    )}
                    <button type="button" onClick={() => remove(run)}>Delete report</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
