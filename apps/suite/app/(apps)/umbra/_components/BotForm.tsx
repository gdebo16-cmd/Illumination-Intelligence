'use client';

// The bot creator. Used for a new bot (/umbra/new) and for editing one (/umbra/<id>/edit).

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BOT_LIMITS, BOT_MODELS, FLAMES, flameColor } from '@/config/umbra';
import Flame from './Flame';
import type { Bot } from './types';

const EMPTY = { name: '', flame: FLAMES[0].id as string, personality: '', purpose: '', model: BOT_MODELS[0].id as string };

export default function BotForm({ botId }: { botId?: string }) {
  const router = useRouter();
  const editing = Boolean(botId);
  const [form, setForm] = useState(EMPTY);
  const [loaded, setLoaded] = useState(!editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // When editing, fill the form with the bot's current settings.
  useEffect(() => {
    if (!botId) return;
    fetch(`/api/umbra/bots/${botId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load this bot.');
        const bot: Bot = await res.json();
        setForm({ name: bot.name, flame: bot.flame, personality: bot.personality, purpose: bot.purpose, model: bot.model });
        setLoaded(true);
      })
      .catch((err: Error) => setError(err.message));
  }, [botId]);

  const set = (field: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

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
      if (!res.ok) throw new Error(data.error ?? 'Could not save the bot.');
      router.push(`/umbra/${data.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${form.name || 'this bot'} and its whole chat? This can't be undone.`)) return;
    const res = await fetch(`/api/umbra/bots/${botId}`, { method: 'DELETE' });
    if (res.ok) router.push('/umbra');
    else setError('Could not delete the bot.');
  };

  return (
    <main className="umbra">
      <form className="umbra-page umbra-form" onSubmit={save} style={{ '--bot-color': flameColor(form.flame) } as React.CSSProperties}>
        <Link href={editing ? `/umbra/${botId}` : '/umbra'} className="umbra-back">← {editing ? 'Back to chat' : 'Your bots'}</Link>
        <h1>{editing ? `Edit ${form.name || 'bot'}` : 'Create a bot'}</h1>

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

            {error && <p className="umbra-error" role="alert">{error}</p>}

            <div className="umbra-form-actions">
              <button type="submit" className="umbra-primary" disabled={saving || !form.name.trim()}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Bring it to life'}
              </button>
              {editing && (
                <button type="button" className="umbra-danger" onClick={remove}>Delete bot</button>
              )}
            </div>
          </>
        )}
        {!loaded && error && <p className="umbra-error" role="alert">{error}</p>}
      </form>
    </main>
  );
}
