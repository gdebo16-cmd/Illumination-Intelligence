// Makes square home-screen icons from the logo symbol in each banner.
//
//   node scripts/make-icons.mjs          (run from apps/suite)
//
// Each banner in public/brand/ is a symbol followed by the product name. This finds the
// symbol (the first bright shape from the left), places it centred on a square in the
// banner's own background colour, and writes public/icons/<name>-180.png (iPhone home
// screen) and <name>-512.png (larger devices). Run it again whenever a banner changes.

import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const BRANDS = ['lumen', 'prism', 'umbra', 'eclipse', 'halo'];
const SRC = 'public/brand';
const OUT = 'public/icons';
const BRIGHT = 70;        // 0-255: a column counts as "drawing" if any pixel in it is this bright
const GAP = 30;           // px: bright columns closer than this belong to the same shape
const SYMBOL_SHARE = 0.68; // how much of the icon's width the symbol fills

fs.mkdirSync(OUT, { recursive: true });

// Find the symbol's bounding box: first run of bright columns, then the bright rows inside it.
async function findSymbol(file) {
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const at = (x, y) => data[y * width + x];

  const bright = [];
  for (let x = 0; x < width; x++) {
    let max = 0;
    for (let y = 0; y < height; y++) max = Math.max(max, at(x, y));
    bright.push(max >= BRIGHT);
  }
  let left = bright.indexOf(true);
  if (left < 0) throw new Error(`No bright shape found in ${file}`);
  let right = left;
  for (let x = left; x < width && x - right <= GAP; x++) if (bright[x]) right = x;

  let top = height, bottom = 0;
  for (let y = 0; y < height; y++)
    for (let x = left; x <= right; x++)
      if (at(x, y) >= BRIGHT) { top = Math.min(top, y); bottom = Math.max(bottom, y); }

  return { left, top, width: right - left + 1, height: bottom - top + 1, imageWidth: width, imageHeight: height };
}

// The banner's background colour, taken from its top-left corner.
async function cornerColour(file) {
  const { data } = await sharp(file).extract({ left: 0, top: 0, width: 8, height: 8 }).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const avg = (o) => Math.round([...Array(64).keys()].reduce((s, i) => s + data[i * 3 + o], 0) / 64);
  return { r: avg(0), g: avg(1), b: avg(2) };
}

for (const name of BRANDS) {
  const file = path.join(SRC, `${name}.png`);
  const box = await findSymbol(file);
  const background = await cornerColour(file);

  // Cut out the symbol with a little margin so its glow comes along, kept square.
  // 1.45 keeps the whole symbol inside the fully-visible middle of the round fade below.
  const side = Math.round(Math.max(box.width, box.height) * 1.45);
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
  const cutLeft = Math.max(0, Math.round(cx - side / 2));
  const cutTop = Math.max(0, Math.round(cy - side / 2));
  const cutW = Math.min(side, box.imageWidth - cutLeft);
  const cutH = Math.min(side, box.imageHeight - cutTop);

  // Soft round mask, so the cut-out fades into the background with no visible edge.
  // (dest-in keeps the cut-out only where the mask is opaque, fading with it.)
  const mask = Buffer.from(
    `<svg width="${cutW}" height="${cutH}"><defs><radialGradient id="g">` +
    `<stop offset="70%" stop-color="#fff" stop-opacity="1"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/>` +
    `</radialGradient></defs>` +
    `<ellipse cx="${cutW / 2}" cy="${cutH / 2}" rx="${cutW / 2}" ry="${cutH / 2}" fill="url(#g)"/></svg>`,
  );
  const cut = await sharp(file)
    .extract({ left: cutLeft, top: cutTop, width: cutW, height: cutH })
    .removeAlpha()
    .ensureAlpha()
    .png()
    .toBuffer();
  const symbol = await sharp(cut).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();

  for (const size of [180, 512]) {
    const symbolSize = Math.round(size * SYMBOL_SHARE * (side / Math.max(box.width, box.height)) / 1.0);
    const scaled = await sharp(symbol).resize(Math.min(symbolSize, size), Math.min(symbolSize, size), { fit: 'contain', background: { ...background, alpha: 0 } }).toBuffer();
    const meta = await sharp(scaled).metadata();
    await sharp({ create: { width: size, height: size, channels: 3, background } })
      .composite([{ input: scaled, left: Math.round((size - meta.width) / 2), top: Math.round((size - meta.height) / 2) }])
      .png()
      .toFile(path.join(OUT, `${name}-${size}.png`));
  }
  console.log(`${name}: symbol ${box.width}x${box.height} at x=${box.left}, y=${box.top}; background rgb(${background.r},${background.g},${background.b})`);
}
