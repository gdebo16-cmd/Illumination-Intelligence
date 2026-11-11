'use client';

// The bot creator. Used for a new bot (/umbra/new) and for editing one (/umbra/<id>/edit).

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BOT_LIMITS, BOT_MODELS, BOT_TOOLS, DEFAULT_TOOL_IDS, FLAMES, flameColor } from '@/config/umbra';
import { canThink } from '@/config/models';
import Flame from './Flame';
import type { Bot, BotNote } from './types';

// New bots start with every tool switched on, except the Code helper (it needs a folder first).
const EMPTY = {
  name: '',
  flame: FLAMES[0].id as string,
  personality: '',
  purpose: '',
  model: BOT_MODELS[0].id as string,
  tools: [...DEFAULT_TOOL_IDS] as string[],
  codeFolder: '',
  codeAutoWrite: false,
  think: false,
};
type TextField = 'name' | 'flame' | 'personality' | 'purpose' | 'model' | 'codeFolder';

export default function BotForm({ botId }: { botId?: string }) {
  const router = useRouter();
  const editing = Boolean(botId);
  const [form, setForm] = useState(EMPTY);
  const [notes, setNotes] = useState<BotNote[]>([]);
  const [loaded, setLoaded] = useState(!editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // When editing, fill the form with the bot's current settings, and load what it remembers.
  useEffect(() => {
    if (!botId) return;
    fetch(`/api/umbra/bots/${botId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load this Flicker.');
        const bot: Bot = await res.json();
        setForm({
          name: bot.name, flame: bot.flame, personality: bot.personality, purpose: bot.purpose, model: bot.model, tools: bot.tools,
          codeFolder: bot.codeFolder ?? '', codeAutoWrite: Boolean(bot.codeAutoWrite), think: Boolean(bot.think),
        });
        setLoaded(true);
      })
      .catch((err: Error) => setError(err.message));
    fetch(`/api/umbra/bots/${botId}/notes`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setNotes)
      .catch(() => {});
  }, [botId]);

  const set = (field: TextField) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const toggleTool = (id: string) =>
    setForm((f) => ({ ...f, tools: f.tools.includes(id) ? f.tools.filter((t) => t !== id) : [...f.tools, id] }));

  const forget = async (note: BotNote) => {
    const res = await fetch(`/api/umbra/bots/${botId}/notes?note=${encodeURIComponent(note.id)}`, { method: 'DELETE' });
    if (res.ok) setNotes((list) => list.filter((n) => n.id !== note.id));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch(editing ? `/api/umbra/bots/${botId}` : '/api/umbra/bots', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not save the Flicker.');
      router.push(`/umbra/${data.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${form.name || 'this Flicker'} and its whole chat? This can't be undone.`)) return;
    const res = await fetch(`/api/umbra/bots/${botId}`, { method: 'DELETE' });
    if (res.ok) router.push('/umbra');
    else setError('Could not delete the Flicker.');
  };

  return (
    <main className="umbra">
      <form className="umbra-page umbra-form" onSubmit={save} style={{ '--bot-color': flameColor(form.flame) } as React.CSSProperties}>
        <Link href={editing ? `/umbra/${botId}` : '/umbra'} className="umbra-back">← {editing ? 'Back to chat' : 'Your Flickers'}</Link>
        <h1>{editing ? `Edit ${form.name || 'Flicker'}` : 'Create a Flicker'}</h1>

        {!loaded && !error && <p className="umbra-muted">Loading…</p>}

        {loaded && (
          <>
            <fieldset className="umbra-field">
              <legend className="umbra-label">Pick a flame</legend>
              <div className="umbra-flames" role="radiogroup">
                {FLAMES.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={form.flame === f.id}
                    aria-label={f.name}
                    title={f.name}
                    className="umbra-flame-option"
                    style={{ '--bot-color': f.color } as React.CSSProperties}
                    onClick={() => setForm((cur) => ({ ...cur, flame: f.id }))}
                  >
                    <Flame flame={f.id} size={64} />
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="umbra-field">
              <span className="umbra-label">Name</span>
              <input value={form.name} onChange={set('name')} maxLength={BOT_LIMITS.name} placeholder="e.g. Ember" required />
            </label>

            <label className="umbra-field">
              <span className="umbra-label">What is it for?</span>
              <textarea
                value={form.purpose}
                onChange={set('purpose')}
                maxLength={BOT_LIMITS.purpose}
                rows={3}
                placeholder="e.g. Helps me plan healthy weeknight dinners and a shopping list."
              />
            </label>

            <label className="umbra-field">
              <span className="umbra-label">Personality</span>
              <textarea
                value={form.personality}
                onChange={set('personality')}
                maxLength={BOT_LIMITS.personality}
                rows={4}
                placeholder="e.g. Warm and upbeat, a little sarcastic, keeps answers short, loves a good pun."
              />
            </label>

            <label className="umbra-field">
              <span className="umbra-label">Brain (model)</span>
              <select value={form.model} onChange={set('model')}>
                {BOT_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </label>

            {/* Only some brains can think; for the others the switch is greyed out. */}
            <label className={`umbra-tool ${canThink(form.model) ? '' : 'is-unavailable'}`}>
              <input
                type="checkbox"
                role="switch"
                checked={form.think && canThink(form.model)}
                disabled={!canThink(form.model)}
                onChange={(e) => setForm((f) => ({ ...f, think: e.target.checked }))}
              />
              <span>
                <span className="umbra-tool-name">Think before answering</span>
                <span className="umbra-tool-description">
                  {canThink(form.model)
                    ? 'Off: answers straight away. On: works through the problem first and shows its thinking in the chat. Better at hard jobs, slower on every reply.'
                    : 'This brain can’t think step by step. Pick another brain to use this.'}
                </span>
              </span>
            </label>

            <fieldset className="umbra-field">
              <legend className="umbra-label">Tools it can use</legend>
              <div className="umbra-tools">
                {BOT_TOOLS.map((tool) => (
                  <label key={tool.id} className="umbra-tool">
                    <input type="checkbox" role="switch" checked={form.tools.includes(tool.id)} onChange={() => toggleTool(tool.id)} />
                    <span>
                      <span className="umbra-tool-name">{tool.name}</span>
                      <span className="umbra-tool-description">{tool.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {form.tools.includes('code') && (
              <fieldset className="umbra-field umbra-code-settings">
                <legend className="umbra-label">Code helper</legend>
                <label className="umbra-field">
                  <span className="umbra-muted umbra-hint">The project folder it may look at. It can’t see anything outside this folder.</span>
                  <input
                    value={form.codeFolder}
                    onChange={set('codeFolder')}
                    placeholder={'e.g. C:\\Users\\you\\projects\\my-app'}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    required
                  />
                </label>
                <label className="umbra-tool">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={form.codeAutoWrite}
                    onChange={(e) => setForm((f) => ({ ...f, codeAutoWrite: e.target.checked }))}
                  />
                  <span>
                    <span className="umbra-tool-name">Change files without asking</span>
                    <span className="umbra-tool-description">
                      Off: every change waits for you to tap Apply. On: changes are written straight away.
                    </span>
                  </span>
                </label>
                <span className="umbra-muted umbra-hint">Tip: pick the “Qwen 3 Coder” brain above for code.</span>
              </fieldset>
            )}

            {editing && (
              <section className="umbra-field">
                <span className="umbra-label">What {form.name || 'it'} remembers about you</span>
                {notes.length === 0 ? (
                  <p className="umbra-muted umbra-notes-empty">
                    Nothing yet. With the Notes tool on, it saves things you tell it to remember.
                  </p>
                ) : (
                  <ul className="umbra-notes">
                    {notes.map((note) => (
                      <li key={note.id}>
                        <span>{note.content}</span>
                        <button type="button" onClick={() => forget(note)} aria-label={`Forget: ${note.content}`}>Forget</button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {error && <p className="umbra-error" role="alert">{error}</p>}

            <div className="umbra-form-actions">
              <button type="submit" className="umbra-primary" disabled={saving || !form.name.trim()}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Bring it to life'}
              </button>
              {editing && (
                <button type="button" className="umbra-danger" onClick={remove}>Delete Flicker</button>
              )}
            </div>
          </>
        )}
        {!loaded && error && <p className="umbra-error" role="alert">{error}</p>}
      </form>
    </main>
  );
}
