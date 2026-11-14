'use client';

// Artifacts, shared by Lumen and Umbra, laid out like a chat assistant's artifacts:
//   - ReplyContent: a reply with each artifact shown as a card, with a symbol for its kind:
//     a paper page (document), a browser window (web page), the picture itself (SVG image),
//     boxes and arrows (diagram), an app window (React component), or an editor (code file).
//   - DocumentPanel: the artifact beside the chat (full screen on a phone). Documents show formatted,
//     web pages, diagrams and React components run in a sandboxed frame, images show as pictures,
//     code is highlighted. It has
//     Preview / Code views, version arrows when it was revised in the chat, Copy, and Download.
//   - documentVersions: every version of each artifact in a chat, oldest first.
//   - useArtifacts: the profile's saved artifacts for one app (lib/artifacts.ts), and opening one.

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageContent } from '@/components/MessageContent';
import { formatExtension, formatLabel, splitContent, type ArtifactFormat } from '@/lib/document-blocks';

export { splitContent, type ArtifactFormat };

/** What the artifacts API sends back for a list (mirrors lib/artifacts.ts, which is server-only). */
export interface ArtifactSummary {
  id: string;
  app: 'lumen' | 'umbra';
  /** 'document': a block in a reply. 'file': a file a Flicker wrote in Refract. */
  kind: 'document' | 'file';
  /** markdown (a document), html (a web page), svg (an image) or code. */
  format: ArtifactFormat;
  /** For code: its language. */
  language: string;
  sourceKind: 'chat' | 'bot' | 'team';
  sourceId: string;
  sourceName: string;
  title: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

/** An artifact open in the side panel. */
export interface OpenDocument {
  title: string;
  content: string;
  /** What it is; Markdown when not given. */
  format?: ArtifactFormat;
  language?: string;
  /** The file name to download as; made from the title when not given. */
  fileName?: string;
  /** Every version of this artifact in the chat, oldest first (content is one of them). */
  versions?: string[];
  /** A short line under the title, e.g. "Document · MD · from Corn". */
  subtitle?: string;
}

/** The download name for an artifact: a Refract file keeps its own name. */
export const artifactFileName = (a: Pick<ArtifactSummary, 'kind' | 'title'>): string | undefined =>
  a.kind === 'file' ? a.title.split('/').pop() : undefined;

/** Every version of each artifact in a chat's replies, by title, oldest first. */
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

/** An SVG as a picture address. As an <img>, any script inside it never runs. */
const svgSrc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// ---------------------------------------------------------------- icons (small places)
const Glyph = ({ size, children }: { size: number; children: React.ReactNode }) => (
  <svg className="document-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

/** The artifact symbol for small places (lists, buttons), one per kind. */
export const ArtifactIcon = ({ format = 'markdown', size = 18 }: { format?: ArtifactFormat; size?: number }) => {
  if (format === 'html') {
    return (
      <Glyph size={size}>
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <path d="M3 8.5h18" />
        <path d="M6 6.25h.01M8.5 6.25h.01" strokeWidth="2.2" />
        <path d="M10 12.5l-2 2 2 2M14 12.5l2 2-2 2" />
      </Glyph>
    );
  }
  if (format === 'svg') {
    return (
      <Glyph size={size}>
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <circle cx="9" cy="9.5" r="1.6" />
        <path d="M21 16l-5-5-8 9" />
      </Glyph>
    );
  }
  if (format === 'mermaid') {
    return (
      <Glyph size={size}>
        <rect x="3" y="3.5" width="7" height="5" rx="1.2" />
        <rect x="14" y="15.5" width="7" height="5" rx="1.2" />
        <rect x="14" y="3.5" width="7" height="5" rx="1.2" />
        <path d="M10 6h4M6.5 8.5v6a2.5 2.5 0 0 0 2.5 2.5h5" />
      </Glyph>
    );
  }
  if (format === 'react') {
    return (
      <Glyph size={size}>
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <path d="M3 8.5h18M9 8.5V20" />
        <rect x="12" y="11.5" width="6" height="3" rx="1.5" />
        <path d="M12 17.5h4" />
      </Glyph>
    );
  }
  if (format === 'code') {
    return (
      <Glyph size={size}>
        <path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 5l-3 14" />
      </Glyph>
    );
  }
  return (
    <Glyph size={size}>
      <path d="M14.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z" />
      <path d="M14.5 3v4.5H19" />
      <path d="M8.5 12.5h7M8.5 16h5" />
    </Glyph>
  );
};

/** The document symbol (kept for places that only ever show documents). */
export const DocumentIcon = ({ size = 18 }: { size?: number }) => <ArtifactIcon format="markdown" size={size} />;

// ---------------------------------------------------------------- thumbnails (cards)
type ThumbLine = { kind: 'heading' | 'text' | 'item' | 'rule'; width: number };

/** A few lines that sketch a document's shape: headings, paragraphs, list items. */
function sketch(content: string): ThumbLine[] {
  const lines: ThumbLine[] = [];
  const width = (text: string, min: number) => Math.max(min, Math.min(100, Math.round(text.length * 1.8)));
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || /^```|^~~~|^\|?[\s:-]+\|[\s|:-]*$/.test(line)) continue;
    if (/^#{1,6}\s/.test(line)) lines.push({ kind: 'heading', width: width(line, 35) * 0.75 });
    else if (/^([-*+]|\d+\.)\s/.test(line)) lines.push({ kind: 'item', width: width(line, 30) * 0.85 });
    else if (/^(-{3,}|\*{3,})$/.test(line)) lines.push({ kind: 'rule', width: 100 });
    else {
      // A long paragraph wraps onto a second line.
      if (line.length > 50) lines.push({ kind: 'text', width: 100 });
      lines.push({ kind: 'text', width: width(line.slice(50), 25) });
    }
    if (lines.length >= 7) break;
  }
  return lines.slice(0, 7);
}

/** The first color a page's CSS uses, to tint its little browser window. */
function pageAccent(html: string): string | null {
  const m = /(?:background(?:-color)?|color)\s*:\s*(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))/i.exec(html);
  return m && !/^#(fff|ffffff|000|000000)$/i.test(m[1]) ? m[1] : null;
}

/** A code file's first lines, as indented colored bars. */
function codeBars(code: string): { indent: number; width: number }[] {
  return code
    .split('\n')
    .filter((l) => l.trim())
    .slice(0, 7)
    .map((l) => ({ indent: Math.min(3, Math.floor((l.length - l.trimStart().length) / 2)), width: Math.max(25, Math.min(100, l.trim().length * 3)) }));
}

/** The card's picture: what the artifact looks like, in miniature. */
export const ArtifactThumb = ({ format = 'markdown', content }: { format?: ArtifactFormat; content: string }) => {
  if (format === 'html') {
    const accent = pageAccent(content);
    return (
      <span className="document-thumb is-html" aria-hidden="true">
        <span className="thumb-window" style={accent ? ({ '--thumb-accent': accent } as React.CSSProperties) : undefined}>
          <span className="thumb-window-bar"><i /><i /><i /></span>
          <span className="thumb-window-hero" />
          <span className="thumb-window-line" />
          <span className="thumb-window-line is-short" />
          <span className="thumb-window-tiles"><i /><i /></span>
        </span>
      </span>
    );
  }
  if (format === 'svg') {
    return (
      <span className="document-thumb is-svg" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: picture, not a file Next can optimise */}
        <img src={svgSrc(content)} alt="" />
      </span>
    );
  }
  if (format === 'mermaid') {
    // Boxes joined by arrows, the shape of a flowchart.
    return (
      <span className="document-thumb is-mermaid" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="100%" height="100%">
          <g fill="none" stroke="#9aa3b8" strokeWidth="1.4">
            <path d="M24 14v6M24 28v3M24 31H13v3M24 31h11v3" />
          </g>
          <rect x="15" y="6" width="18" height="8" rx="2" fill="#7c83ff" />
          <rect x="15" y="20" width="18" height="8" rx="4" fill="#5fe0a8" />
          <rect x="6" y="34" width="14" height="8" rx="2" fill="#ffb547" />
          <rect x="28" y="34" width="14" height="8" rx="2" fill="#ff6fd8" />
        </svg>
      </span>
    );
  }
  if (format === 'react') {
    // A little app: a side bar, a header, a switch and a button.
    return (
      <span className="document-thumb is-react" aria-hidden="true">
        <span className="thumb-app">
          <span className="thumb-app-side" />
          <span className="thumb-app-main">
            <span className="thumb-app-head" />
            <span className="thumb-app-row"><i className="thumb-app-switch" /><i /></span>
            <span className="thumb-app-row"><i className="thumb-app-button" /></span>
          </span>
        </span>
      </span>
    );
  }
  if (format === 'code') {
    return (
      <span className="document-thumb is-code" aria-hidden="true">
        <span className="thumb-code">
          {codeBars(content).map((b, i) => (
            <span key={i} className={`thumb-code-line c${i % 4}`} style={{ marginLeft: `${b.indent * 5}px`, width: `${b.width}%` }} />
          ))}
        </span>
      </span>
    );
  }
  return (
    <span className="document-thumb" aria-hidden="true">
      <span className="document-thumb-page">
        {sketch(content).map((l, i) => (
          <span key={i} className={`document-thumb-line is-${l.kind}`} style={{ width: `${l.width}%` }} />
        ))}
      </span>
    </span>
  );
};

/** The paper-page thumbnail for a document. */
export const DocumentThumb = ({ content }: { content: string }) => <ArtifactThumb format="markdown" content={content} />;

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

// ---------------------------------------------------------------- reply with artifact cards
interface DocumentCardProps {
  title: string;
  /** The artifact's text, drawn in miniature on the card. */
  content: string;
  format?: ArtifactFormat;
  language?: string;
  /** Which version this is, when it was revised in the chat. */
  version?: number;
  /** This artifact is the one open in the panel. */
  active?: boolean;
  onOpen: () => void;
}

export const DocumentCard = ({ title, content, format = 'markdown', language, version, active, onOpen }: DocumentCardProps) => {
  const label = formatLabel(format, language);
  return (
    <button type="button" className={`document-card ${active ? 'is-active' : ''}`} onClick={onOpen} aria-pressed={active}>
      <ArtifactThumb format={format} content={content} />
      <span className="document-card-text">
        <span className="document-card-title">{title}</span>
        <span className="document-card-subtitle">{version ? `Version ${version} · ${label.split(' · ')[1]}` : label}</span>
      </span>
    </button>
  );
};

interface ReplyContentProps {
  content: string;
  onOpen: (doc: OpenDocument) => void;
  /** documentVersions() of the whole chat, to label revisions and let the panel step through them. */
  versions?: Map<string, string[]>;
  /** The artifact open in the panel right now, to highlight its card. */
  open?: OpenDocument | null;
}

/** A reply in Markdown, with each artifact shown as a card that opens it beside the chat. */
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
          content={seg.content}
          format={seg.format}
          language={seg.language}
          version={list.length > 1 && at >= 0 ? at + 1 : undefined}
          active={open?.title === seg.title && open.content === seg.content}
          onOpen={() => onOpen({ title: seg.title, content: seg.content, format: seg.format, language: seg.language, versions: list })}
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

/** Code wrapped in a fence long enough that nothing inside can close it early. */
function fenced(code: string, language: string): string {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${code}\n${fence}`;
}

const MIME: Record<ArtifactFormat, string> = {
  markdown: 'text/markdown',
  html: 'text/html',
  svg: 'image/svg+xml',
  mermaid: 'text/plain',
  react: 'text/javascript',
  code: 'text/plain',
};

const DOWNLOAD_NAME: Record<ArtifactFormat, string> = {
  markdown: 'Markdown',
  html: 'HTML file',
  svg: 'SVG image',
  mermaid: 'Mermaid file',
  react: 'React component',
  code: 'File',
};

// ---------------------------------------------------------------- pages for the sandboxed frame
// Diagrams and React components run in the same sandboxed frame as web pages. These build the page
// for the frame: it loads its library from this app (app/api/artifact-runtime), then draws the
// artifact. Their text goes in as a JSON string, with "<" escaped so it can't end the script early.
const embed = (text: string) => JSON.stringify(text).replace(/</g, '\\u003c');
const RUNTIME = '/api/artifact-runtime';
const FRAME_HEAD = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`;
const FRAME_ERROR_STYLE = `.artifact-error{margin:16px;padding:12px 14px;border-radius:10px;background:#fff1f1;color:#9b1c1c;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap}`;
const FRAME_SHOW_ERROR = `function showError(title, err) {
  var box = document.createElement('div');
  box.className = 'artifact-error';
  box.textContent = title + '\\n\\n' + ((err && err.message) || String(err));
  document.body.replaceChildren(box);
}`;

function mermaidPage(code: string): string {
  return `${FRAME_HEAD}<style>html,body{margin:0;background:#fff;font-family:system-ui,sans-serif}
#diagram{display:flex;justify-content:center;padding:24px}#diagram svg{max-width:100%;height:auto}${FRAME_ERROR_STYLE}</style>
</head><body><div id="diagram"></div>
<script src="${RUNTIME}/mermaid.js"></script>
<script>${FRAME_SHOW_ERROR}
try {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
  mermaid.render('artifact-diagram', ${embed(code)})
    .then(function (out) { document.getElementById('diagram').innerHTML = out.svg; })
    .catch(function (err) { showError('This diagram has a mistake in it:', err); });
} catch (err) { showError('The diagram could not be drawn:', err); }
</script></body></html>`;
}

function reactPage(code: string): string {
  return `${FRAME_HEAD}<style>html,body{margin:0}${FRAME_ERROR_STYLE}</style>
<script src="${RUNTIME}/tailwind.js"></script>
</head><body><div id="root"></div>
<script src="${RUNTIME}/react.js"></script>
<script src="${RUNTIME}/react-dom.js"></script>
<script src="${RUNTIME}/babel.js"></script>
<script>${FRAME_SHOW_ERROR}
window.addEventListener('error', function (e) { showError('The component stopped with an error:', e.error || e.message); });
try {
  var compiled = Babel.transform(${embed(code)}, {
    filename: 'artifact.tsx',
    presets: [['env', { modules: 'commonjs' }], 'react', ['typescript', { isTSX: true, allExtensions: true }]],
  }).code;
  var libraries = { 'react': React, 'react-dom': ReactDOM, 'react-dom/client': ReactDOM };
  var require = function (name) {
    if (Object.prototype.hasOwnProperty.call(libraries, name)) return libraries[name];
    throw new Error('"' + name + '" isn\\'t available here. Components can use React (with its hooks) and Tailwind classes.');
  };
  var module = { exports: {} };
  new Function('require', 'module', 'exports', 'React', compiled)(require, module, module.exports, React);
  var App = module.exports.default || module.exports.App ||
    Object.keys(module.exports).map(function (k) { return module.exports[k]; }).filter(function (v) { return typeof v === 'function'; })[0];
  if (!App) throw new Error('The component needs "export default", e.g. export default function App() { … }');
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
} catch (err) { showError('The component could not run:', err); }
</script></body></html>`;
}

/** Which language to highlight in the Code view. */
const SOURCE_LANGUAGE: Partial<Record<ArtifactFormat, string>> = { html: 'html', svg: 'xml', mermaid: 'mermaid', react: 'jsx' };

/** The artifact beside the chat. A new artifact (or another version from the chat) starts fresh. */
export const DocumentPanel = (props: DocumentPanelProps) => <Panel key={`${props.title}\n${props.content}`} {...props} />;

const Panel = ({ title, content, format = 'markdown', language, fileName, versions, subtitle, onClose }: DocumentPanelProps) => {
  const list = versions?.length ? versions : [content];
  const [index, setIndex] = useState(() => Math.max(0, list.indexOf(content)));
  // Code files have only the code view.
  const [view, setView] = useState<'preview' | 'source'>(format === 'code' ? 'source' : 'preview');
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const shown = list[index] ?? content;
  const ext = formatExtension(format, language);

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

  const downloadFile = () => {
    setMenuOpen(false);
    const blob = new Blob([shown], { type: `${MIME[format]};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const base = title.replace(/\.[\w]+$/, '').replace(/[^\w\- ]+/g, '').trim() || 'artifact';
    a.download = fileName || `${base}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printPdf = () => {
    setMenuOpen(false);
    setView('preview');
    // Let the preview render before the print dialog takes its picture.
    setTimeout(() => window.print(), 50);
  };

  const meta = [list.length > 1 ? `Version ${index + 1} of ${list.length}` : null, subtitle ?? formatLabel(format, language)]
    .filter(Boolean)
    .join(' · ');

  let body: React.ReactNode;
  if (view === 'source') {
    body =
      format === 'markdown' ? (
        <pre className="document-source"><code>{shown}</code></pre>
      ) : (
        <div className="document-code">
          <MessageContent content={fenced(shown, SOURCE_LANGUAGE[format] ?? language ?? '')} />
        </div>
      );
  } else if (format === 'html') {
    // The page runs in a sandbox: its scripts work, but it can't reach this app, its cookies or its data.
    body = <iframe className="document-frame" title={title} sandbox="allow-scripts allow-modals allow-forms" srcDoc={shown} />;
  } else if (format === 'mermaid' || format === 'react') {
    // Same sandbox as a web page: it draws the diagram or runs the component, and nothing more.
    body = (
      <iframe
        className={`document-frame is-${format}`}
        title={title}
        sandbox="allow-scripts allow-modals allow-forms"
        srcDoc={format === 'mermaid' ? mermaidPage(shown) : reactPage(shown)}
      />
    );
  } else if (format === 'svg') {
    body = (
      <div className="document-image">
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: picture, not a file Next can optimise */}
        <img src={svgSrc(shown)} alt={title} />
      </div>
    );
  } else {
    body = (
      <article className="document-page">
        <MessageContent content={shown} />
      </article>
    );
  }

  return (
    <aside className={`document-panel is-${format}`} aria-label={`${formatLabel(format, language).split(' · ')[0]}: ${title}`}>
      <div className="document-panel-header">
        <button type="button" className="document-icon-button document-panel-close" onClick={onClose} aria-label="Close" title="Close">
          <CloseIcon />
        </button>
        <span className="document-panel-icon"><ArtifactIcon format={format} size={18} /></span>
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
        {format === 'code' ? (
          <span className="document-panel-language">{formatLabel(format, language).split(' · ')[1]}</span>
        ) : (
          <div className="document-toggle" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected={view === 'preview'} onClick={() => setView('preview')}>Preview</button>
            <button type="button" role="tab" aria-selected={view === 'source'} onClick={() => setView('source')}>
              {format === 'markdown' ? 'Markdown' : 'Code'}
            </button>
          </div>
        )}
        <div className="document-panel-actions">
          <button type="button" className="document-action" onClick={handleCopy}>{copied ? 'Copied' : 'Copy'}</button>
          <div className="document-menu" ref={menuRef}>
            <button type="button" className="document-action" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
              Download <Chevron dir="down" />
            </button>
            {menuOpen && (
              <div className="document-menu-list" role="menu">
                <button type="button" role="menuitem" onClick={downloadFile}>
                  {format === 'code' ? `${formatLabel(format, language).split(' · ')[1]} file` : DOWNLOAD_NAME[format]} (.{ext})
                </button>
                {format === 'markdown' && <button type="button" role="menuitem" onClick={printPdf}>PDF (print)</button>}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="document-panel-body">{body}</div>
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
        format: full.format,
        language: full.language || undefined,
        fileName: artifactFileName(full),
        subtitle: `${full.kind === 'file' ? `Refract file · ${formatLabel(full.format, full.language).split(' · ')[1]}` : formatLabel(full.format, full.language)} · from ${full.sourceName}`,
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
