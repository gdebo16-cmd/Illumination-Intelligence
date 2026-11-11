// lib/umbra/agent.ts — the "agent loop": how a bot thinks, uses tools, and answers.
//
//   1. Send the model the conversation, plus descriptions of the tools it may use.
//   2. If it answers with text: done.
//   3. If it asks to use tools: run them, add the results to the conversation, go back to 1.
//
// A bot gets at most MAX_ROUNDS of tool use per message, so it can't loop forever.

import 'server-only';
import crypto from 'node:crypto';
import { gpuQueue, OLLAMA_KEEP_ALIVE, OLLAMA_NUM_CTX } from '@/lib/queue';
import type { ToolId } from '@/config/umbra';
import { toolsFor, type ToolContext, type ToolDef } from './tools';
import type { CodeEditView } from './code';

/** 'high' for live chat; 'low' for background tasks, so they never make a chat wait. */
type Priority = 'high' | 'low';

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const MAX_ROUNDS = 6;
// Working on code takes more looking around (list, search, read, read again…) before answering.
const MAX_ROUNDS_CODE = 14;

/** One tool use, as shown in the chat. */
export interface AgentStep {
  id: string;
  tool: string;
  label: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
  links?: { title: string; url: string }[];
  image?: { url: string; prompt: string };
  /** Code helper: a suggested file change. */
  edit?: CodeEditView;
  /** Teams: the teammate who did this step's work, */
  bot?: { id: string; name: string; flame: string };
  /** …the tools that teammate used, */
  children?: AgentStep[];
  /** …and the full answer it gave the leader. */
  detail?: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
  /** Photos for a model that can see: the pictures themselves, as base64 text (lib/chat-images.ts). */
  images?: string[];
}

interface OllamaReply {
  message?: {
    content?: string;
    tool_calls?: { function: { name: string; arguments: Record<string, unknown> | string } }[];
  };
}

// "Thinking" models (Qwen 3, GPT-OSS) reason privately before answering. For a bot that's slow
// (20-90 s per step) and, in testing, often made them *describe* a tool instead of using it.
// So bots use the quick, decisive mode: thinking off, or as low as the model allows.
function thinkSetting(model: string): { think?: boolean | 'low' } {
  if (model.startsWith('gpt-oss')) return { think: 'low' };
  if (model.startsWith('qwen3')) return { think: false };
  return {};
}

async function askModel(model: string, messages: ChatMessage[], tools: unknown[], priority: Priority, userId: string): Promise<OllamaReply> {
  return gpuQueue.add(async () => {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: { num_ctx: OLLAMA_NUM_CTX },
        keep_alive: OLLAMA_KEEP_ALIVE, // stay loaded a while for the next message (lib/queue.ts)
        ...thinkSetting(model),
        ...(tools.length ? { tools } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
    return (await res.json()) as OllamaReply;
  }, priority, 'ollama', { userId, model });
}

export async function runAgent(options: {
  model: string;
  toolIds: ToolId[];
  /** Tools only this run gets, on top of the bot's own (a team leader's "ask_teammate"). */
  extraTools?: ToolDef[];
  messages: ChatMessage[];
  context: ToolContext;
  /** 'low' for background tasks. Default 'high'. */
  priority?: Priority;
  /** Called whenever a step starts or finishes, so the chat can show it live. */
  onStep: (step: AgentStep) => void;
}): Promise<{ reply: string; steps: AgentStep[] }> {
  const tools = toolsFor(options.toolIds);
  for (const tool of options.extraTools ?? []) tools.set(tool.schema.function.name, tool);
  const schemas = [...tools.values()].map((t) => t.schema);
  const messages = [...options.messages];
  const steps: AgentStep[] = [];
  const maxRounds = options.toolIds.includes('code') ? MAX_ROUNDS_CODE : MAX_ROUNDS;

  for (let round = 0; round <= maxRounds; round++) {
    // On the last round, take the tools away so the bot has to answer with what it has.
    const lastRound = round === maxRounds;
    const reply = await askModel(options.model, messages, lastRound ? [] : schemas, options.priority ?? 'high', options.context.userId);
    const calls = reply.message?.tool_calls ?? [];

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
      content: reply.message?.content ?? '',
      tool_calls: parsed.map((p) => ({ function: { name: p.name, arguments: p.args } })),
    });

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
    }
  }
  return { reply: '…', steps }; // not reached: the last round always returns
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
