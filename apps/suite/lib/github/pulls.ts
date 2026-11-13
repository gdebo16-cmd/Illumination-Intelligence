// Opening pull requests on GitHub for work a Flicker pushed from the Refract workshop.
// Uses the REST API from this PC (the VM has git but maybe not `gh`). The token comes from
// GITHUB_TOKEN in the suite's environment and is never logged or returned.

import "server-only";
import { FAILED_CONCLUSIONS, type CheckSummary, type PullInfo } from "./merge-rules";

export type { CheckSummary, PullInfo };

const API = "https://api.github.com";

function headers(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "Illumination-Intelligence",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function apiError(res: Response, what: string): Promise<Error> {
  let detail = "";
  try {
    const data = (await res.json()) as { message?: string; errors?: { message?: string }[] };
    detail = [data.message, ...(data.errors ?? []).map((e) => e.message)].filter(Boolean).join(" ");
  } catch {}
  if (res.status === 401) return new Error("GitHub didn't accept the token (GITHUB_TOKEN). It may have expired.");
  if (res.status === 403 || res.status === 429) {
    return new Error(
      /rate limit/i.test(detail)
        ? "GitHub asked us to wait a bit. Try again in a minute."
        : `The GitHub token isn't allowed to ${what}. It needs pull request write access to this repo.`,
    );
  }
  if (res.status === 404) return new Error(`GitHub couldn't find that repo with this token, so it couldn't ${what}.`);
  return new Error(`GitHub couldn't ${what}${detail ? `: ${detail}` : "."}`);
}

export async function repoDefaultBranch(token: string, owner: string, repo: string): Promise<string> {
  const res = await fetch(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    headers: headers(token),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw await apiError(res, "read the repo");
  const data = (await res.json()) as { default_branch?: string };
  return data.default_branch || "main";
}

async function findOpenPull(token: string, owner: string, repo: string, branch: string): Promise<{ url: string; number: number; base: string } | null> {
  const q = new URLSearchParams({ head: `${owner}:${branch}`, state: "open", per_page: "5" });
  const res = await fetch(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?${q}`, {
    headers: headers(token),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as { html_url?: string; number?: number; base?: { ref?: string } }[];
  const pr = rows.find((r) => r.html_url);
  return pr ? { url: pr.html_url!, number: pr.number ?? 0, base: pr.base?.ref ?? "" } : null;
}

/** Open a pull request from `branch` into `base`. If one is already open for the branch, return it. */
export async function openPullRequest(input: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  base: string;
  title: string;
  body: string;
}): Promise<{ url: string; number: number; base: string; existed: boolean }> {
  const { token, owner, repo, branch, base } = input;
  const existing = await findOpenPull(token, owner, repo, branch);
  if (existing) return { ...existing, existed: true };
  const res = await fetch(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
    method: "POST",
    headers: headers(token),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ title: input.title, body: input.body, head: branch, base }),
  });
  if (res.status === 201) {
    const data = (await res.json()) as { html_url: string; number: number };
    return { url: data.html_url, number: data.number, base, existed: false };
  }
  if (res.status === 422) {
    // Most often: a PR already exists (opened at the same moment), or there's nothing to merge.
    const again = await findOpenPull(token, owner, repo, branch);
    if (again) return { ...again, existed: true };
  }
  throw await apiError(res, "open the pull request");
}

// ------------------------------------------------------------------ merging (refract_merge_pr)

const repoPath = (owner: string, repo: string) => `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

type PullJson = {
  number?: number;
  html_url?: string;
  title?: string;
  state?: string;
  merged?: boolean;
  draft?: boolean;
  mergeable?: boolean | null;
  mergeable_state?: string;
  head?: { ref?: string; sha?: string; repo?: { full_name?: string } | null };
  base?: { ref?: string };
};

/** One pull request, with what's needed to decide whether it may be merged. */
export async function getPull(token: string, owner: string, repo: string, number: number): Promise<PullInfo> {
  const res = await fetch(`${repoPath(owner, repo)}/pulls/${number}`, {
    headers: headers(token),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) throw new Error(`There's no pull request #${number} in ${owner}/${repo} (or the token can't see it).`);
  if (!res.ok) throw await apiError(res, "read the pull request");
  const d = (await res.json()) as PullJson;
  return {
    number: d.number ?? number,
    url: d.html_url ?? `https://github.com/${owner}/${repo}/pull/${number}`,
    title: d.title ?? "",
    state: d.state ?? "",
    merged: d.merged === true,
    draft: d.draft === true,
    mergeable: typeof d.mergeable === "boolean" ? d.mergeable : null,
    mergeableState: d.mergeable_state ?? "unknown",
    headRef: d.head?.ref ?? "",
    headSha: d.head?.sha ?? "",
    headRepo: d.head?.repo?.full_name ?? "",
    baseRef: d.base?.ref ?? "",
  };
}

/** The open pull request for a branch of this repo, if there is one. */
export async function openPullForBranch(token: string, owner: string, repo: string, branch: string): Promise<number | null> {
  const found = await findOpenPull(token, owner, repo, branch);
  return found?.number || null;
}

/** Status checks and check runs on a commit: which failed, which are still going. */
export async function headChecks(token: string, owner: string, repo: string, sha: string): Promise<CheckSummary> {
  const out: CheckSummary = { readable: true, failing: [], pending: [], passed: 0 };
  const get = (url: string) => fetch(url, { headers: headers(token), cache: "no-store", signal: AbortSignal.timeout(20_000) });

  const status = await get(`${repoPath(owner, repo)}/commits/${encodeURIComponent(sha)}/status`);
  if (status.ok) {
    const d = (await status.json()) as { statuses?: { context?: string; state?: string }[] };
    for (const s of d.statuses ?? []) {
      const name = s.context || "a status check";
      if (s.state === "success") out.passed++;
      else if (s.state === "pending") out.pending.push(name);
      else out.failing.push(name);
    }
  } else if (status.status === 403 || status.status === 404) {
    out.readable = false;
  } else {
    throw await apiError(status, "read the pull request's checks");
  }

  const runs = await get(`${repoPath(owner, repo)}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`);
  if (runs.ok) {
    const d = (await runs.json()) as { check_runs?: { name?: string; status?: string; conclusion?: string | null }[] };
    for (const r of d.check_runs ?? []) {
      const name = r.name || "a check";
      if (r.status !== "completed") out.pending.push(name);
      else if (r.conclusion && FAILED_CONCLUSIONS.has(r.conclusion)) out.failing.push(name);
      else out.passed++;
    }
  } else if (runs.status === 403 || runs.status === 404) {
    out.readable = false;
  } else {
    throw await apiError(runs, "read the pull request's checks");
  }
  return out;
}

/** Squash-merge a pull request at exactly the commit that was checked. Never forces anything. */
export async function mergePull(token: string, owner: string, repo: string, pr: PullInfo): Promise<{ sha: string }> {
  const res = await fetch(`${repoPath(owner, repo)}/pulls/${pr.number}/merge`, {
    method: "PUT",
    headers: headers(token),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ merge_method: "squash", sha: pr.headSha, commit_title: `${pr.title || `Pull request #${pr.number}`} (#${pr.number})`.slice(0, 250) }),
  });
  if (res.ok) {
    const d = (await res.json()) as { sha?: string; merged?: boolean };
    if (d.merged === false) throw new Error("GitHub didn't merge the pull request.");
    return { sha: d.sha ?? "" };
  }
  if (res.status === 409) throw new Error("New commits landed on the pull request while it was being checked, so it wasn't merged. Check it again.");
  if (res.status === 405) {
    let detail = "";
    try {
      detail = ((await res.json()) as { message?: string }).message ?? "";
    } catch {}
    throw new Error(`GitHub won't merge it${detail ? `: ${detail}` : "."}`);
  }
  throw await apiError(res, "merge the pull request");
}

/** Delete a branch on GitHub (after its pull request was merged). False if it was already gone. */
export async function deleteBranch(token: string, owner: string, repo: string, branch: string): Promise<boolean> {
  const ref = branch.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`${repoPath(owner, repo)}/git/refs/heads/${ref}`, {
    method: "DELETE",
    headers: headers(token),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 204) return true;
  if (res.status === 422 || res.status === 404) return false;
  throw await apiError(res, "delete the branch");
}
