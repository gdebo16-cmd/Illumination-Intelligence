'use client';

import { useRef, type RefObject } from 'react';
import type { Source } from './types';

// The prompt box. Everything for one request lives inside it: the picture you start from
// (optional), what you type, the "+ Picture" button and the round Generate button (like the
// message box in Lumen). You can also drop a picture onto it.
export default function PromptBox({
  promptBox,
  source,
  setSource,
  animating,
  editing,
  prompt,
  setPrompt,
  generate,
  pickFile,
  busy,
  buttonText,
}: {
  promptBox: RefObject<HTMLTextAreaElement | null>;
  source: Source | null;
  setSource: (source: Source | null) => void;
  animating: boolean;
  editing: boolean;
  prompt: string;
  setPrompt: (text: string) => void;
  generate: () => Promise<void>;
  pickFile: (file: File | undefined) => void;
  busy: boolean;
  buttonText: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`prism-prompt-box ${source ? 'has-picture' : ''}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        pickFile(e.dataTransfer.files[0]);
      }}
    >
      {source && (
        <div className="prism-attached">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local preview or one of our own pictures */}
          <img src={source.kind === 'upload' ? source.preview : source.image.url} alt="The starting picture" />
          <span className="prism-attached-text">
            {source.kind === 'upload' ? source.file.name : 'One of your pictures'}
            <span>{animating ? 'Prism will bring it to life.' : 'Prism will change it the way you describe.'}</span>
          </span>
          <button type="button" className="prism-attached-remove" onClick={() => setSource(null)} aria-label="Remove the picture">
            ✕
          </button>
        </div>
      )}
      <textarea
        ref={promptBox}
        id="prism-prompt"
        className="prism-prompt"
        aria-label={animating ? 'What should move?' : editing ? 'What should change?' : 'Describe your picture'}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          // Ctrl+Enter (or Cmd+Enter on a Mac) generates without reaching for the mouse.
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void generate();
          }
        }}
        placeholder={
          animating
            ? 'What should move? e.g. the waves roll in, the lighthouse beam sweeps across the sea'
            : editing
              ? 'What should change? e.g. make it nighttime, with a full moon'
              : 'Describe your picture, e.g. a lighthouse on a sea cliff at night, stars, glowing beam'
        }
        rows={4}
        maxLength={2000}
      />
      <button
        type="button"
        className="prism-attach"
        onClick={() => fileInput.current?.click()}
        title="Add a picture to edit or animate (or drop one here)"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M21 16l-5-5-8 8" />
        </svg>
        {source ? 'Change picture' : 'Add a picture'}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          pickFile(e.target.files?.[0]);
          e.target.value = ''; // so picking the same file again still counts
        }}
      />
      <button type="submit" className="prism-generate" disabled={busy || !prompt.trim()} aria-label={buttonText} title={buttonText}>
        {busy ? (
          <span className="prism-spinner" aria-hidden="true" />
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        )}
      </button>
    </div>
  );
}
