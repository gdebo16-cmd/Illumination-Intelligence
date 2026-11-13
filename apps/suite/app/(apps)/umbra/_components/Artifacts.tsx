'use client';

// /umbra/artifacts — the Markdown documents your Flickers and teams have written:
// <document> blocks from chats and task reports, and .md files a Flicker wrote in Refract.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { flameColor } from '@/config/umbra';
import { DocumentPanel, useArtifacts, type ArtifactSummary, type OpenDocument } from '@/components/documents';
import Flame from './Flame';
import type { Bot, Team } from './types';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const size = (chars: number) => (chars < 1000 ? `${chars} characters` : `${(chars / 1000).toFixed(1)}k characters`);

export default function Artifacts({ source }: { source?: string }) {
  const { artifacts, error, open, remove } = useArtifacts('umbra', source);
  const [openDoc, setOpenDoc] = useState<OpenDocument | null>(null);
  // The flames to draw next to each artifact, from your Flickers and teams.
  const [flames, setFlames] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([
      fetch('/api/umbra/bots').then((r) => (r.ok ? r.json() : [])) as Promise<Bot[]>,
      fetch('/api/umbra/teams').then((r) => (r.ok ? r.json() : [])) as Promise<Team[]>,
    ])
      .then(([bots, teams]) => {
        const map: Record<string, string> = {};
        for (const b of bots) map[b.id] = b.flame;
        for (const t of teams) map[t.id] = t.leader.flame;
        setFlames(map);
      })
      .catch(() => {});
  }, []);

  const show = async (a: ArtifactSummary) => {
    const doc = await open(a);
    if (doc) setOpenDoc(doc);
  };

  const discard = (a: ArtifactSummary) => {
    if (window.confirm(`Delete the artifact "${a.title}"? The chat it came from stays.`)) void remove(a);
  };

  const sourceName = source ? artifacts?.[0]?.sourceName : undefined;
  const chatLink = (a: ArtifactSummary) => (a.sourceKind === 'team' ? `/umbra/teams/${a.sourceId}` : `/umbra/${a.sourceId}`);

  return (
    <main className="umbra">
      <div className="umbra-page">
        {source ? (
          <Link href="/umbra/artifacts" className="umbra-back">← All artifacts</Link>
        ) : (
          <Link href="/umbra" className="umbra-back">← Your Flickers</Link>
        )}
        <div className="umbra-intro">
          <h1>{sourceName ? `${sourceName}’s artifacts` : 'Artifacts'}</h1>
          <p>
            Markdown documents your Flickers wrote: long write-ups from chats and task reports, and .md files
            they made in Refract. Writing one again with the same name updates it.
          </p>
        </div>

        {error && <p className="umbra-error" role="alert">{error}</p>}
        {artifacts === null && !error && <p className="umbra-muted">Loading…</p>}
        {artifacts?.length === 0 && (
          <p className="umbra-muted">No artifacts yet. Ask a Flicker to write a report, plan or guide.</p>
        )}

        <ul className="umbra-inbox">
          {artifacts?.map((a) => {
            const flame = flames[a.sourceId];
            return (
              <li
                key={a.id}
                className="umbra-report umbra-artifact"
                style={flame ? ({ '--bot-color': flameColor(flame) } as React.CSSProperties) : undefined}
              >
                <button type="button" className="umbra-report-head" onClick={() => show(a)}>
                  {flame ? <Flame flame={flame} size={40} still /> : <span className="umbra-artifact-icon" aria-hidden>📄</span>}
                  <span className="umbra-report-who">
                    <span className="umbra-report-title">{a.title}</span>
                    <span className="umbra-report-meta">
                      {a.kind === 'file' ? 'Refract file' : 'Document'} · {a.sourceName}
                      {a.sourceKind === 'team' && ' (team)'} · {when(a.updatedAt)} · {size(a.size)}
                    </span>
                  </span>
                  <span className="document-card-action">Open</span>
                </button>
                <div className="umbra-report-actions umbra-artifact-actions">
                  {flame && <Link href={chatLink(a)}>Chat with {a.sourceName}</Link>}
                  <button type="button" onClick={() => discard(a)}>Delete</button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {openDoc && <DocumentPanel {...openDoc} onClose={() => setOpenDoc(null)} />}
    </main>
  );
}
