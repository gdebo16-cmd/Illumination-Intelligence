'use client';

// Documents and artifacts, shared by Lumen and Umbra.
//   - ReplyContent: a reply with its <document> blocks shown as cards (lib/document-blocks.ts).
//   - DocumentPanel: the side panel that shows one document, with Copy, Download .md and Print.
//   - useArtifacts: the profile's saved artifacts for one app (lib/artifacts.ts), and opening one.

import { useCallback, useEffect, useState } from 'react';
import { MessageContent } from '@/components/MessageContent';
import { splitContent } from '@/lib/document-blocks';

export { splitContent };

/** What the artifacts API sends back for a list (mirrors lib/artifacts.ts, which is server-only). */
export interface ArtifactSummary {
  id: string;
  app: 'lumen' | 'umbra';
  /** 'document': a <document> block in a reply. 'file': a .md file a Flicker wrote in Refract. */
  kind: 'document' | 'file';
  sourceKind: 'chat' | 'bot' | 'team';
  sourceId: string;
  sourceName: string;
  title: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

/** A document open in the side panel. */
export interface OpenDocument {
  title: string;
  content: string;
  /** The file name to download as; made from the title when not given. */
  fileName?: string;
}

/** The download name for an artifact: a Refract file keeps its own name. */
export const artifactFileName = (a: Pick<ArtifactSummary, 'kind' | 'title'>): string | undefined =>
  a.kind === 'file' ? a.title.split('/').pop() : undefined;

// ---------------------------------------------------------------- reply with document cards
export const DocumentCard = ({ title, onOpen }: { title: string; onOpen: () => void }) => (
  <button type="button" className="document-card" onClick={onOpen}>
    <span className="document-card-icon" aria-hidden>📄</span>
    <span className="document-card-title">{title}</span>
    <span className="document-card-action">Open</span>
  </button>
);

/** A reply in Markdown, with each document block shown as a card that opens it. */
export const ReplyContent = ({ content, onOpen }: { content: string; onOpen: (doc: OpenDocument) => void }) => (
  <>
    {splitContent(content).map((seg, i) =>
      seg.type === 'text' ? (
        <MessageContent key={i} content={seg.text} />
      ) : (
        <DocumentCard key={i} title={seg.title} onOpen={() => onOpen({ title: seg.title, content: seg.content })} />
      ),
    )}
  </>
);

// ---------------------------------------------------------------- side panel
interface DocumentPanelProps extends OpenDocument {
  onClose: () => void;
}

export const DocumentPanel = ({ title, content, fileName, onClose }: DocumentPanelProps) => {
  const [copied, setCopied] = useState(false);

  // Escape closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(content);
      } else {
        const ta = document.createElement('textarea');
        ta.value = content;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Copy failed', err);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || `${title.replace(/[^\w\- ]+/g, '').trim() || 'document'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className="document-panel" aria-label={`Document: ${title}`}>
      <div className="document-panel-header">
        <h2 className="document-panel-title">{title}</h2>
        <div className="document-panel-actions">
          <button type="button" onClick={handleCopy}>{copied ? 'Copied' : 'Copy'}</button>
          <button type="button" onClick={handleDownload}>Download .md</button>
          <button type="button" onClick={() => window.print()}>Print / PDF</button>
          <button type="button" onClick={onClose} aria-label="Close document">✕</button>
        </div>
      </div>
      <div className="document-panel-body">
        <MessageContent content={content} />
      </div>
    </aside>
  );
};

// ---------------------------------------------------------------- saved artifacts
/**
 * The profile's artifacts in one app (optionally only one chat's, Flicker's or team's), newest
 * first. `open` loads one's full text for the DocumentPanel.
 */
async function fetchArtifacts(app: 'lumen' | 'umbra', source?: string): Promise<ArtifactSummary[]> {
  const query = new URLSearchParams({ app });
  if (source) query.set('source', source);
  const res = await fetch(`/api/artifacts?${query}`, { cache: 'no-store' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not load artifacts.');
  return res.json();
}

export function useArtifacts(app: 'lumen' | 'umbra', source?: string) {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[] | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setArtifacts(await fetchArtifacts(app, source));
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  }, [app, source]);

  useEffect(() => {
    let cancelled = false;
    fetchArtifacts(app, source)
      .then((list) => {
        if (!cancelled) setArtifacts(list);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [app, source]);

  const open = useCallback(async (artifact: ArtifactSummary): Promise<OpenDocument | null> => {
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}`, { cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not open that artifact.');
      const full = (await res.json()) as ArtifactSummary & { content: string };
      return { title: full.title, content: full.content, fileName: artifactFileName(full) };
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, []);

  const remove = useCallback(async (artifact: ArtifactSummary) => {
    const res = await fetch(`/api/artifacts/${artifact.id}`, { method: 'DELETE' }).catch(() => null);
    // 404 means it is already gone, so drop it from the list either way.
    if (res && (res.ok || res.status === 404)) setArtifacts((list) => list?.filter((a) => a.id !== artifact.id) ?? null);
  }, []);

  return { artifacts, error, refresh, open, remove };
}
