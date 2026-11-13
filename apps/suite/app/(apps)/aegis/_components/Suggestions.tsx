'use client';

import { useEffect, useRef, useState } from 'react';
import { AEGIS_DEFAULT_MODEL, PAGE_MODELS } from '@/config/models';
import type { SuggestionCandidate, WrittenSuggestion } from '@/lib/aegis/types';

// The Suggestions section: code that does the same job in several files. The scan finds each one
// (lib/aegis/suggest.ts); this asks a local model to write it up (POST /api/aegis/suggest), one
// at a time, and shows the scan's own notes until each is ready.

const MODEL_KEY = 'aegis-model';

type State =
  | { status: 'waiting' }
  | { status: 'writing'; since: number; model: string }
  | { status: 'done'; written: WrittenSuggestion; note?: string };

function readModel(): string {
  try {
    const saved = localStorage.getItem(MODEL_KEY);
    return saved && PAGE_MODELS.chat.some((m) => m.id === saved) ? saved : AEGIS_DEFAULT_MODEL;
  } catch {
    return AEGIS_DEFAULT_MODEL;
  }
}

function Ticks({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/);
  return <>{parts.map((p, i) => (i % 2 ? <code key={i}>{p}</code> : p))}</>;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function Written({ w, note }: { w: WrittenSuggestion; note?: string }) {
  return (
    <>
      <p><Ticks text={w.summary} /></p>
      {w.alreadyShared.length > 0 && (
        <>
          <h4>Already shared</h4>
          <ul>{w.alreadyShared.map((s, i) => <li key={i}><Ticks text={s} /></li>)}</ul>
        </>
      )}
      {w.repeated.length > 0 && (
        <>
          <h4>Repeated today</h4>
          <ul className="aegis-repeated">
            {w.repeated.map((r, i) => (
              <li key={i}><code>{r.file}</code>{r.what ? <>: <Ticks text={r.what} /></> : null}</li>
            ))}
          </ul>
        </>
      )}
      <h4>How to unify it</h4>
      <ol>{w.plan.map((s, i) => <li key={i}><Ticks text={s} /></li>)}</ol>
      {w.sketch && <pre className="aegis-sketch">{w.sketch}</pre>}
      {w.payoff && <p><strong>Payoff.</strong> <Ticks text={w.payoff} /></p>}
      <p className="aegis-by">{w.by === 'scan' ? note ?? 'Written by the scan alone.' : `Written by ${w.by} from the code.`}</p>
    </>
  );
}

export default function Suggestions({
  candidates,
  onWritten,
}: {
  candidates: SuggestionCandidate[];
  /** Every suggestion written so far, in order, for the AI prompt. */
  onWritten: (written: WrittenSuggestion[]) => void;
}) {
  const [model, setModel] = useState(AEGIS_DEFAULT_MODEL);
  const [states, setStates] = useState<Record<string, State>>({});
  const [now, setNow] = useState(() => Date.now());
  // The run in progress; starting another (a new scan, or Rewrite) stops it.
  const active = useRef<{ stopped: boolean } | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists in the browser
  useEffect(() => setModel(readModel()), []);

  const writeAll = async (list: SuggestionCandidate[], withModel: string, token = { stopped: false }) => {
    if (active.current) active.current.stopped = true;
    active.current = token;
    setStates(Object.fromEntries(list.map((c) => [c.id, { status: 'waiting' } as State])));
    const done: WrittenSuggestion[] = [];
    onWritten([]);
    for (const c of list) {
      if (token.stopped) return; // a new scan or another model took over
      setStates((s) => ({ ...s, [c.id]: { status: 'writing', since: Date.now(), model: withModel } }));
      let next: State;
      try {
        const res = await fetch('/api/aegis/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidate: c, model: withModel }),
        });
        const data = await res.json();
        if (!res.ok || !data.written) throw new Error(data.error ?? `The server answered ${res.status}.`);
        next = { status: 'done', written: data.written, note: data.note };
      } catch (err) {
        next = {
          status: 'done',
          written: { title: c.title.replace(/`/g, ''), summary: c.summary, alreadyShared: [], repeated: [], plan: [], sketch: '', payoff: '', by: 'scan' },
          note: `Couldn’t write this one (${err instanceof Error ? err.message : String(err)}).`,
        };
      }
      if (token.stopped) return;
      setStates((s) => ({ ...s, [c.id]: next }));
      if (next.status === 'done' && next.written.plan.length) {
        done.push(next.written);
        onWritten([...done]);
      }
    }
  };

  // A new scan: write its suggestions with the chosen model.
  useEffect(() => {
    const token = { stopped: false };
    void Promise.resolve().then(() => writeAll(candidates, readModel(), token));
    return () => {
      token.stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the scan changes
  }, [candidates]);

  const writing = Object.values(states).some((s) => s.status === 'writing');
  useEffect(() => {
    if (!writing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [writing]);

  const pick = (id: string) => {
    setModel(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {
      // not remembered in private browsing; fine
    }
  };

  if (!candidates.length) return <p>Nothing stood out as repeated across files.</p>;

  return (
    <>
      <div className="aegis-model">
        <label htmlFor="aegis-model">Written by</label>
        <select id="aegis-model" value={model} onChange={(e) => pick(e.target.value)}>
          {PAGE_MODELS.chat.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <button type="button" className="aegis-rewrite" onClick={() => void writeAll(candidates, model)}>
          {writing ? 'Start over' : 'Rewrite'}
        </button>
      </div>
      {candidates.map((c, i) => {
        const state = states[c.id] ?? { status: 'waiting' };
        return (
          <article key={c.id} className="aegis-suggestion">
            <div className="aegis-finding-head">
              <span className="aegis-num">S{i + 1}</span>
              <span className="aegis-sev sev-idea">Suggestion</span>
              <h3><Ticks text={state.status === 'done' ? state.written.title : c.title} /></h3>
            </div>
            {state.status === 'done' ? (
              <Written w={state.written} note={state.note} />
            ) : (
              <>
                <p><Ticks text={c.summary} /></p>
                <ul className="aegis-evidence">{c.evidence.map((e, n) => <li key={n}><Ticks text={e} /></li>)}</ul>
                <p className="aegis-status" role="status">
                  {state.status === 'writing' ? (
                    <><span className="aegis-spinner" aria-hidden /> Reading the code and writing it up with {state.model}… {clock((now - state.since) / 1000)}</>
                  ) : (
                    'Waiting its turn…'
                  )}
                </p>
              </>
            )}
          </article>
        );
      })}
    </>
  );
}
