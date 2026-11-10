'use client';

// Prism's page: describe a picture, pick a model, style and shape, press Generate.
// Or start from a picture (upload one, or "Edit this" on one of yours) and either say what to
// change, or bring it to life as a short video ("Make video").
// It talks to these API routes:
//   POST /api/prism/generate   make a picture, or edit one
//   GET  /api/prism/images     your recent pictures
//   GET  /api/prism/models     the picture models, and whether each one is downloaded yet
//   POST /api/prism/videos     start a video (it's made in the background)
//   GET  /api/prism/videos     your videos, and the length choices with their usual wait

import { useEffect, useRef, useState } from 'react';
import { PRISM_STYLES } from '@/config/prism-styles';
import { DEFAULT_PRISM_MODEL, PRISM_MODELS, findPrismModel } from '@/config/prism-models';
import QueueNotice from '@/components/QueueNotice';

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
  model?: string;
  expandedPrompt?: string | null;
  mode?: 'create' | 'edit';
  sourceId?: string | null;
  createdAt: string;
  url: string;
}

// A picture model in the dropdown. `ready` is false until its files are in ComfyUI;
// `expands` is true when it has a prompt expander (the "Expand my prompt" switch).
interface ModelChoice {
  id: string;
  name: string;
  note: string;
  expands: boolean;
  ready: boolean;
}

// ...and for each video.
interface PrismVideo {
  id: string;
  imageId: string | null;
  prompt: string;
  length: string;
  frames: number;
  width: number;
  height: number;
  status: 'working' | 'done' | 'failed';
  error: string | null;
  seconds: number | null;
  createdAt: string;
  url: string;
  poster: string;
}

// A video length you can pick, with how long it usually takes to make (`wait`, in seconds).
// `runs` is how many videos that average comes from; 0 means it's still a first guess.
interface LengthChoice {
  id: string;
  name: string;
  seconds: number;
  wait: number;
  runs: number;
}

// Until the server answers, show the first guesses (the same ones as lib/prism/video.ts).
const FIRST_GUESS: LengthChoice[] = [
  { id: 'short', name: 'Short', seconds: 2, wait: 150, runs: 0 },
  { id: 'medium', name: 'Medium', seconds: 3, wait: 240, runs: 0 },
  { id: 'long', name: 'Long', seconds: 5, wait: 450, runs: 0 },
];

// The picture to start from: a file from your device, or one of your Prism pictures.
type Source =
  | { kind: 'upload'; file: File; preview: string }
  | { kind: 'image'; image: PrismImage };

// What to do with that picture.
type Make = 'edit' | 'video';

// What's shown big on the stage.
type Shown = { kind: 'image'; id: string } | { kind: 'video'; id: string };

const styleName = (id: string) => PRISM_STYLES.find((s) => s.id === id)?.name ?? 'None';

/** 150 → "about 2½ min", 45 → "about 50 sec". */
function aboutTime(seconds: number): string {
  if (seconds < 90) return `about ${Math.max(10, Math.round(seconds / 10) * 10)} sec`;
  const halves = Math.round(seconds / 30); // in half minutes
  const whole = Math.floor(halves / 2);
  return `about ${whole}${halves % 2 ? '½' : ''} min`;
}

/** 83 → "1:23". */
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

const Prism = () => {
  // The form
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<string>(DEFAULT_PRISM_MODEL);
  // Until the server says which models are downloaded, list them all as ready.
  const [models, setModels] = useState<ModelChoice[]>(() => PRISM_MODELS.map((m) => ({ ...m, ready: true })));
  const pickedModel = models.find((m) => m.id === model);
  // The prompt expander's switch. It only does something for a model that has one (FLUX.3).
  const [expand, setExpand] = useState(true);
  const [style, setStyle] = useState<string>(PRISM_STYLES[0].id);
  const [shape, setShape] = useState<(typeof SHAPES)[number]['id']>('square');
  const [source, setSource] = useState<Source | null>(null);
  const [make, setMake] = useState<Make>('edit');
  const [length, setLength] = useState('short');
  const editing = source !== null && make === 'edit';
  const animating = source !== null && make === 'video';
  const fileInput = useRef<HTMLInputElement>(null);
  const promptBox = useRef<HTMLTextAreaElement>(null);

  // What's happening
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  // Pictures and videos, and which one is shown big
  const [images, setImages] = useState<PrismImage[]>([]);
  const [videos, setVideos] = useState<PrismVideo[]>([]);
  const [lengths, setLengths] = useState<LengthChoice[]>(FIRST_GUESS);
  const [shown, setShown] = useState<Shown | null>(null);
  const shownImage = shown?.kind === 'image' ? images.find((i) => i.id === shown.id) : undefined;
  const shownVideo = shown?.kind === 'video' ? videos.find((v) => v.id === shown.id) : undefined;
  const anyWorking = videos.some((v) => v.status === 'working');

  // Load your recent pictures and videos when the page opens.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/prism/images')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: PrismImage[]) => {
        if (cancelled) return;
        setImages(list);
        setShown((current) => current ?? (list[0] ? { kind: 'image', id: list[0].id } : null));
      })
      .catch(() => {});
    // Which picture models are downloaded? (The ones that aren't get greyed out.)
    fetch('/api/prism/models')
      .then((res) => (res.ok ? res.json() : null))
      .then((list: ModelChoice[] | null) => {
        if (!cancelled && list?.length) setModels(list);
      })
      .catch(() => {});
    loadVideos();
    return () => {
      cancelled = true;
    };
  }, []);

  function loadVideos() {
    fetch('/api/prism/videos')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { videos: PrismVideo[]; lengths: LengthChoice[] } | null) => {
        if (!data) return;
        setVideos(data.videos);
        setLengths(data.lengths);
      })
      .catch(() => {});
  }

  // While a video is being made, check on it every few seconds, and tick the clock every second.
  useEffect(() => {
    if (!anyWorking) return;
    const check = setInterval(loadVideos, 4000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(check);
      clearInterval(tick);
    };
  }, [anyWorking]);

  // While generating a picture, count the seconds so you can see it's working.
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

  // "Edit this" or "Make video" on the big picture: it becomes the starting picture.
  const startFrom = (image: PrismImage, what: Make) => {
    setSource({ kind: 'image', image });
    setMake(what);
    setPrompt('');
    setError('');
    promptBox.current?.focus();
    promptBox.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Send the prompt (and the starting picture, if any) to one of the API routes.
  const send = (url: string, fields: Record<string, string | number>) => {
    if (source?.kind === 'upload') {
      // A file goes as a form, the way a browser uploads attachments.
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
      form.append('image', source.file);
      return fetch(url, { method: 'POST', body: form });
    }
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
  };

  const generate = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setElapsed(0);
    setError('');
    try {
      if (animating) {
        // A video: the server answers right away, and the video is made in the background.
        const res = await send('/api/prism/videos', {
          prompt,
          length,
          ...(source?.kind === 'image' ? { imageId: source.image.id } : {}),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}).`);
        setVideos((list) => [data, ...list]);
        setShown({ kind: 'video', id: data.id });
        setNow(Date.now());
        return;
      }

      const size = SHAPES.find((s) => s.id === shape)!;
      const res = await send(
        '/api/prism/generate',
        source?.kind === 'image'
          ? { prompt, model, expand: String(expand), style, sourceId: source.image.id }
          : source
            ? { prompt, model, expand: String(expand), style }
            : { prompt, model, expand: String(expand), style, width: size.width, height: size.height },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}).`);
      setImages((list) => [data, ...list]);
      setShown({ kind: 'image', id: data.id });
    } catch (err) {
      setError((err as Error).message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  // Put a past picture's prompt, model, style and shape back into the form.
  const reuse = (image: PrismImage) => {
    setPrompt(image.prompt);
    // Its model too, as long as that model is still downloaded.
    const itsModel = models.find((m) => m.id === image.model && m.ready);
    if (itsModel) {
      setModel(itsModel.id);
      // ...and whether the prompt expander was on (a picture has expanded text only if it was).
      if (itsModel.expands) setExpand(Boolean(image.expandedPrompt));
    }
    setStyle(image.style);
    setMake('edit');
    // For an edit, bring back the picture it started from too (if it's still in your list).
    const from = image.mode === 'edit' && image.sourceId ? images.find((i) => i.id === image.sourceId) : undefined;
    setSource(from ? { kind: 'image', image: from } : null);
    const match = SHAPES.find((s) => s.width === image.width && s.height === image.height);
    if (match) setShape(match.id);
  };

  // Put a video's motion prompt, length and starting picture back into the form.
  const reuseVideo = (video: PrismVideo) => {
    const from = video.imageId ? images.find((i) => i.id === video.imageId) : undefined;
    if (!from) {
      setError('The picture this video started from isn’t in your list any more.');
      return;
    }
    setSource({ kind: 'image', image: from });
    setMake('video');
    setPrompt(video.prompt);
    setLength(video.length);
  };

  // Pictures and videos together in the strip at the bottom, newest first.
  const recent = [
    ...images.map((image) => ({ kind: 'image' as const, id: image.id, at: image.createdAt, image })),
    ...videos.map((video) => ({ kind: 'video' as const, id: video.id, at: video.createdAt, video })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const buttonText = busy
    ? animating
      ? 'Starting…'
      : `${editing ? 'Editing' : 'Painting'}… ${elapsed.toFixed(1)}s`
    : animating
      ? 'Make video'
      : editing
        ? 'Edit picture'
        : 'Generate';

  return (
    <main className="prism">
      <QueueNotice active={busy} />
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
                <img src={source.kind === 'upload' ? source.preview : source.image.url} alt="The starting picture" />
                <span className="prism-source-text">
                  {source.kind === 'upload' ? source.file.name : 'One of your pictures'}
                  <span>{animating ? 'Prism will bring it to life.' : 'Prism will change it the way you describe.'}</span>
                </span>
                <button type="button" className="prism-source-remove" onClick={() => setSource(null)} aria-label="Remove the picture">
                  ✕
                </button>
              </>
            ) : (
              <button type="button" className="prism-source-add" onClick={() => fileInput.current?.click()}>
                + Add a picture to edit or animate
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

          {/* With a picture: change it, or make a video from it */}
          {source && (
            <div className="prism-modes" role="radiogroup" aria-label="What to make">
              <button type="button" role="radio" aria-checked={make === 'edit'} onClick={() => setMake('edit')}>
                Edit picture
              </button>
              <button type="button" role="radio" aria-checked={make === 'video'} onClick={() => setMake('video')}>
                Make video
              </button>
            </div>
          )}

          <label className="prism-label" htmlFor="prism-prompt">
            {animating ? 'What should move?' : editing ? 'What should change?' : 'Describe your picture'}
          </label>
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
            placeholder={
              animating
                ? 'the waves roll in, the lighthouse beam sweeps across the sea, the camera stays still'
                : editing
                  ? 'make it nighttime, with a full moon'
                  : 'a lighthouse on a sea cliff at night, stars, glowing beam'
            }
            rows={4}
            maxLength={2000}
          />

          {animating ? (
            <>
              <span className="prism-label" id="prism-length-label">Video length</span>
              <div className="prism-lengths" role="radiogroup" aria-labelledby="prism-length-label">
                {lengths.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="radio"
                    aria-checked={length === l.id}
                    className="prism-length"
                    onClick={() => setLength(l.id)}
                  >
                    <strong>{l.seconds} sec</strong>
                    <span>{aboutTime(l.wait)}</span>
                    <small>{l.runs ? `average of ${l.runs}` : 'estimate'}</small>
                  </button>
                ))}
              </div>
              <p className="prism-note">
                The time is how long making it takes. You can leave the page; your video will be waiting here.
              </p>
            </>
          ) : (
            <>
              <label className="prism-label" htmlFor="prism-model">Model</label>
              <select id="prism-model" className="prism-select" value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.ready}>
                    {m.ready ? m.name : `${m.name} (not downloaded yet)`}
                  </option>
                ))}
              </select>
              <p className="prism-note">{pickedModel?.note}</p>

              {/* Only for a model with a prompt expander (FLUX.3) */}
              {pickedModel?.expands && (
                <label className="prism-check">
                  <input type="checkbox" checked={expand} onChange={(e) => setExpand(e.target.checked)} />
                  <span>
                    Expand my prompt
                    <span>
                      {editing
                        ? 'A helper looks at your picture and writes out the change in detail. This model works best that way.'
                        : 'A helper rewrites your prompt into a long, detailed one. This model paints best from those.'}
                    </span>
                  </span>
                </label>
              )}

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
            </>
          )}

          <button type="submit" className="prism-generate" disabled={busy || !prompt.trim()}>
            {buttonText}
          </button>
          {error && <p className="prism-error" role="alert">{error}</p>}
        </form>

        {/* ---------------------------------------------------------- the picture or video */}
        <section className="prism-stage" aria-live="polite">
          {shownVideo ? (
            <figure className="prism-result">
              {shownVideo.status === 'done' ? (
                <video
                  key={shownVideo.id}
                  src={shownVideo.url}
                  poster={shownVideo.poster}
                  width={shownVideo.width}
                  height={shownVideo.height}
                  controls
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              ) : (
                <div className="prism-video-wait">
                  {/* eslint-disable-next-line @next/next/no-img-element -- the starting picture, from our own API */}
                  <img src={shownVideo.poster} alt="" width={shownVideo.width} height={shownVideo.height} className="is-busy" />
                  {shownVideo.status === 'working' ? (
                    <VideoProgress video={shownVideo} lengths={lengths} now={now} />
                  ) : (
                    <p className="prism-video-status is-failed">{shownVideo.error ?? 'This video didn’t work.'}</p>
                  )}
                </div>
              )}
              <figcaption>
                <span className="prism-caption-text">{shownVideo.prompt}</span>
                <span className="prism-caption-meta">
                  Video · {Math.round(shownVideo.frames / 24)} sec · {shownVideo.width}×{shownVideo.height}
                  {shownVideo.seconds ? ` · made in ${clock(shownVideo.seconds)}` : ''}
                </span>
                <span className="prism-caption-actions">
                  <button type="button" onClick={() => reuseVideo(shownVideo)}>Reuse settings</button>
                  {shownVideo.status === 'done' && (
                    <a href={shownVideo.url} download={`prism-${shownVideo.id.slice(0, 8)}.mp4`}>Download</a>
                  )}
                </span>
              </figcaption>
            </figure>
          ) : shownImage ? (
            <figure className="prism-result">
              {/* eslint-disable-next-line @next/next/no-img-element -- generated pictures, served by our own API */}
              <img src={shownImage.url} alt={shownImage.prompt} width={shownImage.width} height={shownImage.height} className={busy && !animating ? 'is-busy' : ''} />
              <figcaption>
                <span className="prism-caption-text">{shownImage.prompt}</span>
                <span className="prism-caption-meta">
                  {shownImage.mode === 'edit' ? 'Edit · ' : ''}{findPrismModel(shownImage.model).name} · {styleName(shownImage.style)} · {shownImage.width}×{shownImage.height}
                  {shownImage.seconds ? ` · ${shownImage.seconds.toFixed(1)}s` : ''}
                </span>
                {/* With the prompt expander on: what it wrote, and so what the model really painted from */}
                {shownImage.expandedPrompt && (
                  <details className="prism-expanded" key={shownImage.id}>
                    <summary>See the expanded prompt</summary>
                    <p>{shownImage.expandedPrompt}</p>
                  </details>
                )}
                <span className="prism-caption-actions">
                  <button type="button" onClick={() => startFrom(shownImage, 'edit')}>Edit this</button>
                  <button type="button" onClick={() => startFrom(shownImage, 'video')}>Make video</button>
                  <button type="button" onClick={() => reuse(shownImage)}>Reuse settings</button>
                  <a href={shownImage.url} download={`prism-${shownImage.id.slice(0, 8)}.png`}>Download</a>
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

      {/* ---------------------------------------------------------- recent pictures and videos */}
      {recent.length > 0 && (
        <nav className="prism-recent" aria-label="Recent pictures and videos">
          {recent.map((item) => (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              className={`prism-thumb ${item.kind === 'video' ? `is-video is-${item.video.status}` : ''}`}
              aria-current={shown?.kind === item.kind && shown.id === item.id}
              title={item.kind === 'video' ? `Video: ${item.video.prompt}` : item.image.prompt}
              onClick={() => setShown({ kind: item.kind, id: item.id })}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- small thumbnails of our own pictures */}
              <img src={item.kind === 'video' ? item.video.poster : item.image.url} alt={item.kind === 'video' ? item.video.prompt : item.image.prompt} loading="lazy" />
              {item.kind === 'video' && (
                <span className="prism-thumb-badge" aria-hidden="true">
                  {item.video.status === 'working' ? '…' : item.video.status === 'failed' ? '!' : '▶'}
                </span>
              )}
            </button>
          ))}
        </nav>
      )}
    </main>
  );
};

/** "Making your video… 1:12 of about 2½ min", with a bar that fills up as it goes. */
function VideoProgress({ video, lengths, now }: { video: PrismVideo; lengths: LengthChoice[]; now: number }) {
  const wait = lengths.find((l) => l.id === video.length)?.wait ?? 150;
  const elapsed = Math.max(0, (now - Date.parse(video.createdAt)) / 1000);
  // Never show it as finished before it is: the bar stops at 95% if it runs long.
  const share = Math.min(0.95, elapsed / wait);
  return (
    <div className="prism-video-status">
      <span>
        Making your video… {clock(elapsed)} <small>of {aboutTime(wait)}</small>
      </span>
      <span className="prism-video-bar" aria-hidden="true">
        <span style={{ width: `${share * 100}%` }} />
      </span>
    </div>
  );
}

export default Prism;
