// Tries Prism's ComfyUI connection without the app: asks for one picture and saves it.
//
//   node scripts/try-prism.mjs "a lighthouse on a sea cliff at night" watercolor     (run from apps/suite)
//
// The second word is an optional art style id from config/prism-styles.ts.
//
// Saves to data/prism/try.png. ComfyUI must be running.

import fs from 'node:fs';
import { generateImage } from '../lib/prism/comfy.ts';

const prompt = process.argv[2] ?? 'a lighthouse on a sea cliff at night, stars, glowing beam';
const style = process.argv[3];

console.log(`Asking ComfyUI for: "${prompt}"${style ? ` in the ${style} style` : ''}`);
const result = await generateImage({ prompt, style });

fs.mkdirSync('data/prism', { recursive: true });
fs.writeFileSync('data/prism/try.png', result.image);
console.log(`Done in ${result.seconds.toFixed(1)}s — seed ${result.seed}, ${result.width}x${result.height}`);
console.log('Saved to data/prism/try.png');
