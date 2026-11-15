// Reads an uploaded .svg file and pulls out every outline in it, as path text for lib/halo/path.ts.
// Understands <path>, <circle>, <ellipse>, <rect>, <polygon> and <polyline>. Things it skips, like
// transforms, gradients and text, are listed in `skipped` so Halo can say so.

import { ovalPath } from '@/config/halo';
import { parsePath, type Bezier } from '@/lib/halo/path';

export interface SvgShape {
  paths: Bezier[];
  skipped: string[];
}

const n = (el: Element, attr: string) => Number(el.getAttribute(attr) ?? 0);

export function readSvg(text: string): SvgShape {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error("That file isn't a readable SVG.");

  const pieces: string[] = [];
  const skipped = new Set<string>();
  for (const el of Array.from(doc.querySelectorAll('path, circle, ellipse, rect, polygon, polyline'))) {
    if (el.closest('defs, clipPath, mask')) continue; // helpers, not things that are drawn
    if (el.closest('[transform]')) skipped.add('moved or rotated parts (transforms)');
    switch (el.tagName.toLowerCase()) {
      case 'path':
        pieces.push(el.getAttribute('d') ?? '');
        break;
      case 'circle':
        pieces.push(ovalPath(n(el, 'cx'), n(el, 'cy'), n(el, 'r'), n(el, 'r')));
        break;
      case 'ellipse':
        pieces.push(ovalPath(n(el, 'cx'), n(el, 'cy'), n(el, 'rx'), n(el, 'ry')));
        break;
      case 'rect': {
        const [x, y, w, h] = [n(el, 'x'), n(el, 'y'), n(el, 'width'), n(el, 'height')];
        pieces.push(`M${x} ${y} H${x + w} V${y + h} H${x} Z`);
        break;
      }
      default: {
        const points = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
        const pairs = [];
        for (let k = 0; k + 1 < points.length; k += 2) pairs.push(`${points[k]} ${points[k + 1]}`);
        if (pairs.length > 1) pieces.push(`M${pairs.join(' L')}${el.tagName.toLowerCase() === 'polygon' ? ' Z' : ''}`);
      }
    }
  }
  if (doc.querySelector('text')) skipped.add('text (turn it into outlines first)');

  const paths: Bezier[] = [];
  for (const d of pieces) {
    const parsed = parsePath(d);
    if (parsed.approximated) skipped.add('arcs (drawn as straight lines)');
    paths.push(...parsed.paths);
  }
  if (!paths.length) throw new Error('No shapes found in that SVG.');
  return { paths, skipped: [...skipped] };
}
