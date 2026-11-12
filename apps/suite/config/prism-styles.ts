// Art styles for Prism's style dropdown.
//
// The model has no "style" setting: style comes from the words in the prompt. Each style here
// is a bit of extra prompt that Prism adds after whatever you type.
//
// To add your own: copy a line, give it a new id and name, and write the words you want added.
// The first entry is the default.

import type { PrismModelId } from './prism-models.ts';

export interface PrismStyle {
  id: string;
  name: string;
  /** Added to the end of your prompt. Empty = your prompt exactly as typed. */
  words: string;
  /** Put in front of your prompt. A LoRA's "trigger phrase" (the words it was trained with) goes here. */
  lead?: string;
  /**
   * LoRAs: small add-on files that teach a model one art style from example pictures, one per
   * model (an id from config/prism-models.ts). A LoRA only fits the model it was trained on,
   * so with a model that has none here, just the words are used.
   */
  loras?: Partial<Record<PrismModelId, StyleLora>>;
}

export interface StyleLora {
  /** The file's name in ComfyUI's models\loras folder. */
  file: string;
  /** How strongly it's applied. 1 is full strength. */
  strength: number;
}

export const PRISM_STYLES: readonly PrismStyle[] = [
  { id: 'none', name: 'None', words: '' },
  { id: 'photo', name: 'Photo', words: 'photograph, 35mm film, natural light, realistic detail, shallow depth of field' },
  { id: 'cinematic', name: 'Cinematic', words: 'cinematic film still, dramatic lighting, anamorphic, rich color grading' },
  { id: 'anime', name: 'Anime', words: 'anime illustration, clean line art, cel shading, vibrant colors' },
  { id: 'watercolor', name: 'Watercolor', words: 'delicate watercolor painting, soft washes of color, visible paper texture, loose brushstrokes' },
  { id: 'oil', name: 'Oil painting', words: 'oil painting on canvas, thick visible brushstrokes, classical composition' },
  { id: 'pixel', name: 'Pixel art', words: 'pixel art, 16-bit retro game style, limited color palette, crisp pixels' },
  { id: '3d', name: '3D render', words: '3D render, soft studio lighting, smooth materials, octane render style' },
  { id: 'comic', name: 'Comic book', words: 'comic book art, bold ink outlines, halftone shading, dynamic composition' },
  { id: 'fantasy', name: 'Fantasy RPG', words: 'epic fantasy RPG scene, painterly digital painting, dramatic lighting, rich detailed environment, clean full-frame image filling the whole canvas, edge to edge' },
  { id: 'mono-sketch', name: 'Mono sketch', words: 'graphite pencil sketch, monochrome, loose expressive strokes, cross-hatching, visible construction lines, sketchbook paper, no color' },
  { id: 'color-sketch', name: 'Colored sketch', words: 'colored pencil sketch, loose pencil linework with light color washes, hand-drawn, visible strokes and hatching, sketchbook paper texture' },
  { id: 'linework', name: 'Linework', words: 'clean ink line art, black lines on white background, precise even line weight, no shading, no color, no fill, coloring book style' },
  // The Eldrid Tales look: ink and muted watercolor on parchment, learned from the game's own
  // race and subclass art, trained with AI Toolkit once per model (both files are step 1,250 of
  // their runs: eldrid_parchment_v1 for Quicksketch, eldrid_parchment_flux3_v1 for Masterpiece).
  // Without "no text" the model writes the trigger phrase onto the picture as a signature.
  {
    id: 'eldrid',
    name: 'Eldrid Tales',
    lead: 'eldridtales style',
    words: 'ink and muted watercolor, plain parchment-colored background filling the whole frame, no text, no lettering, no signature, no watermark',
    loras: {
      'flux2-klein': { file: 'eldrid-parchment-v1.safetensors', strength: 1 },
      'flux3-klein': { file: 'eldrid-parchment-flux3-v1.safetensors', strength: 1 },
    },
  },
];

/** Your prompt with the chosen style's words around it. Unknown style ids are treated as "None". */
export function applyStyle(prompt: string, styleId?: string): string {
  const style = PRISM_STYLES.find((s) => s.id === styleId);
  return [style?.lead, prompt.trim(), style?.words].filter(Boolean).join(', ');
}

/** The LoRA to load for this style and model, if the style has one made for that model. */
export function styleLora(styleId: string | undefined, model: PrismModelId): StyleLora | undefined {
  return PRISM_STYLES.find((s) => s.id === styleId)?.loras?.[model];
}
