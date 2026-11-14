'use client';

// /umbra/memory — everything Lumen and your Flickers remember about you, in one place:
//   - facts about you, shared by Lumen and every Flicker with Memory on
//   - each Flicker's own notes
//   - what each chat remembers of itself: its running summary, how many exchanges are saved for
//     recall, and what was recalled for its latest message (handy for seeing why it said something)
// Everything can be corrected, added to or forgotten here. The code behind it: lib/memory.ts and
// lib/chat-memory.ts.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { flameColor } from '@/config/umbra';
import Flame from './Flame';
import { useUmbraSidebar } from './UmbraShell';

type Category = 'profile' | 'preference' | 'people' | 'project' | 'other';
interface Fact {
  id: number;
  fact: string;
  category: Category;
  updatedAt: string;
}
interface FlickerMemory {
  id: string;
  name: string;
  flame: string;
  memoryOn: boolean;
  notes: Fact[];
}
interface ChatMemory {
  key: string;
  kind: 'lumen' | 'flicker' | 'team';
  title: string;
  href: string;
  summary: string;
  saved: number;
  lastRecall: string;
  lastRecallAt: string | null;
}
interface MemoryData {
  facts: Fact[];
  flickers: FlickerMemory[];
  chats: ChatMemory[];
}

const CATEGORY_NAMES: Record<Category, string> = {
  profile: 'About you',
  preference: 'How you like answers',
  people: 'People',
  project: 'Projects',
  other: 'Other',
};
const KIND_NAMES: Record<ChatMemory['kind'], string> = { lumen: 'Lumen chat', flicker: 'Flicker chat', team: 'Team chat' };

// SQLite times ("2026-11-14 16:06:26", UTC) and ISO times both read as a short date.
const day = (time: string | null) => {
  if (!time) return '';
  const date = new Date(time.includes('T') ? time : `${time.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

async function send(url: string, method: string, body?: object): Promise<string> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.ok) return '';
  return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'That didn’t work. Try again.';
}

/** One fact: its text, kind and date, with Edit and Forget. */
function FactRow({ fact, shared, onChanged, onError }: {
  fact: Fact;
  shared: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.fact);
  const [category, setCategory] = useState<Category>(fact.category);

  const save = async () => {
    const problem = await send(`/api/memory/facts/${fact.id}`, 'PATCH', { fact: text, category });
    if (problem) return onError(problem);
    setEditing(false);
    onChanged();
  };
  const forget = async () => {
    const where = shared ? ' Lumen and all your Flickers will forget it.' : '';
    if (!window.confirm(`Forget “${fact.fact}”?${where}`)) return;
    const problem = await send(`/api/memory/facts/${fact.id}`, 'DELETE');
    if (problem) return onError(problem);
    onChanged();
  };

  if (editing) {
    return (
      <li className="umbra-memory-editing">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} aria-label="What to remember" />
        <select value={category} onChange={(e) => setCategory(e.target.value as Category)} aria-label="Kind">
          {Object.entries(CATEGORY_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <div className="umbra-memory-row-actions">
          <button type="button" onClick={save} disabled={text.trim().length < 3}>Save</button>
          <button type="button" onClick={() => { setEditing(false); setText(fact.fact); setCategory(fact.category); }}>Cancel</button>
        </div>
      </li>
    );
  }
  return (
    <li>
      <span>
        {fact.fact}
        <small className="umbra-memory-meta">{CATEGORY_NAMES[fact.category]} · {day(fact.updatedAt)}</small>
      </span>
      <div className="umbra-memory-row-actions">
        <button type="button" className="is-plain" onClick={() => setEditing(true)} aria-label={`Edit: ${fact.fact}`}>Edit</button>
        <button type="button" onClick={forget} aria-label={`Forget: ${fact.fact}`}>Forget</button>
      </div>
    </li>
  );
}

/** A box to add a fact by hand: shared, or (with botId) one Flicker's own note. */
function AddFact({ botId, defaultCategory, onAdded, onError }: {
  botId?: string;
  defaultCategory: Category;
  onAdded: () => void;
  onError: (message: string) => void;
}) {
  const [text, setText] = useState('');
  const [category, setCategory] = useState<Category>(defaultCategory);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = await send('/api/memory/facts', 'POST', { fact: text, category, botId });
    if (problem) return onError(problem);
    setText('');
    onAdded();
  };
  return (
    <form className="umbra-memory-add" onSubmit={add}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={300}
        placeholder={botId ? 'Add a note for this Flicker' : 'Add something about you, e.g. “I’m vegetarian”'}
        aria-label={botId ? 'New note' : 'New fact about you'}
      />
      <select value={category} onChange={(e) => setCategory(e.target.value as Category)} aria-label="Kind">
        {Object.entries(CATEGORY_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      <button type="submit" disabled={text.trim().length < 3}>Add</button>
    </form>
  );
}

export default function Memory() {
  const [data, setData] = useState<MemoryData | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetch('/api/memory')
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load what’s remembered.');
        setData(await res.json());
        setError('');
      })
      .catch((err: Error) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  useUmbraSidebar({
    title: 'Umbra',
    items: [
      { label: 'Your Flickers', href: '/umbra' },
      { label: 'Inbox', href: '/umbra/inbox' },
      { label: 'Artifacts', href: '/umbra/artifacts' },
    ],
  });

  const resetChat = async (chat: ChatMemory, what: 'summary' | 'all') => {
    const question = what === 'all'
      ? `Forget everything “${chat.title}” remembers of itself (its summary and its ${chat.saved} saved exchanges)? Its messages stay.`
      : `Start “${chat.title}”’s summary over? Its messages stay and will be summarized again as the chat grows.`;
    if (!window.confirm(question)) return;
    const problem = await send(`/api/memory/chats?chat=${encodeURIComponent(chat.key)}&what=${what}`, 'DELETE');
    if (problem) setError(problem);
    load();
  };

  return (
    <main className="umbra">
      <div className="umbra-page umbra-memory">
        <Link href="/umbra" className="umbra-back">← Your Flickers</Link>
        <div className="umbra-intro">
          <h1>Memory</h1>
          <p>
            What Lumen and your Flickers remember about you. Facts about you are shared: what you tell one, they all know
            (Flickers only with Memory turned on). Fix anything that’s wrong, add what they should know, or forget it.
          </p>
        </div>

        {error && <p className="umbra-error" role="alert">{error}</p>}
        {data === null && !error && <p className="umbra-muted">Loading…</p>}

        {data && (
          <>
            <section className="umbra-memory-section">
              <h2>About you <span className="umbra-muted">({data.facts.length})</span></h2>
              <p className="umbra-muted umbra-hint">
                Shared by Lumen and your Flickers. “About you” and “How you like answers” always go in; the rest when they
                match what you’re talking about.
              </p>
              <AddFact defaultCategory="profile" onAdded={load} onError={setError} />
              {data.facts.length === 0 ? (
                <p className="umbra-muted umbra-notes-empty">Nothing yet. They pick things up as you chat.</p>
              ) : (
                <ul className="umbra-notes">
                  {data.facts.map((f) => <FactRow key={f.id} fact={f} shared onChanged={load} onError={setError} />)}
                </ul>
              )}
            </section>

            <section className="umbra-memory-section">
              <h2>Each Flicker’s own notes</h2>
              <p className="umbra-muted umbra-hint">Only about your work with that Flicker. The others don’t see them.</p>
              {data.flickers.length === 0 && <p className="umbra-muted umbra-notes-empty">No Flickers yet.</p>}
              {data.flickers.map((bot) => (
                <details
                  key={bot.id}
                  className="umbra-memory-flicker"
                  style={{ '--bot-color': flameColor(bot.flame) } as React.CSSProperties}
                >
                  <summary>
                    <Flame flame={bot.flame} size={32} />
                    <span className="umbra-memory-flicker-name">{bot.name}</span>
                    <span className="umbra-muted">
                      {bot.memoryOn ? `${bot.notes.length} note${bot.notes.length === 1 ? '' : 's'}` : 'Memory off'}
                    </span>
                  </summary>
                  {!bot.memoryOn && (
                    <p className="umbra-muted umbra-hint">
                      Memory is off, so {bot.name} doesn’t learn or use anything about you.{' '}
                      <Link href={`/umbra/${bot.id}/edit`}>Turn it on</Link>
                    </p>
                  )}
                  <AddFact botId={bot.id} defaultCategory="preference" onAdded={load} onError={setError} />
                  {bot.notes.length > 0 && (
                    <ul className="umbra-notes">
                      {bot.notes.map((n) => <FactRow key={n.id} fact={n} shared={false} onChanged={load} onError={setError} />)}
                    </ul>
                  )}
                </details>
              ))}
            </section>

            <section className="umbra-memory-section">
              <h2>Chats</h2>
              <p className="umbra-muted umbra-hint">
                A long chat keeps a running summary of its older messages, and saves each exchange so it can be found again.
                “Last recalled” is exactly what the model was shown from memory for that chat’s latest message.
              </p>
              {data.chats.length === 0 && <p className="umbra-muted umbra-notes-empty">Nothing yet.</p>}
              <ul className="umbra-memory-chats">
                {data.chats.map((chat) => (
                  <li key={chat.key}>
                    <div className="umbra-memory-chat-head">
                      <Link href={chat.href}>{chat.title}</Link>
                      <span className="umbra-muted">
                        {KIND_NAMES[chat.kind]} · {chat.saved} saved exchange{chat.saved === 1 ? '' : 's'}
                        {chat.lastRecallAt ? ` · last used ${day(chat.lastRecallAt)}` : ''}
                      </span>
                    </div>
                    {chat.summary ? (
                      <details>
                        <summary>Summary</summary>
                        <p className="umbra-memory-text">{chat.summary}</p>
                      </details>
                    ) : (
                      <p className="umbra-muted umbra-hint">No summary yet: the whole chat still fits.</p>
                    )}
                    <details>
                      <summary>Last recalled</summary>
                      <p className="umbra-memory-text">{chat.lastRecall || 'Nothing: no summary, matching exchanges or facts that time.'}</p>
                    </details>
                    <div className="umbra-report-actions">
                      {chat.summary && <button type="button" onClick={() => resetChat(chat, 'summary')}>Start summary over</button>}
                      <button type="button" onClick={() => resetChat(chat, 'all')}>Forget this chat’s memory</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
