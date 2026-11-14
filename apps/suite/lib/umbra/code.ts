// lib/umbra/code.ts — the "Code helper" tool: a Flicker can look through one project folder and
// suggest changes to its files.
//
// Safety:
//   - Each Flicker gets ONE folder (set in its settings). Every path is checked to stay inside it,
//     also through shortcuts (symlinks), so "../" tricks can't reach anything else on the PC.
//   - That folder must be inside your user folder (or a folder listed in UMBRA_CODE_ROOTS).
//   - Secrets (.env files, keys) and the .git folder are never read or written.
//   - Changes are only suggestions: they show in the chat as a "diff" with Apply / Don't apply
//     buttons. Only if the Flicker's "change files without asking" setting is on does it write
//     straight away.
//   - Everything runs on this PC with a local model; no code leaves the machine.

import 'server-only';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import db from '@/lib/db';
import type { CodeEditView, ToolDef, ToolResult } from './types';

const READ_CHAR_LIMIT = 16_000; // characters of one file handed to the model at a time
const FILE_BYTE_LIMIT = 2_000_000; // bigger files are skipped
const LIST_LIMIT = 300;
const SEARCH_RESULT_LIMIT = 60;
const SEARCH_FILE_LIMIT = 4_000;

/** Folders that are never listed or searched (and never written to). */
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', '.turbo', 'coverage', '.venv', 'venv', '__pycache__', '.cache']);
/** Files that may hold passwords or keys. */
const SECRET_FILE = /^\.env(\..*)?$|\.(pem|key|pfx|p12)$|^id_(rsa|ed25519|ecdsa)/i;

// ------------------------------------------------------------------ which folders are allowed

/** Parent folders a Flicker's project folder must sit inside. */
function allowedRoots(): string[] {
  const fromEnv = (process.env.UMBRA_CODE_ROOTS ?? '').split(';').map((p) => p.trim()).filter(Boolean);
  return (fromEnv.length ? fromEnv : [os.homedir()]).map((p) => path.resolve(p));
}

const isInside = (parent: string, child: string) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Check the folder typed into a Flicker's settings. Returns an error message, or null if it's fine. */
export function checkCodeFolder(folder: string): string | null {
  if (!folder) return 'Type the project folder for the Code helper, e.g. C:\\Users\\you\\projects\\my-app';
  if (!path.isAbsolute(folder)) return 'Give the full folder path, starting with the drive (like C:\\…).';
  let real: string;
  try {
    real = fs.realpathSync(/* turbopackIgnore: true */ folder);
    if (!fs.statSync(/* turbopackIgnore: true */ real).isDirectory()) return 'That path is a file, not a folder.';
  } catch {
    return 'That folder doesn’t exist on this PC.';
  }
  const roots = allowedRoots();
  const ok = roots.some((root) => isInside(root, real) && path.relative(root, real) !== '');
  if (!ok) return `Pick a folder inside ${roots.join(' or ')} (not that folder itself).`;
  return null;
}

// ------------------------------------------------------------------ staying inside the folder

interface CodeBot {
  codeFolder: string;
  codeAutoWrite: boolean;
}

function botSettings(botId: string): CodeBot {
  const row = db.prepare('SELECT code_folder, code_auto FROM UmbraBot WHERE id = ?').get(botId) as
    | { code_folder: string; code_auto: number }
    | undefined;
  if (!row?.code_folder) throw new Error('No project folder is set for the Code helper. Add one in this Flicker’s settings.');
  if (checkCodeFolder(row.code_folder)) throw new Error('The project folder in this Flicker’s settings can’t be used anymore. Check it in the settings.');
  return { codeFolder: fs.realpathSync(/* turbopackIgnore: true */ row.code_folder), codeAutoWrite: row.code_auto === 1 };
}

/** Turn a path the model gave into a real path inside the project folder, or refuse. */
function resolveInside(root: string, given: unknown): string {
  const rel = typeof given === 'string' ? given.trim().replace(/^[/\\]+/, '') : '';
  const target = path.resolve(root, rel || '.');
  if (!isInside(root, target)) throw new Error('That path is outside the project folder.');
  // Follow shortcuts (symlinks): the deepest part that exists must still be inside.
  let probe = target;
  while (!fs.existsSync(/* turbopackIgnore: true */ probe)) probe = path.dirname(probe);
  if (!isInside(root, fs.realpathSync(/* turbopackIgnore: true */ probe))) throw new Error('That path leads outside the project folder.');
  const parts = path.relative(root, target).split(path.sep);
  if (parts.includes('.git')) throw new Error('The .git folder is off limits.');
  if (SECRET_FILE.test(path.basename(target))) throw new Error('That file may hold passwords or keys, so it’s off limits.');
  return target;
}

const shown = (root: string, full: string) => path.relative(root, full).split(path.sep).join('/') || '.';

function readText(file: string): string {
  const stat = fs.statSync(/* turbopackIgnore: true */ file);
  if (!stat.isFile()) throw new Error('That is a folder, not a file.');
  if (stat.size > FILE_BYTE_LIMIT) throw new Error('That file is too big to read.');
  const buffer = fs.readFileSync(/* turbopackIgnore: true */ file);
  if (buffer.subarray(0, 8000).includes(0)) throw new Error('That isn’t a text file.');
  return buffer.toString('utf8');
}

// ------------------------------------------------------------------ reading

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const params = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required });

const listFolder: ToolDef = {
  schema: {
    type: 'function',
    function: {
      name: 'list_folder',
      description: 'List the files and folders in the project folder (or a folder inside it). Folders end with "/". Start here to find your way around.',
      parameters: params({ path: { type: 'string', description: 'Folder path relative to the project, e.g. "src". Leave empty for the top.' } }, []),
    },
  },
  label: (a) => `Looking in ${str(a.path) || 'the project folder'}`,
  run: async (a, ctx) => {
    const { codeFolder: root } = botSettings(ctx.botId);
    const dir = resolveInside(root, a.path);
    if (!fs.statSync(/* turbopackIgnore: true */ dir).isDirectory()) throw new Error('That is a file, not a folder.');
    const entries = fs.readdirSync(/* turbopackIgnore: true */ dir, { withFileTypes: true })
      .filter((e) => !(e.isDirectory() && SKIP_DIRS.has(e.name)) && !SECRET_FILE.test(e.name))
      .sort((x, y) => Number(y.isDirectory()) - Number(x.isDirectory()) || x.name.localeCompare(y.name));
    const lines = entries.slice(0, LIST_LIMIT).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    if (entries.length > LIST_LIMIT) lines.push(`…and ${entries.length - LIST_LIMIT} more`);
    return {
      output: `${shown(root, dir)}:\n${lines.join('\n') || '(empty folder)'}`,
      summary: `${entries.length} item${entries.length === 1 ? '' : 's'} in ${shown(root, dir)}`,
    };
  },
};

const readFile: ToolDef = {
  schema: {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file in the project, with line numbers. For long files, read a part with start_line and end_line.',
      parameters: params(
        {
          path: { type: 'string', description: 'File path relative to the project, e.g. "src/app.ts".' },
          start_line: { type: 'number', description: 'First line to read (optional).' },
          end_line: { type: 'number', description: 'Last line to read (optional).' },
        },
        ['path'],
      ),
    },
  },
  label: (a) => `Reading ${str(a.path)}`,
  run: async (a, ctx) => {
    const { codeFolder: root } = botSettings(ctx.botId);
    const file = resolveInside(root, a.path);
    const lines = readText(file).split(/\r?\n/);
    const start = Math.max(1, Math.floor(Number(a.start_line) || 1));
    const end = Math.min(lines.length, Math.floor(Number(a.end_line) || lines.length));
    let out = '';
    let last = start - 1;
    for (let n = start; n <= end; n++) {
      const line = `${n}: ${lines[n - 1]}\n`;
      if (out.length + line.length > READ_CHAR_LIMIT) break;
      out += line;
      last = n;
    }
    const more = last < lines.length ? `\n…(file continues to line ${lines.length}; read more with start_line ${last + 1})` : '';
    return {
      output: `${shown(root, file)} (lines ${start}-${last} of ${lines.length}):\n${out}${more}`,
      summary: `Read ${last - start + 1} of ${lines.length} lines`,
    };
  },
};

const searchCode: ToolDef = {
  schema: {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search every text file in the project (or a folder inside it) for some text. Not case-sensitive. Returns matching lines with file names and line numbers.',
      parameters: params(
        {
          text: { type: 'string', description: 'The text to look for, e.g. a function name.' },
          path: { type: 'string', description: 'Only search inside this folder (optional).' },
        },
        ['text'],
      ),
    },
  },
  label: (a) => `Searching the code for “${str(a.text)}”`,
  run: async (a, ctx) => {
    const { codeFolder: root } = botSettings(ctx.botId);
    const needle = str(a.text).toLowerCase();
    if (!needle) throw new Error('No search text given.');
    const start = resolveInside(root, a.path);
    const hits: string[] = [];
    let files = 0;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(/* turbopackIgnore: true */ dir, { withFileTypes: true })) {
        if (hits.length >= SEARCH_RESULT_LIMIT || files >= SEARCH_FILE_LIMIT) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) walk(full);
        } else if (entry.isFile() && !SECRET_FILE.test(entry.name)) {
          files++;
          let text: string;
          try {
            text = readText(full);
          } catch {
            continue; // too big, or not text
          }
          if (!text.toLowerCase().includes(needle)) continue;
          text.split(/\r?\n/).forEach((line, i) => {
            if (hits.length < SEARCH_RESULT_LIMIT && line.toLowerCase().includes(needle)) {
              hits.push(`${shown(root, full)}:${i + 1}: ${line.trim().slice(0, 200)}`);
            }
          });
        }
      }
    };
    if (fs.statSync(/* turbopackIgnore: true */ start).isDirectory()) walk(start);
    else throw new Error('Give a folder to search in, not a file.');
    if (hits.length === 0) return { output: 'No matches.', summary: 'No matches' };
    const capped = hits.length >= SEARCH_RESULT_LIMIT ? '\n…(more matches; search for something more specific)' : '';
    return { output: hits.join('\n') + capped, summary: `${hits.length} match${hits.length === 1 ? '' : 'es'}` };
  },
};

// ------------------------------------------------------------------ suggesting changes

interface EditRow {
  id: string;
  user_id: string;
  bot_id: string;
  root: string;
  path: string;
  find: string;
  replace: string;
  diff: string;
  status: CodeEditView['status'];
  note: string | null;
}

/** A "diff": the changed lines with a few lines around them. "-" lines go, "+" lines come in. */
function makeDiff(file: string, before: string, find: string, replace: string): string {
  if (!find) return [`+++ ${file} (new file)`, ...replace.split(/\r?\n/).map((l) => `+${l}`)].join('\n');
  const at = before.indexOf(find);
  const lines = before.split(/\r?\n/);
  const firstLine = before.slice(0, at).split(/\r?\n/).length; // 1-based line where the change starts
  const oldLines = find.split(/\r?\n/);
  // Show whole lines: the start of the first changed line to the end of the last.
  const lastLine = firstLine + oldLines.length - 1;
  const lineStart = before.lastIndexOf('\n', at - 1) + 1;
  const nextBreak = before.indexOf('\n', at + find.length);
  const lineEnd = nextBreak === -1 ? before.length : nextBreak;
  const oldBlock = before.slice(lineStart, lineEnd).replace(/\r$/, '');
  const newBlock = before.slice(lineStart, at) + replace + before.slice(at + find.length, lineEnd).replace(/\r$/, '');
  const ctx = 3;
  const out = [`--- ${file}`, `+++ ${file}`, `@@ line ${firstLine} @@`];
  for (let n = Math.max(1, firstLine - ctx); n < firstLine; n++) out.push(` ${lines[n - 1]}`);
  for (const l of oldBlock.split(/\r?\n/)) out.push(`-${l}`);
  for (const l of newBlock.split(/\r?\n/)) out.push(`+${l}`);
  for (let n = lastLine + 1; n <= Math.min(lines.length, lastLine + ctx); n++) out.push(` ${lines[n - 1]}`);
  return out.join('\n');
}

/** Write a suggested change to disk, if the file is still the way it was when it was suggested. */
function writeEdit(edit: Pick<EditRow, 'root' | 'path' | 'find' | 'replace'>): void {
  const file = resolveInside(edit.root, edit.path);
  if (!edit.find) {
    if (fs.existsSync(/* turbopackIgnore: true */ file)) throw new Error('That file exists now, so it wasn’t created.');
    fs.mkdirSync(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
    fs.writeFileSync(/* turbopackIgnore: true */ file, edit.replace, 'utf8');
    return;
  }
  const before = readText(file);
  // Keep the file's own line endings (Windows files often use CRLF; suggestions are stored with LF).
  const crlf = before.includes('\r\n');
  const find = crlf ? edit.find.replace(/\n/g, '\r\n') : edit.find;
  const replace = crlf ? edit.replace.replace(/\n/g, '\r\n') : edit.replace;
  const count = before.split(find).length - 1;
  if (count !== 1) throw new Error('The file changed since this was suggested, so it wasn’t applied.');
  fs.writeFileSync(/* turbopackIgnore: true */ file, before.replace(find, () => replace), 'utf8');
}

const proposeEdit: ToolDef = {
  schema: {
    type: 'function',
    function: {
      name: 'propose_edit',
      description:
        'Suggest a change to one file in the project. Give the exact text to replace (copied from read_file, without the line numbers, ' +
        'and long enough to appear only once in the file) and the new text. To create a new file, leave find empty and put the whole file in replace. ' +
        'The user sees the change and decides whether to apply it, so explain what it does in your answer. One change per call.',
      parameters: params(
        {
          path: { type: 'string', description: 'File path relative to the project.' },
          find: { type: 'string', description: 'The exact existing text to replace. Empty to create a new file.' },
          replace: { type: 'string', description: 'The new text.' },
        },
        ['path', 'replace'],
      ),
    },
  },
  label: (a) => `Suggesting a change to ${str(a.path)}`,
  run: async (a, ctx): Promise<ToolResult> => {
    const { codeFolder: root, codeAutoWrite } = botSettings(ctx.botId);
    const file = resolveInside(root, a.path);
    const rel = shown(root, file);
    const find = typeof a.find === 'string' ? a.find.replace(/\r\n/g, '\n') : '';
    const replace = typeof a.replace === 'string' ? a.replace.replace(/\r\n/g, '\n') : '';
    if (SKIP_DIRS.has(rel.split('/')[0])) throw new Error(`Files in ${rel.split('/')[0]} can’t be changed.`);

    let diff: string;
    if (!find) {
      if (fs.existsSync(/* turbopackIgnore: true */ file)) throw new Error('That file already exists. To change it, give the text to replace in find.');
      diff = makeDiff(rel, '', '', replace);
    } else {
      const before = readText(file).replace(/\r\n/g, '\n');
      const count = before.split(find).length - 1;
      if (count === 0) throw new Error('The find text isn’t in the file. Read the file again and copy the text exactly.');
      if (count > 1) throw new Error(`The find text appears ${count} times. Include more surrounding lines so it appears once.`);
      if (find === replace) throw new Error('The new text is the same as the old text.');
      diff = makeDiff(rel, before, find, replace);
    }

    const edit: EditRow = {
      id: crypto.randomUUID(), user_id: ctx.userId, bot_id: ctx.botId, root, path: rel, find, replace, diff, status: 'pending', note: null,
    };
    if (codeAutoWrite) {
      try {
        writeEdit(edit);
        edit.status = 'applied';
      } catch (err) {
        edit.status = 'failed';
        edit.note = (err as Error).message;
      }
    }
    db.prepare(
      `INSERT INTO UmbraCodeEdit (id, user_id, bot_id, root, path, find_text, replace_text, diff, status, note, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(edit.id, edit.user_id, edit.bot_id, edit.root, edit.path, edit.find, edit.replace, edit.diff, edit.status, edit.note, new Date().toISOString());

    const outcome = {
      pending: 'The change is shown to the user with an Apply button. It is NOT written yet; it will be if they approve it.',
      applied: 'The change was written to the file.',
      failed: `The change could not be written: ${edit.note}`,
      rejected: '',
    }[edit.status];
    return {
      output: `${outcome}\n\n${diff}`,
      summary: edit.status === 'pending' ? 'Waiting for your OK' : edit.status === 'applied' ? 'Changed the file' : edit.note ?? 'Failed',
      edit: { id: edit.id, path: rel, diff, status: edit.status, ...(edit.note ? { note: edit.note } : {}) },
    };
  },
};

export const CODE_TOOLS: ToolDef[] = [listFolder, readFile, searchCode, proposeEdit];

// ------------------------------------------------------------------ approving changes (from the chat)

/** Apply or turn down a suggested change. Only the profile it was suggested to can do this. */
export function decideEdit(userId: string, editId: string, apply: boolean): CodeEditView | null {
  const edit = db
    .prepare('SELECT id, user_id, bot_id, root, path, find_text AS "find", replace_text AS "replace", diff, status, note FROM UmbraCodeEdit WHERE id = ? AND user_id = ?')
    .get(editId, userId) as EditRow | undefined;
  if (!edit) return null;
  if (edit.status === 'pending') {
    let status: CodeEditView['status'] = 'rejected';
    let note: string | null = null;
    if (apply) {
      try {
        writeEdit(edit);
        status = 'applied';
      } catch (err) {
        status = 'failed';
        note = (err as Error).message;
      }
    }
    db.prepare('UPDATE UmbraCodeEdit SET status = ?, note = ? WHERE id = ?').run(status, note, edit.id);
    Object.assign(edit, { status, note });
  }
  return { id: edit.id, path: edit.path, diff: edit.diff, status: edit.status, ...(edit.note ? { note: edit.note } : {}) };
}

/** The current state of suggested changes, so a chat reloaded later shows "Applied" instead of the buttons. */
export function editStatuses(ids: string[]): Map<string, Pick<CodeEditView, 'status' | 'note'>> {
  const map = new Map<string, Pick<CodeEditView, 'status' | 'note'>>();
  if (ids.length === 0) return map;
  const rows = db
    .prepare(`SELECT id, status, note FROM UmbraCodeEdit WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as { id: string; status: CodeEditView['status']; note: string | null }[];
  for (const r of rows) map.set(r.id, { status: r.status, ...(r.note ? { note: r.note } : {}) });
  return map;
}
