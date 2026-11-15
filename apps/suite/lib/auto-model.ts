// lib/auto-model.ts - "Auto" in Lumen's model picker: chooses a local model for each message.
//
// The choice is made by plain rules (pickLocalModel), not by asking a model. Asking a model to
// choose would mean loading it onto the card first, and this card only holds one chat model at a
// time, so every message would wait for two model loads instead of one.
//
// Cloud models are never chosen here: those are only used when picked by hand.

import { canSeeImages, type LocalModelId } from '@/config/models';
import { loadedOllamaModels } from '@/lib/queue';

export interface AutoInput {
  /** What the person wrote. Empty when they sent a photo on its own. */
  prompt: string;
  /** True when photos are attached, so the model has to be one that can see. */
  hasPhotos: boolean;
  /**
   * The chat model already on the graphics card, or null. Picking this one answers right away;
   * picking any other means waiting for it to load (longest for the "Heavy" ones).
   */
  loaded: string | null;
}

const CODE_HINTS =
  /```|\b(function|const|class|import|def|bug|error|stack trace|compile|typescript|javascript|python|css|html|sql|regex)\b/i;
/** A rough guess at whether a message is about code. */
export const looksLikeCode = (prompt: string) => CODE_HINTS.test(prompt);

/** The rules: which local model should answer this message. */
export function pickLocalModel(input: AutoInput): LocalModelId {
  // TODO(human): decide which fish answers what. For now it's always one of the two quick ones.
  return input.hasPhotos ? 'gemma4:12b' : 'qwen3.5:9b';
}

// The chat model on the card right now (embedding models don't count: they're always there).
async function loadedChatModel(): Promise<string | null> {
  try {
    return (await loadedOllamaModels()).find((name) => !/embed/i.test(name)) ?? null;
  } catch {
    return null; // Ollama isn't answering; the chat request itself will report that.
  }
}

/** What the chat route calls when the picker is on Auto. */
export async function chooseLocalModel(prompt: string, hasPhotos: boolean): Promise<string> {
  const pick = pickLocalModel({ prompt, hasPhotos, loaded: await loadedChatModel() });
  // Safety net: whatever the rules say, a photo goes to a model that can see it.
  return hasPhotos && !canSeeImages(pick) ? 'gemma4:12b' : pick;
}
