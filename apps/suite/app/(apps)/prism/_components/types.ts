// Prism's shared types and small helpers: what the API sends back, and how the page formats it.

import { PRISM_STYLES } from '@/config/prism-styles';
import { PRISM_VIDEO_MODELS, VIDEO_LENGTHS, type VideoModelId } from '@/config/prism-video-models';

// The shapes you can pick. Sizes are in steps of 16 pixels, as the model needs.
export const SHAPES = [
  { id: 'square', name: 'Square', width: 1024, height: 1024 },
  { id: 'portrait', name: 'Portrait', width: 832, height: 1216 },
  { id: 'landscape', name: 'Landscape', width: 1216, height: 832 },
  { id: 'phone', name: 'Phone', width: 768, height: 1344 },
] as const;
export type ShapeId = (typeof SHAPES)[number]['id'];

// What the API sends back for each picture.
export interface PrismImage {
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
export interface ImageJob {
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
export type TrackedJob = ImageJob & { startedAt: number };

export const track = (job: ImageJob): TrackedJob => ({ ...job, startedAt: Date.now() - job.age * 1000 });

// A picture model in the dropdown. `ready` is false until its files are in ComfyUI;
// `expands` is true when it has a prompt expander (the "Expand my prompt" switch).
export interface ModelChoice {
  id: string;
  name: string;
  note: string;
  expands: boolean;
  ready: boolean;
}

// ...and for each video.
export interface PrismVideo {
  id: string;
  imageId: string | null;
  prompt: string;
  model: VideoModelId;
  /** Made from a picture ('image') or from words only ('text'). */
  mode: 'image' | 'text';
  length: string;
  /** How long the clip is, in seconds. */
  clipSeconds: number;
  /** For a smoothed copy: the video it was made from. */
  smoothOf: string | null;
  /** Frames per second (twice the model's for a smoothed copy). */
  fps: number;
  frames: number;
  width: number;
  height: number;
  status: 'working' | 'done' | 'failed';
  error: string | null;
  seconds: number | null;
  createdAt: string;
  url: string;
  /** The starting picture (or a video from words' first frame); null until a video from words is done. */
  poster: string | null;
}

// A video length you can pick, with how long it usually takes to make (`wait`, in seconds).
// `runs` is how many videos that average comes from; 0 means it's still a first guess.
export interface LengthChoice {
  id: string;
  name: string;
  seconds: number;
  wait: number;
  runs: number;
}

// Until the server answers, show each video model's first guesses (config/prism-video-models.ts).
export const FIRST_GUESS = Object.fromEntries(
  PRISM_VIDEO_MODELS.map((m) => [m.id, VIDEO_LENGTHS.map((l) => ({ ...l, wait: m.estimates[l.id], runs: 0 }))]),
) as Record<VideoModelId, LengthChoice[]>;

// Whether a video model's files are in ComfyUI, for a video from a picture and from words.
export interface VideoModelStatus {
  id: VideoModelId;
  ready: { image: boolean; text: boolean };
}

/** CSS modifier for an empty video frame: is-landscape, is-portrait, or is-square. */
export const videoOrientation = (width: number, height: number) =>
  width === height ? 'is-square' : height > width ? 'is-portrait' : 'is-landscape';

// The picture to start from: a file from your device, or one of your Prism pictures.
export type Source =
  | { kind: 'upload'; file: File; preview: string }
  | { kind: 'image'; image: PrismImage };

// What to do with that picture.
export type Make = 'edit' | 'video';

// What's shown big on the stage.
export type Shown = { kind: 'image'; id: string } | { kind: 'video'; id: string };

export const styleName = (id: string) => PRISM_STYLES.find((s) => s.id === id)?.name ?? 'None';

/** 150 → "about 2½ min", 45 → "about 50 sec". */
export function aboutTime(seconds: number): string {
  if (seconds < 90) return `about ${Math.max(10, Math.round(seconds / 10) * 10)} sec`;
  const halves = Math.round(seconds / 30); // in half minutes
  const whole = Math.floor(halves / 2);
  return `about ${whole}${halves % 2 ? '½' : ''} min`;
}

/** 83 → "1:23". */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** One thumbnail in the gallery: a picture or a video. */
export type RecentItem =
  | { kind: 'image'; id: string; at: string; image: PrismImage }
  | { kind: 'video'; id: string; at: string; video: PrismVideo };
