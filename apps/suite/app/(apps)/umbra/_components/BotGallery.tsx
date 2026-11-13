'use client';

// /umbra — your bots, each shown as its flame, plus a card to create a new one.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { flameColor } from '@/config/umbra';
import Flame from './Flame';
import { useUmbraSidebar } from './UmbraShell';
import type { Bot, Team } from './types';

export default function BotGallery() {
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [error, setError] = useState('');
  const [unread, setUnread] = useState(0);
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    fetch('/api/umbra/bots')
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load your Flickers.');
        setBots(await res.json());
      })
      .catch((err: Error) => setError(err.message));
    fetch('/api/umbra/teams')
      .then((res) => (res.ok ? res.json() : []))
      .then(setTeams)
      .catch(() => {});
    fetch('/api/umbra/inbox?count=1')
      .then((res) => (res.ok ? res.json() : { unread: 0 }))
      .then((data) => setUnread(data.unread ?? 0))
      .catch(() => {});
  }, []);

  // Inbox and Artifacts live in the side panel.
  useUmbraSidebar({
    title: 'Umbra',
    items: [
      { label: 'Inbox', href: '/umbra/inbox', badge: unread },
      { label: 'Artifacts', href: '/umbra/artifacts' },
    ],
  });

  return (
    <main className="umbra">
      <div className="umbra-page">
        <div className="umbra-intro">
          <div>
            <h1>Your Flickers</h1>
            <p>Each flame is a Flicker with its own personality and purpose. Tap one to chat.</p>
          </div>
        </div>

        {error && <p className="umbra-error" role="alert">{error}</p>}

        <div className="umbra-grid">
          {bots?.map((bot) => (
            <Link
              key={bot.id}
              href={`/umbra/${bot.id}`}
              className="umbra-card"
              style={{ '--bot-color': flameColor(bot.flame) } as React.CSSProperties}
            >
              <Flame flame={bot.flame} size={110} />
              <span className="umbra-card-name">{bot.name}</span>
              {bot.purpose && <span className="umbra-card-purpose">{bot.purpose}</span>}
            </Link>
          ))}

          <Link href="/umbra/new" className="umbra-card umbra-card-new">
            <span className="umbra-card-plus" aria-hidden>+</span>
            <span className="umbra-card-name">Create a Flicker</span>
            <span className="umbra-card-purpose">Pick a flame and bring it to life</span>
          </Link>
        </div>

        {bots === null && !error && <p className="umbra-muted">Gathering your flames…</p>}

        {/* Teams: bots working together under a leader. */}
        {bots && bots.length >= 2 && (
          <section className="umbra-teams">
            <h2>Teams</h2>
            <p className="umbra-muted">Flickers working together: a leader hands parts of a job to its teammates.</p>
            <div className="umbra-grid">
              {teams.map((team) => (
                <Link
                  key={team.id}
                  href={`/umbra/teams/${team.id}`}
                  className="umbra-card umbra-team-card"
                  style={{ '--bot-color': flameColor(team.leader.flame) } as React.CSSProperties}
                >
                  <span className="umbra-team-flames">
                    <Flame flame={team.leader.flame} size={84} />
                    {team.crew.slice(0, 3).map((c) => <Flame key={c.bot.id} flame={c.bot.flame} size={52} still />)}
                  </span>
                  <span className="umbra-card-name">{team.name}</span>
                  <span className="umbra-card-purpose">
                    {team.leader.name} + {team.crew.map((c) => c.bot.name).join(', ')}
                  </span>
                </Link>
              ))}
              <Link href="/umbra/teams/new" className="umbra-card umbra-card-new">
                <span className="umbra-card-plus" aria-hidden>+</span>
                <span className="umbra-card-name">Build a team</span>
                <span className="umbra-card-purpose">Put a few Flickers on one job</span>
              </Link>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
