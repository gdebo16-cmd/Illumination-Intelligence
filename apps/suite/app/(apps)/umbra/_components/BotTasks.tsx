'use client';

// /umbra/<id>/tasks — jobs this bot does on its own, on a schedule.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { flameColor } from '@/config/umbra';
import { describeSchedule, WEEKDAYS, type Schedule } from '@/config/umbra-schedule';
import Flame from './Flame';
import type { Bot, Task } from './types';

const KINDS = [
  { id: 'once', name: 'Once, right now' },
  { id: 'daily', name: 'Every day' },
  { id: 'weekdays', name: 'Weekdays' },
  { id: 'weekly', name: 'Once a week' },
  { id: 'hourly', name: 'Every few hours' },
] as const;

const BLANK = { title: '', instructions: '', kind: 'daily' as Schedule['kind'], time: '07:00', day: 1, hours: 3 };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

function toSchedule(f: typeof BLANK): Schedule {
  switch (f.kind) {
    case 'once': return { kind: 'once' };
    case 'hourly': return { kind: 'hourly', hours: f.hours };
    case 'weekly': return { kind: 'weekly', time: f.time, day: f.day };
    default: return { kind: f.kind, time: f.time };
  }
}

export default function BotTasks({ botId }: { botId: string }) {
  const [bot, setBot] = useState<Bot | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([fetch(`/api/umbra/bots/${botId}`), fetch(`/api/umbra/bots/${botId}/tasks`)])
      .then(async ([botRes, taskRes]) => {
        if (!botRes.ok) throw new Error((await botRes.json()).error ?? 'Could not load this bot.');
        setBot(await botRes.json());
        if (taskRes.ok) setTasks(await taskRes.json());
      })
      .catch((err: Error) => setError(err.message));
  }, [botId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/umbra/bots/${botId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: form.title, instructions: form.instructions, schedule: toSchedule(form) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not add the task.');
      setTasks((list) => [...list, data]);
      setNotice(form.kind === 'once' ? `${bot?.name} will start within half a minute. The report goes to your inbox.` : 'Task added.');
      setForm(BLANK);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (task: Task) => {
    const res = await fetch(`/api/umbra/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !task.enabled }),
    });
    if (res.ok) {
      const updated: Task = await res.json();
      setTasks((list) => list.map((t) => (t.id === task.id ? updated : t)));
    }
  };

  const runNow = async (task: Task) => {
    const res = await fetch(`/api/umbra/tasks/${task.id}/run`, { method: 'POST' });
    setNotice(res.ok ? `${bot?.name} is working on “${task.title}”. The report will appear in your inbox.` : 'Could not start the task.');
  };

  const remove = async (task: Task) => {
    if (!window.confirm(`Delete the task “${task.title}”? Its past reports stay in your inbox.`)) return;
    const res = await fetch(`/api/umbra/tasks/${task.id}`, { method: 'DELETE' });
    if (res.ok) setTasks((list) => list.filter((t) => t.id !== task.id));
  };

  if (!bot) {
    return (
      <main className="umbra">
        <div className="umbra-page">
          <Link href={`/umbra/${botId}`} className="umbra-back">← Back</Link>
          {error ? <p className="umbra-error" role="alert">{error}</p> : <p className="umbra-muted">Loading…</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="umbra">
      <div className="umbra-page umbra-tasks-page" style={{ '--bot-color': flameColor(bot.flame) } as React.CSSProperties}>
        <Link href={`/umbra/${bot.id}`} className="umbra-back">← Chat with {bot.name}</Link>
        <div className="umbra-tasks-head">
          <Flame flame={bot.flame} size={64} />
          <div>
            <h1>{bot.name}’s tasks</h1>
            <p className="umbra-muted">Jobs {bot.name} does on its own. Reports go to your <Link href="/umbra/inbox">inbox</Link>.</p>
          </div>
        </div>

        {tasks.length > 0 && (
          <ul className="umbra-task-list">
            {tasks.map((task) => (
              <li key={task.id} className={`umbra-task ${task.enabled ? '' : 'is-paused'}`}>
                <div className="umbra-task-main">
                  <span className="umbra-task-title">{task.title}</span>
                  <span className="umbra-task-when">
                    {task.schedule.kind === 'once'
                      ? task.lastRunAt ? `Ran ${when(task.lastRunAt)}` : 'Starting soon'
                      : task.enabled
                        ? `${describeSchedule(task.schedule)} · next ${when(task.nextRunAt)}`
                        : `${describeSchedule(task.schedule)} · paused`}
                  </span>
                  <span className="umbra-task-instructions">{task.instructions}</span>
                </div>
                <div className="umbra-task-actions">
                  <button type="button" onClick={() => runNow(task)}>Run now</button>
                  {task.schedule.kind !== 'once' && (
                    <button type="button" onClick={() => toggle(task)}>{task.enabled ? 'Pause' : 'Resume'}</button>
                  )}
                  <button type="button" className="is-danger" onClick={() => remove(task)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {notice && <p className="umbra-notice" role="status">{notice}</p>}

        <form className="umbra-form umbra-task-form" onSubmit={add}>
          <h2>Give {bot.name} a task</h2>
          <label className="umbra-field">
            <span className="umbra-label">Title</span>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={80} placeholder="e.g. Morning weather" required />
          </label>
          <label className="umbra-field">
            <span className="umbra-label">What should it do?</span>
            <textarea
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              maxLength={2000}
              rows={3}
              placeholder="e.g. Check today’s weather in Spokane and tell me what to wear."
              required
            />
          </label>
          <div className="umbra-field">
            <span className="umbra-label">When</span>
            <div className="umbra-schedule">
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Schedule['kind'] })} aria-label="How often">
                {KINDS.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
              {form.kind === 'weekly' && (
                <select value={form.day} onChange={(e) => setForm({ ...form, day: Number(e.target.value) })} aria-label="Day of the week">
                  {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              )}
              {(form.kind === 'daily' || form.kind === 'weekdays' || form.kind === 'weekly') && (
                <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} aria-label="Time" required />
              )}
              {form.kind === 'hourly' && (
                <select value={form.hours} onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })} aria-label="Every how many hours">
                  {[1, 2, 3, 4, 6, 8, 12, 24].map((h) => <option key={h} value={h}>every {h === 1 ? 'hour' : `${h} hours`}</option>)}
                </select>
              )}
            </div>
            <span className="umbra-muted umbra-hint">Runs while the app is running on your PC. If it was off, the task runs once when the app starts again.</span>
          </div>
          {error && <p className="umbra-error" role="alert">{error}</p>}
          <div className="umbra-form-actions">
            <button type="submit" className="umbra-primary" disabled={saving || !form.title.trim() || !form.instructions.trim()}>
              {saving ? 'Adding…' : form.kind === 'once' ? 'Start it' : 'Add task'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
