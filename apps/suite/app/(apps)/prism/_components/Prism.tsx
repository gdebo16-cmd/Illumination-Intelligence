'use client';

// Prism's page: describe a picture, pick a style and shape, press Generate.
// Or start from a picture (upload one, or "Edit this" on one of yours) and say what to change.
// It talks to the API routes from Step 3:
//   POST /api/prism/generate   make a picture, or edit one
//   GET  /api/prism/images     your recent pictures

import { useEffect, useRef, useState } from 'react';
import { PRISM_STYLES } from '@/config/prism-styles';

// The shapes you can pick. Sizes are in steps of 16 pixels, as the model needs.
const SHAPES = [
  { id: 'square', name: 'Square', width: 1024, height: 1024 },
  { id: 'portrait', name: 'Portrait', width: 832, height: 1216 },
  { id: 'landscape', name: 'Landscape', width: 1216, height: 832 },
  { id: 'phone', name: 'Phone', width: 768, height: 1344 },
] as const;

// What the API sends back for each picture.
interface PrismImage {
  id: string;
  prompt: string;
  style: string;
  seed: number;
  width: number;
  height: number;
  seconds: number | null;
  mode?: 'create' | 'edit';
  sourceId?: string | null;
  url: string;
}

// The picture to edit: a file from your device, or one of your Prism pictures.
type Source =
  | { kind: 'upload'; file: File; preview: string }
  | { kind: 'image'; image: PrismImage };

const styleName = (id: string) => PRISM_STYLES.find((s) => s.id === id)?.name ?? 'None';

const Prism = () => {
  // The form
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<string>(PRISM_STYLES[0].id);
  const [shape, setShape] = useState<(typeof SHAPES)[number]['id']>('square');
  const [source, setSource] = useState<Source | null>(null);
  const editing = source !== null;
  const fileInput = useRef<HTMLInputElement>(null);
  const promptBox = useRef<HTMLTextAreaElement>(null);

  // What's happening
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');

  // Pictures: the one shown big, and the recent list
  const [images, setImages] = useState<PrismImage[]>([]);
  const [shown, setShown] = useState<PrismImage | null>(null);

  // Load your recent pictures when the page opens.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/prism/images')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: PrismImage[]) => {
        if (cancelled) return;
        setImages(list);
        setShown((current) => current ?? list[0] ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // While generating, count the seconds so you can see it's working.
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 100);
    return () => clearInterval(timer);
  }, [busy]);

  // A preview of an uploaded file is a temporary browser address; free it when it's replaced.
  useEffect(() => {
    if (source?.kind !== 'upload') return;
    const url = source.preview;
    return () => URL.revokeObjectURL(url);
  }, [source]);

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('That isn’t a picture. Try a PNG, JPEG or WebP.');
      return;
    }
    setError('');
    setSource({ kind: 'upload', file, preview: URL.createObjectURL(file) });
  };

  // "Edit this" on the big picture: it becomes the starting picture, ready for an instruction.
  const editThis = (image: PrismImage) => {
    setSource({ kind: 'image', image });
    setPrompt('');
    setError('');
    promptBox.current?.focus();
    promptBox.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const generate = async () => {
    if (!prompt.trim() || busy) return;
    const size = SHAPES.find((s) => s.id === shape)!;
    setBusy(true);
    setElapsed(0);
    setError('');
    try {
      let request: RequestInit;
      if (source?.kind === 'upload') {
        // A file goes as a form, the way a browser uploads attachments.
        const form = new FormData();
        form.append('prompt', prompt);
        form.append('style', style);
        form.append('image', source.file);
        request = { method: 'POST', body: form };
      } else {
        request = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            source?.kind === 'image'
              ? { prompt, style, sourceId: source.image.id }
              : { prompt, style, width: size.width, height: size.height },
          ),
        };
      }
      const res = await fetch('/api/prism/generate', request);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}).`);
      setImages((list) => [data, ...list]);
      setShown(data);
    } catch (err) {
      setError((err as Error).message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  // Put a past picture's prompt, style and shape back into the form.
  const reuse = (image: PrismImage) => {
    setPrompt(image.prompt);
    setStyle(image.style);
    // For an edit, bring back the picture it started from too (if it's still in your list).
    const from = image.mode === 'edit' && image.sourceId ? images.find((i) => i.id === image.sourceId) : undefined;
    setSource(from ? { kind: 'image', image: from } : null);
    const match = SHAPES.find((s) => s.width === image.width && s.height === image.height);
    if (match) setShape(match.id);
  };

  return (
    <main className="prism">
      <div className="prism-workspace">
        {/* ---------------------------------------------------------- controls */}
        <form
          className="prism-controls"
          onSubmit={(e) => {
            e.preventDefault();
            void generate();
          }}
        >
          {/* Optional: a picture to start from */}
          <span className="prism-label" id="prism-source-label">
            Start from a picture <span className="prism-optional">(optional)</span>
          </span>
          <div
            className={`prism-source ${source ? 'has-picture' : ''}`}
            role="group"
            aria-labelledby="prism-source-label"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pickFile(e.dataTransfer.files[0]);
            }}
          >
            {source ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- a local preview or one of our own pictures */}
                <img src={source.kind === 'upload' ? source.preview : source.image.url} alt="The picture to edit" />
                <span className="prism-source-text">
                  {source.kind === 'upload' ? source.file.name : 'One of your pictures'}
                  <span>Prism will change it the way you describe.</span>
                </span>
                <button type="button" className="prism-source-remove" onClick={() => setSource(null)} aria-label="Remove the picture">
                  ✕
                </button>
              </>
            ) : (
              <button type="button" className="prism-source-add" onClick={() => fileInput.current?.click()}>
                + Add a picture to edit
                <span>or drop one here</span>
              </button>
            )}
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
          </div>

          <label className="prism-label" htmlFor="prism-prompt">{editing ? 'What should change?' : 'Describe your picture'}</label>
          <textarea
            ref={promptBox}
            id="prism-prompt"
            className="prism-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              // Ctrl+Enter (or Cmd+Enter on a Mac) generates without reaching for the mouse.
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void generate();
              }
            }}
            placeholder={editing ? 'make it nighttime, with a full moon' : 'a lighthouse on a sea cliff at night, stars, glowing beam'}
            rows={4}
            maxLength={2000}
          />

          <label className="prism-label" htmlFor="prism-style">Art style</label>
          <select id="prism-style" className="prism-select" value={style} onChange={(e) => setStyle(e.target.value)}>
            {PRISM_STYLES.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          {editing ? (
            <p className="prism-note">The result keeps your picture’s shape.</p>
          ) : (
            <>
              <span className="prism-label" id="prism-shape-label">Shape</span>
              <div className="prism-shapes" role="radiogroup" aria-labelledby="prism-shape-label">
                {SHAPES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={shape === s.id}
                    className="prism-shape"
                    onClick={() => setShape(s.id)}
                  >
                    {/* A little outline in the shape's proportions */}
                    <span className="prism-shape-icon" style={{ aspectRatio: `${s.width} / ${s.height}` }} />
                    {s.name}
                  </button>
                ))}
              </div>
            </>
          )}

          <button type="submit" className="prism-generate" disabled={busy || !prompt.trim()}>
            {busy ? `${editing ? 'Editing' : 'Painting'}… ${elapsed.toFixed(1)}s` : editing ? 'Edit picture' : 'Generate'}
          </button>
          {error && <p className="prism-error" role="alert">{error}</p>}
        </form>

        {/* ---------------------------------------------------------- the picture */}
        <section className="prism-stage" aria-live="polite">
          {shown ? (
            <figure className="prism-result">
              {/* eslint-disable-next-line @next/next/no-img-element -- generated pictures, served by our own API */}
              <img src={shown.url} alt={shown.prompt} width={shown.width} height={shown.height} className={busy ? 'is-busy' : ''} />
              <figcaption>
                <span className="prism-caption-text">{shown.prompt}</span>
                <span className="prism-caption-meta">
                  {shown.mode === 'edit' ? 'Edit · ' : ''}{styleName(shown.style)} · {shown.width}×{shown.height}
                  {shown.seconds ? ` · ${shown.seconds.toFixed(1)}s` : ''}
                </span>
                <span className="prism-caption-actions">
                  <button type="button" onClick={() => editThis(shown)}>Edit this</button>
                  <button type="button" onClick={() => reuse(shown)}>Reuse settings</button>
                  <a href={shown.url} download={`prism-${shown.id.slice(0, 8)}.png`}>Download</a>
                </span>
              </figcaption>
            </figure>
          ) : (
            <div className="prism-empty">
              {busy ? 'Painting your first picture…' : 'Your pictures will appear here.'}
            </div>
          )}
        </section>
      </div>

      {/* ---------------------------------------------------------- recent pictures */}
      {images.length > 0 && (
        <nav className="prism-recent" aria-label="Recent pictures">
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              className="prism-thumb"
              aria-current={shown?.id === image.id}
              title={image.prompt}
              onClick={() => setShown(image)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- small thumbnails of our own pictures */}
              <img src={image.url} alt={image.prompt} loading="lazy" />
            </button>
          ))}
        </nav>
      )}
    </main>
  );
};

export default Prism;
