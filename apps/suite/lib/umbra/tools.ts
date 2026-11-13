// lib/umbra/tools.ts — the actions a bot can take.
//
// Each tool has two parts:
//   - a description for the model (name, what it does, what to pass in). The model reads these
//     and decides when to use a tool. This is the "function calling" format Ollama understands.
//   - the code that actually runs when the model asks for it.
//
// Safety: bots get exactly these tools and nothing else. No access to programs or settings on
// the PC, "read web page" refuses addresses inside your own network, and the Code helper
// (lib/umbra/code.ts) only sees the one project folder chosen in the bot's settings.

import 'server-only';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import db from '@/lib/db';
import { gpuQueue } from '@/lib/queue';
import { generateImage, imageNeeds } from '@/lib/prism/comfy';
import { saveImage } from '@/lib/prism/images';
import { PRISM_STYLES } from '@/config/prism-styles';
import type { ToolId } from '@/config/umbra';
import { calculate } from './calculator';
import { CODE_TOOLS, type CodeEditView } from './code';
import { REFRACT_TOOLS } from './refract-tools';
import type { AgentStep } from './agent';

const SEARXNG_URL = process.env.SEARXNG_URL ?? 'http://127.0.0.1:8888';
const PAGE_TEXT_LIMIT = 6000; // characters of a web page handed to the model
const PAGE_BYTE_LIMIT = 2_000_000;

/** Who is running the tool: the profile and the bot. */
export interface ToolContext {
  userId: string;
  botId: string;
  /** 'low' when a background task is running, so live chats go first. */
  priority?: 'high' | 'low';
  /** Show progress on this tool's step while it is still running. */
  progress?: (update: Partial<Pick<AgentStep, 'summary' | 'children' | 'bot'>>) => void;
}

/** What a tool hands back: text for the model, plus anything the chat should show. */
export interface ToolResult {
  /** What the model reads. */
  output: string;
  /** A short line for the chat, e.g. "Found 5 results". */
  summary: string;
  /** Links the chat can show (search results, the page that was read). */
  links?: { title: string; url: string }[];
  /** A picture the chat can show. */
  image?: { url: string; prompt: string };
  /** A file change the Code helper suggested, with Apply / Don't apply buttons in the chat. */
  edit?: CodeEditView;
  /** Teams: who did the work, the tools they used, and their full answer. */
  bot?: AgentStep['bot'];
  children?: AgentStep[];
  detail?: string;
}

interface ToolDef {
  /** The description the model reads (Ollama's "function" format). */
  schema: {
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  };
  /** What the chat says while it runs, e.g. "Searching the web for …". */
  label: (args: Record<string, unknown>) => string;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const params = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required });

// ------------------------------------------------------------------ date & time
const datetime: ToolDef = {
  schema: {
    type: 'function',
    function: {
      name: 'get_datetime',
      description: "Get the current local date, day of the week, and time. Use whenever the answer depends on today's date or the time.",
      parameters: params({}, []),
    },
  },
  label: () => 'Checking the date and time',
  run: async () => {
    const now = new Date();
    const text = now.toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
    return { output: text, summary: text };
  },
};

// Days between today and another date. Models are unreliable at counting days across months,
// so this does it in code.
const daysUntil: ToolDef = {
  schema: {
    type: 'function',
    function: {
      name: 'days_until',
      description: 'Count the days from today until a date (negative if the date has passed). Always use this for "how many days until/since" questions instead of counting yourself.',
      parameters: params({ date: { type: 'string', description: 'The date as YYYY-MM-DD, e.g. 2026-12-25' } }, ['date']),
    },
  },
  label: (a) => `Counting the days until ${str(a.date)}`,
  run: async (a) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(a.date));
    if (!match) throw new Error('Give the date as YYYY-MM-DD.');
    const [, y, m, d] = match.map(Number);
    const target = Date.UTC(y, m - 1, d);
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((target - today) / 86_400_000);
    const text = days === 0 ? `${str(a.date)} is today.` : days > 0 ? `${days} days from today until ${str(a.date)}.` : `${str(a.date)} was ${-days} days ago.`;
    return { output: text, summary: text };
  },
};

// ------------------------------------------------------------------ calculator
const calculator: ToolDef = {
  schema: {
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Evaluate a math expression exactly. Supports + - * / % ^, parentheses, sqrt, abs, round, floor, ceil, ln, log, sin, cos, tan, pi, e. Always use this instead of doing arithmetic in your head.',
      parameters: params({ expression: { type: 'string', description: 'For example: (1250 * 0.07) + 12.5' } }, ['expression']),
    },
  },
  label: (a) => `Calculating ${str(a.expression)}`,
  run: async (a) => {
    const expression = str(a.expression);
    const value = calculate(expression);
    const shown = Number.isInteger(value) ? value.toString() : Number(value.toPrecision(12)).toString();
    return { output: `${expression} = ${shown}`, summary: `${expression} = ${shown}` };
  },
};

// ------------------------------------------------------------------ web search
const webSearch: ToolDef = {
  schema: {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web. Returns the top results with title, link and a short snippet. Use for anything current, factual, or that you are unsure about. Follow up with read_webpage for details.',
      parameters: params({ query: { type: 'string', description: 'What to search for, like you would type into a search engine.' } }, ['query']),
    },
  },
  label: (a) => `Searching the web for “${str(a.query)}”`,
  run: async (a) => {
    const query = str(a.query);
    if (!query) throw new Error('No search query given.');
    let res: Response;
    try {
      res = await fetch(`${SEARXNG_URL}/search?${new URLSearchParams({ q: query, format: 'json' })}`, {
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error('Web search is offline. SearXNG isn’t running (start Docker Desktop).');
    }
    if (!res.ok) throw new Error(`Web search failed (${res.status}).`);
    const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
    const results = (data.results ?? []).filter((r) => r.url).slice(0, 6);
    if (results.length === 0) return { output: 'No results found.', summary: 'No results' };
    const output = results
      .map((r, i) => `${i + 1}. ${r.title ?? r.url}\n   ${r.url}\n   ${(r.content ?? '').slice(0, 300)}`)
      .join('\n');
    return {
      output,
      summary: `Found ${results.length} results`,
      links: results.map((r) => ({ title: r.title || r.url!, url: r.url! })),
    };
  },
};

// ------------------------------------------------------------------ read web page

// Refuse addresses on this PC or the home network, so a bot can't be tricked into
// reading ComfyUI, Ollama, the router, etc.
function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

async function checkPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('That isn’t a valid web address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https links can be read.');
  const addresses = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new Error(`Couldn’t find the site ${url.hostname}.`);
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new Error('Pages on this PC or the home network can’t be read.');
  return url;
}

function htmlToText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
  const text = html
    .replace(/<(script|style|noscript|svg|head|nav|footer|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/[ \t\f\r]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
  return { title: title.replace(/\s+/g, ' '), text };
}

const readWebpage: ToolDef = {
  schema: {
    type: 'function',
    function: {
      name: 'read_webpage',
      description: 'Open a web page and read its text. Use after web_search to get details from a result, or when the user gives you a link.',
      parameters: params({ url: { type: 'string', description: 'The full link, starting with http:// or https://' } }, ['url']),
    },
  },
  label: (a) => {
    try {
      return `Reading ${new URL(str(a.url)).hostname}`;
    } catch {
      return 'Reading a web page';
    }
  },
  run: async (a) => {
    // Follow redirects by hand so every hop gets the same public-address check.
    let url = await checkPublicUrl(str(a.url));
    let res: Response | null = null;
    for (let hop = 0; hop < 5; hop++) {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; UmbraBot/1.0)', Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
      }).catch((err: Error & { cause?: { code?: string; message?: string } }) => {
        // "fetch failed" alone says nothing; add the underlying reason (no internet, blocked, timeout…).
        const why = err.cause?.code ?? err.cause?.message ?? err.name;
        throw new Error(`Couldn’t reach ${url.hostname}${why ? ` (${why})` : ''}.`);
      });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!next) break;
      url = await checkPublicUrl(new URL(next, url).toString());
    }
    if (!res || !res.ok) throw new Error(`The page couldn’t be opened (${res?.status ?? 'no response'}).`);
    const type = res.headers.get('content-type') ?? '';
    if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) throw new Error(`That link isn’t a readable page (${type || 'unknown type'}).`);

    const buffer = await res.arrayBuffer();
    const body = new TextDecoder().decode(buffer.slice(0, PAGE_BYTE_LIMIT));
    const { title, text } = type.includes('html') ? htmlToText(body) : { title: '', text: body };
    const clipped = text.length > PAGE_TEXT_LIMIT ? `${text.slice(0, PAGE_TEXT_LIMIT)}\n…(page continues)` : text;
    return {
      output: `${title ? `Title: ${title}\n` : ''}URL: ${url}\n\n${clipped || '(no readable text on the page)'}`,
      summary: title || url.hostname,
      links: [{ title: title || url.hostname, url: url.toString() }],
    };
  },
};

// ------------------------------------------------------------------ make image (Prism)
const SHAPES: Record<string, { width: number; height: number }> = {
  square: { width: 1024, height: 1024 },
  portrait: { width: 832, height: 1216 },
  landscape: { width: 1216, height: 832 },
  phone: { width: 768, height: 1344 },
};

const makeImage: ToolDef = {
  schema: {
    type: 'function',
    function: {
      name: 'make_image',
      description: 'Paint a picture with Prism, the local image generator. Describe the scene in vivid visual detail. The picture is shown in the chat automatically; don’t paste its link.',
      parameters: params(
        {
          prompt: { type: 'string', description: 'A detailed visual description of the picture.' },
          style: { type: 'string', enum: PRISM_STYLES.map((s) => s.id), description: 'Art style. Use "none" if unsure.' },
          shape: { type: 'string', enum: Object.keys(SHAPES), description: 'Picture shape. Default square.' },
        },
        ['prompt'],
      ),
    },
  },
  label: (a) => `Painting “${str(a.prompt).slice(0, 60)}”`,
  run: async (a, ctx) => {
    const prompt = str(a.prompt);
    if (!prompt) throw new Error('No picture description given.');
    const style = PRISM_STYLES.some((s) => s.id === a.style) ? (a.style as string) : 'none';
    const size = SHAPES[str(a.shape)] ?? SHAPES.square;
    const request = { prompt, style, ...size };
    // The GPU queue picks the machine (see lib/gpu/router.ts) and passes it in as `worker`.
    const result = await gpuQueue
      .add((worker) => generateImage(request, worker), ctx.priority ?? 'high', 'comfy', {
        userId: ctx.userId,
        needs: imageNeeds(request),
      })
      .catch((err: Error) => {
        throw new Error(/fetch failed|ECONNREFUSED/i.test(err.message) ? 'Prism can’t paint right now: ComfyUI isn’t running.' : err.message);
      });
    const saved = saveImage(ctx.userId, prompt, style, result);
    return {
      output: 'The picture is finished and is now shown to the user in the chat (and saved to their Prism gallery).',
      summary: `Painted in ${result.seconds.toFixed(1)}s`,
      image: { url: saved.url, prompt },
    };
  },
};

// ------------------------------------------------------------------ notes
const saveNote: ToolDef = {
  schema: {
    type: 'function',
    function: {
      name: 'save_note',
      description: 'Save a short note to remember in all future chats with this user: a preference, a fact about them, an ongoing plan. One fact per note. Your saved notes are listed in your instructions.',
      parameters: params({ note: { type: 'string', description: 'The fact to remember, e.g. "Gabe is vegetarian".' } }, ['note']),
    },
  },
  label: () => 'Saving a note',
  run: async (a, ctx) => {
    const note = str(a.note).slice(0, 500);
    if (!note) throw new Error('The note was empty.');
    db.prepare('INSERT INTO UmbraNote (id, bot_id, content, createdAt) VALUES (?, ?, ?, ?)').run(
      crypto.randomUUID(), ctx.botId, note, new Date().toISOString(),
    );
    return { output: 'Saved.', summary: note };
  },
};

// ------------------------------------------------------------------ the list

/** Tool id (from the bot's settings) → the functions it gives the model. */
const TOOLS_BY_ID: Record<ToolId, ToolDef[]> = {
  datetime: [datetime, daysUntil],
  calculator: [calculator],
  web_search: [webSearch],
  read_webpage: [readWebpage],
  make_image: [makeImage],
  notes: [saveNote],
  code: CODE_TOOLS,
  refract: REFRACT_TOOLS,
};

/** The tools a bot with these settings may use, keyed by the function name the model calls. */
export function toolsFor(ids: ToolId[]): Map<string, ToolDef> {
  const map = new Map<string, ToolDef>();
  for (const id of ids) for (const def of TOOLS_BY_ID[id] ?? []) map.set(def.schema.function.name, def);
  return map;
}

export type { ToolDef };
