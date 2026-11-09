// Art styles for Prism's style dropdown.
//
// The model has no "style" setting: style comes from the words in the prompt. Each style here
// is a bit of extra prompt that Prism adds after whatever you type.
//
// To add your own: copy a line, give it a new id and name, and write the words you want added.
// The first entry is the default.

export interface PrismStyle {
  id: string;
  name: string;
  /** Added to the end of your prompt. Empty = your prompt exactly as typed. */
  words: string;
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
  { id: 'fantasy', name: 'Fantasy RPG', words: 'fantasy RPG concept art, painterly, epic lighting, detailed environment' },
];

/** Your prompt plus the chosen style's words. Unknown style ids are treated as "None". */
export function applyStyle(prompt: string, styleId?: string): string {
  const style = PRISM_STYLES.find((s) => s.id === styleId);
  const text = prompt.trim();
  return style?.words ? `${text}, ${style.words}` : text;
}
