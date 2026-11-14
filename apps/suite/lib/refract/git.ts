// Closing the loop for Refract workshop work: commit in the VM, push to GitHub, and the bits a
// pull request needs. Everything runs as the `refract` user over SSH (lib/refract/ssh.ts).
//
// Safety rules kept here, not in the tools, so every caller gets them:
//   - Commits respect .gitignore (no `git add -f`) and never include files that look like
//     secrets (.env, keys, credential files); those are unstaged and reported as skipped.
//   - The commit identity is passed with `git -c` for that one command, so the VM's git config
//     isn't changed. It uses the GitHub login and its noreply address, never a personal email.
//   - Pushes never force, and by default never go straight onto the default branch: work goes on
//     a feature branch (made automatically when needed) so it can be reviewed in a pull request.
//   - GitHub logins go through lib/refract/github-auth.ts (shared with clone and pull): the token
//     reaches git over the SSH session's standard input and a one-off credential helper, so it
//     never appears in a command line, the remote URL, .git/config, or any file.

import "server-only";
import { execInVm, shQuote, SSH_MESSAGES, type ExecResult } from "./ssh";
import { cleanSlug, workPath } from "./workspace";
import { githubToken, scrub, gitWithToken, tokenStdin, runGitRemote, authFailureMessage } from "./github-auth";

export { githubToken };

export const GIT_LOGIN = (process.env.GITHUB_LOGIN || "gdebo16-cmd").trim();
const GIT_EMAIL = `${GIT_LOGIN}@users.noreply.github.com`;
const PUSH_TIMEOUT_MS = 180_000;

export const TOKEN_MISSING =
  "Pushing and opening pull requests need a GitHub token, and none is set up yet. " +
  "Add GITHUB_TOKEN (a GitHub personal access token with access to this repo's contents and pull requests) " +
  "to the suite's .env file and restart the app. Commits in the virtual machine still work without it.";

// Paths that may hold passwords or keys. Matched against the whole repo-relative path.
const SECRET_PATH =
  /(^|\/)(\.env(\.[^/]*)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|id_(rsa|ed25519|ecdsa|dsa)(\.pub)?|credentials(\.json)?|secrets?\.(json|ya?ml|toml))$|\.(pem|key|pfx|p12|keystore|jks)$/i;

async function sh(dir: string, command: string, opts: { timeoutMs?: number; maxBytes?: number; stdin?: string } = {}): Promise<ExecResult> {
  const result = await execInVm(`export GIT_TERMINAL_PROMPT=0; ${command}`, { cwd: dir, timeoutMs: opts.timeoutMs ?? 60_000, maxBytes: opts.maxBytes ?? 24_000, stdin: opts.stdin });
  return result;
}

async function shOk(dir: string, command: string, failure: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<string> {
  const result = await sh(dir, command, opts);
  if (result.timedOut) throw new Error(SSH_MESSAGES.timeout);
  if (result.code !== 0) throw new Error(scrub((result.stderr || result.stdout).trim()) || failure);
  return result.stdout;
}

/** The workspace folder, checked to be a git repository. */
export async function repoDir(slug: string): Promise<string> {
  const name = cleanSlug(slug);
  const dir = workPath(name, ".");
  const result = await execInVm(`git -C ${shQuote(dir)} rev-parse --is-inside-work-tree 2>/dev/null || true`);
  if (result.timedOut) throw new Error(SSH_MESSAGES.timeout);
  if (result.stdout.trim() !== "true") {
    throw new Error(`There's no git workspace named "${name}" in Refract. Copy the repo in with refract_clone first.`);
  }
  return dir;
}

export type GithubRemote = { owner: string; repo: string; url: string };

/** owner/repo from a GitHub link (https or git@), as a clean https URL with no userinfo. */
export function parseGithubRemote(raw: string): GithubRemote | null {
  const text = raw.trim();
  let owner = "";
  let repo = "";
  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(text);
  if (ssh) {
    owner = ssh[1];
    repo = ssh[2];
  } else {
    try {
      const u = new URL(text);
      const host = u.hostname.toLowerCase();
      if (u.protocol !== "https:" || (host !== "github.com" && host !== "www.github.com")) return null;
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length < 2) return null;
      owner = parts[0];
      repo = parts[1].replace(/\.git$/i, "");
    } catch {
      return null;
    }
  }
  const ok = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
  if (!ok.test(owner) || !ok.test(repo)) return null;
  return { owner, repo, url: `https://github.com/${owner}/${repo}.git` };
}

/** Where this workspace came from on GitHub (its origin remote, or the repo picked in the chat). */
export async function workspaceRemote(dir: string, fallbackUrl?: string): Promise<GithubRemote> {
  const result = await sh(dir, "git remote get-url origin 2>/dev/null || true");
  const fromOrigin = parseGithubRemote(result.stdout.trim());
  if (fromOrigin) return fromOrigin;
  const fromPick = fallbackUrl ? parseGithubRemote(fallbackUrl) : null;
  if (fromPick) return fromPick;
  throw new Error("This workspace isn't linked to a GitHub repo (its origin remote isn't a github.com link), so it can't be pushed.");
}

export async function currentBranch(dir: string): Promise<string> {
  const result = await sh(dir, "git symbolic-ref --short -q HEAD || true");
  return result.stdout.trim();
}

/** The default branch the clone came from (origin/HEAD), or '' when git doesn't know. */
export async function localDefaultBranch(dir: string): Promise<string> {
  const result = await sh(dir, "git symbolic-ref --short -q refs/remotes/origin/HEAD || true");
  const ref = result.stdout.trim();
  return ref.startsWith("origin/") ? ref.slice("origin/".length) : "";
}

function cleanBranch(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return "";
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(name) ||
    name.includes("..") ||
    name.includes("//") ||
    name.endsWith("/") ||
    name.endsWith(".lock") ||
    name.endsWith(".")
  ) {
    throw new Error('Give the branch a simple name, e.g. "flicker/fix-login".');
  }
  return name;
}

function branchFrom(hint: string): string {
  const slug = hint
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
  return `flicker/${slug ? `${slug}-` : ""}${stamp}`;
}

/** Commit what changed in a workspace. */
export async function commitWork(
  slug: string,
  rawMessage: unknown,
  rawPaths?: unknown,
): Promise<{
  committed: boolean;
  sha?: string;
  shortSha?: string;
  branch?: string;
  files: string[];
  skipped: string[];
  stat?: string;
}> {
  const message = typeof rawMessage === "string" ? rawMessage.replace(/\r\n/g, "\n").trim() : "";
  if (!message) throw new Error("Give a commit message that says what changed.");
  if (message.length > 5_000) throw new Error("That commit message is too long.");
  const dir = await repoDir(slug);

  // Stage: the given paths, or everything that changed. .gitignore is respected (no -f).
  let addCmd = "git add -A -- .";
  if (Array.isArray(rawPaths) && rawPaths.length > 0) {
    const paths = rawPaths.map((p) => (typeof p === "string" ? p.trim().replace(/^\.\/+/, "") : ""));
    for (const p of paths) {
      if (!p || p.startsWith("/") || p.split("/").includes("..") || p.split("/")[0] === ".git") {
        throw new Error(`"${p}" isn't a path inside the workspace.`);
      }
    }
    addCmd = `git add -A -- ${paths.map(shQuote).join(" ")}`;
  }
  await shOk(dir, addCmd, "Couldn't stage the changes.");

  // Never commit files that may hold secrets: take them back out of the commit.
  const staged = await shOk(dir, "git diff --cached --name-only -z", "Couldn't read the staged changes.");
  const names = staged.split("\0").map((n) => n.trim()).filter(Boolean);
  const skipped = names.filter((n) => SECRET_PATH.test(n));
  if (skipped.length) {
    await shOk(dir, `git restore --staged -- ${skipped.map(shQuote).join(" ")}`, "Couldn't leave out the secret files.");
  }
  const files = names.filter((n) => !SECRET_PATH.test(n));
  if (files.length === 0) return { committed: false, files: [], skipped };

  const identity = `-c user.name=${shQuote(GIT_LOGIN)} -c user.email=${shQuote(GIT_EMAIL)}`;
  await shOk(dir, `git ${identity} commit -q -m ${shQuote(message)}`, "Couldn't make the commit.", { timeoutMs: 120_000 });
  const sha = (await shOk(dir, "git rev-parse HEAD", "Couldn't read the new commit.")).trim();
  const branch = (await currentBranch(dir)) || "(detached)";
  const stat = (await sh(dir, "git show --stat --format= HEAD", { maxBytes: 4_000 })).stdout.trim();
  return { committed: true, sha, shortSha: sha.slice(0, 7), branch, files, skipped, stat };
}

/**
 * Pick the branch to push: the one asked for, the current feature branch, or a new feature
 * branch when the workspace sits on the default branch.
 */
async function pickBranch(
  dir: string,
  requested: string,
  defaultBranch: string,
  pushToDefault: boolean,
): Promise<{ branch: string; created: boolean }> {
  const current = await currentBranch(dir);
  const isDefault = (b: string) => b === defaultBranch || (!defaultBranch && (b === "main" || b === "master"));
  if (requested) {
    if (isDefault(requested) && !pushToDefault) {
      throw new Error(
        `I won't push straight onto ${requested} (the default branch). Push to a feature branch and open a pull request, ` +
          "or, only if the user clearly asked for it, set push_to_default.",
      );
    }
    if (requested === current) return { branch: requested, created: false };
    const exists = await sh(dir, `git show-ref --verify --quiet ${shQuote(`refs/heads/${requested}`)}; echo $?`);
    if (exists.stdout.trim() === "0") {
      throw new Error(
        `A local branch named ${requested} already exists but isn't checked out (you're on ${current || "a detached commit"}). ` +
          "Switch to it with refract_run first, or pick another name.",
      );
    }
    await shOk(dir, `git switch -q -c ${shQuote(requested)}`, "Couldn't make the branch.");
    return { branch: requested, created: true };
  }
  if (current && !isDefault(current)) return { branch: current, created: false };
  if (current && pushToDefault) return { branch: current, created: false };
  const subject = (await sh(dir, "git log -1 --format=%s 2>/dev/null || true")).stdout.trim();
  let name = branchFrom(subject);
  const taken = await sh(dir, `git show-ref --verify --quiet ${shQuote(`refs/heads/${name}`)}; echo $?`);
  if (taken.stdout.trim() === "0") name = `${name}-${Math.random().toString(36).slice(2, 6)}`;
  await shOk(dir, `git switch -q -c ${shQuote(name)}`, "Couldn't make a feature branch.");
  return { branch: name, created: true };
}

export type PushResult = {
  remote: GithubRemote;
  branch: string;
  createdBranch: boolean;
  defaultBranch: string;
  output: string;
  upToDate: boolean;
  uncommitted: number;
};

/** Push the workspace's current work to GitHub. Never forces. */
export async function pushWork(
  slug: string,
  opts: { branch?: unknown; pushToDefault?: boolean; fallbackUrl?: string; defaultBranch?: string } = {},
): Promise<PushResult> {
  const token = githubToken();
  if (!token) throw new Error(TOKEN_MISSING);
  const dir = await repoDir(slug);
  const remote = await workspaceRemote(dir, opts.fallbackUrl);
  const head = await sh(dir, "git rev-parse --verify -q HEAD || true");
  if (!head.stdout.trim()) throw new Error("There are no commits to push yet. Commit with refract_commit first.");

  const defaultBranch = opts.defaultBranch || (await localDefaultBranch(dir));
  const { branch, created } = await pickBranch(dir, cleanBranch(opts.branch), defaultBranch, Boolean(opts.pushToDefault));

  const status = await sh(dir, "git status --porcelain");
  const uncommitted = status.stdout.split(/\r?\n/).filter((l) => l.trim()).length;

  // The token arrives on stdin, lives only in this shell's environment, and is handed to git by a
  // one-off credential helper (lib/refract/github-auth.ts).
  const command = gitWithToken(`push --porcelain ${shQuote(remote.url)} ${shQuote(`HEAD:refs/heads/${branch}`)} 2>&1`);
  const result = await sh(dir, command, { timeoutMs: PUSH_TIMEOUT_MS, maxBytes: 16_000, stdin: tokenStdin(token) });
  const output = scrub(`${result.stdout}\n${result.stderr}`.trim(), token);
  if (result.timedOut) throw new Error("Pushing to GitHub took too long and was stopped.");
  if (result.code !== 0) {
    if (/non-fast-forward|fetch first|\[rejected\]|rejected/i.test(output)) {
      throw new Error(
        `GitHub has commits on ${branch} that this workspace doesn't. Bring them in first with refract_pull (branch ${branch}, rebase true), then push again. I never force-push.`,
      );
    }
    if (/authentication failed|invalid username|could not read username|403|401|permission .* denied|write access/i.test(output)) {
      throw new Error(
        "GitHub refused the token for this push. It needs write access to this repo's contents (and pull requests for a PR). Check GITHUB_TOKEN in the suite's .env.",
      );
    }
    if (/repository not found|not found/i.test(output)) {
      throw new Error(`GitHub couldn't find ${remote.owner}/${remote.repo} with this token. Check the token can see that repo.`);
    }
    throw new Error(output || "Couldn't push to GitHub.");
  }
  // Remember the pushed branch locally so later git commands in the VM see it (no token involved).
  await sh(dir, `git update-ref ${shQuote(`refs/remotes/origin/${branch}`)} HEAD 2>/dev/null || true`);
  const upToDate = /up to date|\[up to date\]|=\s+HEAD:/i.test(output);
  return { remote, branch, createdBranch: created, defaultBranch, output, upToDate, uncommitted };
}

export type PullResult = { branch: string; mode: "fetch" | "rebase" | "ff-only"; output: string; url: string };

/**
 * Bring in GitHub's latest for a workspace (fetch, fast-forward pull, or pull --rebase), logging
 * in with the token for private repos the same per-command way push does. Nothing is written to
 * .git/config, and the origin remote keeps its plain https link.
 */
export async function pullWork(
  slug: string,
  opts: { branch?: unknown; rebase?: boolean; fetchOnly?: boolean } = {},
): Promise<PullResult> {
  const dir = await repoDir(slug);
  const origin = (await sh(dir, "git remote get-url origin 2>/dev/null || true")).stdout.trim();
  if (!origin) throw new Error("This workspace has no origin remote, so there's nothing to pull from.");
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+@/i.test(origin)) {
    // An old clone kept login details in its remote; drop them (the helper supplies the login now).
    await sh(dir, `git remote set-url origin ${shQuote(origin.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, "$1"))}`);
  }
  const url = origin.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, "$1");
  const branch = cleanBranch(opts.branch) || (await currentBranch(dir));
  if (!branch && !opts.fetchOnly) throw new Error("The workspace isn't on a branch. Pass branch, or switch to one first.");

  const identity = `-c user.name=${shQuote(GIT_LOGIN)} -c user.email=${shQuote(GIT_EMAIL)}`;
  const mode: PullResult["mode"] = opts.fetchOnly ? "fetch" : opts.rebase ? "rebase" : "ff-only";
  const args =
    mode === "fetch"
      ? "fetch --prune origin 2>&1"
      : mode === "rebase"
        ? `${identity} pull --rebase --autostash origin ${shQuote(branch)} 2>&1`
        : `${identity} pull --ff-only origin ${shQuote(branch)} 2>&1`;
  const run = await runGitRemote(args, url, { cwd: dir, timeoutMs: PUSH_TIMEOUT_MS });
  if (run.timedOut) throw new Error("Getting the latest from the remote took too long and was stopped.");
  if (run.code !== 0) {
    if (/couldn't find remote ref/i.test(run.output)) {
      throw new Error(`The remote has no branch named ${branch} yet, so there's nothing to pull. Push it first with refract_push.`);
    }
    const auth = authFailureMessage(run, url, "This repo");
    if (auth) throw new Error(auth);
    if (/not possible to fast-forward|diverg/i.test(run.output)) {
      throw new Error(`${branch} has commits here and on the remote that differ. Pull again with rebase true to put this work on top.`);
    }
    if (/conflict/i.test(run.output)) {
      throw new Error(
        `Bringing in the remote's changes hit conflicts:\n${run.output}\nFix the conflicted files and run "git rebase --continue" with refract_run, or undo it with "git rebase --abort".`,
      );
    }
    throw new Error(run.output || "Couldn't get the latest from the remote.");
  }
  return { branch, mode, output: run.output, url };
}

/** Subject of the newest commit, and the commits on this branch that aren't on base. */
export async function commitsSince(dir: string, base: string): Promise<{ subject: string; lines: string[] }> {
  const subject = (await sh(dir, "git log -1 --format=%s 2>/dev/null || true")).stdout.trim();
  let lines: string[] = [];
  if (base) {
    const log = await sh(dir, `git log --format=%s ${shQuote(`refs/remotes/origin/${base}`)}..HEAD 2>/dev/null || true`, { maxBytes: 8_000 });
    lines = log.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 30);
  }
  return { subject, lines };
}
