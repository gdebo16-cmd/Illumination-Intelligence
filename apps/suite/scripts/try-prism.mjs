// Tries Prism's ComfyUI connection without the app: asks for one picture and saves it.
//
//   node scripts/try-prism.mjs "a lighthouse on a sea cliff at night" watercolor     (run from apps/suite)
//   node scripts/try-prism.mjs "a lighthouse on a sea cliff at night" none flux3-klein
//
// The second word is an optional art style id from config/prism-styles.ts ("none" for no style).
// The third is an optional model id from config/prism-models.ts.
//
// Saves to data/prism/try.png. ComfyUI must be running.

import fs from 'node:fs';
import { generateImage } from '../lib/prism/comfy.ts';

const prompt = process.argv[2] ?? 'a lighthouse on a sea cliff at night, stars, glowing beam';
const style = process.argv[3];
const model = process.argv[4];

console.log(`Asking ComfyUI for: "${prompt}"${style ? ` in the ${style} style` : ''}${model ? ` with ${model}` : ''}`);
const result = await generateImage({ prompt, style, model });

fs.mkdirSync('data/prism', { recursive: true });
fs.writeFileSync('data/prism/try.png', result.image);
console.log(`Done in ${result.seconds.toFixed(1)}s with ${result.model} — seed ${result.seed}, ${result.width}x${result.height}`);
if (result.expandedPrompt) console.log(`The prompt expander wrote:\n${result.expandedPrompt}`);
console.log('Saved to data/prism/try.png');
