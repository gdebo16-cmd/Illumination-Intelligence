// lib/aegis/advise.ts — writing up a suggestion (lib/aegis/suggest.ts found it) the way a senior
// engineer would after reading the code: what's already shared, what each copy does differently,
// how to unify it (with file names, steps and a short sketch), and what that buys.
//
// A local model writes it, through Ollama and the GPU queue like everything else. If no model is
// reachable, writeFromScan() gives the plainer version the scan can write on its own.

import 'server-only';
import { PAGE_MODELS, thinkSetting } from '@/config/models';
import { gpuQueue, OLLAMA_KEEP_ALIVE, OLLAMA_NUM_CTX, OLLAMA_URL } from '@/lib/queue';
import type { SuggestionCandidate, WrittenSuggestion } from './types';

const SUGGESTION_MODELS: readonly string[] = PAGE_MODELS.chat.map((m) => m.id);
const TIMEOUT_MS = 6 * 60_000;
const MAX_INPUT_CHARS = 40_000;

const SYSTEM = `You review a codebase for code that does the same job in several places and could live in one place. You are given what an automated scan found, and the relevant code from each file. Write one suggestion, the way a careful senior engineer would after reading that code.

What to write:
- title: one line naming what could be unified, e.g. "Centralize the delete-confirm dialogs".
- summary: two or three sentences: what is repeated, and the problem it causes (for example: the copies behave differently, or every change has to be made N times).
- alreadyShared: what the files already share (components, hooks, helpers), each as "Name (path): what it does". Empty if nothing.
- repeated: one entry per file in the scan: what that file writes out itself, and exactly how its copy behaves, in plain words taken from the code (for example "starts closed; closes itself when the window is resized wider than 1024px", not "uses a hook"). Say when two files do the same thing.
- plan: 3 to 6 steps. Name the new files with paths next to similar existing ones (hooks next to hooks, components next to components). If the copies behave differently, pick the one behavior to keep, say why, and say which pages will change. Say which files switch to the new piece, including files that only use part of it.
- sketch: a short TypeScript/TSX sketch (at most 30 lines) of the new piece's interface and one page using it. Real prop and file names from the code. No full implementation.
- payoff: one or two sentences: what disappears, and what becomes a single change.

Rules:
- Only describe code that is in the excerpts. Don't invent files, props or behavior. New files you propose are fine.
- Use the real names from the code (components, props, hooks, CSS classes, paths).
- Plain English, short sentences, no filler or marketing words.
- Answer with JSON only, in the given shape.

An example of the expected quality (a different codebase):
{"title":"Centralize the delete-confirm dialogs","summary":"Three pages each build their own \\"Are you sure?\\" dialog around the shared Modal, with their own open state and button wiring. They've drifted: one confirms with Enter, one closes when you click outside, one does neither.","alreadyShared":["Modal (components/Modal.tsx): the overlay, the box and the close button"],"repeated":[{"file":"app/notes/NotesList.tsx","what":"useState(false) for the dialog, a Delete button that opens it, Cancel and Delete buttons; Enter confirms"},{"file":"app/tasks/TaskRow.tsx","what":"the same, but clicking outside also closes it; no Enter key"},{"file":"app/files/FileCard.tsx","what":"the same as TaskRow, with the title text hard-coded"}],"plan":["Add components/ConfirmDialog.tsx: Modal plus a message, a Cancel button and a red confirm button, taking title, message, confirmLabel and onConfirm.","Add hooks/use-confirm.ts returning { ask, dialog }: ask(options) opens the dialog and resolves true or false.","Standardize on: Enter confirms, Escape and clicking outside cancel. NotesList already behaves this way; TaskRow and FileCard gain Enter.","Replace the dialog code in NotesList, TaskRow and FileCard with const { ask, dialog } = useConfirm() and render {dialog} once."],"sketch":"// hooks/use-confirm.ts\\nexport function useConfirm(): {\\n  ask: (o: { title: string; message: string; confirmLabel?: string }) => Promise<boolean>;\\n  dialog: React.ReactNode;\\n}\\n\\n// app/tasks/TaskRow.tsx\\nconst { ask, dialog } = useConfirm();\\nconst remove = async () => {\\n  if (await ask({ title: 'Delete task?', message: task.name })) await deleteTask(task.id);\\n};\\nreturn <>{/* … */}{dialog}</>;","payoff":"About 70 lines of dialog code go, the three dialogs behave the same, and the next page that needs a confirmation gets one in two lines."}`;

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    alreadyShared: { type: 'array', items: { type: 'string' } },
    repeated: {
      type: 'array',
      items: { type: 'object', properties: { file: { type: 'string' }, what: { type: 'string' } }, required: ['file', 'what'] },
    },
    plan: { type: 'array', items: { type: 'string' } },
    sketch: { type: 'string' },
    payoff: { type: 'string' },
  },
  required: ['title', 'summary', 'alreadyShared', 'repeated', 'plan', 'sketch', 'payoff'],
};

function describe(c: SuggestionCandidate): string {
  const parts = [
    `The scan found: ${c.title}`,
    `Kind: ${c.kind === 'layout' ? 'several components build the same page frame' : 'the same steps with different names'}`,
    `Files (${c.files.length}): ${c.files.join(', ')}`,
    '',
    'What the scan saw in each file:',
    ...c.evidence.map((e) => `- ${e}`),
  ];
  if (c.shared.length) parts.push('', 'Already shared:', ...c.shared.map((s) => `- ${s.name} (${s.path})`));
  parts.push('', 'The code:');
  let used = parts.join('\n').length;
  for (const x of c.excerpts) {
    const block = `\n--- ${x.path}\n${x.code}\n`;
    if (used + block.length > MAX_INPUT_CHARS) {
      parts.push(`\n--- (${c.excerpts.length} excerpts in all; the rest were left out for length)`);
      break;
    }
    parts.push(block);
    used += block.length;
  }
  return parts.join('\n');
}

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strings = (v: unknown, max = 12) => (Array.isArray(v) ? v.map((x) => str(x, 600)).filter(Boolean).slice(0, max) : []);

function clean(raw: unknown, model: string): WrittenSuggestion {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const written: WrittenSuggestion = {
    title: str(o.title, 200),
    summary: str(o.summary, 1500),
    alreadyShared: strings(o.alreadyShared),
    repeated: (Array.isArray(o.repeated) ? o.repeated : [])
      .map((r) => ({ file: str((r as Record<string, unknown>)?.file, 300), what: str((r as Record<string, unknown>)?.what, 800) }))
      .filter((r) => r.file && r.what)
      .slice(0, 20),
    plan: strings(o.plan, 10),
    sketch: str(o.sketch, 4000),
    payoff: str(o.payoff, 800),
    by: model,
  };
  if (!written.title || !written.summary || !written.plan.length) throw new Error('The model’s answer was missing the title, summary or plan.');
  return written;
}

/** Ask a local model to write the suggestion. Throws if it can't (no Ollama, unknown model, bad answer). */
export async function writeWithModel(candidate: SuggestionCandidate, model: string, userId: string): Promise<WrittenSuggestion> {
  if (!SUGGESTION_MODELS.includes(model)) throw new Error(`${model} isn't one of the suite's chat models.`);
  const reply = await gpuQueue.add(async () => {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: describe(candidate) },
        ],
        stream: false,
        format: SCHEMA,
        options: { num_ctx: OLLAMA_NUM_CTX, temperature: 0.2 },
        keep_alive: OLLAMA_KEEP_ALIVE,
        ...thinkSetting(model, false),
      }),
    });
    if (!res.ok) throw new Error(`Ollama answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as { message?: { content?: string } };
  }, 'high', 'ollama', { userId, model });
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.message?.content ?? '');
  } catch {
    throw new Error('The model didn’t answer with valid JSON.');
  }
  return clean(parsed, model);
}

/** The plainer write-up the scan can make on its own. */
export function writeFromScan(c: SuggestionCandidate): WrittenSuggestion {
  const plan =
    c.kind === 'layout'
      ? [
          'Read each file’s copy of the frame and the state behind it, and list how they differ.',
          'Pick one behavior to keep where they differ, and note which pages will change.',
          'Add a wrapper component next to the shared components that renders the frame, taking the parts that differ (titles, content, header buttons) as props, and a hook for the state it needs.',
          `Switch ${c.files.length} files to the wrapper, one at a time, checking each page after.`,
        ]
      : [
          'Compare the spots side by side and list what differs (names, values, the odd extra step).',
          'Write one function, next to the code that uses it most, that takes what differs as arguments.',
          `Replace the ${c.files.length} copies with calls to it, checking each one after.`,
        ];
  return {
    title: c.title.replace(/`/g, ''),
    summary: c.summary,
    alreadyShared: c.shared.map((s) => `${s.name} (${s.path})`),
    repeated: c.evidence.map((e) => {
      const i = e.indexOf(': ');
      return { file: i > 0 ? e.slice(0, i) : e, what: i > 0 ? e.slice(i + 2) : '' };
    }),
    plan,
    sketch: '',
    payoff: `One place to change instead of ${c.files.length}.`,
    by: 'scan',
  };
}
