// GitHub credentials for git in the Refract VM, shared by clone, pull and push.
//
// The token is read from this PC's environment (GITHUB_TOKEN) and handed to git in the VM over
// the SSH session's standard input. The shell reads it into an environment variable that lives
// only for that one command, and a one-off credential helper (passed with `git -c`, so nothing is
// written to .git/config) answers git's password question from that variable. The token never
// appears in a command line, a remote URL, .git/config, or any file. Output is scrubbed of it
// anyway, and URLs are shown without userinfo.

import "server-only";
import { execInVm, shQuote } from "./ssh";

export function githubToken(): string | null {
  const token = (process.env.GITHUB_TOKEN ?? "").trim();
  return token || null;
}

/** Remove a secret, and any login details in URLs, from text before anyone sees it. */
export function scrub(text: string, secret?: string | null): string {
  let out = text.replace(/(https?:\/\/)[^/@\s]+@/gi, "$1");
  if (secret) out = out.split(secret).join("***");
  return out;
}

/** True for https links to github.com, the only host the token is ever offered to. */
export function isGithubHttps(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && (host === "github.com" || host === "www.github.com");
  } catch {
    return false;
  }
}

// `credential.helper=` first clears any helpers from the VM's git config, then this one echoes
// the variable for "get" requests only.
const HELPER = '!f() { test "$1" = get || return 0; echo username=x-access-token; echo "password=$GH_TOKEN"; }; f';

/**
 * Wrap a git command (without the leading `git`) so it authenticates to GitHub with the token.
 * Run the result with `stdin: tokenStdin(token)`.
 */
export function gitWithToken(gitArgs: string): string {
  return (
    "IFS= read -r GH_TOKEN || true; export GH_TOKEN; " +
    "GIT_ASKPASS=/bin/false SSH_ASKPASS=/bin/false " +
    `git -c credential.helper= -c credential.helper=${shQuote(HELPER)} ${gitArgs}`
  );
}

/** The same git command with no credentials at all (public repos, or no token set up). */
export function gitWithoutToken(gitArgs: string): string {
  return `GIT_ASKPASS=/bin/false SSH_ASKPASS=/bin/false git -c credential.helper= ${gitArgs}`;
}

export function tokenStdin(token: string): string {
  return `${token}\n`;
}

/** git's ways of saying it needed a login it didn't get (or the repo is private / missing). */
export const AUTH_FAILURE =
  /authentication failed|invalid username|could not read username|could not read password|terminal prompts disabled|\b40[13]\b|permission .* denied|repository not found|not found/i;

export const PRIVATE_TOKEN_MISSING =
  "That repo looks private (or the link is wrong), and copying or updating a private repo needs a GitHub token, which isn't set up yet. " +
  "Add GITHUB_TOKEN (a GitHub personal access token with access to this repo's contents) to the suite's .env file and restart the app.";

export type GitRun = { code: number; timedOut: boolean; output: string; usedToken: boolean; token: string | null };

/**
 * Run one git command in the VM against `url`. The token is offered only when the remote is an
 * https github.com link and GITHUB_TOKEN is set; otherwise git runs with no credentials at all.
 * The returned output is already scrubbed.
 */
export async function runGitRemote(
  gitArgs: string,
  url: string,
  opts: { cwd?: string; timeoutMs?: number; maxBytes?: number } = {},
): Promise<GitRun> {
  const token = isGithubHttps(url) ? githubToken() : null;
  const command = `export GIT_TERMINAL_PROMPT=0; ${token ? gitWithToken(gitArgs) : gitWithoutToken(gitArgs)}`;
  const result = await execInVm(command, {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 180_000,
    maxBytes: opts.maxBytes ?? 16_000,
    stdin: token ? tokenStdin(token) : undefined,
  });
  const output = scrub(`${result.stdout}\n${result.stderr}`.trim(), githubToken());
  return { code: result.code, timedOut: result.timedOut, output, usedToken: Boolean(token), token };
}

/** A plain explanation when git couldn't log in to (or find) a repo. */
export function authFailureMessage(run: GitRun, url: string, what: string): string | null {
  if (run.code === 0 || !AUTH_FAILURE.test(run.output)) return null;
  if (!isGithubHttps(url)) {
    return `${what} needs a login, and only GitHub logins are set up here. Use a public link, or a github.com repo.`;
  }
  if (!run.usedToken) return PRIVATE_TOKEN_MISSING;
  return (
    `GitHub couldn't find that repo with the token, or refused it. Check the link, and that GITHUB_TOKEN in the suite's .env ` +
    "can read this repo's contents."
  );
}
