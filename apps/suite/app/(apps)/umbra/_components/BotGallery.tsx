'use client';

// /umbra — your bots, each shown as its flame, plus a card to create a new one.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { flameColor } from '@/config/umbra';
import Flame from './Flame';
import type { Bot } from './types';

export default function BotGallery() {
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/umbra/bots')
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load your bots.');
        setBots(await res.json());
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main className="umbra">
      <div className="umbra-page">
        <div className="umbra-intro">
          <h1>Your bots</h1>
          <p>Each flame is a bot with its own personality and purpose. Tap one to chat.</p>
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
            <span className="umbra-card-name">Create a bot</span>
            <span className="umbra-card-purpose">Pick a flame and bring it to life</span>
          </Link>
        </div>

        {bots === null && !error && <p className="umbra-muted">Gathering your flames…</p>}
      </div>
    </main>
  );
}
