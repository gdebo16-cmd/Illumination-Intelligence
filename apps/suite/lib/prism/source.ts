// lib/prism/source.ts — getting a picture ready to be edited.
//
// The editing model works best with a picture of about 1 megapixel, with no see-through parts.
// Pictures people give it are rarely like that: phone photos are huge and sideways, sprites are
// tiny and transparent. So before a picture goes to ComfyUI we:
//   1. turn it upright (phones store "rotate me" as a note instead of rotating the pixels),
//   2. put any see-through parts on solid black (ComfyUI can't handle transparency),
//   3. resize it smoothly to about 1 megapixel, in steps of 16 pixels (what the model needs).
// Videos use the same steps with a smaller size (see lib/prism/video.ts).

import 'server-only';
import sharp, { type Metadata } from 'sharp';

/** Biggest upload we accept, in bytes (phone photos are 3–12 MB). */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

const TARGET_PIXELS = 1024 * 1024;

export interface PreparedSource {
  png: Buffer;
  width: number;
  height: number;
}

/**
 * Options: `pixels` is the target size (default about 1 megapixel) and `step` the multiple the
 * sides are rounded to (16 for FLUX pictures; the Wan video model needs 32).
 */
export async function prepareSource(
  input: Buffer,
  { pixels = TARGET_PIXELS, step = 16 }: { pixels?: number; step?: number } = {},
): Promise<PreparedSource> {
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new Error('That file isn’t a picture Prism can read. Try a PNG, JPEG or WebP.');
  }
  if (!meta.width || !meta.height) throw new Error('That picture has no size.');

  // Phones say "rotate 90°" in the file instead of rotating it; account for that in the shape.
  const sideways = (meta.orientation ?? 1) >= 5;
  const w = sideways ? meta.height : meta.width;
  const h = sideways ? meta.width : meta.height;

  // Scale to the target size, keeping the shape, rounded to multiples of `step`.
  const scale = Math.sqrt(pixels / (w * h));
  const fit = (n: number) => Math.min(2048, Math.max(256, Math.round((n * scale) / step) * step));
  const width = fit(w);
  const height = fit(h);

  const png = await sharp(input)
    .rotate() // upright, using the phone's note
    .flatten({ background: '#000000' }) // see-through → black
    // "cover" fills the exact size; rounding to 16 may trim a few pixels off the edges.
    .resize(width, height, { fit: 'cover', kernel: 'lanczos3' })
    .png()
    .toBuffer();

  return { png, width, height };
}
