'use client';

// Prism's page: describe a picture and press Generate. The side panel (☰) holds the model,
// art style and shape pickers, and the pictures and videos you've made.
// Or start from a picture (upload one, or "Edit this" on one of yours) and either say what to
// change, or bring it to life as a short video ("Make video").
// It talks to these API routes:
//   POST /api/prism/generate   start a picture, or an edit (it's made in the background)
//   POST /api/prism/upscale    enlarge a picture (Fast 4×, Photo 4×, or Enhance to 4K / 8K)
//   GET  /api/prism/jobs       pictures still being made, and how the latest ones went
//   GET  /api/prism/images     your recent pictures
//   GET  /api/prism/models     the picture models, and whether each one is downloaded yet
//   POST /api/prism/videos     start a video (it's made in the background)
//   GET  /api/prism/videos     your videos, and the length choices with their usual wait

import { useCallback, useEffect, useRef, useState } from 'react';
import { PRISM_STYLES } from '@/config/prism-styles';
import { DEFAULT_PRISM_MODEL, PRISM_MODELS } from '@/config/prism-models';
import type { EnlargeChoice } from '@/lib/prism/upscale-plan';
import AppShell from '@/components/AppShell';
import useSidebar from '@/hooks/use-sidebar';
import QueueNotice from '@/components/QueueNotice';
import EnlargeButtons from './EnlargeButtons';
import usePictureSize from './use-picture-size';
import Gallery from './Gallery';
import PromptBox from './PromptBox';
import Stage from './Stage';
import StudioSettings from './StudioSettings';
import {
  FIRST_GUESS,
  SHAPES,
  aboutTime,
  track,
  type ImageJob,
  type LengthChoice,
  type Make,
  type ModelChoice,
  type PrismImage,
  type PrismVideo,
  type RecentItem,
  type ShapeId,
  type Shown,
  type Source,
  type TrackedJob,
} from './types';

const Prism = () => {
  // The form
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<string>(DEFAULT_PRISM_MODEL);
  // Until the server says which models are downloaded, list them all as ready.
  const [models, setModels] = useState<ModelChoice[]>(() => PRISM_MODELS.map((m) => ({ ...m, ready: true })));
  // The prompt expander's switch. It only does something for a model that has one (FLUX.3).
  const [expand, setExpand] = useState(true);
  const [style, setStyle] = useState<string>(PRISM_STYLES[0].id);
  const [shape, setShape] = useState<ShapeId>('square');
  const [source, setSource] = useState<Source | null>(null);
  const [make, setMake] = useState<Make>('edit');
  const [length, setLength] = useState('short');
  const editing = source !== null && make === 'edit';
  const animating = source !== null && make === 'video';
  const uploadSize = usePictureSize(source?.kind === 'upload' ? source.preview : null);
  const promptBox = useRef<HTMLTextAreaElement>(null);

  // The side panel (settings and your pictures); see hooks/use-sidebar.ts for how it behaves.
  const panel = useSidebar();
  /** Show a picture or video big. On a phone that also closes the panel, which would cover it. */
  const show = (next: Shown) => {
    setShown(next);
    panel.closeOnPhone();
  };

  // What's happening
  // `sending`: a request is on its way to the server. `jobs`: pictures the server is making.
  const [sending, setSending] = useState<'make' | 'upscale' | null>(null);
  const [upscaleLabel, setUpscaleLabel] = useState('Upscaling');
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const jobsRef = useRef<TrackedJob[]>([]); // the same list, for code that runs outside a render
  const pictureJob = jobs.find((j) => j.status === 'working');
  const busy = sending !== null || pictureJob !== undefined;
  const upscaling = sending === 'upscale' || pictureJob?.mode === 'upscale'; // busy because of an Enlarge button
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
  }, [setImages, setShown]);

  const setTracked = useCallback((list: TrackedJob[]) => {
    jobsRef.current = list;
    setJobs(list);
  }, [setJobs]);

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
  }, [loadImages, setTracked, setError]);

  const loadVideos = useCallback(() => {
    fetch('/api/prism/videos')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { videos: PrismVideo[]; lengths: LengthChoice[] } | null) => {
        if (!data) return;
        setVideos(data.videos);
        setLengths(data.lengths);
      })
      .catch(() => {});
  }, [setVideos, setLengths]);

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

  // Enlarge the big picture, or a picture just loaded from this device. The original is kept.
  const enlarge = async (choice: EnlargeChoice, image?: PrismImage) => {
    if (busy) return;
    const file = !image && source?.kind === 'upload' ? source.file : null;
    if (!image && !file) return;
    setUpscaleLabel(choice.label);
    setSending('upscale');
    setElapsed(0);
    setError('');
    wentAway.current = false;
    const sentAt = Date.now();
    try {
      const fields = { target: choice.target, ...(choice.fastModel ? { fastModel: choice.fastModel } : {}) };
      const res = file
        ? await send('/api/prism/upscale', fields)
        : await fetch('/api/prism/upscale', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...fields, imageId: image!.id }),
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
  const recent: RecentItem[] = [
    ...images.map((image) => ({ kind: 'image' as const, id: image.id, at: image.createdAt, image })),
    ...videos.map((video) => ({ kind: 'video' as const, id: video.id, at: video.createdAt, video })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const upscaleWord = sending === 'upscale' ? upscaleLabel : 'Upscaling';
  const buttonText = upscaling
    ? `${upscaleWord}… ${elapsed.toFixed(1)}s`
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


  const studio = (
    <>
      <StudioSettings
        animating={animating}
        editing={editing}
        models={models}
        model={model}
        setModel={setModel}
        expand={expand}
        setExpand={setExpand}
        style={style}
        setStyle={setStyle}
        shape={shape}
        setShape={setShape}
      />

      <Gallery jobs={jobs} images={images} recent={recent} shown={shown} show={show} remove={remove} />
    </>
  );

  return (
    <AppShell
      appId="prism"
      sidebar={{ panel, title: 'Studio', label: 'settings and pictures', className: 'prism-sidebar', content: studio }}
    >
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

            {source?.kind === 'upload' && !animating && (
              <>
                <span className="prism-label" id="prism-enlarge-label">Enlarge</span>
                <EnlargeButtons
                  width={uploadSize?.width ?? 0}
                  height={uploadSize?.height ?? 0}
                  disabled={busy}
                  onEnlarge={(choice) => void enlarge(choice)}
                />
              </>
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

            <PromptBox
              promptBox={promptBox}
              source={source}
              setSource={setSource}
              animating={animating}
              editing={editing}
              prompt={prompt}
              setPrompt={setPrompt}
              generate={generate}
              pickFile={pickFile}
              busy={busy}
              buttonText={buttonText}
            />
            {/* While it works: what it's doing and for how long (the button only shows a spinner) */}
            {busy && <p className="prism-status" role="status">{buttonText}</p>}

            {error && <p className="prism-error" role="alert">{error}</p>}
          </form>

          {/* ---------------------------------------------------------- the picture or video */}
          <Stage
            shownImage={shownImage}
            shownVideo={shownVideo}
            busy={busy}
            animating={animating}
            lengths={lengths}
            now={now}
            startFrom={startFrom}
            reuse={reuse}
            reuseVideo={reuseVideo}
            enlarge={enlarge}
          />
        </div>

      </main>
    </AppShell>
  );
};

export default Prism;
