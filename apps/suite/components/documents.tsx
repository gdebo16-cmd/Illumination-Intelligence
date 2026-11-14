'use client';

// Documents and artifacts, shared by Lumen and Umbra. Laid out like a chat assistant's artifacts:
//   - ReplyContent: a reply with each document shown as a card (icon, title, kind or version).
//   - DocumentPanel: the document beside the chat (full screen on a phone), with Preview / Markdown,
//     version arrows when it was revised in the chat, Copy, and a Download menu (.md or PDF).
//   - documentVersions: every version of each document in a chat, oldest first.
//   - useArtifacts: the profile's saved artifacts for one app (lib/artifacts.ts), and opening one.

import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Every version of this document in the chat, oldest first (content is one of them). */
  versions?: string[];
  /** A short line under the title, e.g. "From Corn". */
  subtitle?: string;
}

/** The download name for an artifact: a Refract file keeps its own name. */
export const artifactFileName = (a: Pick<ArtifactSummary, 'kind' | 'title'>): string | undefined =>
  a.kind === 'file' ? a.title.split('/').pop() : undefined;

/** Every version of each document in a chat's replies, by title, oldest first. */
export function documentVersions(replies: string[]): Map<string, string[]> {
  const versions = new Map<string, string[]>();
  for (const reply of replies) {
    if (!reply) continue;
    for (const seg of splitContent(reply)) {
      if (seg.type !== 'document') continue;
      const list = versions.get(seg.title) ?? [];
      if (list[list.length - 1] !== seg.content) list.push(seg.content);
      versions.set(seg.title, list);
    }
  }
  return versions;
}

// ---------------------------------------------------------------- icons
const DocIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
);
const Chevron = ({ dir }: { dir: 'left' | 'right' | 'down' }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={dir === 'left' ? 'M15 6l-6 6 6 6' : dir === 'right' ? 'M9 6l6 6-6 6' : 'M6 9l6 6 6-6'} />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

// ---------------------------------------------------------------- reply with document cards
interface DocumentCardProps {
  title: string;
  /** Under the title: "Document · Markdown", or "Version 2" for a revision. */
  subtitle?: string;
  /** This document is the one open in the panel. */
  active?: boolean;
  onOpen: () => void;
}

export const DocumentCard = ({ title, subtitle = 'Document · Markdown', active, onOpen }: DocumentCardProps) => (
  <button type="button" className={`document-card ${active ? 'is-active' : ''}`} onClick={onOpen} aria-pressed={active}>
    <span className="document-card-icon"><DocIcon /></span>
    <span className="document-card-text">
      <span className="document-card-title">{title}</span>
      <span className="document-card-subtitle">{subtitle}</span>
    </span>
  </button>
);

interface ReplyContentProps {
  content: string;
  onOpen: (doc: OpenDocument) => void;
  /** documentVersions() of the whole chat, to label revisions and let the panel step through them. */
  versions?: Map<string, string[]>;
  /** The document open in the panel right now, to highlight its card. */
  open?: OpenDocument | null;
}

/** A reply in Markdown, with each document shown as a card that opens it beside the chat. */
export const ReplyContent = ({ content, onOpen, versions, open }: ReplyContentProps) => (
  <>
    {splitContent(content).map((seg, i) => {
      if (seg.type === 'text') return <MessageContent key={i} content={seg.text} />;
      const list = versions?.get(seg.title) ?? [seg.content];
      const at = list.indexOf(seg.content);
      return (
        <DocumentCard
          key={i}
          title={seg.title}
          subtitle={list.length > 1 && at >= 0 ? `Version ${at + 1} · Markdown` : undefined}
          active={open?.title === seg.title && open.content === seg.content}
          onOpen={() => onOpen({ title: seg.title, content: seg.content, versions: list })}
        />
      );
    })}
  </>
);

// ---------------------------------------------------------------- side panel
interface DocumentPanelProps extends OpenDocument {
  onClose: () => void;
}

async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

/** The document beside the chat. A new document (or another version from the chat) starts fresh. */
export const DocumentPanel = (props: DocumentPanelProps) => <Panel key={`${props.title}\n${props.content}`} {...props} />;

const Panel = ({ title, content, fileName, versions, subtitle, onClose }: DocumentPanelProps) => {
  const list = versions?.length ? versions : [content];
  const [index, setIndex] = useState(() => Math.max(0, list.indexOf(content)));
  const [view, setView] = useState<'preview' | 'source'>('preview');
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const shown = list[index] ?? content;

  // Escape closes the menu, or else the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menuOpen) setMenuOpen(false);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, menuOpen]);

  // A tap outside the Download menu closes it.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menuOpen]);

  const handleCopy = async () => {
    try {
      await copyText(shown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Copy failed', err);
    }
  };

  const downloadMarkdown = () => {
    setMenuOpen(false);
    const blob = new Blob([shown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || `${title.replace(/[^\w\- ]+/g, '').trim() || 'document'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printPdf = () => {
    setMenuOpen(false);
    setView('preview');
    // Let the preview render before the print dialog takes its picture.
    setTimeout(() => window.print(), 50);
  };

  const meta = [list.length > 1 ? `Version ${index + 1} of ${list.length}` : null, subtitle ?? 'Markdown'].filter(Boolean).join(' · ');

  return (
    <aside className="document-panel" aria-label={`Document: ${title}`}>
      <div className="document-panel-header">
        <button type="button" className="document-icon-button document-panel-close" onClick={onClose} aria-label="Close document" title="Close">
          <CloseIcon />
        </button>
        <div className="document-panel-heading">
          <h2 className="document-panel-title">{title}</h2>
          <span className="document-panel-meta">{meta}</span>
        </div>
        {list.length > 1 && (
          <div className="document-versions" role="group" aria-label="Versions">
            <button type="button" className="document-icon-button" onClick={() => setIndex((i) => i - 1)} disabled={index === 0} aria-label="Previous version" title="Previous version">
              <Chevron dir="left" />
            </button>
            <button type="button" className="document-icon-button" onClick={() => setIndex((i) => i + 1)} disabled={index === list.length - 1} aria-label="Next version" title="Next version">
              <Chevron dir="right" />
            </button>
          </div>
        )}
      </div>

      <div className="document-panel-toolbar">
        <div className="document-toggle" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === 'preview'} onClick={() => setView('preview')}>Preview</button>
          <button type="button" role="tab" aria-selected={view === 'source'} onClick={() => setView('source')}>Markdown</button>
        </div>
        <div className="document-panel-actions">
          <button type="button" className="document-action" onClick={handleCopy}>{copied ? 'Copied' : 'Copy'}</button>
          <div className="document-menu" ref={menuRef}>
            <button type="button" className="document-action" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
              Download <Chevron dir="down" />
            </button>
            {menuOpen && (
              <div className="document-menu-list" role="menu">
                <button type="button" role="menuitem" onClick={downloadMarkdown}>Markdown (.md)</button>
                <button type="button" role="menuitem" onClick={printPdf}>PDF (print)</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="document-panel-body">
        {view === 'preview' ? (
          <article className="document-page">
            <MessageContent content={shown} />
          </article>
        ) : (
          <pre className="document-source"><code>{shown}</code></pre>
        )}
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
      return {
        title: full.title,
        content: full.content,
        fileName: artifactFileName(full),
        subtitle: `${full.kind === 'file' ? 'Refract file' : 'Markdown'} · from ${full.sourceName}`,
      };
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
