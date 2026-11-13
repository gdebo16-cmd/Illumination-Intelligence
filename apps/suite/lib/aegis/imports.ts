// lib/aegis/imports.ts — who imports what, for JavaScript and TypeScript files, and the checks
// that need it: import cycles, files nothing imports, exports nothing uses, and modules that
// pass another module's names through.
//
// It reads import lines with patterns rather than a full parser, so it errs on the side of
// keeping things: anything a file mentions by name (a dynamic path, a script in package.json)
// counts as used.

import 'server-only';
import path from 'node:path';
import type { RepoFile } from './files';
import type { Finding } from './types';

const JS_EXTS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'];
const isJs = (f: RepoFile) => JS_EXTS.includes(f.ext) && !f.path.endsWith('.d.ts');

interface Edge {
  from: string;
  to: string;
  /** Names imported; "*" when every export may be used (namespace, dynamic import, export *). */
  names: Set<string>;
  typeOnly: boolean;
  /** Names this file re-exports straight from the target (`export { a } from '...'`). */
  reexport: boolean;
}

export interface ImportGraph {
  files: Map<string, RepoFile>;
  edges: Edge[];
  importers: Map<string, Edge[]>;
  imports: Map<string, Edge[]>;
}

// Takes out line and block comments, leaving strings alone (so "@/*" in a tsconfig survives).
// Keeps line breaks, so line numbers still match.
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '"' || ch === "'" || ch === '`') {
      const start = i++;
      while (i < src.length && src[i] !== ch && !(ch !== '`' && src[i] === '\n')) i += src[i] === '\\' ? 2 : 1;
      out += src.slice(start, ++i);
    } else if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, '');
      i = stop;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function clauseNames(clause: string): { names: Set<string>; typeOnly: boolean } {
  const names = new Set<string>();
  const c = clause.trim();
  let typeOnly = /^type\s/.test(c);
  const body = c.replace(/^type\s+/, '');
  if (/\*/.test(body)) names.add('*');
  const def = body.match(/^([A-Za-z_$][\w$]*)\s*(,|$)/);
  if (def) names.add('default');
  const braces = body.match(/\{([^}]*)\}/);
  if (braces) {
    const parts = braces[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length && !def && parts.every((p) => p.startsWith('type '))) typeOnly = true;
    for (const p of parts) names.add(p.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim());
  }
  return { names, typeOnly };
}

/** "@/*" style aliases from each tsconfig.json / jsconfig.json, keyed by that config's folder. */
function readAliases(files: RepoFile[]): { dir: string; prefix: string; target: string }[] {
  const aliases: { dir: string; prefix: string; target: string }[] = [];
  for (const f of files) {
    if (!/(^|\/)(tsconfig|jsconfig)\.json$/.test(f.path) || !f.text) continue;
    try {
      const json = JSON.parse(stripComments(f.text).replace(/,(\s*[}\]])/g, '$1'));
      const opts = json.compilerOptions ?? {};
      const dir = path.posix.dirname(f.path);
      const base = path.posix.join(dir, opts.baseUrl ?? '.');
      for (const [key, targets] of Object.entries<string[]>(opts.paths ?? {})) {
        if (!key.endsWith('/*') || !targets?.[0]?.endsWith('*')) continue;
        aliases.push({ dir: dir === '.' ? '' : dir, prefix: key.slice(0, -1), target: path.posix.join(base, targets[0].slice(0, -1)) });
      }
    } catch {
      // a config we can't read just means its aliases go unresolved
    }
  }
  return aliases.sort((a, b) => b.dir.length - a.dir.length);
}

export function buildGraph(all: RepoFile[]): ImportGraph {
  const files = new Map(all.filter(isJs).map((f) => [f.path, f]));
  const aliases = readAliases(all);

  const resolve = (from: string, spec: string): string | null => {
    let base: string | null = null;
    if (spec.startsWith('.')) base = path.posix.join(path.posix.dirname(from), spec);
    else {
      const alias = aliases.find((a) => (a.dir === '' || from.startsWith(a.dir + '/')) && spec.startsWith(a.prefix));
      if (alias) base = path.posix.join(alias.target, spec.slice(alias.prefix.length));
    }
    if (base === null) return null;
    base = base.replace(/^\.\//, '');
    const swapped = base.replace(/\.(m|c)?jsx?$/, '');
    const tries = [base, ...JS_EXTS.map((e) => `${base}.${e}`), ...JS_EXTS.map((e) => `${swapped}.${e}`), ...JS_EXTS.map((e) => `${base}/index.${e}`)];
    return tries.find((t) => files.has(t)) ?? null;
  };

  const edges: Edge[] = [];
  for (const f of files.values()) {
    const src = stripComments(f.text ?? '');
    const add = (spec: string, names: Set<string>, typeOnly: boolean, reexport = false) => {
      const to = resolve(f.path, spec);
      if (to && to !== f.path) edges.push({ from: f.path, to, names, typeOnly, reexport });
    };
    for (const m of src.matchAll(/\b(import|export)\s+((?:type\s+)?[^;'"`]*?)\s*from\s*['"]([^'"\n]+)['"]/g)) {
      const { names, typeOnly } = clauseNames(m[2]);
      add(m[3], names, typeOnly, m[1] === 'export');
    }
    for (const m of src.matchAll(/\bimport\s*['"]([^'"\n]+)['"]/g)) add(m[1], new Set(), false);
    for (const m of src.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g)) add(m[1], new Set(['*']), false);
  }

  const importers = new Map<string, Edge[]>();
  const imports = new Map<string, Edge[]>();
  for (const p of files.keys()) {
    importers.set(p, []);
    imports.set(p, []);
  }
  for (const e of edges) {
    importers.get(e.to)!.push(e);
    imports.get(e.from)!.push(e);
  }
  return { files, edges, importers, imports };
}

// ---------------------------------------------------------------------------------------------
// Entry points: files that are run or loaded by a framework or tool, not imported.

const NEXT_SPECIAL = /^(page|layout|route|template|loading|error|global-error|not-found|default|manifest|robots|sitemap|icon|apple-icon|opengraph-image|twitter-image)\.[cm]?[jt]sx?$/;

function entryChecker(all: RepoFile[]) {
  // Every string in every package.json (main, bin, exports, scripts) can name an entry file.
  const pkgStrings: { dir: string; text: string }[] = all
    .filter((f) => f.path.endsWith('package.json') && f.text)
    .map((f) => ({ dir: path.posix.dirname(f.path), text: f.text! }));
  const htmlText = all.filter((f) => f.ext === 'html' && f.text).map((f) => f.text!).join('\n');

  return (p: string): boolean => {
    const base = p.slice(p.lastIndexOf('/') + 1);
    const parts = p.split('/');
    if (/\.(test|test-d|spec|stories|bench)\.[cm]?[jt]sx?$|^bench(mark)?s?\./.test(base)) return true;
    // Files right next to a package.json are often run directly (node benchmark.js, a CLI).
    if (pkgStrings.some(({ dir }) => (dir === '.' ? '' : dir) === path.posix.dirname(p).replace(/^\.$/, ''))) return true;
    if (parts.some((d) => ['__tests__', 'test', 'tests', 'e2e', 'scripts', 'bin', 'tools', 'pages', 'public', '.storybook', '.github'].includes(d))) return true;
    if (/\.config\.[cm]?[jt]s$|^\.[\w-]+rc\.[cm]?js$/.test(base)) return true;
    if (/^(middleware|proxy|instrumentation|instrumentation-client)\.[cm]?[jt]s$/.test(base)) return true;
    if (parts.includes('app') && NEXT_SPECIAL.test(base)) return true;
    if (/^(index|main|server|app|cli|worker)\.[cm]?[jt]sx?$/.test(base) && (parts.length <= 2 || parts[parts.length - 2] === 'src')) return true;
    if (htmlText.includes(base)) return true;
    return pkgStrings.some(({ dir, text }) => {
      const rel = dir === '.' ? p : p.startsWith(dir + '/') ? p.slice(dir.length + 1) : null;
      return rel !== null && (text.includes(`"${rel}"`) || text.includes(`./${rel}`) || text.includes(` ${rel}`));
    });
  };
}

/** Every word in every JS/TS file, and which files it appears in. */
function wordIndex(graph: ImportGraph): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const f of graph.files.values()) {
    for (const w of new Set((f.text ?? '').split(/[^\w$]+/))) {
      if (!w) continue;
      let set = index.get(w);
      if (!set) index.set(w, (set = new Set()));
      set.add(f.path);
    }
  }
  return index;
}

const listOut = (items: string[], max: number) =>
  items.length > max ? [...items.slice(0, max), `…and ${items.length - max} more`] : items;

// ---------------------------------------------------------------------------------------------

/** Strongly connected groups of files (Tarjan's algorithm): each group imports itself in a loop. */
function cycles(graph: ImportGraph, runtimeOnly = false): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const groups: string[][] = [];
  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index++);
    stack.push(v);
    onStack.add(v);
    for (const e of graph.imports.get(v)!) {
      if (runtimeOnly && e.typeOnly) continue;
      if (!idx.has(e.to)) {
        visit(e.to);
        low.set(v, Math.min(low.get(v)!, low.get(e.to)!));
      } else if (onStack.has(e.to)) {
        low.set(v, Math.min(low.get(v)!, idx.get(e.to)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const group: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        group.push(w);
      } while (w !== v);
      if (group.length > 1) groups.push(group.sort());
    }
  };
  for (const v of graph.files.keys()) if (!idx.has(v)) visit(v);
  return groups;
}

export function checkCycles(graph: ImportGraph): Finding[] {
  const groups = cycles(graph);
  if (!groups.length) return [];
  // A loop only causes trouble at runtime if it's still a loop without the type-only imports,
  // which disappear when the code is compiled.
  const runtime = cycles(graph, true);
  const evidence = groups.map((g) => {
    const real = runtime.find((r) => r.every((p) => g.includes(p)));
    return `${g.join(' ↔ ')}${real ? (real.length < g.length ? ` (at runtime: ${real.join(' ↔ ')})` : '') : ' (only through type imports)'}`;
  });
  return [{
    kind: 'import-cycles',
    severity: runtime.length ? 'medium' : 'low',
    title: `${groups.length} group${groups.length === 1 ? '' : 's'} of files import each other in a loop`,
    why: runtime.length
      ? 'When files depend on each other in a circle, none of them can be understood, tested or moved on its own, and code that runs as a file loads can see half-loaded values.'
      : "Only type imports close these loops, so nothing breaks at runtime, but the files still can't be understood or moved apart, and the next real import will make it a runtime loop.",
    evidence: listOut(evidence, 10),
    fix: 'Find what the files share (usually types or constants) and move it into its own small module that each of them imports, so the arrows point one way.',
  }];
}

export function checkOrphans(graph: ImportGraph, all: RepoFile[]): Finding[] {
  const isEntry = entryChecker(all);
  const orphans = [...graph.files.keys()].filter((p) => {
    if (graph.importers.get(p)!.length || isEntry(p)) return false;
    // A file named in some other file (a path in a string, a script) may be loaded dynamically.
    const base = p.slice(p.lastIndexOf('/') + 1);
    const stem = base.replace(/\.[^.]+$/, '');
    const quoted = new RegExp(`['"\`/]${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
    return !all.some((f) => f.path !== p && f.text !== undefined && (f.text.includes(base) || (stem.length > 3 && quoted.test(f.text))));
  });
  if (!orphans.length) return [];
  return [{
    kind: 'orphan-files',
    severity: 'medium',
    title: `${orphans.length} code file${orphans.length === 1 ? '' : 's'} nothing imports`,
    why: "Nothing imports these files and they don't look like entry points (pages, routes, scripts, tests, configs). Dead files still get read, searched and kept in step with everything else.",
    evidence: listOut(orphans, 15),
    fix: 'Search for each file\'s name to be sure nothing loads it by a path in a string or a tool config, then delete it.',
  }];
}

export function checkUnusedExports(graph: ImportGraph, all: RepoFile[]): Finding[] {
  const isEntry = entryChecker(all);
  const words = wordIndex(graph);
  const rows: { path: string; unused: string[]; dead: string[] }[] = [];
  for (const [p, f] of graph.files) {
    const into = graph.importers.get(p)!;
    if (!into.length || isEntry(p) || into.some((e) => e.names.has('*'))) continue;
    const used = new Set(into.flatMap((e) => [...e.names]));
    const src = f.text ?? '';
    const exported = [...src.matchAll(/^export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|type|interface|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    const unused = exported.filter((n) => !used.has(n) && ![...(words.get(n) ?? [])].some((q) => q !== p));
    if (!unused.length) continue;
    const dead = unused.filter((n) => (src.match(new RegExp(`(?<![\\w$])${n.replace(/\$/g, '\\$')}(?![\\w$])`, 'g')) ?? []).length === 1);
    rows.push({ path: p, unused, dead });
  }
  if (!rows.length) return [];
  const total = rows.reduce((n, r) => n + r.unused.length, 0);
  const deadTotal = rows.reduce((n, r) => n + r.dead.length, 0);
  rows.sort((a, b) => b.unused.length - a.unused.length);
  return [{
    kind: 'unused-exports',
    severity: 'low',
    title: `${total} export${total === 1 ? '' : 's'} in ${rows.length} file${rows.length === 1 ? '' : 's'} that no other file uses`,
    why: `Each export is a promise that other code depends on it, so these make modules look bigger and more connected than they are.${deadTotal ? ` ${deadTotal} of them aren't used inside their own file either (marked †): that's dead code.` : ''}`,
    evidence: listOut(rows.map((r) => `${r.path}: ${r.unused.map((n) => (r.dead.includes(n) ? `${n}†` : n)).join(', ')}`), 12),
    fix: 'Remove the `export` keyword from names only their own file uses, and delete the ones marked †.',
  }];
}

export function checkPassThrough(graph: ImportGraph): Finding[] {
  const evidence: string[] = [];
  for (const [p, f] of graph.files) {
    const src = stripComments(f.text ?? '');
    const localExports = new Set<string>();
    for (const m of src.matchAll(/\bexport\s*\{([^}]*)\}\s*(?!\s*from)(?:;|$)/gm)) {
      for (const n of m[1].split(',')) localExports.add(n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim());
    }
    for (const out of graph.imports.get(p)!) {
      const passed = out.reexport
        ? [...out.names].filter((n) => n !== '*' && n !== 'default')
        : [...out.names].filter((n) => localExports.has(n));
      if (!passed.length) continue;
      const passedSet = new Set(passed);
      const viaShim = graph.importers.get(p)!.filter((e) => [...e.names].some((n) => passedSet.has(n))).length;
      const direct = graph.importers.get(out.to)!.filter((e) => e.from !== p && [...e.names].some((n) => passedSet.has(n))).length;
      if (viaShim && direct) {
        evidence.push(`${p} passes on ${passed.join(', ')} from ${out.to}: ${direct} file${direct === 1 ? '' : 's'} import${direct === 1 ? 's' : ''} ${out.to}, ${viaShim} import${viaShim === 1 ? 's' : ''} ${p}`);
      }
    }
  }
  if (!evidence.length) return [];
  return [{
    kind: 'pass-through',
    severity: 'low',
    title: `${evidence.length} module${evidence.length === 1 ? '' : 's'} pass${evidence.length === 1 ? 'es' : ''} another module's names through`,
    why: 'The same names can be imported from two places, so callers split between them and nobody knows which one is the real home.',
    evidence: listOut(evidence, 10),
    fix: 'Pick one home for those names. Point every import at it, and drop the re-export (or merge the two files if the wrapper adds little).',
  }];
}
