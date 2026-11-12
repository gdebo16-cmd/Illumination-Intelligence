// trace.ts — turn an uploaded picture into filled shapes for the font.
//
// traceImage: a picture of ONE letter. traceSheet: a picture of a whole alphabet, split into letters.
// It all happens in the browser:
//   1. Shrink the picture to a working size and turn it grey.
//   2. Decide which pixels are "ink": the darker side of an automatically chosen cut-off
//      (or the lighter side, for a light letter on a dark background).
//   3. Walk around the edges of the ink to get outlines (holes, like the middle of an O, too).
//   4. Throw away specks of dust, then smooth the jagged pixel steps and drop extra points.
//   5. Scale and move the outlines so the letter sits between the cap line and the baseline.
// A sheet adds a step between 4 and 5: sort the outlines into letters, rows, and reading order.

import { BASELINE, CAP_LINE, GLYPH_SIZE, MAX_SHAPE_POINTS, MAX_SHAPES, type Point, type Shape } from "@/config/astra";

/** The longest side of the picture while tracing, in pixels. Bigger = finer detail, but slower. */
const WORK_SIZE = 400;
/** A sheet holds many letters, so it's traced bigger. */
const SHEET_WORK_SIZE = 1600;
/** At most this many points across all the shapes of one letter. */
const MAX_TOTAL_POINTS = 6000;
/** At most this many letters on one sheet. */
const MAX_SHEET_LETTERS = 60;

/** Trace a picture of one letter. */
export async function traceImage(file: File): Promise<Shape[]> {
  const { ink, width, height } = await loadInk(file, WORK_SIZE);
  const outlines = withoutSpecks(traceOutlines(ink, width, height))
    .sort((a, b) => Math.abs(b.area) - Math.abs(a.area))
    .slice(0, MAX_SHAPES);
  const shapes = fitToGrid(simplifyLetter(outlines.map((o) => smooth(o.points))));
  if (shapes.length === 0) {
    throw new Error("Couldn't find a letter in that picture. A dark letter on a plain light background works best.");
  }
  return shapes;
}

/** Trace a picture of many letters written in rows. Gives the letters in reading order (rows top to
 *  bottom, each row left to right), each already placed on the letter grid. */
export async function traceSheet(file: File): Promise<Shape[][]> {
  const { ink, width, height } = await loadInk(file, SHEET_WORK_SIZE);
  const rows = readingOrder(withoutSpecks(traceOutlines(ink, width, height)));
  const count = rows.reduce((sum, row) => sum + row.letters.length, 0);
  if (count === 0) {
    throw new Error("Couldn't find any letters in that picture. Dark letters on plain light paper work best.");
  }
  if (count > MAX_SHEET_LETTERS) {
    throw new Error(`Found ${count} separate marks, which is too many. Try a cleaner photo with just the letters.`);
  }
  return rows.flatMap((row) =>
    row.letters.map((outlines) => placeOnRow(simplifyLetter(outlines.map(smooth)), row)),
  );
}

// ── 1. Load the picture ─────────────────────────────────────────────────────────────────────────

async function loadInk(file: File, workSize: number) {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That file couldn't be opened as a picture.");
  });
  // Draw it onto a white canvas at the working size (a see-through background becomes white).
  const scale = Math.min(4, workSize / Math.max(bitmap.width, bitmap.height));
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
  return { ink: findInk(ctx.getImageData(0, 0, width, height).data, width, height), width, height };
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

type Outline = { points: Point[]; area: number }; // area > 0 around ink, < 0 around a hole

/** Measure each outline, and drop specks of dust and tiny gaps: anything under 1% of the biggest one. */
function withoutSpecks(outlines: Point[][]): Outline[] {
  const measured = outlines.map((points) => ({ points, area: area(points) }));
  const largest = Math.max(0, ...measured.map((o) => Math.abs(o.area)));
  return measured.filter((o) => Math.abs(o.area) >= Math.max(8, largest * 0.01));
}

const smooth = (points: Point[]) => midpoints(cornersOnly(points));

/** Simplify one letter's outlines, and simplify harder if it still has too many points. */
function simplifyLetter(outlines: Point[][]): Point[][] {
  for (let tolerance = 0.75; ; tolerance *= 2) {
    const simple = outlines.map((points) => simplifyOutline(points, tolerance)).filter((points) => points.length >= 3);
    const total = simple.reduce((sum, points) => sum + points.length, 0);
    const fits = total <= MAX_TOTAL_POINTS && simple.every((points) => points.length <= MAX_SHAPE_POINTS);
    if (fits || tolerance > 16) return simple;
  }
}

// ── Sheets: sort the outlines into letters and rows ─────────────────────────────────────────────

type Box = { left: number; right: number; top: number; bottom: number };
const boxOf = (points: Point[]): Box => ({
  left: Math.min(...points.map((p) => p[0])),
  right: Math.max(...points.map((p) => p[0])),
  top: Math.min(...points.map((p) => p[1])),
  bottom: Math.max(...points.map((p) => p[1])),
});
const joinBoxes = (a: Box, b: Box): Box => ({
  left: Math.min(a.left, b.left),
  right: Math.max(a.right, b.right),
  top: Math.min(a.top, b.top),
  bottom: Math.max(a.bottom, b.bottom),
});
const isInside = (small: Box, big: Box) =>
  small.left >= big.left && small.right <= big.right && small.top >= big.top && small.bottom <= big.bottom;
/** How much two ranges overlap, compared with the shorter one (0 = not at all, 1 = fully). */
const overlap = (a1: number, a2: number, b1: number, b2: number) =>
  Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)) / Math.max(1, Math.min(a2 - a1, b2 - b1));
/** The middle value, so one unusual letter doesn't throw off the rest. */
const middle = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

type Piece = { outlines: Point[][]; box: Box };
type Row = { letters: Point[][][]; capHeight: number; baseline: number };

function readingOrder(outlines: Outline[]): Row[] {
  // Each piece of ink with its holes: a hole belongs to the smallest piece of ink around it.
  const inks = outlines
    .filter((o) => o.area > 0)
    .map((o) => ({ area: o.area, box: boxOf(o.points), outlines: [o.points] }));
  for (const hole of outlines.filter((o) => o.area < 0)) {
    const holeBox = boxOf(hole.points);
    const owner = inks.filter((ink) => isInside(holeBox, ink.box)).sort((a, b) => a.area - b.area)[0];
    owner?.outlines.push(hole.points);
  }

  // Rows: go down the page; a piece joins the row above if it sits mostly at the same height.
  const pieces: Piece[] = inks.map(({ outlines, box }) => ({ outlines, box }));
  pieces.sort((a, b) => a.box.top + a.box.bottom - (b.box.top + b.box.bottom));
  const rows: { pieces: Piece[]; box: Box }[] = [];
  for (const piece of pieces) {
    const row = rows[rows.length - 1];
    if (row && overlap(piece.box.top, piece.box.bottom, row.box.top, row.box.bottom) >= 0.5) {
      row.pieces.push(piece);
      row.box = joinBoxes(row.box, piece.box);
    } else {
      rows.push({ pieces: [piece], box: piece.box });
    }
  }

  return rows.map((row) => {
    // Left to right. Pieces stacked above each other (like a letter drawn with a gap in it) are one letter.
    row.pieces.sort((a, b) => a.box.left - b.box.left);
    const letters: Piece[] = [];
    for (const piece of row.pieces) {
      const last = letters[letters.length - 1];
      if (last && overlap(piece.box.left, piece.box.right, last.box.left, last.box.right) >= 0.5) {
        last.outlines.push(...piece.outlines);
        last.box = joinBoxes(last.box, piece.box);
      } else {
        letters.push({ outlines: [...piece.outlines], box: piece.box });
      }
    }
    // Capitals in a row share a height and a baseline: use the typical ones, so a Q's tail doesn't count.
    return {
      letters: letters.map((letter) => letter.outlines),
      capHeight: Math.max(1, middle(letters.map((l) => l.box.bottom - l.box.top))),
      baseline: middle(letters.map((l) => l.box.bottom)),
    };
  });
}

// ── 5. Place it on the letter grid ──────────────────────────────────────────────────────────────

/** Move every point, round to whole grid units, and drop points that land where the one before did. */
function toGrid(outlines: Point[][], move: (p: Point) => Point): Shape[] {
  return outlines
    .map((points) => {
      const placed = points.map((p): Point => {
        const [x, y] = move(p);
        return [Math.round(x), Math.round(y)];
      });
      return placed.filter((p, i) => {
        const before = placed[(i - 1 + placed.length) % placed.length];
        return p[0] !== before[0] || p[1] !== before[1];
      });
    })
    .filter((points) => points.length >= 3);
}

/** One letter on its own: as tall as a capital (cap line to baseline), unless that would make it
 *  wider than the square; centred across, with its bottom on the baseline. */
function fitToGrid(outlines: Point[][]): Shape[] {
  if (outlines.length === 0) return [];
  const box = boxOf(outlines.flat());
  const scale = Math.min(
    (BASELINE - CAP_LINE) / Math.max(1, box.bottom - box.top),
    (GLYPH_SIZE * 0.9) / Math.max(1, box.right - box.left),
  );
  const offsetX = (GLYPH_SIZE - (box.right - box.left) * scale) / 2 - box.left * scale;
  const offsetY = BASELINE - box.bottom * scale;
  return toGrid(outlines, ([x, y]) => [x * scale + offsetX, y * scale + offsetY]);
}

/** A letter from a sheet: scaled by its row, so letters keep their sizes compared with each other;
 *  sitting on the row's baseline (a Q's tail can hang below), centred across. */
function placeOnRow(outlines: Point[][], row: Row): Shape[] {
  if (outlines.length === 0) return [];
  const box = boxOf(outlines.flat());
  const scale = Math.min(
    (BASELINE - CAP_LINE) / row.capHeight,
    (GLYPH_SIZE * 0.95) / Math.max(1, box.right - box.left),
  );
  const centre = (box.left + box.right) / 2;
  return toGrid(outlines, ([x, y]) => [GLYPH_SIZE / 2 + (x - centre) * scale, BASELINE + (y - row.baseline) * scale]);
}
