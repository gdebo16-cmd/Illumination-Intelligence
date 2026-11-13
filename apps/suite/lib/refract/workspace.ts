// Workshop folders inside the Refract VM: copied-in git repos that Flickers can edit, run
// commands in, and snapshot. Everything lives under /home/refract/work, so a mistake stays
// in the virtual machine. VM-wide VirtualBox snapshots (the control room sidebar) are separate;
// these snapshots are just one project, so two Flickers can work without wiping each other.

import "server-only";
import {
  execInVm,
  shQuote,
  withSftp,
  sftpReadFile,
  sftpWriteFile,
  sftpStat,
  sftpReaddir,
  SSH_MESSAGES,
} from "./ssh";
import { runGitRemote, authFailureMessage } from "./github-auth";

export const WORK_ROOT = "/home/refract/work";
const SNAP_DIR = "/home/refract/work/.snapshots";

const READ_CHAR_LIMIT = 16_000;
const FILE_BYTE_LIMIT = 2_000_000;
const LIST_LIMIT = 300;
const SEARCH_RESULT_LIMIT = 60;
const MAX_SNAPSHOTS_PER_WORKSPACE = 15;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  ".turbo",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  ".snapshots",
]);
const SECRET_FILE = /^\.env(\..*)?$|\.(pem|key|pfx|p12)$|^id_(rsa|ed25519|ecdsa)/i;

export type WorkspaceInfo = {
  name: string;
  git: string | null;
  snapshots: SnapshotInfo[];
};

export type SnapshotInfo = {
  id: string;
  label: string;
  takenAt: string;
};

const slugOk = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;

export function cleanSlug(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!slugOk.test(name) || name === ".snapshots") {
    throw new Error('Give the workspace a short name of letters, numbers, dots, dashes or underscores, e.g. "my-app".');
  }
  return name;
}

/** A path inside a workspace. Rejects abs paths, ".." and the reserved snapshots folder. */
export function workPath(slug: string, rel: unknown = "."): string {
  const name = cleanSlug(slug);
  const given = typeof rel === "string" ? rel.trim() : "";
  const trimmed = given.replace(/^\/+/, "");
  const parts = (trimmed || ".").split("/").filter((p) => p && p !== ".");
  if (parts.some((p) => p === ".." || p === ".snapshots")) {
    throw new Error("That path is outside the workspace.");
  }
  if (parts.some((p) => SKIP_DIRS.has(p) && p === ".git")) {
    throw new Error("The .git folder is off limits.");
  }
  if (parts[0] === ".git") throw new Error("The .git folder is off limits.");
  const joined = parts.length ? `${WORK_ROOT}/${name}/${parts.join("/")}` : `${WORK_ROOT}/${name}`;
  return joined;
}

export function shownPath(slug: string, full: string): string {
  const root = `${WORK_ROOT}/${slug}`;
  if (full === root) return ".";
  if (full.startsWith(`${root}/`)) return full.slice(root.length + 1);
  return full;
}

async function ensureRoot(): Promise<void> {
  const result = await execInVm(`mkdir -p -- ${shQuote(WORK_ROOT)} ${shQuote(SNAP_DIR)}`);
  if (result.timedOut || result.code !== 0) {
    throw new Error(result.stderr.trim() || SSH_MESSAGES.failed);
  }
}

function parseSnapshotName(file: string, slug: string): SnapshotInfo | null {
  // slug__YYYYMMDDTHHMMSS__label.tar.gz
  const prefix = `${slug}__`;
  if (!file.startsWith(prefix) || !file.endsWith(".tar.gz")) return null;
  const core = file.slice(prefix.length, -".tar.gz".length);
  const sep = core.indexOf("__");
  if (sep < 0) return null;
  const stamp = core.slice(0, sep);
  const label = core.slice(sep + 2).replace(/_/g, " ");
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!m) return null;
  const takenAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  return { id: file, label: label || "snapshot", takenAt };
}

function stampNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function cleanLabel(raw: unknown): string {
  const text = (typeof raw === "string" ? raw : "snapshot")
    .trim()
    .slice(0, 40)
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return text || "snapshot";
}

function stripUserinfo(url: string): string {
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return url;
  }
}

/** Only http(s) git URLs. Any login details in the URL are dropped: GitHub logins come from GITHUB_TOKEN. */
export function parseRepoUrl(raw: unknown): { url: string; defaultSlug: string; safeUrl: string } {
  const given = typeof raw === "string" ? raw.trim() : "";
  let url: URL;
  try {
    url = new URL(given);
  } catch {
    throw new Error("Give a full git link, starting with https://.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http and https git links can be copied in.");
  }
  const base = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const defaultSlug = base.replace(/\.git$/i, "");
  if (!slugOk.test(defaultSlug)) {
    throw new Error("Couldn't pick a workspace name from that link. Give one with the name argument.");
  }
  const safe = new URL(url.toString());
  safe.username = "";
  safe.password = "";
  // Never hand userinfo to git (it would be saved in .git/config) or to anyone reading the output.
  return { url: safe.toString(), defaultSlug, safeUrl: safe.toString() };
}

export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
  await ensureRoot();
  const listing = await execInVm(`ls -1A -- ${shQuote(WORK_ROOT)}`);
  if (listing.timedOut) throw new Error(SSH_MESSAGES.timeout);
  if (listing.code !== 0) throw new Error(listing.stderr.trim() || SSH_MESSAGES.failed);
  const names = listing.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && s !== ".snapshots" && slugOk.test(s));
  const snapsOut = await execInVm(`ls -1A -- ${shQuote(SNAP_DIR)} 2>/dev/null || true`);
  const snapFiles = snapsOut.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  const result: WorkspaceInfo[] = [];
  for (const name of names) {
    const git = await execInVm(`git -C ${shQuote(`${WORK_ROOT}/${name}`)} remote get-url origin 2>/dev/null || true`);
    const remote = git.stdout.trim() ? stripUserinfo(git.stdout.trim()) : null;
    const snapshots = snapFiles
      .map((f) => parseSnapshotName(f, name))
      .filter((s): s is SnapshotInfo => !!s)
      .sort((a, b) => (a.takenAt < b.takenAt ? 1 : -1));
    result.push({ name, git: remote, snapshots });
  }
  return result;
}

export async function cloneRepo(rawUrl: unknown, rawSlug?: unknown): Promise<{ name: string; safeUrl: string; output: string }> {
  const { url, defaultSlug, safeUrl } = parseRepoUrl(rawUrl);
  const name = rawSlug ? cleanSlug(rawSlug) : defaultSlug;
  await ensureRoot();
  const dest = `${WORK_ROOT}/${name}`;
  const exists = await execInVm(`test -e ${shQuote(dest)}; echo $?`);
  if (exists.stdout.trim() === "0") {
    throw new Error(`A workspace named "${name}" is already there. Pick a different name, or restore a snapshot into it.`);
  }
  // Private GitHub repos log in with GITHUB_TOKEN through a one-off credential helper (see
  // lib/refract/github-auth.ts), the same way push does: the token never reaches the command
  // line, the origin remote or .git/config. GIT_TERMINAL_PROMPT=0 so nothing hangs on a prompt.
  const run = await runGitRemote(`clone --depth 1 -- ${shQuote(url)} ${shQuote(dest)}`, url, {
    timeoutMs: 180_000,
    maxBytes: 16_000,
  });
  if (run.timedOut) {
    await execInVm(`rm -rf -- ${shQuote(dest)}`).catch(() => {});
    throw new Error("Copying the repo took too long and was stopped.");
  }
  if (run.code !== 0) {
    await execInVm(`rm -rf -- ${shQuote(dest)}`).catch(() => {});
    const auth = authFailureMessage(run, url, "That repo");
    throw new Error(auth || run.output || `Couldn't copy ${safeUrl} into the virtual machine.`);
  }
  return { name, safeUrl, output: run.output };
}

export async function listFolder(slug: string, rel?: unknown): Promise<{ path: string; entries: string[]; total: number }> {
  const dir = workPath(slug, rel);
  return withSftp(async (sftp) => {
    let stats: { isDirectory: boolean };
    try {
      stats = await sftpStat(sftp, dir);
    } catch {
      throw new Error(`There's no folder at ${shownPath(slug, dir)}.`);
    }
    if (!stats.isDirectory) throw new Error("That is a file, not a folder.");
    const raw = await sftpReaddir(sftp, dir);
    const filtered = raw
      .filter((e) => e.filename !== "." && e.filename !== ".." && !(e.isDirectory && SKIP_DIRS.has(e.filename)) && !SECRET_FILE.test(e.filename))
      .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.filename.localeCompare(b.filename));
    const entries = filtered.slice(0, LIST_LIMIT).map((e) => (e.isDirectory ? `${e.filename}/` : e.filename));
    return { path: shownPath(slug, dir), entries, total: filtered.length };
  });
}

function rejectSecret(filePath: string): void {
  const base = filePath.split("/").pop() ?? "";
  if (SECRET_FILE.test(base)) throw new Error("That file may hold passwords or keys, so it's off limits.");
  if (filePath.split("/").includes(".git")) throw new Error("The .git folder is off limits.");
}

export async function readWorkFile(
  slug: string,
  rel: unknown,
  startLine?: unknown,
  endLine?: unknown,
): Promise<{ path: string; text: string; start: number; last: number; total: number }> {
  const file = workPath(slug, rel);
  rejectSecret(file);
  return withSftp(async (sftp) => {
    let stats: { isFile: boolean; isDirectory: boolean; size: number };
    try {
      stats = await sftpStat(sftp, file);
    } catch {
      throw new Error(`There's no file at ${shownPath(slug, file)}.`);
    }
    if (stats.isDirectory) throw new Error("That is a folder, not a file.");
    if (!stats.isFile) throw new Error("That isn't a readable file.");
    if (stats.size > FILE_BYTE_LIMIT) throw new Error("That file is too big to read.");
    const buffer = await sftpReadFile(sftp, file);
    if (buffer.subarray(0, 8000).includes(0)) throw new Error("That isn't a text file.");
    const lines = buffer.toString("utf8").split(/\r?\n/);
    const start = Math.max(1, Math.floor(Number(startLine) || 1));
    const end = Math.min(lines.length, Math.floor(Number(endLine) || lines.length));
    let out = "";
    let last = start - 1;
    for (let n = start; n <= end; n++) {
      const line = `${n}: ${lines[n - 1]}\n`;
      if (out.length + line.length > READ_CHAR_LIMIT) break;
      out += line;
      last = n;
    }
    return { path: shownPath(slug, file), text: out, start, last, total: lines.length };
  });
}

export async function searchWork(slug: string, rawQuery: unknown, rel?: unknown): Promise<string[]> {
  const query = typeof rawQuery === "string" ? rawQuery : "";
  if (!query) throw new Error("Give some text to search for.");
  if (query.length > 200) throw new Error("The search is too long.");
  const dir = workPath(slug, rel);
  const excludes = [...SKIP_DIRS].map((d) => `--exclude-dir=${shQuote(d)}`).join(" ");
  const result = await execInVm(
    `grep -R -n -I -F -m ${SEARCH_RESULT_LIMIT} ${excludes} -- ${shQuote(query)} . || true`,
    { cwd: dir, timeoutMs: 30_000, maxBytes: 24_000 },
  );
  if (result.timedOut) throw new Error(SSH_MESSAGES.timeout);
  const prefix = `${dir}/`;
  const hits: string[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line) continue;
    // grep: ./path:line:text  or /abs/path:line:text
    let shown = line;
    if (shown.startsWith("./")) shown = shown.slice(2);
    if (shown.startsWith(prefix)) shown = shown.slice(prefix.length);
    const base = shown.split(":")[0]?.split("/").pop() ?? "";
    if (SECRET_FILE.test(base)) continue;
    hits.push(shown);
    if (hits.length >= SEARCH_RESULT_LIMIT) break;
  }
  return hits;
}

export async function writeWorkFile(
  slug: string,
  rel: unknown,
  replace: string,
  find?: string,
): Promise<{ path: string; created: boolean; message: string; text: string }> {
  const file = workPath(slug, rel);
  rejectSecret(file);
  const relShown = shownPath(slug, file);
  if (SKIP_DIRS.has(relShown.split("/")[0])) throw new Error(`Files in ${relShown.split("/")[0]} can't be changed.`);

  return withSftp(async (sftp) => {
    const parent = file.slice(0, file.lastIndexOf("/"));
    const mkdir = await execInVm(`mkdir -p -- ${shQuote(parent)}`);
    if (mkdir.code !== 0) throw new Error(mkdir.stderr.trim() || "Couldn't create the folder.");

    let existed = false;
    let before = "";
    try {
      const stats = await sftpStat(sftp, file);
      if (stats.isDirectory) throw new Error("That is a folder, not a file.");
      existed = stats.isFile;
      if (existed) {
        const buffer = await sftpReadFile(sftp, file);
        if (buffer.subarray(0, 8000).includes(0)) throw new Error("That isn't a text file.");
        before = buffer.toString("utf8");
      }
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (/folder, not a file|isn't a text/i.test(msg)) throw err;
      existed = false;
    }

    if (!find) {
      await sftpWriteFile(sftp, file, replace);
      return { path: relShown, created: !existed, message: existed ? "Wrote the file." : "Created the file.", text: replace };
    }
    if (!existed) throw new Error("That file doesn't exist yet. Leave find empty to create it.");
    const normalized = before.replace(/\r\n/g, "\n");
    const needle = find.replace(/\r\n/g, "\n");
    const crlf = before.includes("\r\n");
    const count = normalized.split(needle).length - 1;
    if (count === 0) throw new Error("The find text isn't in the file. Read the file again and copy the text exactly.");
    if (count > 1) throw new Error(`The find text appears ${count} times. Include more surrounding lines so it appears once.`);
    if (needle === replace.replace(/\r\n/g, "\n")) throw new Error("The new text is the same as the old text.");
    const next = normalized.replace(needle, replace.replace(/\r\n/g, "\n"));
    const written = crlf ? next.replace(/\n/g, "\r\n") : next;
    await sftpWriteFile(sftp, file, written);
    return { path: relShown, created: false, message: "Updated the file.", text: next };
  });
}

export async function runInWorkspace(
  slug: string,
  rawCommand: unknown,
  timeoutMs?: unknown,
): Promise<ExecResultLike> {
  const command = typeof rawCommand === "string" ? rawCommand.trim() : "";
  if (!command) throw new Error("Give a command to run.");
  if (command.length > 8_000) throw new Error("That command is too long.");
  // The VM is the sandbox, but we still refuse a login shell as root: Flickers work as `refract`.
  cleanSlug(slug);
  const cwd = workPath(slug, ".");
  const exists = await execInVm(`test -d ${shQuote(cwd)}; echo $?`);
  if (exists.stdout.trim() !== "0") throw new Error(`There's no workspace named "${slug}". Copy a repo in first.`);
  const ms = Math.max(5_000, Math.min(300_000, Math.floor(Number(timeoutMs) || 60_000)));
  const result = await execInVm(command, { cwd, timeoutMs: ms, maxBytes: 32_000 });
  return result;
}

type ExecResultLike = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
};

export async function takeWorkspaceSnapshot(slug: string, rawLabel?: unknown): Promise<SnapshotInfo> {
  const name = cleanSlug(slug);
  await ensureRoot();
  const cwd = `${WORK_ROOT}/${name}`;
  const exists = await execInVm(`test -d ${shQuote(cwd)}; echo $?`);
  if (exists.stdout.trim() !== "0") throw new Error(`There's no workspace named "${name}".`);
  const label = cleanLabel(rawLabel);
  const id = `${name}__${stampNow()}__${label}.tar.gz`;
  const dest = `${SNAP_DIR}/${id}`;
  // Exclude node_modules and other bulky folders so snapshots stay quick and small.
  const excludes = [...SKIP_DIRS].map((d) => `--exclude=${shQuote(d)}`).join(" ");
  const result = await execInVm(
    `tar -C ${shQuote(WORK_ROOT)} ${excludes} -czf ${shQuote(dest)} -- ${shQuote(name)}`,
    { timeoutMs: 120_000 },
  );
  if (result.timedOut) {
    await execInVm(`rm -f -- ${shQuote(dest)}`).catch(() => {});
    throw new Error("Taking the snapshot took too long and was stopped.");
  }
  if (result.code !== 0) {
    await execInVm(`rm -f -- ${shQuote(dest)}`).catch(() => {});
    throw new Error(result.stderr.trim() || "Couldn't take a snapshot.");
  }
  // Drop the oldest if this workspace has more than the cap.
  const list = await execInVm(`ls -1A -- ${shQuote(SNAP_DIR)}`);
  const mine = list.stdout
    .split(/\r?\n/)
    .map((f) => parseSnapshotName(f.trim(), name))
    .filter((s): s is SnapshotInfo => !!s)
    .sort((a, b) => (a.takenAt < b.takenAt ? -1 : 1));
  const extra = mine.length - MAX_SNAPSHOTS_PER_WORKSPACE;
  if (extra > 0) {
    const doomed = mine.slice(0, extra).map((s) => shQuote(`${SNAP_DIR}/${s.id}`)).join(" ");
    await execInVm(`rm -f -- ${doomed}`).catch(() => {});
  }
  return parseSnapshotName(id, name) ?? { id, label, takenAt: new Date().toISOString() };
}

export async function restoreWorkspaceSnapshot(slug: string, snapshotId: unknown): Promise<SnapshotInfo> {
  const name = cleanSlug(slug);
  const id = typeof snapshotId === "string" ? snapshotId.trim() : "";
  const parsed = parseSnapshotName(id, name);
  if (!parsed) throw new Error("That snapshot doesn't belong to this workspace.");
  const dest = `${SNAP_DIR}/${id}`;
  const exists = await execInVm(`test -f ${shQuote(dest)}; echo $?`);
  if (exists.stdout.trim() !== "0") throw new Error("That snapshot isn't there anymore.");
  // Extract to a temp folder, then swap, so a failed extract leaves the current work in place.
  const tmp = `/tmp/refract-restore-${name}-${Date.now()}`;
  const result = await execInVm(
    `mkdir -p -- ${shQuote(tmp)} && tar -C ${shQuote(tmp)} -xzf ${shQuote(dest)} && ` +
      `test -d ${shQuote(`${tmp}/${name}`)} && ` +
      `rm -rf -- ${shQuote(`${WORK_ROOT}/${name}`)} && ` +
      `mv -- ${shQuote(`${tmp}/${name}`)} ${shQuote(`${WORK_ROOT}/${name}`)} && ` +
      `rm -rf -- ${shQuote(tmp)}`,
    { timeoutMs: 120_000 },
  );
  if (result.timedOut || result.code !== 0) {
    await execInVm(`rm -rf -- ${shQuote(tmp)}`).catch(() => {});
    throw new Error(result.timedOut ? SSH_MESSAGES.timeout : result.stderr.trim() || "Couldn't restore the snapshot.");
  }
  return parsed;
}