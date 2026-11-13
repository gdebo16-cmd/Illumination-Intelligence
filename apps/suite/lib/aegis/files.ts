// lib/aegis/files.ts — the list of files a scan looks at, with the text of the readable ones.
//
// In a git repo the list comes from git (tracked files plus new ones that aren't ignored), so
// whatever .gitignore leaves out stays out. Anywhere else it walks the folder. Either way,
// installed packages, build output, vendored code and lock files are skipped: they aren't
// the project's own code, and they'd swamp everything else.

import 'server-only';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface RepoFile {
  /** Path from the repo's top folder, always with forward slashes. */
  path: string;
  size: number;
  /** Lowercase extension without the dot, e.g. "tsx". "" when there isn't one. */
  ext: string;
  /** The file's text, for text files up to MAX_TEXT_BYTES. */
  text?: string;
  /** SHA-1 of the contents, for files up to MAX_HASH_BYTES. */
  hash?: string;
}

const MAX_FILES = 20_000;
const MAX_TEXT_BYTES = 1_000_000;
const MAX_HASH_BYTES = 50_000_000;

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', 'dist', 'build', 'out',
  'coverage', 'vendor', 'vendors', 'third_party', 'third-party', 'Pods', 'DerivedData', '.venv', 'venv',
  '__pycache__', 'target', '.gradle', '.idea', '.vscode',
]);
const SKIP_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'Cargo.lock', 'poetry.lock',
  'Gemfile.lock', 'composer.lock', 'go.sum', 'Podfile.lock', '.DS_Store', 'Thumbs.db',
]);

export const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte', 'astro', 'py', 'rb', 'go', 'rs',
  'java', 'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'sh', 'ps1', 'sql', 'css', 'scss',
  'sass', 'less', 'html',
]);
const TEXT_EXTS = new Set([
  ...CODE_EXTS, 'json', 'md', 'mdx', 'txt', 'yml', 'yaml', 'toml', 'xml', 'plist', 'ini', 'cfg', 'conf',
  'env', 'gradle', 'bat', 'cmd', 'svg', 'csv', 'storyboard', 'pbxproj', 'xcconfig', 'lock', 'gitignore',
]);
const TEXT_NAMES = new Set(['Dockerfile', 'Makefile', 'LICENSE', 'README', 'Procfile', 'Gemfile']);

const extOf = (p: string) => {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
};

const skipped = (rel: string) => {
  const parts = rel.split('/');
  const base = parts[parts.length - 1];
  return (
    parts.slice(0, -1).some((d) => SKIP_DIRS.has(d)) ||
    SKIP_FILES.has(base) ||
    /\.min\.(js|css)$|\.map$/.test(base)
  );
};

function gitList(dir: string): Promise<string[] | null> {
  if (!fs.existsSync(path.join(dir, '.git'))) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', dir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout.split('\0').filter(Boolean)),
    );
  });
}

function walk(dir: string): string[] {
  const out: string[] = [];
  const visit = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (out.length >= MAX_FILES) return;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(child);
      } else if (entry.isFile()) {
        out.push(child);
      }
    }
  };
  visit('');
  return out;
}

export async function listFiles(dir: string): Promise<{ files: RepoFile[]; truncated: boolean }> {
  const all = ((await gitList(dir)) ?? walk(dir)).filter((rel) => !skipped(rel));
  const truncated = all.length > MAX_FILES;
  const files: RepoFile[] = [];
  for (const rel of all.slice(0, MAX_FILES)) {
    const full = path.join(dir, rel);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue; // deleted but not yet committed
    }
    if (!stat.isFile()) continue; // e.g. a git submodule
    const ext = extOf(rel);
    const file: RepoFile = { path: rel, size: stat.size, ext };
    if (stat.size > 0 && stat.size <= MAX_HASH_BYTES) {
      const data = fs.readFileSync(full);
      file.hash = crypto.createHash('sha1').update(data).digest('hex');
      const base = rel.slice(rel.lastIndexOf('/') + 1);
      if (stat.size <= MAX_TEXT_BYTES && (TEXT_EXTS.has(ext) || TEXT_NAMES.has(base) || base.startsWith('.'))) {
        file.text = data.toString('utf8');
      }
    }
    files.push(file);
  }
  return { files, truncated };
}
