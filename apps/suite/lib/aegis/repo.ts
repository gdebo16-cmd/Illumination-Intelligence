// lib/aegis/repo.ts — turning what you typed into a folder Aegis can read.
//
// Three kinds of input:
//   - a folder on this computer, e.g. C:\code\my-app or ~/code/my-app (read in place, never changed);
//   - a git link, e.g. https://github.com/owner/repo (copied into data/aegis/clones/, then deleted);
//   - owner/repo, short for the GitHub link.

import 'server-only';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLONE_DIR = path.join(process.cwd(), 'data', 'aegis', 'clones');
const CLONE_TIMEOUT_MS = 180_000;

interface OpenedRepo {
  /** The folder to scan. */
  dir: string;
  /** A name to show, e.g. "my-app" or "owner/repo". */
  name: string;
  source: 'folder' | 'git';
  /** Removes the copy, for a git link. Does nothing for a folder. */
  close: () => Promise<void>;
}

export class RepoError extends Error {}

const SHORTHAND = /^[\w.-]+\/[\w.-]+$/;

export async function openRepo(raw: unknown): Promise<OpenedRepo> {
  const given = typeof raw === 'string' ? raw.trim() : '';
  if (!given) throw new RepoError('Enter a folder on this computer or a git link.');

  if (/^https?:\/\//i.test(given)) return cloneRepo(given);
  // owner/repo, but not a relative folder like src/app that happens to exist here.
  if (SHORTHAND.test(given) && !fs.existsSync(given)) return cloneRepo(`https://github.com/${given}`);
  return openFolder(given);
}

function openFolder(given: string): OpenedRepo {
  const expanded = given.startsWith('~') ? path.join(os.homedir(), given.slice(1)) : given;
  if (!path.isAbsolute(expanded)) {
    throw new RepoError('Give the full path to the folder, e.g. C:\\code\\my-app or /home/me/my-app.');
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(expanded);
  } catch {
    throw new RepoError(`Couldn't find the folder ${expanded}.`);
  }
  if (!stat.isDirectory()) throw new RepoError(`${expanded} is a file, not a folder.`);
  return { dir: expanded, name: path.basename(expanded), source: 'folder', close: async () => {} };
}

async function cloneRepo(link: string): Promise<OpenedRepo> {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new RepoError("That link doesn't look right.");
  }
  // Never show a password or token that was pasted into the link.
  const shown = `${url.host}${url.pathname}`.replace(/\.git$/i, '').replace(/\/+$/, '');
  const name = url.pathname.split('/').filter(Boolean).slice(-2).join('/').replace(/\.git$/i, '') || url.host;

  fs.mkdirSync(CLONE_DIR, { recursive: true });
  const dir = path.join(CLONE_DIR, crypto.randomUUID());
  const close = () => fs.promises.rm(dir, { recursive: true, force: true });

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        'git',
        ['clone', '--depth', '1', '--quiet', '--', link, dir],
        // GIT_TERMINAL_PROMPT=0: a private repo fails straight away instead of waiting for a password.
        { timeout: CLONE_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
        (err, _stdout, stderr) => {
          if (!err) return resolve();
          if (err.killed) return reject(new RepoError('Copying the repo took too long and was stopped.'));
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return reject(new RepoError('Git isn\'t installed on this computer, so links can\'t be copied in. Scan a folder instead.'));
          }
          const said = String(stderr).replaceAll(link, shown).trim();
          const hint = /could not read Username|Authentication failed|not found/i.test(said)
            ? ' If it is private, clone it yourself and scan the folder instead.'
            : '';
          reject(new RepoError(`Couldn't copy ${shown}.${hint}${said ? `\n${said}` : ''}`));
        },
      );
    });
  } catch (err) {
    await close();
    throw err;
  }
  return { dir, name, source: 'git', close };
}
