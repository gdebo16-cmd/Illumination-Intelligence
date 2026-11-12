'use client';

// Prism's page: describe a picture and press Generate. The side panel (☰) holds the model,
// art style and shape pickers, and the pictures and videos you've made.
// Or start from a picture (upload one, or "Edit this" on one of yours) and either say what to
// change, or bring it to life as a short video ("Make video").
// It talks to these API routes:
//   POST /api/prism/generate   start a picture, or an edit (it's made in the background)
//   POST /api/prism/upscale    start a bigger copy of a picture (also in the background)
//   GET  /api/prism/jobs       pictures still being made, and how the latest ones went
//   GET  /api/prism/images     your recent pictures
//   GET  /api/prism/models     the picture models, and whether each one is downloaded yet
//   POST /api/prism/videos     start a video (it's made in the background)
//   GET  /api/prism/videos     your videos, and the length choices with their usual wait

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PRISM_STYLES } from '@/config/prism-styles';
import { DEFAULT_PRISM_MODEL, PRISM_MODELS, findPrismModel } from '@/config/prism-models';
import AppHeader from '@/components/AppHeader';
import QueueNotice from '@/components/QueueNotice';
import Sidebar from '@/components/Sidebar';
import SidebarToggle from '@/components/SidebarToggle';

// The shapes you can pick. Sizes are in steps of 16 pixels, as the model needs.
const SHAPES = [
  { id: 'square', name: 'Square', width: 1024, height: 1024 },
  { id: 'portrait', name: 'Portrait', width: 832, height: 1216 },
  { id: 'landscape', name: 'Landscape', width: 1216, height: 832 },
  { id: 'phone', name: 'Phone', width: 768, height: 1344 },
] as const;

// A picture with a side longer than this has no Upscale button (the same limit as
// UPSCALE_MAX_SIDE in lib/prism/comfy.ts, which the server enforces).
const MAX_UPSCALE_SIDE = 2048;

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
  mode?: 'create' | 'edit' | 'upscale';
  sourceId?: string | null;
  createdAt: string;
  url: string;
}

// A picture being made (or just made) in the background. Pictures used to arrive on the same
// request that asked for them, so minimizing the iPhone app cut them off. Now the server answers
// right away with one of these, and the page checks on it until it's 'done' or 'failed'.
interface ImageJob {
  id: string;
  mode: 'create' | 'edit' | 'upscale';
  prompt: string;
  sourceId: string | null;
  status: 'working' | 'done' | 'failed';
  error: string | null;
  /** Once it's done: the new picture's id. */
  imageId: string | null;
  createdAt: string;
  /** Seconds since it started, by the server's clock. */
  age: number;
}

// ...plus when it started by this device's clock (worked out from `age`), for the timer.
type TrackedJob = ImageJob & { startedAt: number };
// "Is the window wide?" (a computer or a tablet on its side, not a phone). React keeps asking
// the browser, so the answer stays right when the window is resized.
const WIDE_SCREEN = '(min-width: 1024px)';
const watchWide = (onChange: () => void) => {
  const query = window.matchMedia(WIDE_SCREEN);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const isWideNow = () => window.matchMedia(WIDE_SCREEN).matches;
const isWideOnServer = () => false; // the server can't see the window; the browser corrects it

const track = (job: ImageJob): TrackedJob => ({ ...job, startedAt: Date.now() - job.age * 1000 });

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

  // The side panel (settings and your pictures). It starts open on a wide screen and closed on
  // a phone, where it slides over the page.
  // Until you open or close it yourself (sidebarChoice), it simply follows the screen width.
  const isWide = useSyncExternalStore(watchWide, isWideNow, isWideOnServer);
  const [sidebarChoice, setSidebarOpen] = useState<boolean | null>(null);
  const sidebarOpen = sidebarChoice ?? isWide;
  /** Show a picture or video big. On a phone that also closes the panel, which would cover it. */
  const show = (next: Shown) => {
    setShown(next);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  // What's happening
  // `sending`: a request is on its way to the server. `jobs`: pictures the server is making.
  const [sending, setSending] = useState<'make' | 'upscale' | null>(null);
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const jobsRef = useRef<TrackedJob[]>([]); // the same list, for code that runs outside a render
  const pictureJob = jobs.find((j) => j.status === 'working');
  const busy = sending !== null || pictureJob !== undefined;
  const upscaling = sending === 'upscale' || pictureJob?.mode === 'upscale'; // busy because of the Upscale button
  // Set when the app goes into the background, so a request cut off by that isn't called a failure.
  const wentAway = useRef(false);
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

  // ---- Fetching from the server. These are wrapped in useCallback so each one stays the very
  // same function for the life of the page; the effects below can then list them as things
  // they use without re-running every time the page redraws.

  // Your pictures again; with `show`, show that one big once the list has it.
  const loadImages = useCallback((show?: string) => {
    fetch('/api/prism/images', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((list: PrismImage[] | null) => {
        if (!list) return;
        setImages(list);
        if (show && list.some((i) => i.id === show)) setShown({ kind: 'image', id: show });
        else setShown((current) => current ?? (list[0] ? { kind: 'image', id: list[0].id } : null));
      })
      .catch(() => {});
  }, []);

  const setTracked = useCallback((list: TrackedJob[]) => {
    jobsRef.current = list;
    setJobs(list);
  }, []);

  // Check on the pictures being made. A finished one shows up big; a failed one says why.
  // Any picture still being made that this page didn't know about (it was reloaded, or the
  // picture was started on another device) is picked up too. Returns the server's list.
  const loadJobs = useCallback(async (): Promise<ImageJob[] | null> => {
    let list: ImageJob[];
    try {
      const res = await fetch('/api/prism/jobs', { cache: 'no-store' });
      if (!res.ok) return null;
      list = await res.json();
    } catch {
      return null; // offline for a moment (or still waking up); the next check will catch up
    }
    const known = jobsRef.current;
    const next: TrackedJob[] = [];
    for (const job of known) {
      const latest = list.find((j) => j.id === job.id);
      if (!latest) continue; // too old to be listed any more
      if (latest.status === 'working') next.push({ ...job, ...latest, startedAt: job.startedAt });
      else if (latest.status === 'done' && latest.imageId) loadImages(latest.imageId);
      else if (latest.status === 'failed') setError(latest.error || 'This picture didn’t work.');
    }
    for (const job of list) {
      if (job.status === 'working' && !known.some((k) => k.id === job.id)) next.push(track(job));
    }
    setTracked(next);
    return list;
  }, [loadImages, setTracked]);

  const loadVideos = useCallback(() => {
    fetch('/api/prism/videos')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { videos: PrismVideo[]; lengths: LengthChoice[] } | null) => {
        if (!data) return;
        setVideos(data.videos);
        setLengths(data.lengths);
      })
      .catch(() => {});
  }, []);

  // Load your recent pictures and videos when the page opens.
  // (Plus any picture still being made, say from before the app was closed.)
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
    void loadJobs();
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
  }, [loadJobs, loadVideos]);

  // While a video is being made, check on it every few seconds, and tick the clock every second.
  useEffect(() => {
    if (!anyWorking) return;
    const check = setInterval(loadVideos, 4000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(check);
      clearInterval(tick);
    };
  }, [anyWorking, loadVideos]);

  // While a picture is being made, check on it every couple of seconds.
  const making = pictureJob !== undefined;
  useEffect(() => {
    if (!making) return;
    const check = setInterval(() => void loadJobs(), 1500);
    return () => clearInterval(check);
  }, [making, loadJobs]);

  // Coming back to the app (or the tab): catch up on everything that happened while it was
  // away. iPhones pause a Home Screen app in the background, so nothing was checked meanwhile.
  useEffect(() => {
    const catchUp = () => {
      if (document.visibilityState !== 'visible') {
        wentAway.current = true;
        return;
      }
      void loadJobs();
      loadImages();
      loadVideos();
    };
    document.addEventListener('visibilitychange', catchUp);
    window.addEventListener('pageshow', catchUp);
    window.addEventListener('focus', catchUp);
    return () => {
      document.removeEventListener('visibilitychange', catchUp);
      window.removeEventListener('pageshow', catchUp);
      window.removeEventListener('focus', catchUp);
    };
  }, [loadJobs, loadImages, loadVideos]);

  // While generating a picture, count the seconds so you can see it's working. The count starts
  // when the server started the picture, so it carries on correctly after the app was away.
  const startedAt = pictureJob?.startedAt;
  useEffect(() => {
    if (!busy) return;
    const started = startedAt ?? Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 100);
    return () => clearInterval(timer);
  }, [busy, startedAt]);

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

  // A picture request that didn't get an answer because the app went into the background (the
  // iPhone cuts requests off then). The server may well have got it, so look before calling it a
  // failure: a job that started since `sentAt` is ours.
  const findCutOffJob = async (sentAt: number) => {
    const list = await loadJobs();
    const since = (Date.now() - sentAt) / 1000 + 2; // seconds, with a little slack
    const ours = list?.find((j) => j.age <= since);
    if (!ours) setError('The app was closed before Prism got your request. Please try again.');
    else if (ours.status === 'done' && ours.imageId) loadImages(ours.imageId);
    else if (ours.status === 'failed') setError(ours.error || 'This picture didn’t work.');
    // ('working': loadJobs has already picked it up, and it'll show when it's done.)
  };

  const generate = async () => {
    if (!prompt.trim() || busy) return;
    setSending('make');
    setElapsed(0);
    setError('');
    wentAway.current = false;
    const sentAt = Date.now();
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
      // The picture is being made; the checks above show it when it's done.
      setTracked([track(data as ImageJob), ...jobsRef.current]);
    } catch (err) {
      // Cut off by the app going into the background? Then it may be on its way after all.
      if (!animating && err instanceof TypeError && (wentAway.current || document.visibilityState !== 'visible')) {
        await findCutOffJob(sentAt);
      } else {
        setError((err as Error).message || 'Something went wrong.');
      }
    } finally {
      setSending(null);
    }
  };

  // "Upscale" on the big picture: make a copy twice as big and sharper. The original is kept.
  const upscale = async (image: PrismImage) => {
    if (busy) return;
    setSending('upscale');
    setElapsed(0);
    setError('');
    wentAway.current = false;
    const sentAt = Date.now();
    try {
      const res = await fetch('/api/prism/upscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: image.id, factor: 2 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}).`);
      setTracked([track(data as ImageJob), ...jobsRef.current]);
    } catch (err) {
      if (err instanceof TypeError && (wentAway.current || document.visibilityState !== 'visible')) {
        await findCutOffJob(sentAt);
      } else {
        setError((err as Error).message || 'Something went wrong.');
      }
    } finally {
      setSending(null);
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

  // Pictures and videos together in the strip at the bottom, newest first, after any picture
  // still being made.
  const recent = [
    ...images.map((image) => ({ kind: 'image' as const, id: image.id, at: image.createdAt, image })),
    ...videos.map((video) => ({ kind: 'video' as const, id: video.id, at: video.createdAt, video })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const buttonText = upscaling
    ? `Upscaling… ${elapsed.toFixed(1)}s`
    : busy
    ? animating && !pictureJob
      ? 'Starting…'
      : `${(pictureJob ? pictureJob.mode === 'edit' : editing) ? 'Editing' : 'Painting'}… ${elapsed.toFixed(1)}s`
    : animating
      ? 'Make video'
      : editing
        ? 'Edit picture'
        : 'Generate';

  /** Delete one of your pictures or videos for good (the ✕ on its thumbnail), after asking. */
  const remove = async (kind: Shown['kind'], id: string) => {
    if (!window.confirm(`Delete this ${kind === 'video' ? 'video' : 'picture'}? This can't be undone.`)) return;
    try {
      const res = await fetch(`/api/prism/${kind === 'video' ? 'videos' : 'images'}/${id}`, { method: 'DELETE' });
      // 404 means it is already gone, so drop it from the list either way.
      if (!res.ok && res.status !== 404) {
        setError((await res.json().catch(() => null))?.error ?? 'Could not delete it. Please try again.');
        return;
      }
      const left = recent.filter((item) => !(item.kind === kind && item.id === id));
      if (kind === 'video') setVideos((list) => list.filter((v) => v.id !== id));
      else setImages((list) => list.filter((i) => i.id !== id));
      // If it was the one shown big, show the newest of what's left.
      if (shown?.kind === kind && shown.id === id) setShown(left[0] ? { kind: left[0].kind, id: left[0].id } : null);
      // If it was the picture you were about to edit or animate, take it off the prompt box.
      if (kind === 'image' && source?.kind === 'image' && source.image.id === id) setSource(null);
    } catch {
      setError('Could not delete it. Please check the connection and try again.');
    }
  };

  return (
    <div className={`site-container ${sidebarOpen ? 'sidebar-open' : ''}`}>
      {/* ------------------------------------------------------------ the side panel */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} title="Studio" className="prism-sidebar">
        {animating ? (
          <p className="prism-note">Videos use their own model, so there is nothing to pick here while you make one.</p>
        ) : (
          <>
            <label className="sidebar-separator" htmlFor="prism-model">Model</label>
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

            <label className="sidebar-separator" htmlFor="prism-style">Art style</label>
            <select id="prism-style" className="prism-select" value={style} onChange={(e) => setStyle(e.target.value)}>
              {PRISM_STYLES.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            <span className="sidebar-separator" id="prism-shape-label">Shape</span>
            {editing ? (
              <p className="prism-note">The result keeps your picture’s shape.</p>
            ) : (
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
            )}
          </>
        )}

        {/* Everything you've made, newest first. Tap one to see it big. */}
        <span className="sidebar-separator">Your pictures</span>
        {recent.length === 0 && jobs.length === 0 ? (
          <p className="prism-note">Nothing yet. Your pictures and videos will collect here.</p>
        ) : (
          <nav className="prism-gallery" aria-label="Your pictures and videos">
            {/* Pictures being made: the picture they start from (if any), dimmed, with "…" */}
            {jobs.map((job) => {
              const from = job.sourceId ? images.find((i) => i.id === job.sourceId) : undefined;
              return (
                <button
                  key={`job-${job.id}`}
                  type="button"
                  className="prism-thumb is-working"
                  title={`Being made: ${job.prompt}`}
                  onClick={() => from && show({ kind: 'image', id: from.id })}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- one of our own pictures */}
                  {from && <img src={from.url} alt="" />}
                  <span className="prism-thumb-badge" aria-hidden="true">…</span>
                </button>
              );
            })}
            {recent.map((item) => (
              <div className="prism-thumb-wrap" key={`${item.kind}-${item.id}`}>
              <button
                type="button"
                className={`prism-thumb ${item.kind === 'video' ? `is-video is-${item.video.status}` : ''}`}
                aria-current={shown?.kind === item.kind && shown.id === item.id}
                title={item.kind === 'video' ? `Video: ${item.video.prompt}` : item.image.prompt}
                onClick={() => show({ kind: item.kind, id: item.id })}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- small thumbnails of our own pictures */}
                <img src={item.kind === 'video' ? item.video.poster : item.image.url} alt={item.kind === 'video' ? item.video.prompt : item.image.prompt} loading="lazy" />
                {item.kind === 'video' && (
                  <span className="prism-thumb-badge" aria-hidden="true">
                    {item.video.status === 'working' ? '…' : item.video.status === 'failed' ? '!' : '▶'}
                  </span>
                )}
              </button>
              {/* Delete it for good. Not offered while a video is still being made. */}
              {!(item.kind === 'video' && item.video.status === 'working') && (
                <button
                  type="button"
                  className="prism-thumb-delete"
                  aria-label={item.kind === 'video' ? 'Delete this video' : 'Delete this picture'}
                  title="Delete"
                  onClick={() => void remove(item.kind, item.id)}
                >
                  ✕
                </button>
              )}
              </div>
            ))}
          </nav>
        )}
      </Sidebar>

      <div className="content-area">
        <AppHeader
          appId="prism"
          left={<SidebarToggle open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} label="settings and pictures" />}
        />
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

          {animating && (
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
          )}

          {/* The prompt box. Everything for one request lives inside it: the picture you start
              from (optional), what you type, the "+ Picture" button and the round Generate
              button (like the message box in Lumen). You can also drop a picture onto it. */}
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
          {/* While it works: what it's doing and for how long (the button only shows a spinner) */}
          {busy && <p className="prism-status" role="status">{buttonText}</p>}

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
                    <SaveButton key={shownVideo.url} url={shownVideo.url} name={`prism-${shownVideo.id.slice(0, 8)}.mp4`} type="video/mp4" />
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
                  {shownImage.mode === 'edit' ? 'Edit · ' : shownImage.mode === 'upscale' ? 'Upscaled · ' : ''}{findPrismModel(shownImage.model).name} · {styleName(shownImage.style)} · {shownImage.width}×{shownImage.height}
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
                  {/* Not offered for a picture that's already as big as Prism makes them */}
                  {Math.max(shownImage.width, shownImage.height) <= MAX_UPSCALE_SIDE && (
                    <button type="button" onClick={() => void upscale(shownImage)} disabled={busy}>
                      {upscaling ? 'Upscaling…' : 'Upscale 2×'}
                    </button>
                  )}
                  <button type="button" onClick={() => reuse(shownImage)}>Reuse settings</button>
                  <SaveButton key={shownImage.url} url={shownImage.url} name={`prism-${shownImage.id.slice(0, 8)}.png`} type="image/png" />
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

    </main>
      </div>
    </div>
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

// "Save" for a picture or video. On a phone it opens the share sheet, where "Save Image" or
// "Save Video" puts it in Photos. (A plain download link in the Home Screen app opens a
// full-screen viewer with no way back.) On a computer it downloads the file like before.
// The file is fetched as soon as it's shown, so the share sheet can open right on the tap.
// (Each picture gets a fresh button, key={url}, so it never offers the previous picture's file.)
function SaveButton({ url, name, type }: { url: string; name: string; type: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(url)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        if (!live) return;
        const f = new File([blob], name, { type: blob.type || type });
        setFile(f);
        setCanShare(typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] }));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [url, name, type]);

  const download = (href: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const save = async () => {
    if (file && canShare) {
      try {
        await navigator.share({ files: [file] });
      } catch (err) {
        // Closing the share sheet isn't an error.
        if ((err as Error).name !== 'AbortError') download(URL.createObjectURL(file));
      }
      return;
    }
    if (file) {
      const href = URL.createObjectURL(file);
      download(href);
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      return;
    }
    setSaving(true);
    download(url);
    setSaving(false);
  };

  const label = canShare ? (type.startsWith('video') ? 'Save video' : 'Save to Photos') : 'Download';
  return (
    <button type="button" onClick={() => void save()} disabled={saving}>
      {label}
    </button>
  );
}
