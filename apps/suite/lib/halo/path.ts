// Turns SVG path text (the d="M10 20 C ..." part of an SVG) into the curve format Lottie uses.
//
// Both describe shapes as points joined by Bézier curves. The difference is bookkeeping: SVG says
// "curve to here, using these two handles", while Lottie stores every point with its own two
// handles (in = the handle coming into the point, out = the one leaving it), measured from the point.
//
// Handles M L H V C S Q T Z, in capitals (exact spots) and lowercase (steps from the last spot).
// Arcs (A) are drawn as straight lines for now, and `approximated` says when that happened.

export type Point = [number, number];

/** One unbroken outline, in Lottie's layout. */
export interface Bezier {
  closed: boolean;
  /** The points. */
  v: Point[];
  /** Each point's incoming handle, measured from the point. */
  i: Point[];
  /** Each point's outgoing handle, measured from the point. */
  o: Point[];
}

export interface ParsedPath {
  paths: Bezier[];
  approximated: boolean;
}

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const near = (a: Point, b: Point) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

export function parsePath(d: string): ParsedPath {
  const tokens = d.match(/[a-df-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const paths: Bezier[] = [];
  let approximated = false;
  let path: Bezier | null = null;
  let cur: Point = [0, 0];
  let start: Point = [0, 0];
  let lastCubic: Point | null = null; // the last curve's second handle, for S
  let lastQuad: Point | null = null; // the last Q's handle, for T
  let cmd = '';
  let k = 0;

  const isCommand = (t: string) => /^[a-z]$/i.test(t);
  const num = () => Number(tokens[k++]);

  const finish = () => {
    if (path && path.v.length > 1) paths.push(path);
    path = null;
  };
  const ensurePath = (): Bezier => {
    if (!path) path = { closed: false, v: [cur], i: [[0, 0]], o: [[0, 0]] };
    return path;
  };
  const lineTo = (p: Point) => {
    const pa = ensurePath();
    pa.v.push(p);
    pa.i.push([0, 0]);
    pa.o.push([0, 0]);
    cur = p;
    lastCubic = lastQuad = null;
  };
  const curveTo = (c1: Point, c2: Point, p: Point) => {
    const pa = ensurePath();
    pa.o[pa.v.length - 1] = sub(c1, cur);
    pa.v.push(p);
    pa.i.push(sub(c2, p));
    pa.o.push([0, 0]);
    cur = p;
    lastCubic = c2;
    lastQuad = null;
  };
  // A Q curve has one handle; Lottie needs two. Each one sits two thirds of the way to it.
  const quadTo = (q: Point, p: Point) => {
    const from = cur;
    curveTo(
      [from[0] + (2 / 3) * (q[0] - from[0]), from[1] + (2 / 3) * (q[1] - from[1])],
      [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])],
      p,
    );
    lastCubic = null;
    lastQuad = q;
  };

  while (k < tokens.length) {
    if (isCommand(tokens[k])) cmd = tokens[k++];
    else if (!cmd) break; // numbers before any command: not a real path
    const rel = cmd === cmd.toLowerCase();
    const at = (): Point => {
      const x = num();
      const y = num();
      return rel ? [cur[0] + x, cur[1] + y] : [x, y];
    };
    const mirror = (handle: Point | null): Point => (handle ? [2 * cur[0] - handle[0], 2 * cur[1] - handle[1]] : cur);

    switch (cmd.toUpperCase()) {
      case 'M': {
        finish();
        cur = start = at();
        path = { closed: false, v: [cur], i: [[0, 0]], o: [[0, 0]] };
        lastCubic = lastQuad = null;
        cmd = rel ? 'l' : 'L'; // more numbers after M mean "line to"
        break;
      }
      case 'L':
        lineTo(at());
        break;
      case 'H': {
        const x = num();
        lineTo([rel ? cur[0] + x : x, cur[1]]);
        break;
      }
      case 'V': {
        const y = num();
        lineTo([cur[0], rel ? cur[1] + y : y]);
        break;
      }
      case 'C': {
        const c1 = at();
        const c2 = at();
        curveTo(c1, c2, at());
        break;
      }
      case 'S': {
        const c1 = mirror(lastCubic);
        const c2 = at();
        curveTo(c1, c2, at());
        break;
      }
      case 'Q': {
        const q = at();
        quadTo(q, at());
        break;
      }
      case 'T':
        quadTo(mirror(lastQuad), at());
        break;
      case 'A': {
        k += 5; // radius x, radius y, tilt, large-arc flag, sweep flag
        lineTo(at());
        approximated = true;
        break;
      }
      case 'Z': {
        const pa = path as Bezier | null;
        if (pa) {
          const last = pa.v.length - 1;
          // Ending exactly on the first point: merge the two, so there's no doubled point.
          if (last > 0 && near(pa.v[last], pa.v[0])) {
            pa.i[0] = pa.i[last];
            pa.v.pop();
            pa.i.pop();
            pa.o.pop();
          }
          pa.closed = true;
          if (pa.v.length > 1) paths.push(pa);
          path = null;
        }
        cur = start;
        lastCubic = lastQuad = null;
        cmd = '';
        break;
      }
      default:
        k++; // a letter we don't know: skip it
    }
  }
  finish();
  return { paths, approximated };
}

export interface Fitted {
  paths: Bezier[];
  /** How far below the middle the shape's lowest point is, after fitting. */
  bottom: number;
}

/** Shrink or grow the outlines so the bigger side is `size` across, centred on 0,0. */
export function fitPaths(paths: Bezier[], size: number): Fitted {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) {
    for (const [x, y] of p.v) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return { paths: [], bottom: 0 };
  const scale = size / Math.max(maxX - minX, maxY - minY, 1e-6);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const move = ([x, y]: Point): Point => [(x - cx) * scale, (y - cy) * scale];
  const stretch = ([x, y]: Point): Point => [x * scale, y * scale];
  return {
    paths: paths.map((p) => ({ closed: p.closed, v: p.v.map(move), i: p.i.map(stretch), o: p.o.map(stretch) })),
    bottom: ((maxY - minY) / 2) * scale,
  };
}

/** Back to SVG path text, for drawing a small picture of an uploaded shape. */
export function toSvgPath(paths: Bezier[]): string {
  const f = (n: number) => Math.round(n * 100) / 100;
  return paths
    .map((p) => {
      const parts = [`M${f(p.v[0][0])} ${f(p.v[0][1])}`];
      const count = p.closed ? p.v.length : p.v.length - 1;
      for (let n = 0; n < count; n++) {
        const a = p.v[n];
        const b = p.v[(n + 1) % p.v.length];
        const c1 = [a[0] + p.o[n][0], a[1] + p.o[n][1]];
        const c2 = [b[0] + p.i[(n + 1) % p.v.length][0], b[1] + p.i[(n + 1) % p.v.length][1]];
        parts.push(`C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(b[0])} ${f(b[1])}`);
      }
      return parts.join(' ') + (p.closed ? ' Z' : '');
    })
    .join(' ');
}
