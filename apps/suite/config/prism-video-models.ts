// The video models in Prism's "Video model" dropdown, and the lengths and shapes you can pick.
//
// This file has no server code in it, so the page can use it too. The recipes (ComfyUI
// workflows) and the model files each one loads are in lib/prism/video-workflow.ts. A model is greyed
// out ("not downloaded yet") until some machine's ComfyUI has every file its recipe loads.
//
// The first entry is the default.
//
// The two "Cloud Movies" entries are different: they're made online by far bigger models
// (lib/prism/cloud.ts), cost money for every second of video, and send your prompt and picture
// out of the house. They're last in the list and only ever used when picked by hand.

export interface PrismVideoModel {
  id: string;
  name: string;
  /** One line shown under the dropdown when this model is picked. */
  note: string;
  /** Frames per second the model makes. A clip has seconds × fps + 1 frames. */
  fps: number;
  /** About how many pixels a frame has (width × height). Other shapes keep about that many. */
  pixels: number;
  /** Video sides must be multiples of this. */
  step: number;
  /** About how much graphics memory (VRAM) it wants, in GB, for the GPU queue's router. */
  vramGB: number;
  /** First guesses at how long each length takes to make, in seconds, until real ones replace them. */
  estimates: Record<VideoLengthId, number>;
  /** Its own clip lengths, in seconds, when it can't make the usual ones (see lengthSeconds). */
  seconds?: Record<VideoLengthId, number>;
  /** True for a model that runs online, not on these machines (lib/prism/cloud.ts). */
  cloud?: boolean;
}

/** The lengths you can pick. The number of frames depends on the model (see framesFor). */
export const VIDEO_LENGTHS = [
  { id: 'short', name: 'Short', seconds: 2 },
  { id: 'medium', name: 'Medium', seconds: 3 },
  { id: 'long', name: 'Long', seconds: 5 },
] as const;

export type VideoLengthId = (typeof VIDEO_LENGTHS)[number]['id'];
export const findLength = (id: unknown) => VIDEO_LENGTHS.find((l) => l.id === id);

export const PRISM_VIDEO_MODELS = [
  {
    id: 'wan-5b',
    name: 'Fast (Wan 2.2 5B)',
    note: 'The quicker one, at 720p.',
    fps: 24,
    pixels: 1280 * 704,
    step: 32,
    vramGB: 14,
    // 2 seconds took 146 s in the first test on the Raider.
    estimates: { short: 150, medium: 240, long: 450 },
  },
  {
    id: 'wan-14b',
    name: 'Better (Wan 2.2 14B)',
    note: 'Better motion and detail. Uses the 4-step Lightning add-ons, so it isn’t much slower.',
    fps: 16,
    // 1024×576. Raise it toward 1280×720 if the Raider copes; lower it to 832×480 if it runs out of memory.
    pixels: 1024 * 576,
    step: 16,
    vramGB: 14,
    // Guesses: not measured yet.
    estimates: { short: 210, medium: 330, long: 600 },
  },
  // Prices: Comfy credits per second at 1080p, at 211 credits to the dollar (November 2026).
  {
    id: 'cloud-kling',
    name: 'Cloud Movies (Kling 3)',
    // 23.63 credits a second, without sound.
    note: 'Made online at 1080p, without sound. About 11¢ for each second of video (56¢ for 5 seconds). Your prompt and picture leave the house.',
    fps: 24, // a guess: only used to count frames, and by Smooth
    pixels: 1920 * 1080,
    step: 8,
    vramGB: 0,
    seconds: { short: 3, medium: 5, long: 10 }, // Kling takes 3 to 15 seconds
    estimates: { short: 120, medium: 150, long: 240 }, // guesses: not measured yet
    cloud: true,
  },
  {
    id: 'cloud-veo',
    name: 'Cloud Movies Premium (Veo 3.1)',
    // 84.4 credits a second, with sound.
    note: 'Google’s best, made online at 1080p with sound. About 40¢ for each second of video ($1.60 for 4 seconds). Landscape or portrait only. Your prompt and picture leave the house.',
    fps: 24, // a guess, as above
    pixels: 1920 * 1080,
    step: 8,
    vramGB: 0,
    seconds: { short: 4, medium: 6, long: 8 }, // Veo takes 4, 6 or 8 seconds
    estimates: { short: 120, medium: 150, long: 180 }, // guesses: not measured yet
    cloud: true,
  },
] as const satisfies readonly PrismVideoModel[];

export type VideoModelId = (typeof PRISM_VIDEO_MODELS)[number]['id'];
export const DEFAULT_VIDEO_MODEL: VideoModelId = PRISM_VIDEO_MODELS[0].id;

export type CloudVideoModelId = 'cloud-kling' | 'cloud-veo';
/** The models that run on these machines: the ones with recipe files in lib/prism. */
export type LocalVideoModelId = Exclude<VideoModelId, CloudVideoModelId>;
export const isCloudVideo = (id: unknown): id is CloudVideoModelId => id === 'cloud-kling' || id === 'cloud-veo';

/** How long a clip of this length is, in seconds, for this model. */
export const lengthSeconds = (model: PrismVideoModel, length: VideoLengthId): number =>
  model.seconds?.[length] ?? VIDEO_LENGTHS.find((l) => l.id === length)!.seconds;

/** The model with this id. Anything unknown (or left out, as in videos made before there was a choice) gives the default. */
export function findVideoModel(id: unknown): (typeof PRISM_VIDEO_MODELS)[number] {
  return PRISM_VIDEO_MODELS.find((m) => m.id === id) ?? PRISM_VIDEO_MODELS[0];
}

/** How many frames a clip of this length has. Wan needs 4n + 1 frames, which seconds × fps + 1 always is here. */
export const framesFor = (model: PrismVideoModel, seconds: number) => seconds * model.fps + 1;

/** The shapes for a video made from words only (one made from a picture keeps the picture's shape). */
export const VIDEO_SHAPES = [
  { id: 'landscape', name: 'Landscape', ratio: 16 / 9 },
  { id: 'portrait', name: 'Portrait', ratio: 9 / 16 },
  { id: 'square', name: 'Square', ratio: 1 },
] as const;

export type VideoShapeId = (typeof VIDEO_SHAPES)[number]['id'];
export const findVideoShape = (id: unknown) => VIDEO_SHAPES.find((s) => s.id === id);

/** The frame size for a shape: about `model.pixels` pixels, sides in multiples of `model.step`. */
export function videoSize(model: PrismVideoModel, ratio: number): { width: number; height: number } {
  const round = (n: number) => Math.max(model.step, Math.round(n / model.step) * model.step);
  return { width: round(Math.sqrt(model.pixels * ratio)), height: round(Math.sqrt(model.pixels / ratio)) };
}
