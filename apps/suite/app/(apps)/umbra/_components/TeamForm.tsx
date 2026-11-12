'use client';

// The team builder. Used for a new team (/umbra/teams/new) and editing one (/umbra/teams/<id>/edit).
// Pick a leader, then tick the bots that work under it and give each a role.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { flameColor } from '@/config/umbra';
import Flame from './Flame';
import type { Bot, Team } from './types';

const MAX_MEMBERS = 5;
const ROLE_IDEAS = ['Researcher', 'Writer', 'Critic', 'Planner', 'Artist', 'Fact-checker'];

export default function TeamForm({ teamId }: { teamId?: string }) {
  const router = useRouter();
  const editing = Boolean(teamId);
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [leaderId, setLeaderId] = useState('');
  // Teammates in order, with their roles.
  const [members, setMembers] = useState<{ botId: string; role: string }[]>([]);
  const [loaded, setLoaded] = useState(!editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/umbra/bots')
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load your Flickers.');
        const list: Bot[] = await res.json();
        setBots(list);
        if (!teamId) setLeaderId((id) => id || list[0]?.id || '');
      })
      .catch((err: Error) => setError(err.message));
    if (!teamId) return;
    fetch(`/api/umbra/teams/${teamId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load this team.');
        const team: Team = await res.json();
        setName(team.name);
        setPurpose(team.purpose);
        setLeaderId(team.leaderId);
        setMembers(team.crew.map((c) => ({ botId: c.bot.id, role: c.role })));
        setLoaded(true);
      })
      .catch((err: Error) => setError(err.message));
  }, [teamId]);

  const pickLeader = (id: string) => {
    setLeaderId(id);
    setMembers((list) => list.filter((m) => m.botId !== id)); // the leader can't also be a teammate
  };

  const toggleMember = (id: string) =>
    setMembers((list) =>
      list.some((m) => m.botId === id)
        ? list.filter((m) => m.botId !== id)
        : list.length < MAX_MEMBERS ? [...list, { botId: id, role: '' }] : list,
    );

  const setRole = (id: string, role: string) => setMembers((list) => list.map((m) => (m.botId === id ? { ...m, role } : m)));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch(editing ? `/api/umbra/teams/${teamId}` : '/api/umbra/teams', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, purpose, leaderId, members }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not save the team.');
      router.push(`/umbra/teams/${data.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete the team ${name || ''} and its chat? The Flickers themselves stay.`)) return;
    const res = await fetch(`/api/umbra/teams/${teamId}`, { method: 'DELETE' });
    if (res.ok) router.push('/umbra');
    else setError('Could not delete the team.');
  };

  const leader = bots?.find((b) => b.id === leaderId);
  const others = bots?.filter((b) => b.id !== leaderId) ?? [];

  return (
    <main className="umbra">
      <form
        className="umbra-page umbra-form umbra-team-form"
        onSubmit={save}
        style={{ '--bot-color': flameColor(leader?.flame ?? '') } as React.CSSProperties}
      >
        <Link href={editing ? `/umbra/teams/${teamId}` : '/umbra'} className="umbra-back">← {editing ? 'Back to the team' : 'Your Flickers'}</Link>
        <h1>{editing ? `Edit ${name || 'team'}` : 'Build a team'}</h1>
        <p className="umbra-muted">
          The leader reads your message and hands parts of the job to teammates. Each teammate works with its own tools,
          then the leader puts it all together.
        </p>

        {(!loaded || bots === null) && !error && <p className="umbra-muted">Loading…</p>}

        {bots !== null && bots.length < 2 && (
          <p className="umbra-notice">
            A team needs at least two Flickers. <Link href="/umbra/new">Create another Flicker</Link> first.
          </p>
        )}

        {loaded && bots !== null && bots.length >= 2 && (
          <>
            <label className="umbra-field">
              <span className="umbra-label">Team name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Trip Planners" required />
            </label>

            <label className="umbra-field">
              <span className="umbra-label">What is the team for?</span>
              <textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                maxLength={1000}
                rows={2}
                placeholder="e.g. Research weekend trips, write up a plan, and double-check the details."
              />
            </label>

            <fieldset className="umbra-field">
              <legend className="umbra-label">Leader</legend>
              <div className="umbra-pick-bots" role="radiogroup">
                {bots.map((bot) => (
                  <button
                    key={bot.id}
                    type="button"
                    role="radio"
                    aria-checked={leaderId === bot.id}
                    aria-label={bot.name}
                    className="umbra-pick-bot"
                    style={{ '--bot-color': flameColor(bot.flame) } as React.CSSProperties}
                    onClick={() => pickLeader(bot.id)}
                  >
                    <Flame flame={bot.flame} size={48} still={leaderId !== bot.id} />
                    <span>{bot.name}</span>
                  </button>
                ))}
              </div>
              <span className="umbra-muted umbra-hint">Pick a Flicker with a capable model; it does the planning. GPT-OSS works best.</span>
            </fieldset>

            <fieldset className="umbra-field">
              <legend className="umbra-label">Teammates (up to {MAX_MEMBERS})</legend>
              <ul className="umbra-team-members">
                {others.map((bot) => {
                  const member = members.find((m) => m.botId === bot.id);
                  return (
                    <li
                      key={bot.id}
                      className={`umbra-team-member ${member ? 'is-on' : ''}`}
                      style={{ '--bot-color': flameColor(bot.flame) } as React.CSSProperties}
                    >
                      <label className="umbra-team-member-pick">
                        <input type="checkbox" checked={Boolean(member)} onChange={() => toggleMember(bot.id)} />
                        <Flame flame={bot.flame} size={36} still />
                        <span className="umbra-team-member-name">{bot.name}</span>
                      </label>
                      {member && (
                        <input
                          className="umbra-team-role"
                          value={member.role}
                          onChange={(e) => setRole(bot.id, e.target.value)}
                          maxLength={60}
                          placeholder="Role, e.g. Researcher"
                          list="umbra-role-ideas"
                          aria-label={`${bot.name}'s role`}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
              <datalist id="umbra-role-ideas">
                {ROLE_IDEAS.map((r) => <option key={r} value={r} />)}
              </datalist>
            </fieldset>

            {error && <p className="umbra-error" role="alert">{error}</p>}

            <div className="umbra-form-actions">
              <button type="submit" className="umbra-primary" disabled={saving || !name.trim() || !leaderId || members.length === 0}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Assemble the team'}
              </button>
              {editing && <button type="button" className="umbra-danger" onClick={remove}>Delete team</button>}
            </div>
          </>
        )}
        {error && !(loaded && bots !== null && bots.length >= 2) && <p className="umbra-error" role="alert">{error}</p>}
      </form>
    </main>
  );
}
