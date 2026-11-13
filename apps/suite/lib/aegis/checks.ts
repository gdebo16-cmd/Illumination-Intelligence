// lib/aegis/checks.ts — the checks that work in any language: copies, unused folders and
// pictures, docs naming files that are gone, stylesheets patched over themselves, very long
// files, the same lines pasted into many files, confusing names, and catch-all folders.
//
// Each check returns findings (or nothing). They lean towards staying quiet: a check skips
// anything with an obvious reason to exist, because a noisy report gets ignored.

import 'server-only';
import { CODE_EXTS, type RepoFile } from './files';
import type { Finding } from './types';

const kb = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);
const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;
const listOut = (items: string[], max: number) =>
  items.length > max ? [...items.slice(0, max), `…and ${items.length - max} more`] : items;
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ASSET_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp', 'tif', 'tiff', 'psd', 'mp4', 'webm',
  'mov', 'mp3', 'wav', 'ogg', 'ttf', 'otf', 'woff', 'woff2', 'pdf', 'zip',
]);
const STYLE_EXTS = new Set(['css', 'scss', 'sass', 'less']);
const LOGIC_EXTS = new Set([...CODE_EXTS].filter((e) => !STYLE_EXTS.has(e) && e !== 'html' && e !== 'sql'));
const isTest = (p: string) => /(^|\/)(__tests__|tests?|e2e|fixtures?)\/|\.(test|spec)\.\w+$/.test(p);
const isGenerated = (text: string) => /@generated|do not edit|auto-?generated/i.test(text.slice(0, 400));

// ---------------------------------------------------------------------------------------------

export function checkDuplicateFiles(files: RepoFile[]): Finding[] {
  const groups = new Map<string, RepoFile[]>();
  for (const f of files) {
    // Xcode asset catalogs need their own copy of each picture; that's how they work.
    if (!f.hash || f.size < 64 || /\.(xcassets|imageset|appiconset)\//.test(f.path)) continue;
    groups.set(f.hash, [...(groups.get(f.hash) ?? []), f]);
  }
  const dups = [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b[0].size * b.length - a[0].size * a.length);
  if (!dups.length) return [];
  const wasted = dups.reduce((n, g) => n + g[0].size * (g.length - 1), 0);
  return [{
    kind: 'duplicate-files',
    severity: wasted > 200_000 || dups.length >= 4 ? 'medium' : 'low',
    title: `${plural(dups.length, 'set')} of byte-identical files (${kb(wasted)} of copies)`,
    why: 'Copies drift: someone updates one and the others quietly go stale, and nobody can tell which one the app really uses.',
    evidence: listOut(dups.map((g) => `${g.map((f) => f.path).join('  =  ')}  (${kb(g[0].size)})`), 12),
    fix: 'Keep the copy the code actually uses and delete the rest. If two places really need it, have one point at the other (an import, a symlink, or a build step that copies it).',
  }];
}

// ---------------------------------------------------------------------------------------------

/**
 * Folders that hold no code and that nothing outside them mentions by name, and pictures, videos
 * and fonts that nothing mentions. A path built in code (`/brand/${id}.png`) counts as a mention
 * of every file it could match.
 */
export function checkUnusedAssets(files: RepoFile[]): Finding[] {
  const texts = files.filter((f) => f.text !== undefined);
  const findings: Finding[] = [];

  // Folder-level: walk down from the top so only the highest unused folder is reported.
  const byDir = new Map<string, RepoFile[]>();
  for (const f of files) {
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join('/');
      byDir.set(d, [...(byDir.get(d) ?? []), f]);
    }
  }
  const unusedDirs: string[] = [];
  const notPackages: string[] = [];
  const manifests = /^(package\.json|pyproject\.toml|setup\.py|Cargo\.toml|go\.mod|Package\.swift|[\w.-]+\.csproj|composer\.json|Gemfile)$/;
  for (const [dir, inside] of [...byDir].sort((a, b) => a[0].length - b[0].length)) {
    if (unusedDirs.some((u) => dir.startsWith(u + '/'))) continue;
    const name = baseOf(dir);
    const parent = dirOf(dir);
    if (['packages', 'libs', 'modules'].includes(baseOf(parent)) && !inside.some((f) => manifests.test(baseOf(f.path)))) {
      notPackages.push(`${dir}/ is in ${parent}/ but has no package manifest (${inside.length} files)`);
    }
    // Skip short names, hidden folders, and bundles like App.xcodeproj that a tool manages.
    if (name.length < 4 || dir.split('/').some((s) => s.startsWith('.') || /\.\w+$/.test(s)) || inside.some((f) => CODE_EXTS.has(f.ext))) continue;
    const re = new RegExp(`(^|[^\\w-])${escapeRe(name)}([^\\w-]|$)`);
    const mentioned = texts.some((f) => !f.path.startsWith(dir + '/') && re.test(f.text!));
    if (!mentioned) {
      unusedDirs.push(dir);
    }
  }
  if (unusedDirs.length) {
    findings.push({
      kind: 'unused-folders',
      severity: 'medium',
      title: `${plural(unusedDirs.length, 'folder')} that nothing points to`,
      why: "These folders hold no code, and no file outside them mentions them. Old versions and experiments belong in git history, where they're still one command away, not in the working tree.",
      evidence: unusedDirs.map((d) => {
        const inside = byDir.get(d)!;
        return `${d}/  (${plural(inside.length, 'file')}, ${kb(inside.reduce((n, f) => n + f.size, 0))})`;
      }),
      fix: "Delete each folder (git keeps the history), or if one is kept on purpose, add a short README saying what it's for and who uses it.",
    });
  }
  if (notPackages.length) {
    findings.push({
      kind: 'not-a-package',
      severity: 'low',
      title: notPackages.length === 1 ? "1 folder that looks like a package but isn't" : `${notPackages.length} folders that look like packages but aren't`,
      why: "A folder under packages/ promises a shared, installable package. Without a manifest nothing can depend on it, so it's really a loose folder with a misleading address.",
      evidence: notPackages,
      fix: 'Make it a real package (add a manifest and import it), or move its files next to the code that uses them.',
    });
  }

  // File-level: assets in folders that are used, which nothing mentions.
  const patterns: RegExp[] = [];
  for (const f of texts) {
    for (const m of f.text!.matchAll(/[\w@.\-/]*(?:\$\{[^}]{1,40}\}|\{[\w.]{1,40}\})[\w.\-/${}]*/g)) {
      const lit = m[0];
      if (!lit.includes('/') && !lit.includes('.')) continue;
      const re = lit.split(/\$?\{[^}]*\}/).map(escapeRe).join('[^/]+').replace(/^\/+/, '');
      if (re.replace(/\[\^\/\]\+/g, '').length >= 3) patterns.push(new RegExp(`(^|/)${re}$`));
    }
  }
  const corpus = texts.map((f) => f.text!).join('\n');
  const unusedFiles = files.filter((f) => {
    if (!ASSET_EXTS.has(f.ext) || unusedDirs.some((d) => f.path.startsWith(d + '/'))) return false;
    if (/\.(xcassets|imageset|appiconset)\//.test(f.path)) return false;
    // Files a framework picks up by name: Next's app/icon.png, favicon.ico, opengraph-image.png …
    if (/^(favicon|icon|apple-icon|opengraph-image|twitter-image|apple-touch-icon)\b/.test(baseOf(f.path))) return false;
    if (corpus.includes(baseOf(f.path))) return false;
    return !patterns.some((re) => re.test(f.path));
  });
  if (unusedFiles.length) {
    const size = unusedFiles.reduce((n, f) => n + f.size, 0);
    findings.push({
      kind: 'unused-assets',
      severity: size > 1_000_000 ? 'medium' : 'low',
      title: `${plural(unusedFiles.length, 'picture, video or font file')} nothing uses (${kb(size)})`,
      why: "No file mentions these by name, and no path built in code matches them. They make the repo heavier to clone and harder to tidy, because nobody's sure they're safe to remove.",
      evidence: listOut(unusedFiles.map((f) => `${f.path}  (${kb(f.size)})`), 15),
      fix: 'Check each one is really unused (search the code for its name, and for any path built from a variable that could reach it), then delete it.',
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------------------------

/** Paths in `backticks` in Markdown files that don't match any file in the repo. */
export function checkStaleDocs(files: RepoFile[]): Finding[] {
  const paths = files.map((f) => f.path);
  // Paths that .gitignore leaves out (data/, .env …) are meant to exist only on someone's machine.
  const ignored: RegExp[] = files
    .filter((f) => baseOf(f.path) === '.gitignore' && f.text)
    .flatMap((f) => f.text!.split('\n').map((l) => ({ dir: dirOf(f.path), line: l.trim() })))
    .filter(({ line }) => line && !line.startsWith('#') && !line.startsWith('!'))
    .map(({ dir, line }) => {
      const glob = line.replace(/\/$/, '');
      const anchored = glob.startsWith('/') || glob.slice(0, -1).includes('/');
      const body = glob.replace(/^\//, '').split('**').map((part) => part.split('*').map(escapeRe).join('[^/]*')).join('.*');
      const prefix = dir ? `${escapeRe(dir)}/` : '';
      return new RegExp(anchored ? `^${prefix}${body}(/|$)` : `(^|/)${body}(/|$)`);
    });
  // `apps/*/data/` also covers `data/…` named from inside one of those apps (e.g. its README).
  for (const f of files.filter((f) => baseOf(f.path) === '.gitignore' && f.text)) {
    for (const line of f.text!.split('\n').map((l) => l.trim().replace(/^\/|\/$/g, ''))) {
      const segs = line.split('/');
      const lastWild = segs.map((s) => s.includes('*')).lastIndexOf(true);
      if (line.startsWith('#') || lastWild < 0 || lastWild === segs.length - 1) continue;
      ignored.push(new RegExp(`^${segs.slice(lastWild + 1).map(escapeRe).join('/')}(/|$)`));
    }
  }
  const docExts = new Set([...CODE_EXTS, 'json', 'md', 'mdx', 'yml', 'yaml', 'toml']);
  const stale: string[] = [];

  for (const doc of files) {
    if (!['md', 'mdx'].includes(doc.ext) || !doc.text) continue;
    const text = doc.text.replace(/^```[\s\S]*?^```/gm, (block) => block.replace(/[^\n]/g, ' '));
    const seen = new Set<string>();
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      let token = m[1].trim().replace(/[.,:;)]+$/, '');
      if (seen.has(token) || /\s|^[-@~]|:\/\/|^https?:|^\$/.test(token) || token.length < 4) continue;
      seen.add(token);
      token = token.replace(/^\.?\//, '');
      const isDir = token.endsWith('/');
      const last = baseOf(token.replace(/\/$/, ''));
      const ext = last.includes('.') ? last.slice(last.lastIndexOf('.') + 1).toLowerCase() : '';
      // Only things that are clearly meant as repo paths: a/b/c.ext, a/b/, or name.ext for a code file.
      if (!(isDir ? token.includes('/') || token.length > 4 : ext && (token.includes('/') ? true : docExts.has(ext)))) continue;
      if (isDir && !token.slice(0, -1).includes('/') && !/^[\w.-]+\/$/.test(token)) continue;
      if (token.startsWith('<') || ignored.some((re) => re.test(token) || re.test(token.replace(/\/$/, '')))) continue;
      if (token.split('/').some((s) => s === '..')) continue;

      const pattern = token
        .replace(/\/$/, '')
        .split(/(<[^>]*>|\{[^}]*\}|\*|\[[^\]]*\])/)
        .map((part, i) => (i % 2 ? '[^/]+' : escapeRe(part)))
        .join('');
      const re = new RegExp(`(^|/)${pattern}${isDir ? '/' : '$'}`);
      const docDir = dirOf(doc.path);
      const found = paths.some((p) => re.test(p) || (docDir && re.test(p.slice(docDir.length + 1)) && p.startsWith(docDir + '/')));
      if (!found) stale.push(`${doc.path}:${lineAt(doc.text, m.index!)} mentions \`${m[1].trim()}\`, which isn't in the repo`);
    }
  }
  if (!stale.length) return [];
  return [{
    kind: 'stale-docs',
    severity: stale.length >= 5 ? 'medium' : 'low',
    title: `${plural(stale.length, 'file path')} in the docs that no longer exist`,
    why: "Docs that point at files that are gone usually describe an older layout. Readers (and coding agents) follow them and get lost, and every other line in that doc becomes suspect.",
    evidence: listOut(stale, 15),
    fix: 'Update each mention to the current path, or delete the section if what it describes is gone. Some may name files outside the repo on purpose; say so in the text if they do.',
  }];
}

// ---------------------------------------------------------------------------------------------

/** Stylesheets where the same selector is written again further down, i.e. patches on patches. */
export function checkCss(files: RepoFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const f of files) {
    if (!STYLE_EXTS.has(f.ext) || !f.text || isGenerated(f.text)) continue;
    const src = f.text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    // Each top-level rule a selector appears in: its line and the properties it sets.
    const seen = new Map<string, { line: number; props: string[] }[]>();
    let depth = 0;
    let start = 0;
    let inAt = 0; // depth at which an @-rule opened; selectors inside @media are counted separately
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (ch === '{') {
        const head = src.slice(start, i).trim();
        if (depth === 0 && head.startsWith('@')) inAt = 1;
        else if (depth === 0 && head) {
          const line = lineAt(src, start + (src.slice(start, i).length - src.slice(start, i).trimStart().length));
          const close = src.indexOf('}', i);
          const props = src.slice(i + 1, close < 0 ? undefined : close).split(';').map((d) => d.split(':')[0].trim().toLowerCase()).filter(Boolean);
          for (const s of head.split(',')) {
            const sel = s.trim().replace(/\s+/g, ' ');
            if (sel && !/^(from|to|\d+%)$/.test(sel)) seen.set(sel, [...(seen.get(sel) ?? []), { line, props }]);
          }
        }
        depth++;
        start = i + 1;
      } else if (ch === '}') {
        depth = Math.max(0, depth - 1);
        if (depth === 0) inAt = 0;
        start = i + 1;
      } else if (ch === ';' && depth === inAt) {
        start = i + 1;
      }
    }
    // A selector written twice is fine (a shared group rule plus its own rule). It's an override
    // when a later rule sets a property an earlier one already set.
    const repeated = [...seen]
      .map(([sel, rules]) => {
        const count = new Map<string, number>();
        for (const r of rules) for (const p of new Set(r.props)) count.set(p, (count.get(p) ?? 0) + 1);
        const twice = [...count].filter(([, n]) => n > 1).map(([p]) => p);
        return [sel, rules.filter((r) => r.props.some((p) => twice.includes(p))).map((r) => r.line), twice] as const;
      })
      .filter(([, , twice]) => twice.length > 0)
      .sort((a, b) => b[1].length - a[1].length);
    const lines = f.text.split('\n').length;
    if (repeated.length < 8 && !(lines >= 1500 && repeated.length >= 3)) continue;
    const important = (src.match(/!important/g) ?? []).length;
    findings.push({
      kind: 'css-overrides',
      severity: lines > 2500 && repeated.length >= 20 ? 'high' : 'medium',
      title: `${f.path} overrides ${plural(repeated.length, 'selector')} further down the file`,
      why: `At ${plural(lines, 'line')}, with the same selectors written again later on${important ? ` and ${important} !important` : ''}, what a rule really does depends on where it sits in the file. Each fix gets added as another override, so the file only grows.`,
      evidence: listOut(repeated.map(([sel, at, props]) => `\`${sel}\` at lines ${at.join(', ')} (sets ${props.slice(0, 3).join(', ')}${props.length > 3 ? ', …' : ''} again)`), 10),
      fix: 'Merge each later override back into the original rule, then split the file by feature or page (one stylesheet per area plus a small shared one) so each rule has one obvious home.',
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------------------------

export function checkLargeFiles(files: RepoFile[]): Finding[] {
  const big = files
    .filter((f) => LOGIC_EXTS.has(f.ext) && f.text && !isGenerated(f.text) && !isTest(f.path))
    .map((f) => ({ path: f.path, lines: f.text!.split('\n').length }))
    .filter((f) => f.lines > 600)
    .sort((a, b) => b.lines - a.lines);
  if (!big.length) return [];
  return [{
    kind: 'large-files',
    severity: big[0].lines > 1000 ? 'medium' : 'low',
    title: `${plural(big.length, 'code file')} over 600 lines`,
    why: 'Very long files usually do several jobs at once. They are hard to review, merge conflicts pile up in them, and a coding agent has to read the whole thing to change one part.',
    evidence: listOut(big.map((f) => `${f.path}  (${f.lines.toLocaleString()} lines)`), 10),
    fix: 'Split each one along the jobs it does (for a page: the data loading, each panel, the helpers), so each new file has one reason to change.',
  }];
}

// ---------------------------------------------------------------------------------------------

/** The same lines pasted into many files: a helper waiting to be written. */
export function checkRepeatedCode(files: RepoFile[]): Finding[] {
  type Spot = Map<string, number>; // file → first line
  const windows = new Map<string, Spot>();
  const note = (key: string, file: string, line: number) => {
    let spot = windows.get(key);
    if (!spot) windows.set(key, (spot = new Map()));
    if (!spot.has(file)) spot.set(file, line);
  };

  for (const f of files) {
    if (!LOGIC_EXTS.has(f.ext) || !f.text || isTest(f.path) || isGenerated(f.text)) continue;
    const kept: { text: string; line: number }[] = [];
    f.text.split('\n').forEach((raw, i) => {
      const t = raw.trim().replace(/\s+/g, ' ');
      if (t.length < 12) return;
      if (/^(\/\/|#|\*|\/\*|import\s|from\s\S+\simport|export \* from|['"]use (client|server|strict)['"]|require\()/.test(t)) return;
      // Signatures a framework requires (Next.js route handlers) look alike on purpose.
      if (/^export (async )?function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\(/.test(t)) return;
      if (/^[\])}]*[;,]?$/.test(t)) return;
      kept.push({ text: t, line: i + 1 });
    });
    for (let i = 0; i < kept.length; i++) {
      const one = kept[i].text;
      // One-line helpers defined again and again (not short idioms like a useRef, or bare signatures).
      if (one.length >= 70 && !one.endsWith('{') && /^(export\s+)?(const|let|function|async function|def|func|fn)\s/.test(one)) note(one, f.path, kept[i].line);
      if (i + 1 < kept.length) {
        const two = `${one}\n${kept[i + 1].text}`;
        if (two.length >= 100) note(two, f.path, kept[i].line);
      }
    }
  }

  const candidates = [...windows]
    .filter(([key, spot]) => spot.size >= (key.includes('\n') ? 4 : 3))
    .sort((a, b) => b[1].size - a[1].size || b[0].length - a[0].length);
  const picked: [string, Spot][] = [];
  for (const [key, spot] of candidates) {
    const lines = key.split('\n');
    const overlaps = picked.some(([k, s]) => {
      const shared = k.split('\n').some((l) => lines.includes(l));
      const common = [...spot.keys()].filter((p) => s.has(p)).length;
      return shared && common >= Math.min(spot.size, s.size) * 0.4;
    });
    if (!overlaps) picked.push([key, spot]);
    if (picked.length >= 6) break;
  }
  if (!picked.length) return [];
  return [{
    kind: 'repeated-code',
    severity: picked[0][1].size >= 8 ? 'medium' : 'low',
    title: `${plural(picked.length, 'snippet')} pasted into many files (up to ${picked[0][1].size} copies)`,
    why: 'Every copy has to be found and changed when the logic changes, and sooner or later one gets missed. The same few lines in many places is a helper waiting to be written.',
    evidence: picked.map(([key, spot]) => {
      const where = [...spot].slice(0, 4).map(([p, l]) => `${p}:${l}`).join(', ');
      return `\`${key.replace(/\n/g, ' ⏎ ').slice(0, 140)}\` in ${spot.size} files: ${where}${spot.size > 4 ? ', …' : ''}`;
    }),
    fix: 'Move each repeated snippet into one shared function, named for what it does, and call it from every place that had a copy.',
  }];
}

// ---------------------------------------------------------------------------------------------

export function checkNaming(files: RepoFile[]): Finding[] {
  const evidence: string[] = [];

  // Files in the same folder whose names differ only by a trailing "s" or by case/dashes.
  const code = files.filter((f) => CODE_EXTS.has(f.ext));
  const byDir = new Map<string, RepoFile[]>();
  for (const f of code) byDir.set(dirOf(f.path), [...(byDir.get(dirOf(f.path)) ?? []), f]);
  const squash = (s: string) => s.toLowerCase().replace(/[-_.]/g, '');
  for (const [dir, list] of byDir) {
    const stems = list.map((f) => baseOf(f.path).replace(/\.[^.]+$/, ''));
    for (let i = 0; i < stems.length; i++) {
      for (let j = i + 1; j < stems.length; j++) {
        const [a, b] = [stems[i], stems[j]].sort((x, y) => x.length - y.length);
        if (a === b || a.length < 3) continue;
        if (b === `${a}s` || (squash(a) === squash(b))) {
          evidence.push(`${dir ? dir + '/' : ''}${baseOf(list[stems.indexOf(a)].path)} and ${baseOf(list[stems.indexOf(b)].path)}: names one letter apart`);
        }
      }
    }
  }

  // The same folder name with and without a leading _ (components vs _components). The _ marks a
  // private folder in a Next.js app/ folder, so only folders inside one are compared.
  const dirs = new Set(files.filter((f) => /(^|\/)app\//.test(f.path)).flatMap((f) => {
    const parts = f.path.split('/').slice(0, -1);
    return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  }));
  const spellings = new Map<string, Map<string, number>>();
  for (const d of dirs) {
    const name = baseOf(d);
    if (/^\(.*\)$|^\[.*\]$/.test(name)) continue; // Next route groups and dynamic segments
    const key = name.replace(/^_+/, '');
    if (key.length < 3) continue;
    const seen = spellings.get(key) ?? new Map<string, number>();
    seen.set(name, (seen.get(name) ?? 0) + 1);
    spellings.set(key, seen);
  }
  for (const seen of spellings.values()) {
    if (seen.size < 2) continue;
    evidence.push(`Folders called ${[...seen].map(([v, n]) => `\`${v}\` (${n})`).join(' and ')}`);
  }

  // Component files named two ways.
  const comps = files.filter((f) => ['tsx', 'jsx', 'vue', 'svelte'].includes(f.ext) && !/(^|\/)(app|pages|routes)\/.*\b(page|layout|route|index|\+page)\./.test(f.path));
  const pascal = comps.filter((f) => /^[A-Z][A-Za-z0-9]*\./.test(baseOf(f.path)));
  const kebab = comps.filter((f) => /^[a-z0-9]+(-[a-z0-9]+)+\./.test(baseOf(f.path)));
  if (pascal.length >= 3 && kebab.length >= 3) {
    evidence.push(`Component files in PascalCase (${pascal.length}, e.g. ${baseOf(pascal[0].path)}) and kebab-case (${kebab.length}, e.g. ${baseOf(kebab[0].path)})`);
  }

  if (!evidence.length) return [];
  return [{
    kind: 'naming',
    severity: 'low',
    title: `${plural(evidence.length, 'naming inconsistency', 'naming inconsistencies')}`,
    why: 'When the same kind of thing is named two ways, people (and coding agents) guess wrong about where code lives. Names one letter apart get opened by mistake.',
    evidence: listOut(evidence, 12),
    fix: 'Pick one convention for each case and rename the odd ones out. For names one letter apart, rename so each name says what that file does, or merge them if they do the same job.',
  }];
}

// ---------------------------------------------------------------------------------------------

export function checkDumpingGrounds(files: RepoFile[]): Finding[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    if (!LOGIC_EXTS.has(f.ext)) continue;
    const dir = dirOf(f.path);
    if (/^(utils?|helpers?|common|misc|shared|stuff|other)$/i.test(baseOf(dir))) counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  const big = [...counts].filter(([, n]) => n >= 12);
  if (!big.length) return [];
  return [{
    kind: 'dumping-ground',
    severity: 'low',
    title: `${plural(big.length, 'catch-all folder')} with many files`,
    why: '"utils" and "helpers" folders collect anything that had no obvious home. Over time they hide which feature owns which code.',
    evidence: big.map(([d, n]) => `${d}/  (${n} files)`),
    fix: 'Move each file next to the feature that uses it. Keep in the shared folder only what several features really share.',
  }];
}

export function checkSchema(files: RepoFile[]): Finding[] {
  if (files.some((f) => /migrat/i.test(f.path) && /\bcreate\s+table\b/i.test(f.text ?? ''))) return [];
  const spots = files
    .filter((f) => f.text && f.ext !== 'md')
    .map((f) => ({ path: f.path, n: (f.text!.match(/\bcreate\s+table\s+(if\s+not\s+exists\s+)?["`[]?\w/gi) ?? []).length }))
    .filter((s) => s.n > 0);
  if (spots.length < 3) return [];
  return [{
    kind: 'scattered-schema',
    severity: 'low',
    title: `Database tables are defined in ${spots.length} different files`,
    why: "With no single place that shows every table, it's easy to miss one when changing the database, and two features can end up with clashing names.",
    evidence: spots.map((s) => `${s.path}: ${plural(s.n, 'table')}`),
    fix: 'Gather the table definitions into one schema file (or a numbered migrations folder). Leave a table where it is only if it must be created at a special moment, and note why next to it.',
  }];
}

// ---------------------------------------------------------------------------------------------

/**
 * Next.js: code that calls /api/... where no route file answers. Usually the other half of a
 * feature that was never added (or was deleted), so the call quietly fails every time.
 */
export function checkMissingRoutes(files: RepoFile[]): Finding[] {
  // app/api/prism/images/[id]/route.ts → ['api', 'prism', 'images', '[id]']. Route groups like
  // (apps) don't appear in the address.
  const routes = files
    .map((f) => f.path.match(/(?:^|\/)app\/(.*\/)?route\.[cm]?[jt]sx?$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => (m[1] ?? '').split('/').filter((s) => s && !/^\(.*\)$/.test(s)));
  if (!routes.some((r) => r[0] === 'api')) return [];

  const answers = (call: string[], open: boolean) =>
    routes.some((r) => {
      const catchAll = r.length > 0 && /^\[\[?\.\.\./.test(r[r.length - 1]);
      if (!catchAll && !open && r.length !== call.length) return false;
      if (open && r.length < call.length) return false;
      if (catchAll && call.length < r.length - 1) return false;
      return call.every((seg, i) => i >= r.length ? catchAll : seg.includes('${') || seg === '*' || /^\[.*\]$/.test(r[i]) || seg === r[i]);
    });

  const missing = new Map<string, string[]>();
  for (const f of files) {
    if (!['ts', 'tsx', 'js', 'jsx', 'mjs'].includes(f.ext) || !f.text || isTest(f.path) || /(^|\/)app\/(.*\/)?route\.[cm]?[jt]sx?$/.test(f.path)) continue;
    for (const m of f.text.matchAll(/[`'"](\/api\/[^`'"\s?#]*)/g)) {
      const raw = m[1];
      const lineStart = f.text.lastIndexOf('\n', m.index!) + 1;
      const before = f.text.slice(lineStart, m.index!);
      // Skip comments, and constants that define a path this code serves itself (a WebSocket hook).
      if (/\/\/|^\s*\*/.test(before) || /\bconst\s+[A-Z][A-Z0-9_]*\s*=\s*$/.test(before)) continue;
      // A string that ends at a variable ('/api/x/' + id) leaves the rest of the address open.
      const open = raw.endsWith('/') || raw.endsWith('${');
      const segs = raw.replace(/\$\{[^}]*\}/g, '*').split('/').filter(Boolean);
      if (answers(segs, open)) continue;
      const at = `${f.path}:${lineAt(f.text, m.index!)}`;
      missing.set(raw, [...(missing.get(raw) ?? []), at]);
    }
  }
  if (!missing.size) return [];
  return [{
    kind: 'missing-routes',
    severity: 'medium',
    title: `${plural(missing.size, 'API address', 'API addresses')} called by the code with no route behind ${missing.size === 1 ? 'it' : 'them'}`,
    why: 'Each call gets a 404 every time. The page usually carries on as if nothing happened, so a feature quietly never works, and the code on the other end (if it was written) sits unused.',
    evidence: listOut([...missing].map(([addr, at]) => `\`${addr}\` from ${at.slice(0, 3).join(', ')}${at.length > 3 ? ', …' : ''}`), 12),
    fix: 'For each one, decide: add the missing route (if the feature is wanted and its server code exists), or remove the call and anything only it needed.',
  }];
}
