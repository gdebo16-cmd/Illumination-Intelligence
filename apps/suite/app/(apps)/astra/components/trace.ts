// trace.ts — turn an uploaded picture of a letter into filled shapes for the font.
//
// It all happens in the browser, in five steps:
//   1. Shrink the picture to a working size and turn it grey.
//   2. Decide which pixels are "ink": the darker side of an automatically chosen cut-off
//      (or the lighter side, for a light letter on a dark background).
//   3. Walk around the edges of the ink to get outlines (holes, like the middle of an O, too).
//   4. Smooth the jagged pixel steps and drop extra points, and throw away specks of dust.
//   5. Scale and move the outlines so the letter sits between the cap line and the baseline.

import { BASELINE, CAP_LINE, GLYPH_SIZE, MAX_SHAPE_POINTS, MAX_SHAPES, type Point, type Shape } from "@/config/astra";

/** The longest side of the picture while tracing, in pixels. Bigger = finer detail, but slower. */
const WORK_SIZE = 400;
/** At most this many points across all the shapes of one letter. */
const MAX_TOTAL_POINTS = 6000;

export async function traceImage(file: File): Promise<Shape[]> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That file couldn't be opened as a picture.");
  });

  // 1. Draw it onto a white canvas at the working size (a see-through background becomes white).
  const scale = Math.min(4, WORK_SIZE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser can't read pictures.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // 2–5.
  const ink = findInk(ctx.getImageData(0, 0, width, height).data, width, height);
  const outlines = traceOutlines(ink, width, height);
  const shapes = fitToGrid(cleanUp(outlines));
  if (shapes.length === 0) {
    throw new Error("Couldn't find a letter in that picture. A dark letter on a plain light background works best.");
  }
  return shapes;
}

// ── 2. Which pixels are ink ─────────────────────────────────────────────────────────────────────

function findInk(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const count = width * height;
  const grey = new Uint8Array(count);
  const histogram = new Array<number>(256).fill(0);
  let darkest = 255;
  let lightest = 0;
  for (let i = 0; i < count; i++) {
    const value = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
    grey[i] = value;
    histogram[value]++;
    darkest = Math.min(darkest, value);
    lightest = Math.max(lightest, value);
  }
  const ink = new Uint8Array(count);
  if (lightest - darkest < 30) return ink; // nearly one flat colour: nothing to trace

  const cutOff = otsuThreshold(histogram, count);
  let darkPixels = 0;
  for (let i = 0; i < count; i++) if (grey[i] < cutOff) darkPixels++;
  // A letter usually covers less of the picture than its background, so the smaller side is the ink.
  const darkIsInk = darkPixels <= count / 2;
  for (let i = 0; i < count; i++) ink[i] = (grey[i] < cutOff) === darkIsInk ? 1 : 0;
  return ink;
}

/** Otsu's method: the grey level that best splits the picture into two groups (ink and paper). */
function otsuThreshold(histogram: number[], total: number): number {
  let sumAll = 0;
  for (let level = 0; level < 256; level++) sumAll += level * histogram[level];
  let sumDark = 0;
  let countDark = 0;
  let best = -1;
  let cutOff = 128;
  for (let level = 0; level < 256; level++) {
    countDark += histogram[level];
    if (countDark === 0) continue;
    const countLight = total - countDark;
    if (countLight === 0) break;
    sumDark += level * histogram[level];
    const meanDark = sumDark / countDark;
    const meanLight = (sumAll - sumDark) / countLight;
    const between = countDark * countLight * (meanDark - meanLight) ** 2;
    if (between > best) {
      best = between;
      cutOff = level + 1; // grey < cutOff is the dark group
    }
  }
  return cutOff;
}

// ── 3. Walk around the ink ──────────────────────────────────────────────────────────────────────

// Every side of an ink pixel that touches paper becomes a one-pixel edge between two pixel corners,
// pointing so the ink is always on its right. Joining those edges end to end gives closed outlines:
// clockwise around ink, and the other way around holes — which is what fonts expect.
function traceOutlines(ink: Uint8Array, width: number, height: number): Point[][] {
  const cornersAcross = width + 1;
  const corner = (x: number, y: number) => y * cornersAcross + x;
  const isInk = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && ink[y * width + x] === 1;

  // Each corner has at most two edges leaving it (where two ink pixels only touch diagonally).
  const nextA = new Int32Array(cornersAcross * (height + 1)).fill(-1);
  const nextB = new Int32Array(cornersAcross * (height + 1)).fill(-1);
  const addEdge = (from: number, to: number) => {
    if (nextA[from] < 0) nextA[from] = to;
    else nextB[from] = to;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isInk(x, y)) continue;
      if (!isInk(x, y - 1)) addEdge(corner(x, y), corner(x + 1, y)); // top side, going right
      if (!isInk(x + 1, y)) addEdge(corner(x + 1, y), corner(x + 1, y + 1)); // right side, going down
      if (!isInk(x, y + 1)) addEdge(corner(x + 1, y + 1), corner(x, y + 1)); // bottom side, going left
      if (!isInk(x - 1, y)) addEdge(corner(x, y + 1), corner(x, y)); // left side, going up
    }
  }

  const takeEdge = (from: number) => {
    let to = nextA[from];
    if (to >= 0) nextA[from] = -1;
    else {
      to = nextB[from];
      nextB[from] = -1;
    }
    return to;
  };
  const outlines: Point[][] = [];
  for (let start = 0; start < nextA.length; start++) {
    while (nextA[start] >= 0 || nextB[start] >= 0) {
      const outline: Point[] = [];
      let at = start;
      do {
        outline.push([at % cornersAcross, Math.floor(at / cornersAcross)]);
        at = takeEdge(at);
      } while (at >= 0 && at !== start);
      outlines.push(outline);
    }
  }
  return outlines;
}

// ── 4. Smooth, simplify, and drop specks ────────────────────────────────────────────────────────

/** Area inside an outline: positive around ink, negative around a hole. */
function area(points: Point[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    twice += x1 * y2 - x2 * y1;
  }
  return twice / 2;
}

/** Keep only the corners where the outline turns. */
function cornersOnly(points: Point[]): Point[] {
  return points.filter((point, i) => {
    const before = points[(i - 1 + points.length) % points.length];
    const after = points[(i + 1) % points.length];
    return Math.sign(point[0] - before[0]) !== Math.sign(after[0] - point[0]) ||
      Math.sign(point[1] - before[1]) !== Math.sign(after[1] - point[1]);
  });
}

/** Use the middle of each side instead of its ends: turns pixel staircases into smooth slopes. */
function midpoints(points: Point[]): Point[] {
  return points.map((point, i) => {
    const after = points[(i + 1) % points.length];
    return [(point[0] + after[0]) / 2, (point[1] + after[1]) / 2];
  });
}

/** How far point p is from the line segment a–b. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ramer–Douglas–Peucker: drop points that are within `tolerance` of a straight line between their neighbours. */
function simplifyLine(points: Point[], tolerance: number): Point[] {
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const todo: [number, number][] = [[0, points.length - 1]];
  while (todo.length > 0) {
    const [first, last] = todo.pop()!;
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const distance = distanceToSegment(points[i], points[first], points[last]);
      if (distance > farthestDistance) {
        farthest = i;
        farthestDistance = distance;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      todo.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** The same, for a closed outline: split it at the point farthest from the start, simplify both halves. */
function simplifyOutline(points: Point[], tolerance: number): Point[] {
  if (points.length < 4) return points;
  let far = 0;
  let farDistance = -1;
  for (let i = 1; i < points.length; i++) {
    const distance = Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]);
    if (distance > farDistance) {
      far = i;
      farDistance = distance;
    }
  }
  const firstHalf = simplifyLine(points.slice(0, far + 1), tolerance);
  const secondHalf = simplifyLine([...points.slice(far), points[0]], tolerance);
  return [...firstHalf.slice(0, -1), ...secondHalf.slice(0, -1)];
}

function cleanUp(outlines: Point[][]): Point[][] {
  const withArea = outlines.map((points) => ({ points, size: Math.abs(area(points)) }));
  const largest = Math.max(0, ...withArea.map((o) => o.size));
  // Specks of dust and tiny gaps: anything under 1% of the biggest outline.
  const kept = withArea
    .filter((o) => o.size >= Math.max(8, largest * 0.01))
    .sort((a, b) => b.size - a.size)
    .slice(0, MAX_SHAPES)
    .map((o) => midpoints(cornersOnly(o.points)));

  // Simplify, and simplify harder if the letter still has too many points.
  for (let tolerance = 0.75; ; tolerance *= 2) {
    const simple = kept.map((points) => simplifyOutline(points, tolerance)).filter((points) => points.length >= 3);
    const total = simple.reduce((sum, points) => sum + points.length, 0);
    const fits = total <= MAX_TOTAL_POINTS && simple.every((points) => points.length <= MAX_SHAPE_POINTS);
    if (fits || tolerance > 16) return simple;
  }
}

// ── 5. Place it on the letter grid ──────────────────────────────────────────────────────────────

function fitToGrid(outlines: Point[][]): Shape[] {
  const all = outlines.flat();
  if (all.length === 0) return [];
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  // As tall as a capital (cap line to baseline), unless that would make it wider than the square.
  const scale = Math.min((BASELINE - CAP_LINE) / Math.max(1, bottom - top), (GLYPH_SIZE * 0.9) / Math.max(1, right - left));
  const offsetX = (GLYPH_SIZE - (right - left) * scale) / 2 - left * scale;
  const offsetY = BASELINE - bottom * scale; // the bottom of the letter sits on the baseline

  return outlines
    .map((points) => {
      const placed = points.map(([x, y]): Point => [Math.round(x * scale + offsetX), Math.round(y * scale + offsetY)]);
      // Rounding can put two points in the same spot; keep just one.
      return placed.filter((p, i) => {
        const before = placed[(i - 1 + placed.length) % placed.length];
        return p[0] !== before[0] || p[1] !== before[1];
      });
    })
    .filter((points) => points.length >= 3);
}
