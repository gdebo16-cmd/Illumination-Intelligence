// Flicker looks made in Halo. When you press "Add to Umbra" in Halo, the animation (a Lottie .json)
// is saved here as a file, under a random id, and the new Flicker's look is saved as "halo:<id>#color"
// (see config/umbra.ts). Umbra's avatar (Flame.tsx) loads the file by its id and plays it.
//
// The files live in data/umbra-looks, next to the database. They never change once saved, so the
// browser can keep them as long as it likes.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const LOOKS_DIR = path.join(process.cwd(), 'data', 'umbra-looks');
/** The biggest animation we'll keep. Flicker templates are about 30–250 KB. */
export const MAX_LOOK_BYTES = 1_500_000;
const ID = /^[0-9a-f]{32}$/;

/** Saves an animation and returns its new id, or an error to show. */
export function saveLook(animation: unknown): { id: string } | { error: string } {
  // A Lottie file is an object with layers; anything else isn't an animation.
  if (!animation || typeof animation !== 'object' || !Array.isArray((animation as { layers?: unknown }).layers))
    return { error: 'That is not a Halo animation.' };
  const text = JSON.stringify(animation);
  if (text.length > MAX_LOOK_BYTES) return { error: 'That animation is too big to use as a Flicker.' };
  const id = randomUUID().replace(/-/g, '');
  fs.mkdirSync(LOOKS_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOOKS_DIR, `${id}.json`), text);
  return { id };
}

/** The saved animation's text, or null if there's no such look. */
export function readLook(id: string): string | null {
  if (!ID.test(id)) return null; // only our own ids, so nobody can ask for some other file
  try {
    return fs.readFileSync(path.join(LOOKS_DIR, `${id}.json`), 'utf8');
  } catch {
    return null;
  }
}
