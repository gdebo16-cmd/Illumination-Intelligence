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
import { gpuQueue, OLLAMA_CHAT_NUM_CTX, OLLAMA_KEEP_ALIVE, OLLAMA_NUM_CTX } from '@/lib/queue';
import type { ToolId } from '@/config/umbra';
import { historyBudget } from '@/lib/chat-memory';
import { canThink, thinkSetting } from '@/config/models';
import { toolsFor } from './tools';
import type { AgentStep, ToolContext, ToolDef } from './types';

/** 'high' for live chat; 'low' for background tasks, so they never make a chat wait. */
type Priority = 'high' | 'low';

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const MAX_ROUNDS = 10;
// Working on code takes more looking around (list, search, read, read again…) before answering.
const MAX_ROUNDS_CODE = 24;

// Smaller models often stop to say what they're about to do ("Let me check the tests now.")
// without doing it, which ends the run. When a reply sounds like that, the bot is told to go on,
// this many times at most per message.
const MAX_NUDGES = 3;
const NUDGE_PROMPT =
  'Go on: do that now with your tools instead of describing it. Keep working until the whole job is done. ' +
  'If you are actually finished, or you truly need a decision from the user, reply with only the word DONE.';
/** The last lines of a reply that announce more work instead of finishing. */
const ANNOUNCES_MORE =
  /\b(let me|let's|i'll|i will|i'm going to|i am going to|i'm now|i am now|now i|next,? i|i need to|i should|going to (now )?(check|look|run|read|search|open|write|fix|try)|one moment|hang tight|stand by|working on it)\b/i;
/** Wording that means the bot is done or waiting on the user, so it shouldn't be pushed on. */
const WAITS_ON_USER =
  /\?\s*$|\b(let me know|if you('d| would)? like|would you like|do you want|shall i|should i|want me to|your (call|decision|approval)|once you|when you('re| are) ready|approve)\b/i;

/** Whether a reply ends by announcing work it then didn't do. */
function announcesMoreWork(text: string): boolean {
  const tail = text.trim().split(/\n+/).slice(-2).join(' ').slice(-400);
  if (!tail) return false;
  return ANNOUNCES_MORE.test(tail) && !WAITS_ON_USER.test(tail);
}

/** Said on the last round, when the tools are taken away. */
const LAST_ROUND_PROMPT =
  'You have used all your steps for this message, so stop using tools now. Tell the user what you got done, ' +
  'what is still left, and that they can say "continue" for you to pick it back up.';

// Tools whose results are long (web pages, files, command output) need the large context window.
// A Flicker without them only talks, so it gets the small one and uses less graphics memory.
const READING_TOOLS: ToolId[] = ['web_search', 'read_webpage', 'code', 'refract'];
/** The context window a bot with these tools runs in. */
export const numCtxFor = (toolIds: ToolId[]) =>
  toolIds.some((id) => READING_TOOLS.includes(id)) ? OLLAMA_NUM_CTX : OLLAMA_CHAT_NUM_CTX;

// Thinking is written into the same window as the answer, before it. A bot that thinks keeps this
// much more room free (in tokens), so the thinking doesn't leave too little for the answer itself.
const THINKING_ROOM_TOKENS = 2048;

/**
 * How many characters of earlier chat a bot with these tools reads, next to a character sheet
 * `promptChars` long. A bot with tools keeps half its room free for what the tools bring back,
 * and a bot that thinks keeps extra room for its thinking.
 */
export const botHistoryBudget = (toolIds: ToolId[], promptChars: number, think = false) => {
  const numCtx = numCtxFor(toolIds);
  const thinkingRoom = think ? Math.min(THINKING_ROOM_TOKENS, Math.floor(numCtx / 4)) * 3 : 0;
  return historyBudget(numCtx, promptChars + thinkingRoom, toolIds.length ? 0.5 : 1);
};

// How the conversation is kept inside the window while a bot works (about 3 characters a token).
/** One tool result may take at most this share of the window. */
const TOOL_RESULT_SHARE = 0.25;
/** Before each step, older tool results are shortened until the conversation fits in this share… */
const WORKING_SHARE = 0.7;
/** …down to this many characters each. */
const SHORTENED_TOOL_CHARS = 1200;

/** Cut text to `max` characters, saying that it was cut. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[…cut: ${text.length - max} more characters left out to save room.]`;
}

/**
 * Keep the conversation inside the window: while it is too long, shorten the oldest tool results
 * (never the newest one, which the model is about to read). The system prompt and the chat itself
 * are left alone; their size was already fitted before the run (lib/chat-memory.ts).
 */
function fitToWindow(messages: ChatMessage[], numCtx: number) {
  const limit = numCtx * 3 * WORKING_SHARE;
  const size = () => messages.reduce((n, m) => n + m.content.length + (m.thinking?.length ?? 0), 0);
  let total = size();
  if (total <= limit) return;
  const lastTool = messages.map((m) => m.role).lastIndexOf('tool');
  for (let i = 0; i < messages.length && total > limit; i++) {
    const m = messages[i];
    if (i === lastTool) continue;
    // Old thinking can go first: the model only needs its conclusions.
    if (m.thinking) {
      total -= m.thinking.length;
      messages[i] = { ...m, thinking: undefined };
    }
    if (m.role === 'tool' && m.content.length > SHORTENED_TOOL_CHARS) {
      const short = clip(m.content, SHORTENED_TOOL_CHARS);
      total -= m.content.length - short.length;
      messages[i] = { ...messages[i], content: short };
    }
  }
}

// When the window fills up part-way through a reply, Ollama stops and says why ("length"). The bot
// is then asked to go on from where it stopped, this many times at most, before the reply is kept
// as it is, marked as cut off.
const MAX_CONTINUES = 2;
const CONTINUE_PROMPT =
  'Your reply was cut off. Continue exactly where you stopped, without repeating anything or starting over.';
const CUT_OFF_NOTE = '\n\n_(This reply was cut off: it ran out of room. Ask me to go on.)_';

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
  /** Why the model stopped: "stop" when it finished, "length" when it ran out of room. */
  done_reason?: string;
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: { function: { name: string; arguments: Record<string, unknown> | string } }[];
  };
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
  numCtx: number,
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
        options: { num_ctx: numCtx },
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
  let doneReason: string | undefined;
  const take = (line: string) => {
    if (!line.trim()) return;
    const piece = JSON.parse(line) as OllamaReply & { error?: string };
    if (piece.error) throw new Error(`Ollama error: ${piece.error}`);
    if (piece.done_reason) doneReason = piece.done_reason;
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
  return { message, done_reason: doneReason };
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
  const numCtx = numCtxFor(options.toolIds);

  const checkpoint = (round: number) => {
    try {
      options.onCheckpoint?.({ messages, round });
    } catch (err) {
      console.error('[umbra-agent] checkpoint failed', (err as Error)?.message);
    }
  };
  const firstRound = Math.max(0, Math.min(maxRounds, Math.floor(options.startRound ?? 0)));
  let nudges = 0;
  // A reply the bot gave before being told to go on: kept in case it turns out it was finished.
  let heldAnswer = '';

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

    fitToWindow(messages, numCtx);
    // A bot that ran out of steps mid-job says where it got to instead of just stopping.
    const asked = lastRound && round > 0 ? [...messages, { role: 'system' as const, content: LAST_ROUND_PROMPT }] : messages;
    const askedAt = Date.now();
    const reply = await askModel(
      options.model, asked, lastRound ? [] : schemas, numCtx, options.priority ?? 'high', options.context.userId,
      thinks ? showThinking : undefined,
    );
    // Some models write their thinking into the reply itself, between <think> tags. Move it to
    // where thinking goes, so the reply is only the answer.
    if (reply.message) {
      const split = splitThinking(reply.message.content ?? '');
      reply.message.content = split.content;
      if (split.thinking) reply.message.thinking = [reply.message.thinking, split.thinking].filter(Boolean).join('\n\n');
    }
    let calls = reply.message?.tool_calls ?? [];
    let spoken = reply.message?.content ?? '';
    // Some models write a tool request as JSON or an XML-style tag in the reply
    // text instead of Ollama's official tool_calls slot. Turn that into a real tool request.
    if (calls.length === 0) {
      const fromText = parseTextToolCalls(spoken, (name) => resolveTool(name, tools) !== null);
      if (fromText.length) {
        calls = fromText;
        spoken = ''; // the text was a tool request, not the answer to show
      }
    }

    // The thinking is over: keep it with the reply, folded away under how long it took.
    const thinking = reply.message?.thinking?.trim() ?? '';
    if (thinking) {
      // Thinking that came inside the reply wasn't shown live: it took about as long as the reply.
      if (!thought) {
        thought = { id: crypto.randomUUID(), tool: 'thinking', label: 'Thinking', status: 'running' };
        thinkingFrom = askedAt;
        thinkingUntil = Date.now();
      }
      const seconds = Math.max(1, Math.round((thinkingUntil - thinkingFrom) / 1000));
      const done: AgentStep = {
        ...thought,
        status: 'done',
        label: `Thought for ${seconds} second${seconds === 1 ? '' : 's'}`,
        seconds,
        thought: thinking.length > SAVED_THOUGHT_CHARS ? `${thinking.slice(0, SAVED_THOUGHT_CHARS)}…` : thinking,
      };
      steps.push(done);
      options.onStep({ ...done });
    }

    // It said what it would do next but didn't do it: show what it said as a step, and tell it
    // to go on.
    if (calls.length === 0 && !lastRound && schemas.length > 0 && nudges < MAX_NUDGES && reply.done_reason !== 'length' && announcesMoreWork(spoken)) {
      nudges++;
      heldAnswer = spoken.trim();
      const note: AgentStep = { id: crypto.randomUUID(), tool: 'note', label: 'Update', status: 'done', thought: heldAnswer };
      steps.push(note);
      options.onStep({ ...note });
      messages.push({ role: 'assistant', content: spoken }, { role: 'user', content: NUDGE_PROMPT });
      checkpoint(round);
      continue;
    }

    if (calls.length === 0 || lastRound) {
      let answer = reply.message?.content ?? '';
      // Told to go on, it said it was already done: its earlier reply was the answer after all.
      if (heldAnswer && /^\W*done\W*$/i.test(answer.trim())) {
        steps.splice(steps.findLastIndex((s) => s.tool === 'note'), 1);
        return { reply: heldAnswer, steps };
      }
      let cutOff = reply.done_reason === 'length';
      // Ran out of room part-way: make room and ask the model to go on from where it stopped.
      // Without thinking this time, so all the room goes to the answer.
      for (let tries = 0; cutOff && tries < MAX_CONTINUES; tries++) {
        const more = [
          ...messages,
          ...(answer.trim() ? [{ role: 'assistant' as const, content: answer }] : []),
          { role: 'user' as const, content: answer.trim() ? CONTINUE_PROMPT : 'Answer now, briefly, without thinking it through again.' },
        ];
        fitToWindow(more, numCtx);
        const next = await askModel(options.model, more, [], numCtx, options.priority ?? 'high', options.context.userId);
        const piece = splitThinking(next.message?.content ?? '').content;
        if (!piece.trim()) break;
        answer = answer.trim() ? joinPieces(answer, piece) : piece;
        cutOff = next.done_reason === 'length';
      }
      answer = answer.trim();
      if (cutOff && answer) answer += CUT_OFF_NOTE;
      return { reply: answer || '…', steps };
    }

    // The model wants to use tools. Keep its request in the conversation, then run each one.
    const parsed = calls.map((c) => {
      const args = typeof c.function.arguments === 'string' ? safeJson(c.function.arguments) : c.function.arguments ?? {};
      return resolveTool(c.function.name, tools)?.(args) ?? { name: c.function.name, args };
    });
    // What it said on the way ("First I'll look at the config"), shown with its steps.
    if (spoken.trim()) {
      const note: AgentStep = { id: crypto.randomUUID(), tool: 'note', label: 'Update', status: 'done', thought: spoken.trim() };
      steps.push(note);
      options.onStep({ ...note });
    }
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
      messages.push({ role: 'tool', tool_name: call.name, content: clip(output, Math.floor(numCtx * 3 * TOOL_RESULT_SHARE)) });
      checkpoint(round);
    }
  }
  return { reply: '…', steps }; // not reached: the last round always returns
}

/**
 * Split thinking written inside a reply (<think>…</think>, as DeepSeek-R1 and Qwen do when their
 * thinking isn't switched on through Ollama) from the answer. Also handles a reply whose opening
 * <think> tag was left out, and one cut off before its closing tag.
 */
function splitThinking(text: string): { thinking: string; content: string } {
  if (!/<\/?think>/i.test(text)) return { thinking: '', content: text };
  const parts: string[] = [];
  let content = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner: string) => {
    parts.push(inner.trim());
    return '';
  });
  // "…thinking…</think>answer": the opening tag was in the prompt template, not the reply.
  const close = content.search(/<\/think>/i);
  if (close >= 0) {
    parts.unshift(content.slice(0, close).trim());
    content = content.slice(close).replace(/^<\/think>/i, '');
  }
  // "<think>thinking…" with no end: it never got to the answer.
  const open = content.search(/<think>/i);
  if (open >= 0) {
    parts.push(content.slice(open + '<think>'.length).trim());
    content = content.slice(0, open);
  }
  return { thinking: parts.filter(Boolean).join('\n\n'), content: content.trim() };
}

/** Put a continued reply back together, keeping the space (or line break) between the two pieces. */
function joinPieces(first: string, second: string): string {
  if (/\s$/.test(first) || /^\s/.test(second)) return first + second;
  // The model almost always stops between words (its pieces of text start with the space), so the
  // two parts get a space between them, unless the second goes on with punctuation.
  return /^[.,;:!?)\]}'’"]/.test(second) ? first + second : `${first} ${second}`;
}

/**
 * Models often guess generic tool names (list_folder, read_file, search_code) that this bot
 * doesn't have, e.g. when it works through the Refract tools instead. Map a guess onto the bot's
 * matching tool, renaming arguments where they differ. Returns null if nothing fits.
 */
const TOOL_ALIASES: Record<string, { name: string; args?: Record<string, string> }[]> = {
  list_folder: [{ name: 'refract_list' }],
  read_file: [{ name: 'refract_read' }],
  search_code: [{ name: 'refract_search', args: { text: 'query' } }],
  refract_list: [{ name: 'list_folder' }],
  refract_read: [{ name: 'read_file' }],
  refract_search: [{ name: 'search_code', args: { query: 'text' } }],
};

function resolveTool(
  name: string,
  tools: ReadonlyMap<string, unknown>,
): ((args: Record<string, unknown>) => { name: string; args: Record<string, unknown> }) | null {
  if (tools.has(name)) return (args) => ({ name, args });
  const alias = TOOL_ALIASES[name]?.find((a) => tools.has(a.name));
  if (!alias) return null;
  return (args) => {
    const renamed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) renamed[alias.args?.[key] ?? key] = value;
    return { name: alias.name, args: renamed };
  };
}

/**
 * Some models (Devstral, for example) write a tool request as JSON in the reply
 * text instead of Ollama's official tool_calls slot: {"name": "search_code",
 * "arguments": {"text": "page.tsx"}}, or as an XML-style tag:
 * <search_code text="page.tsx"/>. If it names a real tool, treat it as a real
 * request so the tool actually runs.
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
  if (found.length) return found;

  // Others write it as an XML-style tag: <list_folder path="src"/>. Only tags
  // that name a real tool count, so ordinary HTML in a reply is left alone.
  for (const m of unfenced.matchAll(/<([a-z_][a-z0-9_]*)((?:\s+[a-z_][a-z0-9_]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/gi)) {
    if (!isTool(m[1])) continue;
    const args: Record<string, unknown> = {};
    for (const a of m[2].matchAll(/([a-z_][a-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      args[a[1]] = a[2] ?? a[3] ?? '';
    }
    found.push({ function: { name: m[1], arguments: args } });
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
