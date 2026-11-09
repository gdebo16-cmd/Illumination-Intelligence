'use client';

import { useState } from 'react';
import { MessageContent } from './MessageContent';

// ---------------------------------------------------------------- prompt
// Append this to the system prompt in /api/chat so the model knows the format.
export const DOCUMENT_SYSTEM_PROMPT = `When the user asks you to write something substantial they will keep or reuse (a report, plan, letter, essay, README, guide, spec), put it in a document block instead of the chat text:

<document title="Short descriptive title">
...the full document in Markdown...
</document>

Rules:
- Put only the document inside the block. Add one or two sentences of normal text before or after it.
- Never put code snippets, quick answers, or short replies in a document block.
- To revise a document, output a new block with the same title containing the full updated text.
- Do not use document blocks for anything under about 150 words.`;

// ---------------------------------------------------------------- parsing
export type Segment =
  | { type: 'text'; text: string }
  | { type: 'document'; title: string; content: string };

const DOC_RE = /<document\s+title="([^"]*)"\s*>([\s\S]*?)<\/document>/g;

export const splitContent = (content: string): Segment[] => {
  const segments: Segment[] = [];
  let last = 0;

  for (const match of content.matchAll(DOC_RE)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ type: 'text', text: content.slice(last, index) });
    segments.push({ type: 'document', title: match[1] || 'Untitled', content: match[2].trim() });
    last = index + match[0].length;
  }
  if (last < content.length) segments.push({ type: 'text', text: content.slice(last) });

  return segments.filter((s) => s.type === 'document' || s.text.trim().length > 0);
};

// ---------------------------------------------------------------- UI
export const DocumentCard = ({ title, onOpen }: { title: string; onOpen: () => void }) => (
  <button type="button" className="document-card" onClick={onOpen}>
    <span className="document-card-icon" aria-hidden>📄</span>
    <span className="document-card-title">{title}</span>
    <span className="document-card-action">Open</span>
  </button>
);

interface DocumentPanelProps {
  title: string;
  content: string;
  onClose: () => void;
}

export const DocumentPanel = ({ title, content, onClose }: DocumentPanelProps) => {
  const [copied, setCopied] = useState(false);

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
    a.download = `${title.replace(/[^\w\- ]+/g, '').trim() || 'document'}.md`;
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
