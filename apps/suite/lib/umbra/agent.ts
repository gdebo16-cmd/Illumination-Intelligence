// lib/umbra/agent.ts — the "agent loop": how a bot thinks, uses tools, and answers.
//
//   1. Send the model the conversation, plus descriptions of the tools it may use.
//   2. If it answers with text: done.
//   3. If it asks to use tools: run them, add the results to the conversation, go back to 1.
//
// A bot gets at most MAX_ROUNDS of tool use per message, so it can't loop forever.
//
// With "Think before answering" switched on, the model reasons before each of those steps, and
// its thinking is shown in the chat as it happens: one "Thinking" step per round.

import 'server-only';
import crypto from 'node:crypto';
import { gpuQueue, OLLAMA_KEEP_ALIVE, OLLAMA_NUM_CTX } from '@/lib/queue';
import type { ToolId } from '@/config/umbra';
import { canThink } from '@/config/models';
import { toolsFor } from './tools';
import type { AgentStep, ToolContext, ToolDef } from './types';

/** 'high' for live chat; 'low' for background tasks, so they never make a chat wait. */
type Priority = 'high' | 'low';

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const MAX_ROUNDS = 6;
// Working on code takes more looking around (list, search, read, read again…) before answering.
const MAX_ROUNDS_CODE = 14;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
  /** Photos for a model that can see: the pictures themselves, as base64 text (lib/chat-images.ts). */
  images?: string[];
  /** The model's own reasoning, handed back to it while it is still working on the same message. */
  thinking?: string;
}

interface OllamaReply {
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: { function: { name: string; arguments: Record<string, unknown> | string } }[];
  };
}

// "Thinking" models (Qwen 3, Gemma 4, GPT-OSS) reason privately before answering. For a bot that's slow
// (20-90 s per step) and, in testing, often made them *describe* a tool instead of using it.
// So unless a bot has "Think before answering" switched on, it uses the quick, decisive mode:
// thinking off, or as low as the model allows.
function thinkSetting(model: string, think: boolean): { think?: boolean | 'low' | 'medium' } {
  // GPT-OSS can't stop thinking; it takes an effort level instead of on/off.
  if (model.startsWith('gpt-oss')) return { think: think ? 'medium' : 'low' };
  if (think) return { think: true };
  if (model.startsWith('qwen3') || model.startsWith('gemma4')) return { think: false };
  return {};
}

/**
 * Ask the model for its next move. With `onThinking`, the model thinks first and the answer is
 * read as it arrives, so the thinking can be shown live: `onThinking` gets all the thinking so far,
 * again and again as it grows.
 */
async function askModel(
  model: string,
  messages: ChatMessage[],
  tools: unknown[],
  priority: Priority,
  userId: string,
  onThinking?: (thinking: string) => void,
): Promise<OllamaReply> {
  const ask = (think: boolean) =>
    fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: think,
        options: { num_ctx: OLLAMA_NUM_CTX },
        keep_alive: OLLAMA_KEEP_ALIVE, // stay loaded a while for the next message (lib/queue.ts)
        ...thinkSetting(model, think),
        ...(tools.length ? { tools } : {}),
      }),
    });

  return gpuQueue.add(async () => {
    let res = await ask(Boolean(onThinking));
    let failure = res.ok ? '' : await res.text();
    // A model that can't think says so; ask it again the ordinary way.
    if (onThinking && !res.ok && /does not support thinking/i.test(failure)) {
      onThinking = undefined;
      res = await ask(false);
      failure = res.ok ? '' : await res.text();
    }
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${failure}`);
    if (!onThinking) return (await res.json()) as OllamaReply;
    return readThinkingReply(res, onThinking);
  }, priority, 'ollama', { userId, model });
}

/**
 * Read a reply that arrives a piece at a time (one JSON object per line), putting the pieces
 * together into one whole reply. Thinking pieces come first, then the answer or tool requests.
 */
async function readThinkingReply(res: Response, onThinking: (thinking: string) => void): Promise<OllamaReply> {
  if (!res.body) throw new Error('Ollama sent an empty reply.');
  const message: Required<NonNullable<OllamaReply['message']>> = { content: '', thinking: '', tool_calls: [] };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const take = (line: string) => {
    if (!line.trim()) return;
    const piece = JSON.parse(line) as OllamaReply & { error?: string };
    if (piece.error) throw new Error(`Ollama error: ${piece.error}`);
    if (piece.message?.thinking) {
      message.thinking += piece.message.thinking;
      onThinking(message.thinking);
    }
    if (piece.message?.content) message.content += piece.message.content;
    if (piece.message?.tool_calls?.length) message.tool_calls.push(...piece.message.tool_calls);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      take(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  take(buffer);
  return { message };
}

// How much of the thinking is sent to the chat while it is still growing (the page shows only the
// last few lines), how often, and how much is kept with the finished message.
const LIVE_THOUGHT_CHARS = 600;
const LIVE_THOUGHT_EVERY_MS = 200;
const SAVED_THOUGHT_CHARS = 12_000;

export async function runAgent(options: {
  model: string;
  toolIds: ToolId[];
  /** Tools only this run gets, on top of the bot's own (a team leader's "ask_teammate"). */
  extraTools?: ToolDef[];
  messages: ChatMessage[];
  context: ToolContext;
  /** 'low' for background tasks. Default 'high'. */
  priority?: Priority;
  /** The bot's "Think before answering" switch. Ignored for models that can't think. */
  think?: boolean;
  /** Called whenever a step starts or finishes, so the chat can show it live. */
  onStep: (step: AgentStep) => void;
  /** Picking a run back up after a restart (lib/umbra/runs.ts): the round to go on from… */
  startRound?: number;
  /** …and the steps it had already finished. */
  initialSteps?: AgentStep[];
  /**
   * Called each time the conversation grows (the model asked for tools; a tool finished), with
   * everything needed to go on from here if the server stops. `round` is the round in progress.
   */
  onCheckpoint?: (checkpoint: { messages: ChatMessage[]; round: number }) => void;
}): Promise<{ reply: string; steps: AgentStep[] }> {
  const tools = toolsFor(options.toolIds);
  for (const tool of options.extraTools ?? []) tools.set(tool.schema.function.name, tool);
  const schemas = [...tools.values()].map((t) => t.schema);
  const messages = [...options.messages];
  const steps: AgentStep[] = [...(options.initialSteps ?? [])];
  const maxRounds = options.toolIds.includes('code') || options.toolIds.includes('refract') ? MAX_ROUNDS_CODE : MAX_ROUNDS;
  const thinks = Boolean(options.think) && canThink(options.model);

  const checkpoint = (round: number) => {
    try {
      options.onCheckpoint?.({ messages, round });
    } catch (err) {
      console.error('[umbra-agent] checkpoint failed', (err as Error)?.message);
    }
  };
  const firstRound = Math.max(0, Math.min(maxRounds, Math.floor(options.startRound ?? 0)));

  for (let round = firstRound; round <= maxRounds; round++) {
    // On the last round, take the tools away so the bot has to answer with what it has.
    const lastRound = round === maxRounds;

    // Thinking shows as a step of its own, growing while the model reasons.
    let thought: AgentStep | undefined;
    let thinkingFrom = 0;
    let thinkingUntil = 0;
    let lastShown = 0;
    const showThinking = (thinking: string) => {
      const now = Date.now();
      if (!thought) {
        thought = { id: crypto.randomUUID(), tool: 'thinking', label: 'Thinking', status: 'running' };
        thinkingFrom = now;
      }
      thinkingUntil = now;
      if (now - lastShown < LIVE_THOUGHT_EVERY_MS) return;
      lastShown = now;
      options.onStep({ ...thought, thought: thinking.slice(-LIVE_THOUGHT_CHARS) });
    };

    const reply = await askModel(
      options.model, messages, lastRound ? [] : schemas, options.priority ?? 'high', options.context.userId,
      thinks ? showThinking : undefined,
    );
    let calls = reply.message?.tool_calls ?? [];
    let spoken = reply.message?.content ?? '';
    // Some models write a tool request as JSON in the reply text instead of
    // Ollama's official tool_calls slot. Turn that into a real tool request.
    if (calls.length === 0) {
      const fromText = parseTextToolCalls(spoken, (name) => tools.has(name));
      if (fromText.length) {
        calls = fromText;
        spoken = ''; // the JSON was a tool request, not the answer to show
      }
    }

    // The thinking is over: keep it with the reply, folded away under how long it took.
    const thinking = reply.message?.thinking?.trim() ?? '';
    if (thought && thinking) {
      const seconds = Math.max(1, Math.round((thinkingUntil - thinkingFrom) / 1000));
      const done: AgentStep = {
        ...thought,
        status: 'done',
        label: `Thought for ${seconds} second${seconds === 1 ? '' : 's'}`,
        thought: thinking.length > SAVED_THOUGHT_CHARS ? `${thinking.slice(0, SAVED_THOUGHT_CHARS)}…` : thinking,
      };
      steps.push(done);
      options.onStep({ ...done });
    }

    if (calls.length === 0 || lastRound) {
      return { reply: reply.message?.content?.trim() || '…', steps };
    }

    // The model wants to use tools. Keep its request in the conversation, then run each one.
    const parsed = calls.map((c) => ({
      name: c.function.name,
      args: typeof c.function.arguments === 'string' ? safeJson(c.function.arguments) : c.function.arguments ?? {},
    }));
    messages.push({
      role: 'assistant',
      content: spoken,
      tool_calls: parsed.map((p) => ({ function: { name: p.name, arguments: p.args } })),
      ...(thinking ? { thinking } : {}),
    });
    checkpoint(round);

    for (const call of parsed) {
      const def = tools.get(call.name);
      const step: AgentStep = {
        id: crypto.randomUUID(),
        tool: call.name,
        label: def ? def.label(call.args) : `Using ${call.name}`,
        status: 'running',
      };
      options.onStep({ ...step });

      let output: string;
      try {
        if (!def) throw new Error(`There is no tool called ${call.name}.`);
        const result = await def.run(call.args, {
          ...options.context,
          priority: options.priority ?? 'high',
          // A long tool (a teammate at work) can show its progress before it finishes.
          progress: (update) => {
            Object.assign(step, update);
            options.onStep({ ...step });
          },
        });
        Object.assign(step, {
          status: 'done',
          summary: result.summary,
          links: result.links,
          image: result.image,
          edit: result.edit,
          approval: result.approval,
          bot: result.bot,
          children: result.children,
          detail: result.detail,
        });
        output = result.output;
      } catch (err) {
        const message = (err as Error).message || 'The tool failed.';
        Object.assign(step, { status: 'error', summary: message });
        output = `Error: ${message}`;
      }

      steps.push(step);
      options.onStep({ ...step });
      messages.push({ role: 'tool', tool_name: call.name, content: output });
      checkpoint(round);
    }
  }
  return { reply: '…', steps }; // not reached: the last round always returns
}


/**
 * Some models (Devstral, for example) write a tool request as JSON in the reply
 * text instead of Ollama's official tool_calls slot: {"name": "search_code",
 * "arguments": {"text": "page.tsx"}}. If that JSON names a real tool, treat it
 * as a real request so the tool actually runs.
 */
function parseTextToolCalls(
  content: string,
  isTool: (name: string) => boolean,
): NonNullable<NonNullable<OllamaReply['message']>['tool_calls']> {
  const text = content.trim();
  if (!text) return [];

  const asCall = (value: unknown): { function: { name: string; arguments: Record<string, unknown> } } | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const obj = value as Record<string, unknown>;
    const fn = obj.function && typeof obj.function === 'object' && !Array.isArray(obj.function)
      ? (obj.function as Record<string, unknown>)
      : obj;
    const name = typeof fn.name === 'string' ? fn.name.trim() : '';
    if (!name || !isTool(name)) return null;
    let args: unknown = fn.arguments ?? fn.args ?? fn.parameters ?? {};
    if (typeof args === 'string') args = safeJson(args);
    if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
    return { function: { name, arguments: args as Record<string, unknown> } };
  };

  const consider = (value: unknown) => {
    if (Array.isArray(value)) {
      const calls = value.map(asCall).filter((c): c is NonNullable<typeof c> => c !== null);
      return calls.length === value.length && calls.length > 0 ? calls : [];
    }
    if (value && typeof value === 'object' && Array.isArray((value as { tool_calls?: unknown }).tool_calls)) {
      return consider((value as { tool_calls: unknown[] }).tool_calls);
    }
    const one = asCall(value);
    return one ? [one] : [];
  };

  const unfenced = text.replace(/^```(?:json|tool|tools)?\s*/i, '').replace(/\s*```$/, '').trim();
  for (const candidate of [text, unfenced]) {
    try {
      const found = consider(JSON.parse(candidate));
      if (found.length) return found;
    } catch {
      // not a single JSON value
    }
  }

  const found: NonNullable<NonNullable<OllamaReply['message']>['tool_calls']> = [];
  for (const snippet of jsonSnippets(unfenced)) {
    try {
      found.push(...consider(JSON.parse(snippet)));
    } catch {
      // keep looking
    }
  }
  return found;
}

/** Top-level JSON objects or arrays sitting inside a larger string. */
function jsonSnippets(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const start = text[i];
    if (start !== '{' && start !== '[') continue;
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) {
          out.push(text.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  return out;
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export type { ChatMessage };
