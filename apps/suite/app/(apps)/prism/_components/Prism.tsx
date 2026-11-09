'use client';

// Prism's page: describe a picture, pick a style and shape, press Generate.
// It talks to the API routes from Step 3:
//   POST /api/prism/generate   make a picture
//   GET  /api/prism/images     your recent pictures

import { useEffect, useState } from 'react';
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
  url: string;
}

const styleName = (id: string) => PRISM_STYLES.find((s) => s.id === id)?.name ?? 'None';

const Prism = () => {
  // The form
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<string>(PRISM_STYLES[0].id);
  const [shape, setShape] = useState<(typeof SHAPES)[number]['id']>('square');

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

  const generate = async () => {
    if (!prompt.trim() || busy) return;
    const size = SHAPES.find((s) => s.id === shape)!;
    setBusy(true);
    setElapsed(0);
    setError('');
    try {
      const res = await fetch('/api/prism/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, style, width: size.width, height: size.height }),
      });
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
          <label className="prism-label" htmlFor="prism-prompt">Describe your picture</label>
          <textarea
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
            placeholder="a lighthouse on a sea cliff at night, stars, glowing beam"
            rows={4}
            maxLength={2000}
          />

          <label className="prism-label" htmlFor="prism-style">Art style</label>
          <select id="prism-style" className="prism-select" value={style} onChange={(e) => setStyle(e.target.value)}>
            {PRISM_STYLES.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

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

          <button type="submit" className="prism-generate" disabled={busy || !prompt.trim()}>
            {busy ? `Painting… ${elapsed.toFixed(1)}s` : 'Generate'}
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
                  {styleName(shown.style)} · {shown.width}×{shown.height}
                  {shown.seconds ? ` · ${shown.seconds.toFixed(1)}s` : ''}
                </span>
                <span className="prism-caption-actions">
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
