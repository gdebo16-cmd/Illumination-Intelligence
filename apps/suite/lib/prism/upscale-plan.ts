// lib/prism/upscale-plan.ts — what each Enlarge button asks for, before ComfyUI is involved.
//
// Fast 4× and Photo 4× only enlarge. They use a small upscale model (Real-ESRGAN or Nomos DAT),
// so the picture stays faithful: hair and eyelashes are not invented.
// Enhance runs SeedVR2, which can invent plausible fine detail, then (for 8K) a faithful 2×.
//
// Sizes:
//   1024×1024 at Fast 4×  → 4096×4096
//   1920×1080 at Fast 4×  → 7680×4320
//   4K                    → 4096 on the long edge (a square stays square)
//   4K UHD                → 3840×2160 when the picture is 16:9, otherwise that long edge
//   8K / 8K UHD           → the same idea at 8192 and 7680×4320

export type FastModelId = 'realesrgan' | 'nomos';

/** 'fast-2x' is the old Upscale button (still accepted by the API). It isn't shown. */
export type UpscaleTargetId = 'fast-2x' | 'fast-4x' | '4k' | '4k-uhd' | '8k' | '8k-uhd';

export interface FastModelChoice {
  id: FastModelId;
  /** The button label. */
  label: string;
  /**
   * File names ComfyUI might list for this model, in models/upscale_models.
   * The first one that machine actually has is the one we load. Weights are not in git.
   */
  files: readonly string[];
}

export const FAST_MODELS: Record<FastModelId, FastModelChoice> = {
  realesrgan: {
    id: 'realesrgan',
    label: 'Fast 4×',
    // The recipe used to ask for the .safetensors name. The official release is the .pth.
    files: ['RealESRGAN_x4plus.safetensors', 'RealESRGAN_x4plus.pth'],
  },
  nomos: {
    id: 'nomos',
    label: 'Photo 4×',
    files: ['4xNomos2_hq_dat2.safetensors', '4xNomos2_hq_dat2.pth'],
  },
};

/** Faithful 2× after SeedVR2, when the target is 8K. Same ComfyUI folder. */
export const SECOND_PASS_FILES = ['RealESRGAN_x2plus.pth', 'RealESRGAN_x2plus.safetensors'] as const;

/** int8, not fp16: the 7B fp16 weights don't stay in 16 GB. */
export const SEEDVR_UNET = 'seedvr2_7b_int8_convrot.safetensors';
export const SEEDVR_VAE = 'seedvr2_ema_vae_fp16.safetensors';

/**
 * Comfy's upscaling handbook: shrink the SeedVR2 input to about this many megapixels first
 * (ImageScaleToTotalPixels), then enlarge. 1 megapixel here is 1024×1024.
 */
export const SEEDVR_INPUT_MEGAPIXELS = 0.35;

/** Fast enlarges stop at 8K on the long edge (a 4× of a 2048px picture). */
export const FAST_MAX_LONG_EDGE = 8192;

const UHD = {
  '4k-uhd': { long: 3840, short: 2160 },
  '8k-uhd': { long: 7680, short: 4320 },
} as const;

const LONG_EDGE = {
  '4k': 4096,
  '8k': 8192,
} as const;

export interface UpscalePlan {
  target: UpscaleTargetId;
  path: 'fast' | 'enhance';
  fastModel: FastModelId | null;
  width: number;
  height: number;
  /** Pixels SeedVR2 works at. Half the output when a faithful 2× follows. 0 on the fast path. */
  seedvrWidth: number;
  seedvrHeight: number;
  thenFast2x: boolean;
  /** GPU-queue log, and the name in a missing-model error. */
  label: string;
  /** About how much graphics memory it needs, in GB. SeedVR2 int8 wants the 16 GB card. */
  vramGB: number;
}

export interface EnlargeChoice {
  target: UpscaleTargetId;
  fastModel: FastModelId | null;
  label: string;
  title: string;
}

const WIDE = 16 / 9;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Round to a multiple of `step` (8K sizes need a multiple of 4 so half of each side is even). */
const multipleOf = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

/** Fit a picture so its long edge is `longEdge`. The shape stays. Both sides come out even. */
export function fitLongEdge(width: number, height: number, longEdge: number): { width: number; height: number } {
  const edge = even(longEdge);
  if (width === height) return { width: edge, height: edge };
  const scale = edge / Math.max(width, height);
  const sized = width >= height
    ? { width: edge, height: even(height * scale) }
    : { width: even(width * scale), height: edge };
  return sized;
}

const closeTo = (ratio: number, target: number) => Math.abs(ratio - target) / target <= 0.03;

/**
 * 16:9 (or 9:16) lands on the exact UHD frame. Anything else keeps its shape, with that
 * frame's long edge — a square is not cropped down to 16:9.
 */
function uhdFrame(width: number, height: number, frame: { long: number; short: number }): { width: number; height: number } {
  const ratio = width / height;
  if (closeTo(ratio, WIDE)) return { width: frame.long, height: frame.short };
  if (closeTo(ratio, 1 / WIDE)) return { width: frame.short, height: frame.long };
  return fitLongEdge(width, height, frame.long);
}

const ENHANCE_LABEL: Record<'4k' | '4k-uhd' | '8k' | '8k-uhd', string> = {
  '4k': 'Enhance 4K',
  '4k-uhd': '4K UHD',
  '8k': 'Enhance 8K',
  '8k-uhd': '8K UHD',
};

/** The output size (and which recipe) for one button on a picture of this size. */
export function planUpscale(
  target: UpscaleTargetId,
  width: number,
  height: number,
  fastModel: FastModelId = 'realesrgan',
): UpscalePlan {
  if (target === 'fast-2x' || target === 'fast-4x') {
    const factor = target === 'fast-2x' ? 2 : 4;
    const model = FAST_MODELS[fastModel];
    return {
      target,
      path: 'fast',
      fastModel,
      width: width * factor,
      height: height * factor,
      seedvrWidth: 0,
      seedvrHeight: 0,
      thenFast2x: false,
      label: target === 'fast-2x' ? 'Upscale 2×' : model.label,
      vramGB: 4,
    };
  }

  const size = target === '4k' || target === '8k'
    ? fitLongEdge(width, height, LONG_EDGE[target])
    : uhdFrame(width, height, UHD[target]);
  const thenFast2x = target === '8k' || target === '8k-uhd';
  // A 2× pass needs each side even after halving, so the final size is a multiple of 4.
  if (thenFast2x) {
    const long = Math.max(size.width, size.height);
    size.width = multipleOf(size.width, 4);
    size.height = multipleOf(size.height, 4);
    if (size.width >= size.height) size.width = multipleOf(long, 4);
    else size.height = multipleOf(long, 4);
  }

  return {
    target,
    path: 'enhance',
    fastModel: null,
    width: size.width,
    height: size.height,
    seedvrWidth: thenFast2x ? size.width / 2 : size.width,
    seedvrHeight: thenFast2x ? size.height / 2 : size.height,
    thenFast2x,
    label: ENHANCE_LABEL[target],
    vramGB: 14,
  };
}

/** Why this button should not be offered. null when the picture can still grow that way. */
export function upscaleBlockReason(
  target: UpscaleTargetId,
  width: number,
  height: number,
  fastModel?: FastModelId,
): string | null {
  if (width < 2 || height < 2) return 'That picture is too small.';
  const long = Math.max(width, height);
  if (target === 'fast-2x' || target === 'fast-4x') {
    const factor = target === 'fast-2x' ? 2 : 4;
    if (long * factor > FAST_MAX_LONG_EDGE) return 'A copy that big would be over 8K.';
    return null;
  }
  const plan = planUpscale(target, width, height, fastModel);
  const grows = plan.width * plan.height > width * height && Math.max(plan.width, plan.height) > long;
  if (!grows) return 'That picture is already this big.';
  return null;
}

/** The buttons under a picture, in the order they're shown. */
export const ENLARGE_CHOICES: readonly EnlargeChoice[] = [
  {
    target: 'fast-4x',
    fastModel: 'realesrgan',
    label: 'Fast 4×',
    title: 'Faithful enlarge, four times bigger (Real-ESRGAN). Doesn’t invent detail.',
  },
  {
    target: 'fast-4x',
    fastModel: 'nomos',
    label: 'Photo 4×',
    title: 'Faithful 4× for photos (Nomos DAT). Doesn’t invent detail.',
  },
  {
    target: '4k',
    fastModel: null,
    label: 'Enhance 4K',
    title: '4096 on the long edge, or 4096×4096 when the picture is square. Can invent fine detail.',
  },
  {
    target: '4k-uhd',
    fastModel: null,
    label: '4K UHD',
    title: '3840×2160 when the picture is 16:9, or 2160×3840 when it’s 9:16. Other shapes keep their ratio, with 3840 on the long edge.',
  },
  {
    target: '8k',
    fastModel: null,
    label: 'Enhance 8K',
    title: '8192 on the long edge. SeedVR2 to about 4K, then a faithful 2×.',
  },
  {
    target: '8k-uhd',
    fastModel: null,
    label: '8K UHD',
    title: '7680×4320 when the picture is 16:9. Other shapes keep their ratio, with 7680 on the long edge.',
  },
];

/** Buttons that still make this picture bigger. An unknown size (0) shows every button. */
export function choicesFor(width: number, height: number): EnlargeChoice[] {
  if (width < 2 || height < 2) return [...ENLARGE_CHOICES];
  return ENLARGE_CHOICES.filter((choice) => upscaleBlockReason(choice.target, width, height, choice.fastModel ?? undefined) === null);
}

export function isUpscaleTarget(id: unknown): id is UpscaleTargetId {
  return id === 'fast-2x' || id === 'fast-4x' || id === '4k' || id === '4k-uhd' || id === '8k' || id === '8k-uhd';
}

export function isFastModel(id: unknown): id is FastModelId {
  return id === 'realesrgan' || id === 'nomos';
}
