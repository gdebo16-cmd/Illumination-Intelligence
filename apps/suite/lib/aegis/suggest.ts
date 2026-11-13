// lib/aegis/suggest.ts — finding code that does the same job in several files, so it could live
// in one place. Two detectors, both reading the code with TypeScript's own parser:
//
//   - Repeated layouts: several components build the same outer frame (the same wrapper elements
//     and shared components, a couple of levels deep). Each one usually also has its own copy of
//     the state that drives the frame, sometimes written differently, so the same piece of the
//     app behaves differently from page to page.
//   - Look-alike code: the same run of steps in several files with different names (exact copies
//     are the "pasted code" finding instead).
//
// Each candidate carries the code a model needs to write it up (lib/aegis/advise.ts): an outline
// of the frame, the declarations behind it, and the shared pieces it already uses.

import 'server-only';
import crypto from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import type { RepoFile } from './files';
import type { ImportGraph } from './imports';
import type { SuggestionCandidate } from './types';

const JSX_FILES = new Set(['tsx', 'jsx']);
const CODE_FILES = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs']);
const isTest = (p: string) => /(^|\/)(__tests__|tests?|e2e)\/|\.(test|spec|stories)\.\w+$/.test(p);
const idOf = (...parts: string[]) => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 10);
const MAX_EXCERPT_LINES = 60;

function parse(f: RepoFile): ts.SourceFile {
  const kind = f.ext === 'tsx' ? ts.ScriptKind.TSX : f.ext === 'jsx' ? ts.ScriptKind.JSX : f.ext === 'ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  return ts.createSourceFile(f.path, f.text ?? '', ts.ScriptTarget.Latest, true, kind);
}

const clip = (text: string, max = MAX_EXCERPT_LINES) => {
  const lines = text.split('\n');
  return lines.length > max ? [...lines.slice(0, max), `// … ${lines.length - max} more lines`].join('\n') : text;
};

const oneLine = (text: string, max = 140) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

// ---------------------------------------------------------------------------------------------
// Repeated layouts

type Jsx = ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment;

interface FrameNode {
  /** "div.site-container", "Sidebar", "main". */
  label: string;
  /** The tag without its class, for the third level. */
  tag: string;
  component: boolean;
  node: ts.JsxElement | ts.JsxSelfClosingElement;
  children: FrameNode[];
}

const isJsx = (n: ts.Node): n is Jsx => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n);

function openingOf(n: ts.JsxElement | ts.JsxSelfClosingElement) {
  return ts.isJsxElement(n) ? n.openingElement : n;
}

/** The first class in a className="…" or className={`… ${x}`}, if it's written out. */
function firstClass(n: ts.JsxElement | ts.JsxSelfClosingElement): string {
  for (const attr of openingOf(n).attributes.properties) {
    if (!ts.isJsxAttribute(attr) || attr.name.getText() !== 'className' || !attr.initializer) continue;
    let text = '';
    const init = attr.initializer;
    if (ts.isStringLiteral(init)) text = init.text;
    else if (ts.isJsxExpression(init) && init.expression) {
      const e = init.expression;
      if (ts.isNoSubstitutionTemplateLiteral(e) || ts.isStringLiteral(e)) text = e.text;
      else if (ts.isTemplateExpression(e)) text = e.head.text;
    }
    return text.trim().split(/\s+/)[0] ?? '';
  }
  return '';
}

/** Element children, looking through fragments and {cond && <x/>} / {a ? <x/> : <y/>}. */
function elementChildren(n: Jsx): (ts.JsxElement | ts.JsxSelfClosingElement)[] {
  if (ts.isJsxSelfClosingElement(n)) return [];
  const out: (ts.JsxElement | ts.JsxSelfClosingElement)[] = [];
  const take = (c: ts.Node) => {
    if (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) out.push(c);
    else if (ts.isJsxFragment(c)) c.children.forEach(take);
    else if (ts.isJsxExpression(c) && c.expression) {
      const e = c.expression;
      if (ts.isBinaryExpression(e)) take(e.right);
      else if (ts.isConditionalExpression(e)) { take(e.whenTrue); take(e.whenFalse); }
      else if (ts.isParenthesizedExpression(e)) take(e.expression);
      else if (isJsx(e)) take(e);
    } else if (ts.isParenthesizedExpression(c)) take(c.expression);
  };
  n.children.forEach(take);
  return out;
}

function frameOf(n: ts.JsxElement | ts.JsxSelfClosingElement, depth: number): FrameNode {
  const tag = openingOf(n).tagName.getText();
  const component = /^[A-Z]/.test(tag) || tag.includes('.');
  const cls = component ? '' : firstClass(n);
  return {
    label: cls ? `${tag}.${cls}` : tag,
    tag,
    component,
    node: n,
    children: depth < 2 ? elementChildren(n).map((c) => frameOf(c, depth + 1)) : [],
  };
}

const frameSize = (f: FrameNode): number => 1 + f.children.reduce((n, c) => n + frameSize(c), 0);
const frameComponents = (f: FrameNode): string[] => [...(f.component ? [f.tag] : []), ...f.children.flatMap(frameComponents)];

/** "div.site-container > [Sidebar, div.content-area > [AppHeader, main]]" (third level: tags only). */
function frameText(f: FrameNode, depth = 0): string {
  const name = depth >= 2 ? f.tag : f.label;
  return f.children.length ? `${name} > [${f.children.map((c) => frameText(c, depth + 1)).join(', ')}]` : name;
}

/** The outermost JSX in a file (not JSX nested inside other JSX). */
function jsxRoots(sf: ts.SourceFile): (ts.JsxElement | ts.JsxSelfClosingElement)[] {
  const roots: (ts.JsxElement | ts.JsxSelfClosingElement)[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      roots.push(n);
      return;
    }
    if (ts.isJsxFragment(n)) {
      n.children.forEach((c) => visit(c));
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return roots;
}

/**
 * The frame written out as code, two levels deep, with each element's real attributes and the
 * content inside the third level left out: what a model needs to see what's repeated.
 */
function outline(f: FrameNode, sf: ts.SourceFile, depth = 0): string {
  const pad = '  '.repeat(depth);
  const open = openingOf(f.node);
  const head = pad + open.getText(sf).replace(/\n\s*/g, ' ');
  if (ts.isJsxSelfClosingElement(f.node)) return head;
  const close = `${pad}</${f.tag}>`;
  if (depth >= 2 || !f.children.length) {
    const inner = f.node.children.some((c) => !(ts.isJsxText(c) && !c.text.trim())) ? `${pad}  {/* … */}` : '';
    return [head, inner, close].filter(Boolean).join('\n');
  }
  return [head, ...f.children.map((c) => outline(c, sf, depth + 1)), close].join('\n');
}

/**
 * Names used in the frame's own attributes (props and className): the wrapper and its children,
 * plus third-level elements most of the pages have (`common`). A page's own content inside the
 * frame (a settings panel in a sidebar, say) isn't part of the frame.
 */
function namesInFrame(f: FrameNode, common: Set<string>): Set<string> {
  const names = new Set<string>();
  const walkAttrs = (n: FrameNode, depth = 0) => {
    if (depth >= 1 && !common.has(depth === 1 ? n.label : n.tag)) return;
    for (const attr of openingOf(n.node).attributes.properties) {
      const visit = (x: ts.Node) => {
        if (ts.isIdentifier(x) && !(ts.isPropertyAccessExpression(x.parent) && x.parent.name === x)) names.add(x.text);
        ts.forEachChild(x, visit);
      };
      if (ts.isJsxAttribute(attr) && attr.initializer) visit(attr.initializer);
      if (ts.isJsxSpreadAttribute(attr)) visit(attr.expression);
    }
    n.children.forEach((c) => walkAttrs(c, depth + 1));
  };
  walkAttrs(f);
  return names;
}

/** The statements that declare these names in the file, following what they're built from. */
function declarationsFor(sf: ts.SourceFile, names: Set<string>, max = 10): string[] {
  const statements = new Map<ts.Node, string>();
  const byName = new Map<string, ts.Node>();
  const visit = (n: ts.Node) => {
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        const bind = (b: ts.BindingName) => {
          if (ts.isIdentifier(b)) byName.set(b.text, n);
          else b.elements.forEach((e) => { if (!ts.isOmittedExpression(e)) bind(e.name); });
        };
        bind(d.name);
      }
    } else if (ts.isFunctionDeclaration(n) && n.name) {
      byName.set(n.name.text, n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const queue = [...names];
  const seen = new Set<string>();
  while (queue.length && statements.size < max) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const st = byName.get(name);
    if (!st || statements.has(st)) continue;
    const text = st.getText(sf);
    // A long function is the work itself, not the state; show only its first line.
    statements.set(st, text.split('\n').length > 12 ? `${text.split('\n')[0]} … }` : text);
    // Follow what it's built from, one step at a time (sidebarOpen ← sidebarChoice, isWide …).
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const walk = (x: ts.Node) => {
          if (ts.isIdentifier(x) && byName.has(x.text)) queue.push(x.text);
          if (!ts.isArrowFunction(x) && !ts.isFunctionExpression(x)) ts.forEachChild(x, walk);
        };
        if (d.initializer) walk(d.initializer);
      }
    }
  }
  return [...statements.entries()].sort((a, b) => a[0].pos - b[0].pos).map(([, t]) => t);
}

/** Where each component in the frame comes from: shared (another folder) or this file's own. */
function componentSources(sf: ts.SourceFile, file: string, graph: ImportGraph): Map<string, string> {
  const out = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const target = graph.resolve(file, st.moduleSpecifier.text);
    if (!target) continue;
    const clause = st.importClause;
    if (clause.name) out.set(clause.name.text, target);
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) out.set(el.name.text, target);
    }
  }
  return out;
}

const REACT_HOOKS = new Set(['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useSyncExternalStore', 'useContext', 'useReducer', 'useId', 'useTransition', 'useDeferredValue', 'useLayoutEffect', 'useImperativeHandle', 'useOptimistic', 'useActionState']);

/**
 * When the frame's state comes from the project's own hooks (const { open } = usePanel()), the
 * lines in the hook's file that make those values, and one hook further (usePanel → useToggle).
 */
function followHooks(decls: string[], file: string, sources: Map<string, string>, files: RepoFile[], graph: ImportGraph): SuggestionCandidate['excerpts'] {
  const out: SuggestionCandidate['excerpts'] = [];
  const seen = new Set<string>();
  const follow = (text: string, from: string, fromSources: Map<string, string>, hops: number) => {
    for (const m of text.matchAll(/\b(use[A-Z]\w*)\s*\(/g)) {
      const hook = m[1];
      const target = fromSources.get(hook);
      if (REACT_HOOKS.has(hook) || !target || seen.has(target)) continue;
      seen.add(target);
      const f = files.find((x) => x.path === target);
      if (!f?.text) continue;
      // The names this file takes from the hook: const { isOpen: open, toggle } = useX(…).
      const binding = text.slice(0, m.index).match(/(?:const|let)\s*\{([^}]*)\}\s*=\s*$/) ?? text.slice(0, m.index).match(/(?:const|let)\s*\[([^\]]*)\]\s*=\s*$/);
      const names = binding ? binding[1].split(',').map((p) => p.split(':')[0].trim()).filter(Boolean) : [];
      const lines = f.text.split('\n');
      const short = lines.length <= 45;
      const picked = short
        ? lines
        : lines.filter((l) => names.some((n) => new RegExp(`\\b${n}\\b`).test(l)) || /\buse[A-Z]\w*\s*\(/.test(l) && names.some((n) => l.includes(n))).slice(0, 12);
      if (!picked.length) continue;
      out.push({ path: target, code: `// Where ${hook}() in ${from} gets ${names.join(', ') || 'its values'}${short ? '' : ' (the lines that matter)'}:\n${picked.join('\n')}` });
      if (hops > 0) {
        const targetSf = ts.createSourceFile(target, f.text, ts.ScriptTarget.Latest, true, f.ext === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        follow(picked.join('\n'), target, componentSources(targetSf, target, graph), hops - 1);
      }
    }
  };
  follow(decls.join('\n'), file, sources, 1);
  return out;
}

export function findRepeatedLayouts(files: RepoFile[], graph: ImportGraph): SuggestionCandidate[] {
  interface Seen { file: string; sf: ts.SourceFile; frame: FrameNode }
  const byRoot = new Map<string, Seen[]>();
  for (const f of files) {
    if (!JSX_FILES.has(f.ext) || !f.text || isTest(f.path)) continue;
    const sf = parse(f);
    for (const root of jsxRoots(sf)) {
      const frame = frameOf(root, 0);
      // A frame worth unifying: a named wrapper, a few levels of structure, at least one component.
      if (frame.component || !frame.label.includes('.') || frameSize(frame) < 3 || !frameComponents(frame).length) continue;
      const list = byRoot.get(frame.label) ?? [];
      if (!list.some((s) => s.file === f.path)) list.push({ file: f.path, sf, frame });
      byRoot.set(frame.label, list);
    }
  }

  const candidates: SuggestionCandidate[] = [];
  for (const [root, seen] of byRoot) {
    if (seen.length < 3) continue;
    // They should share most of their second level, not just the wrapper's name.
    const childSets = seen.map((s) => new Set(s.frame.children.map((c) => c.label)));
    const common = [...childSets[0]].filter((l) => childSets.every((c) => c.has(l)));
    if (!common.length) continue;

    // Shared pieces: components the frames use that live in a file other than the page's own folder.
    const shared = new Map<string, string>();
    const sourcesByFile = new Map<string, Map<string, string>>();
    for (const s of seen) {
      const sources = componentSources(s.sf, s.file, graph);
      sourcesByFile.set(s.file, sources);
      for (const name of frameComponents(s.frame)) {
        const from = sources.get(name);
        if (from && path.posix.dirname(from) !== path.posix.dirname(s.file)) shared.set(name, from);
      }
    }

    // Variants: the same frame with and without some parts (e.g. with or without a sidebar).
    const variants = new Map<string, string[]>();
    for (const s of seen) variants.set(frameText(s.frame), [...(variants.get(frameText(s.frame)) ?? []), s.file]);

    // Second- and third-level elements most pages have (Sidebar, content-area, AppHeader, main …)
    // belong to the frame; a part only one page has (its own dialog, say) doesn't.
    const tagCount = new Map<string, number>();
    for (const s of seen) {
      const here = new Set([...s.frame.children.map((c) => c.label), ...s.frame.children.flatMap((c) => c.children.map((g) => g.tag))]);
      for (const t of here) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    }
    const frameTags = new Set([...tagCount].filter(([, n]) => n * 2 >= seen.length).map(([t]) => t));
    // The state each file keeps for its frame; written differently means it behaves differently.
    const stateByFile = seen.map((s) => ({ file: s.file, decls: declarationsFor(s.sf, namesInFrame(s.frame, frameTags)) }));
    const ways = new Set(stateByFile.filter((x) => x.decls.length).map((x) => x.decls.map((d) => oneLine(d, 400)).join('\n').replace(/\b[a-z]\w*/g, (w) => (/^(use|const|let|true|false|null)/.test(w) ? w : 'x'))));

    const excerpts: SuggestionCandidate['excerpts'] = seen.map((s) => ({
      path: s.file,
      code: clip([
        ...(stateByFile.find((x) => x.file === s.file)!.decls.length ? ['// State and helpers the frame uses:', ...stateByFile.find((x) => x.file === s.file)!.decls, ''] : []),
        '// The frame (content below the second level left out):',
        outline(s.frame, s.sf),
      ].join('\n')),
    }));
    for (const s of seen) {
      const decls = stateByFile.find((x) => x.file === s.file)!.decls;
      for (const e of followHooks(decls, s.file, sourcesByFile.get(s.file)!, files, graph)) {
        if (!excerpts.some((x) => x.path === e.path)) excerpts.push(e);
      }
    }
    for (const [name, from] of shared) {
      const f = files.find((x) => x.path === from);
      if (f?.text) excerpts.push({ path: from, code: `// Already shared: ${name}\n${clip(f.text, 45)}` });
    }

    const evidence = seen.map((s) => {
      const decls = stateByFile.find((x) => x.file === s.file)!.decls;
      const state = decls.length ? `; state: ${oneLine(decls.slice(0, 2).join(' '), 150)}` : '';
      return `${s.file}: ${frameText(s.frame)}${state}`;
    });
    const variantNote = variants.size > 1 ? ` The pages add their own parts to it (${variants.size} variations).` : '';
    const sharedNote = shared.size ? ` Already shared: ${[...shared].map(([n, p]) => `${n} (${p})`).join(', ')}.` : '';
    const waysNote = ways.size > 1 ? ` The state behind it is written ${ways.size} different ways, so it may behave differently from page to page.` : '';
    candidates.push({
      id: idOf('layout', root, ...seen.map((s) => s.file)),
      kind: 'layout',
      title: `${seen.length} components build the same \`<${root.replace('.', ' className="')}">\` frame`,
      files: seen.map((s) => s.file),
      summary: `These files each write out the same outer layout (\`${frameText(seen[0].frame)}\`) and wire it up themselves.${variantNote}${sharedNote}${waysNote} A wrapper component that takes the parts that differ as props, plus one hook for any state it needs, would keep the layout and its behavior in one place.`,
      evidence,
      shared: [...shared].map(([name, p]) => ({ name, path: p })),
      excerpts,
    });
  }
  return candidates;
}

// ---------------------------------------------------------------------------------------------
// Look-alike code

const WINDOW = 60; // tokens; about 4 to 8 lines
const KEEP = new Set(['fetch', 'window', 'document', 'JSON', 'Math', 'console', 'Promise', 'Date', 'Object', 'Array', 'Number', 'String', 'Error', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'localStorage', 'navigator']);

interface Tok { norm: string; line: number }

/** The file's tokens with local names, strings and numbers blanked out (imports left out). */
function normalizedTokens(f: RepoFile): Tok[] {
  const variant = f.ext === 'tsx' || f.ext === 'jsx' ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, variant, f.text ?? '');
  const out: Tok[] = [];
  const starts = [0];
  for (let i = 0; i < (f.text ?? '').length; i++) if (f.text![i] === '\n') starts.push(i + 1);
  const lineAt = (pos: number) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
  let prev = '';
  let skipLine = -1;
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const pos = scanner.getTokenStart();
    const line = lineAt(pos);
    if (kind === ts.SyntaxKind.ImportKeyword && prev !== '.') skipLine = line; // import lines
    if (line === skipLine) { prev = scanner.getTokenText(); continue; }
    const raw = scanner.getTokenText();
    let norm: string;
    if (kind === ts.SyntaxKind.Identifier) {
      // Keep property names, hooks, components/types and well-known globals; blank local names.
      norm = prev === '.' || /^use[A-Z]/.test(raw) || /^[A-Z]/.test(raw) || KEEP.has(raw) ? raw : 'ID';
    } else if (kind === ts.SyntaxKind.StringLiteral || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral || kind === ts.SyntaxKind.TemplateHead) {
      norm = 'STR';
    } else if (kind === ts.SyntaxKind.NumericLiteral) {
      norm = 'NUM';
    } else if (kind === ts.SyntaxKind.JsxText) {
      continue;
    } else {
      norm = raw;
    }
    out.push({ norm, line });
    prev = raw;
  }
  return out;
}

export function findLookalikeCode(files: RepoFile[]): SuggestionCandidate[] {
  const code = files.filter((f) => CODE_FILES.has(f.ext) && f.text && !isTest(f.path) && !/@generated|do not edit/i.test(f.text.slice(0, 400)));
  const tokens = new Map(code.map((f) => [f.path, normalizedTokens(f)]));
  // Every window of tokens, by its shape: which files have it, and where.
  const spots = new Map<string, Map<string, number>>();
  for (const [file, toks] of tokens) {
    for (let i = 0; i + WINDOW <= toks.length; i += 2) {
      const key = toks.slice(i, i + WINDOW).map((t) => t.norm).join(' ');
      // Mostly punctuation and blanks (e.g. a long object of options) isn't a meaningful shape.
      if ((key.match(/\b(ID|STR|NUM)\b/g) ?? []).length > WINDOW * 0.55) continue;
      let at = spots.get(key);
      if (!at) spots.set(key, (at = new Map()));
      if (!at.has(file)) at.set(file, i);
    }
  }
  // Group windows by the set of files they appear in, and grow each file's covered region.
  const groups = new Map<string, Map<string, { from: number; to: number }>>();
  for (const at of spots.values()) {
    if (at.size < 3) continue;
    const key = [...at.keys()].sort().join('\n');
    const regions = groups.get(key) ?? new Map<string, { from: number; to: number }>();
    for (const [file, i] of at) {
      const r = regions.get(file);
      regions.set(file, r ? { from: Math.min(r.from, i), to: Math.max(r.to, i + WINDOW) } : { from: i, to: i + WINDOW });
    }
    groups.set(key, regions);
  }

  const ranked = [...groups.values()]
    .map((regions) => {
      const lines = [...regions].map(([file, r]) => {
        const toks = tokens.get(file)!;
        return { file, start: toks[r.from].line, end: toks[Math.min(r.to, toks.length) - 1].line };
      });
      const size = lines.reduce((n, l) => n + (l.end - l.start + 1), 0);
      return { lines, score: size };
    })
    .sort((a, b) => b.score - a.score);

  const candidates: SuggestionCandidate[] = [];
  const used: { file: string; start: number; end: number }[] = [];
  for (const g of ranked) {
    if (candidates.length >= 3) break;
    if (g.lines.some((l) => used.some((u) => u.file === l.file && l.start <= u.end && u.start <= l.end))) continue;
    const texts = g.lines.map((l) => code.find((f) => f.path === l.file)!.text!.split('\n').slice(l.start - 1, l.end).join('\n'));
    // Exact copies are reported as pasted code; here we want the same steps with different names.
    if (new Set(texts.map((t) => t.replace(/\s+/g, ' ').trim())).size === 1) continue;
    used.push(...g.lines);
    const avg = Math.round(g.lines.reduce((n, l) => n + l.end - l.start + 1, 0) / g.lines.length);
    candidates.push({
      id: idOf('lookalike', ...g.lines.map((l) => `${l.file}:${l.start}`)),
      kind: 'lookalike',
      title: `The same steps, with different names, in ${g.lines.length} files (about ${avg} lines each)`,
      files: g.lines.map((l) => l.file),
      summary: `These spots do the same thing in the same order and differ only in names and values. One function that takes what differs as arguments would replace them all.`,
      evidence: g.lines.map((l, i) => `${l.file}:${l.start}–${l.end}: ${oneLine(texts[i], 110)}`),
      shared: [],
      excerpts: g.lines.map((l, i) => ({ path: `${l.file} (lines ${l.start}–${l.end})`, code: clip(texts[i], 40) })),
    });
  }
  return candidates;
}

export function findSuggestions(files: RepoFile[], graph: ImportGraph): SuggestionCandidate[] {
  const out: SuggestionCandidate[] = [];
  for (const find of [() => findRepeatedLayouts(files, graph), () => findLookalikeCode(files)]) {
    try {
      out.push(...find());
    } catch (err) {
      console.error('Aegis: a suggestion detector failed:', err);
    }
  }
  return out;
}

