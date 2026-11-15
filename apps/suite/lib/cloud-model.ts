// lib/cloud-model.ts - "Cloud Fish": big models that run on Ollama's servers instead of this
// machine's graphics card. Far larger than anything the card can hold, but the conversation
// leaves the house and each message costs a little, so it is only ever used when someone picks
// Cloud Fish by hand (Lumen's picker, or a Flicker's Brain). Auto never chooses it.
//
// Ollama's cloud speaks the same /api/chat format as the local Ollama, so the rest of the app
// builds a request the usual way and cloudChat() sends it. Cloud requests skip the GPU queue:
// they use none of this machine's graphics memory.
//
// Setup: make a key at ollama.com/settings/keys and put it in apps/suite/.env as
//   OLLAMA_API_KEY=...
// then restart the app. The background work around a chat (memory, summaries) stays on a local
// model (config/models.ts, localOnly).

import 'server-only';
import { CLOUD_MODELS } from '@/config/models';
import { looksLikeCode } from '@/lib/auto-model';

const CLOUD_URL = (process.env.OLLAMA_CLOUD_URL ?? 'https://ollama.com').replace(/\/+$/, '');

export interface CloudInput {
  /** What the person wrote. */
  prompt: string;
  /**
   * A Flicker doing real work: thinking is switched on, or it has the code or Refract tools.
   * Those jobs go wrong in expensive ways, so they get the strong model.
   */
  working?: boolean;
}

const HARD_HINTS =
  /\b(why|explain|analy[sz]e|compare|plan|design|debug|prove|research|strategy|trade-?offs?|review|refactor|step[- ]by[- ]step)\b/i;

/**
 * Which cloud model answers. The strong one costs about three times the everyday one, so it is
 * kept for messages that look like they need it: code, long or involved questions, working Flickers.
 */
export function pickCloudModel(input: CloudInput): string {
  const { prompt } = input;
  if (input.working || looksLikeCode(prompt) || prompt.length > 600 || HARD_HINTS.test(prompt)) return CLOUD_MODELS.strong;
  return CLOUD_MODELS.everyday;
}

const NOT_SET_UP = 'Cloud Fish isn’t set up yet. Add OLLAMA_API_KEY to apps/suite/.env and restart, or pick a local fish.';
const cloudKey = () => process.env.OLLAMA_API_KEY?.trim() || null;
/** Why Cloud Fish can't be used right now, or null when it can. Checked before a message is saved. */
export const cloudProblem = () => (cloudKey() ? null : NOT_SET_UP);

/** Send a chat request (the same body the local Ollama takes) to Ollama's cloud. */
export async function cloudChat(body: Record<string, unknown>): Promise<Response> {
  const key = cloudKey();
  if (!key) throw new Error(NOT_SET_UP);
  let res: Response;
  try {
    res = await fetch(`${CLOUD_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Couldn’t reach the cloud. Check the internet connection, or pick a local fish.');
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('The cloud turned the key down. Check OLLAMA_API_KEY in apps/suite/.env.');
  }
  return res;
}
