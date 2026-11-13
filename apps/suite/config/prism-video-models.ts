// The video models in Prism's "Video model" dropdown, and the lengths and shapes you can pick.
//
// This file has no server code in it, so the page can use it too. The recipes (ComfyUI
// workflows) and the model files each one loads are in lib/prism/video.ts. A model is greyed
// out ("not downloaded yet") until some machine's ComfyUI has every file its recipe loads.
//
// The first entry is the default.

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
] as const satisfies readonly PrismVideoModel[];

export type VideoModelId = (typeof PRISM_VIDEO_MODELS)[number]['id'];
export const DEFAULT_VIDEO_MODEL: VideoModelId = PRISM_VIDEO_MODELS[0].id;

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
