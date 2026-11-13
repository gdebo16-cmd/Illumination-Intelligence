// The picture models in Prism's "Model" dropdown.
//
// Each model has its own two recipe files in lib/prism (one for making a picture from words,
// one for editing a picture). lib/prism/comfy.ts lists which recipe files belong to which model.
// A model can only be picked once its files are in ComfyUI's models folder; until then the
// dropdown shows it greyed out as "not downloaded yet".
//
// The first entry is the default. It's also the one Umbra's bots paint with.

interface PrismModel {
  id: string;
  name: string;
  /** One line shown under the dropdown when this model is picked. */
  note: string;
  /**
   * True when the model comes with a "prompt expander": a second language model that rewrites
   * your short prompt into a long, detailed one before the picture is painted. Prism then shows
   * an "Expand my prompt" switch for it.
   */
  expands: boolean;
  /**
   * About how much graphics-card memory (VRAM) it needs, in GB. The GPU queue uses this to pick
   * a machine (lib/gpu/router.ts): a model that fits in 8 GB prefers the Alienware.
   */
  vramGB: number;
}

export const PRISM_MODELS = [
  { id: 'flux2-klein', name: 'Quicksketch', note: 'The quick one: it paints a picture in 4 steps.', expands: false, vramGB: 8 },
  {
    id: 'flux3-klein',
    name: 'Masterpiece',
    note: 'The newer one: it paints in 16 steps, so each picture takes longer.',
    expands: true,
    // A guess until it has run here: the painter plus two language models (one is the expander).
    vramGB: 12,
  },
] as const satisfies readonly PrismModel[];

export type PrismModelId = (typeof PRISM_MODELS)[number]['id'];

export const DEFAULT_PRISM_MODEL: PrismModelId = PRISM_MODELS[0].id;

/** The model with this id. Anything unknown (or left out) gives the default model. */
export function findPrismModel(id: unknown): (typeof PRISM_MODELS)[number] {
  return PRISM_MODELS.find((m) => m.id === id) ?? PRISM_MODELS[0];
}
