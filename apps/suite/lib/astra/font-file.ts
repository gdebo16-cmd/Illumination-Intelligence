// lib/astra/font-file.ts — turn an Astra font into a real TrueType font file (.ttf) you can install.
//
// A .ttf file is a set of tables, each answering one question a computer asks about the font:
//   glyf + loca  the letter outlines, and where each one starts in the file
//   cmap         which letter shape to use for each key you type (A and a both use your A)
//   hmtx         how wide each letter is
//   head, hhea, maxp, OS/2, post, name   sizes, line spacing, limits, and the font's name
//
// Font files can only hold filled outlines. Traced pictures already are outlines; pen strokes are
// lines, so each one is turned into overlapping pieces: a bar along every segment of the stroke and
// a round dot at every point (which gives the rounded ends and joints the pad draws).
//
// Coordinates: the pad's grid has y going DOWN with the baseline at 800. Fonts have y going UP with
// the baseline at 0, so a grid point (x, y) becomes (x, 800 - y). Outlines go clockwise around ink
// and counter-clockwise around holes, as TrueType expects.

import 'server-only';
import {
  BASELINE,
  CAP_LINE,
  GLYPH_SIZE,
  LETTERS,
  PEN_WIDTH,
  SIDE_SPACE,
  SPACE_WIDTH,
  type Glyph,
  type Glyphs,
  type Point,
} from '@/config/astra';

const UNITS_PER_EM = GLYPH_SIZE;
const ASCENDER = BASELINE; // the top of the grid
const DESCENDER = BASELINE - GLYPH_SIZE; // the bottom of the grid (negative: below the baseline)
const CAP_HEIGHT = BASELINE - CAP_LINE;
const DOT_SIDES = 16; // how many straight sides make up a round dot
const STROKE_TOLERANCE = 2; // simplify pen strokes this much (grid units) before outlining them

type Contour = Point[];
type OutlineGlyph = { contours: Contour[]; advance: number };

// ── Turning letters into outlines ───────────────────────────────────────────────────────────────

/** Signed area: positive = counter-clockwise (with y going up). */
function area(contour: Contour): number {
  let twice = 0;
  for (let i = 0; i < contour.length; i++) {
    const [x1, y1] = contour[i];
    const [x2, y2] = contour[(i + 1) % contour.length];
    twice += x1 * y2 - x2 * y1;
  }
  return twice / 2;
}

const clockwise = (contour: Contour) => (area(contour) > 0 ? [...contour].reverse() : contour);

/** Round to whole units and drop repeated points (including a last point equal to the first). */
function tidy(contour: Contour): Contour {
  const rounded = contour.map(([x, y]): Point => [Math.round(x), Math.round(y)]);
  return rounded.filter((p, i) => {
    const before = rounded[(i - 1 + rounded.length) % rounded.length];
    return rounded.length === 1 || p[0] !== before[0] || p[1] !== before[1];
  });
}

/** Drop points that barely change a stroke's path (Ramer–Douglas–Peucker). */
function simplifyStroke(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const todo: [number, number][] = [[0, points.length - 1]];
  while (todo.length) {
    const [a, b] = todo.pop()!;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const length = Math.hypot(bx - ax, by - ay);
    let far = -1;
    let farDistance = STROKE_TOLERANCE;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const distance = length === 0
        ? Math.hypot(px - ax, py - ay)
        : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (distance > farDistance) {
        far = i;
        farDistance = distance;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      todo.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** One pen stroke (already in font coordinates) → overlapping filled pieces. */
function outlineStroke(points: Point[]): Contour[] {
  const radius = PEN_WIDTH / 2;
  const pieces: Contour[] = [];
  for (const [cx, cy] of points) {
    const dot: Contour = [];
    for (let i = 0; i < DOT_SIDES; i++) {
      const angle = (i / DOT_SIDES) * Math.PI * 2;
      dot.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
    }
    pieces.push(dot);
  }
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const length = Math.hypot(bx - ax, by - ay);
    if (length === 0) continue;
    const nx = (-(by - ay) / length) * radius; // a step sideways from the line, half the pen wide
    const ny = ((bx - ax) / length) * radius;
    pieces.push([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]);
  }
  return pieces.map((piece) => clockwise(tidy(piece))).filter((piece) => piece.length >= 3);
}

/** One letter → outlines in font coordinates, placed SIDE_SPACE from the left, plus its width. */
function outlineGlyph(glyph: Glyph): OutlineGlyph | null {
  const toFont = ([x, y]: Point): Point => [x, BASELINE - y];
  const contours: Contour[] = [
    // Traced shapes are already clockwise around ink once y is flipped.
    ...glyph.shapes.map((shape) => tidy(shape.map(toFont))).filter((c) => c.length >= 3),
    ...glyph.strokes.flatMap((stroke) => outlineStroke(simplifyStroke(stroke).map(toFont))),
  ];
  if (contours.length === 0) return null;
  const left = Math.min(...contours.flat().map((p) => p[0]));
  const right = Math.max(...contours.flat().map((p) => p[0]));
  const shift = SIDE_SPACE - left;
  return {
    contours: contours.map((contour) => contour.map(([x, y]): Point => [x + shift, y])),
    advance: Math.round(right - left + 2 * SIDE_SPACE),
  };
}

/** The box shown for a character the font doesn't have: a rectangle with a rectangular hole. */
function notdefGlyph(): OutlineGlyph {
  const outer: Contour = [[100, 0], [100, CAP_HEIGHT], [500, CAP_HEIGHT], [500, 0]]; // clockwise
  const inner: Contour = [[150, 50], [450, 50], [450, CAP_HEIGHT - 50], [150, CAP_HEIGHT - 50]]; // the other way
  return { contours: [outer, inner], advance: 600 };
}

// ── Writing bytes ───────────────────────────────────────────────────────────────────────────────

/** Builds a table byte by byte. TrueType numbers are big-endian (most significant byte first). */
class Bytes {
  private parts: number[] = [];
  u8(n: number) { this.parts.push(n & 0xff); return this; }
  u16(n: number) { return this.u8(n >> 8).u8(n); }
  i16(n: number) { return this.u16(n < 0 ? n + 0x10000 : n); }
  u32(n: number) { return this.u16(Math.floor(n / 0x10000) & 0xffff).u16(n & 0xffff); }
  tag(text: string) { for (const c of text) this.u8(c.charCodeAt(0)); return this; }
  date(when: Date) {
    // Seconds since 1 January 1904, as a 64-bit number.
    const seconds = Math.floor(when.getTime() / 1000) + 2082844800;
    return this.u32(Math.floor(seconds / 0x100000000)).u32(seconds % 0x100000000);
  }
  bytes(data: Uint8Array) { for (const b of data) this.parts.push(b); return this; }
  get length() { return this.parts.length; }
  done() { return Uint8Array.from(this.parts); }
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum = (sum + ((data[i] << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0))) >>> 0;
  }
  return sum;
}

const log2Floor = (n: number) => Math.floor(Math.log2(n));

// ── The tables ──────────────────────────────────────────────────────────────────────────────────

function glyfTable(glyphs: (OutlineGlyph | null)[]) {
  const glyf = new Bytes();
  const offsets: number[] = [];
  for (const glyph of glyphs) {
    offsets.push(glyf.length);
    if (!glyph) continue; // an empty glyph (the space) takes no room
    const points = glyph.contours.flat();
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    glyf.i16(glyph.contours.length)
      .i16(Math.min(...xs)).i16(Math.min(...ys)).i16(Math.max(...xs)).i16(Math.max(...ys));
    let end = -1;
    for (const contour of glyph.contours) glyf.u16((end += contour.length));
    glyf.u16(0); // no hinting instructions
    for (let i = 0; i < points.length; i++) glyf.u8(0x01); // every point is on the outline (straight lines)
    // Each point is stored as the step from the point before it.
    let last = 0;
    for (const [x] of points) { glyf.i16(x - last); last = x; }
    last = 0;
    for (const [, y] of points) { glyf.i16(y - last); last = y; }
    while (glyf.length % 4) glyf.u8(0);
  }
  offsets.push(glyf.length);
  const loca = new Bytes();
  for (const offset of offsets) loca.u32(offset);
  return { glyf: glyf.done(), loca: loca.done() };
}

function cmapTable(map: Map<number, number>) {
  // Format 4: one small range per character, then the 0xFFFF end marker every cmap needs.
  const codes = [...map.keys()].sort((a, b) => a - b);
  const segments = [...codes.map((code) => ({ code, glyph: map.get(code)! })), { code: 0xffff, glyph: 0 }];
  const segCount = segments.length;
  const searchRange = 2 * 2 ** log2Floor(segCount);
  const sub = new Bytes();
  sub.u16(4).u16(16 + 8 * segCount).u16(0)
    .u16(segCount * 2).u16(searchRange).u16(log2Floor(segCount)).u16(segCount * 2 - searchRange);
  for (const s of segments) sub.u16(s.code); // end codes
  sub.u16(0);
  for (const s of segments) sub.u16(s.code); // start codes
  for (const s of segments) sub.u16(s.code === 0xffff ? 1 : (s.glyph - s.code + 0x10000) % 0x10000); // deltas
  for (let i = 0; i < segCount; i++) sub.u16(0); // range offsets
  // Two lookups (Unicode, and Windows Unicode) sharing that one subtable.
  return new Bytes().u16(0).u16(2).u16(0).u16(3).u32(20).u16(3).u16(1).u32(20).bytes(sub.done()).done();
}

function nameTable(family: string, postscript: string, made: Date) {
  const records: [number, string][] = [
    [1, family],
    [2, 'Regular'],
    [3, `Astra: ${family}: ${made.toISOString().slice(0, 10)}`],
    [4, family],
    [5, 'Version 1.000'],
    [6, postscript],
  ];
  const strings = new Bytes();
  const table = new Bytes().u16(0).u16(records.length).u16(6 + 12 * records.length);
  for (const [id, text] of records) {
    const start = strings.length;
    for (const c of text) {
      // UTF-16, big-endian (characters beyond U+FFFF become two parts).
      const code = c.codePointAt(0)!;
      if (code > 0xffff) strings.u16(0xd800 + ((code - 0x10000) >> 10)).u16(0xdc00 + ((code - 0x10000) & 0x3ff));
      else strings.u16(code);
    }
    table.u16(3).u16(1).u16(0x0409).u16(id).u16(strings.length - start).u16(start); // Windows, Unicode, English
  }
  return table.bytes(strings.done()).done();
}

/** Build the .ttf file for a font. Returns null if no letters have been made yet. */
export function buildFontFile(name: string, glyphs: Glyphs): Uint8Array | null {
  const letters = LETTERS.filter((letter) => glyphs[letter]);
  const outlined = letters.map((letter) => ({ letter, glyph: outlineGlyph(glyphs[letter]) }))
    .filter((entry): entry is { letter: string; glyph: OutlineGlyph } => entry.glyph !== null);
  if (outlined.length === 0) return null;

  // Glyph 0 must be the "missing character" box, then the space, then the letters.
  const all: (OutlineGlyph | null)[] = [notdefGlyph(), null, ...outlined.map((e) => e.glyph)];
  const advances = [600, SPACE_WIDTH, ...outlined.map((e) => e.glyph.advance)];
  const charMap = new Map<number, number>([[0x20, 1]]);
  outlined.forEach((entry, i) => {
    charMap.set(entry.letter.charCodeAt(0), i + 2); // A
    charMap.set(entry.letter.toLowerCase().charCodeAt(0), i + 2); // a uses the same shape, until lowercase exists
  });

  const points = all.flatMap((g) => (g ? g.contours.flat() : []));
  const xMin = Math.min(...points.map((p) => p[0]));
  const yMin = Math.min(...points.map((p) => p[1]));
  const xMax = Math.max(...points.map((p) => p[0]));
  const yMax = Math.max(...points.map((p) => p[1]));
  const leftSides = all.map((g) => (g ? Math.min(...g.contours.flat().map((p) => p[0])) : 0));
  const rightEdges = all.map((g) => (g ? Math.max(...g.contours.flat().map((p) => p[0])) : 0));
  const made = new Date();
  const family = name.trim() || 'Astra Font';
  const postscript = (family.replace(/[^A-Za-z0-9-]/g, '') || 'AstraFont').slice(0, 63);

  const { glyf, loca } = glyfTable(all);
  const hmtx = new Bytes();
  all.forEach((_, i) => hmtx.u16(advances[i]).i16(leftSides[i]));

  const tables: Record<string, Uint8Array> = {
    head: new Bytes()
      .u32(0x00010000).u32(0x00010000).u32(0) // version, font revision, checksum fix (filled in below)
      .u32(0x5f0f3cf5).u16(0x000b).u16(UNITS_PER_EM) // magic number, flags, units per em
      .date(made).date(made)
      .i16(xMin).i16(yMin).i16(xMax).i16(yMax)
      .u16(0).u16(8).i16(2).i16(1).i16(0) // style, smallest size, direction, long loca, glyph format
      .done(),
    hhea: new Bytes()
      .u32(0x00010000).i16(ASCENDER).i16(DESCENDER).i16(0)
      .u16(Math.max(...advances)).i16(Math.min(...leftSides))
      .i16(Math.min(...all.map((g, i) => (g ? advances[i] - rightEdges[i] : 0))))
      .i16(Math.max(...rightEdges))
      .i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0) // caret, reserved
      .u16(all.length)
      .done(),
    maxp: new Bytes()
      .u32(0x00010000).u16(all.length)
      .u16(Math.max(...all.map((g) => (g ? g.contours.flat().length : 0))))
      .u16(Math.max(...all.map((g) => (g ? g.contours.length : 0))))
      .u16(0).u16(0).u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0)
      .done(),
    'OS/2': new Bytes()
      .u16(4).i16(Math.round(advances.reduce((a, b) => a + b, 0) / advances.length))
      .u16(400).u16(5).u16(0) // normal weight, normal width, installable anywhere
      .i16(650).i16(600).i16(0).i16(75).i16(650).i16(600).i16(0).i16(350).i16(50).i16(300) // sub/superscript, strikeout
      .i16(0).bytes(new Uint8Array(10)) // family class, PANOSE
      .u32(1).u32(0).u32(0).u32(0) // Basic Latin
      .tag('ASTR').u16(0x0040) // vendor, Regular
      .u16(Math.min(...charMap.keys())).u16(Math.max(...charMap.keys()))
      .i16(ASCENDER).i16(DESCENDER).i16(0)
      .u16(Math.max(ASCENDER, yMax)).u16(Math.max(-DESCENDER, -yMin))
      .u32(1).u32(0) // Latin 1 code page
      .i16(Math.round(CAP_HEIGHT * 0.7)).i16(CAP_HEIGHT).u16(0).u16(0x20).u16(0)
      .done(),
    hmtx: hmtx.done(),
    cmap: cmapTable(charMap),
    loca,
    glyf,
    name: nameTable(family, postscript, made),
    post: new Bytes().u32(0x00030000).u32(0).i16(-100).i16(50).u32(0).u32(0).u32(0).u32(0).u32(0).done(),
  };

  // The file: a directory listing every table (sorted by tag), then the tables, each padded to 4 bytes.
  const tags = Object.keys(tables).sort();
  const searchRange = 16 * 2 ** log2Floor(tags.length);
  const file = new Bytes()
    .u32(0x00010000).u16(tags.length).u16(searchRange).u16(log2Floor(tags.length)).u16(tags.length * 16 - searchRange);
  let offset = 12 + 16 * tags.length;
  for (const tag of tags) {
    file.tag(tag).u32(checksum(tables[tag])).u32(offset).u32(tables[tag].length);
    offset += Math.ceil(tables[tag].length / 4) * 4;
  }
  for (const tag of tags) {
    file.bytes(tables[tag]);
    while (file.length % 4) file.u8(0);
  }
  const bytes = file.done();

  // Finally, the head table's "checksum fix" makes the whole file add up to a set number.
  const headOffset = 12 + 16 * tags.length + tags.slice(0, tags.indexOf('head'))
    .reduce((sum, tag) => sum + Math.ceil(tables[tag].length / 4) * 4, 0);
  const fix = (0xb1b0afba - checksum(bytes) + 0x100000000) % 0x100000000;
  new DataView(bytes.buffer).setUint32(headOffset + 8, fix);
  return bytes;
}
