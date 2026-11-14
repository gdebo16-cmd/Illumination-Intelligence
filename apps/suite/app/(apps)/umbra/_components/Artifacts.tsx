'use client';

// /umbra/artifacts — what your Flickers and teams have made (documents, web pages, images, code):
// <document> blocks from chats and task reports, and .md files a Flicker wrote in Refract.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArtifactThumb, DocumentPanel, useArtifacts, type ArtifactSummary, type OpenDocument } from '@/components/documents';
import { formatArtifactSize, formatLabel } from '@/lib/document-blocks';
import type { Bot, Team } from './types';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function Artifacts({ source }: { source?: string }) {
  const { artifacts, error, open, remove } = useArtifacts('umbra', source);
  const [openDoc, setOpenDoc] = useState<OpenDocument | null>(null);
  // Known Flickers and teams, so a card can offer a link back to their chat.
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
            What your Flickers made: documents, web pages, images, diagrams, React components and code from chats and task reports,
            and .md, .html, .svg and .mmd files they wrote in Refract. Making one again with the same name updates it.
          </p>
        </div>

        {error && <p className="umbra-error" role="alert">{error}</p>}
        {artifacts === null && !error && <p className="umbra-muted">Loading…</p>}
        {artifacts?.length === 0 && (
          <p className="umbra-muted">No artifacts yet. Ask a Flicker to write a report, build a web page or draw a logo.</p>
        )}

        <ul className="umbra-inbox">
          {artifacts?.map((a) => {
            const flame = flames[a.sourceId];
            const kindLabel = a.kind === 'file'
              ? `Refract file · ${formatLabel(a.format, a.language).split(' · ')[1]}`
              : formatLabel(a.format, a.language);
            const meta = `${kindLabel} · ${formatArtifactSize(a.size)}`;
            return (
              <li key={a.id} className="umbra-artifact">
                <button type="button" className={`document-card is-${a.format}`} onClick={() => show(a)}>
                  <ArtifactThumb format={a.format} />
                  <span className="document-card-text">
                    <span className="document-card-title">{a.title}</span>
                    <span className="document-card-subtitle">{meta}</span>
                    <span className="document-card-origin">
                      {a.sourceName}{a.sourceKind === 'team' ? ' (team)' : ''} · {when(a.updatedAt)}
                    </span>
                  </span>
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
