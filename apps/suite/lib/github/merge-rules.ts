// lib/github/merge-rules.ts — when a Flicker may merge a pull request (refract_merge_pr).
// Plain logic with no server imports, so it can be tested on its own.
//
// The rules, all of which must hold:
//   - the pull request is open, not a draft, and not merged yet;
//   - it was opened by a Flicker: its head branch starts with "flicker/" and lives in the same repo
//     (not a fork);
//   - it goes into the repo's default branch;
//   - GitHub says it merges cleanly (no conflicts, not blocked by branch protection, not behind);
//   - no status check or check run has failed, and none is still running.

export interface PullInfo {
  number: number;
  url: string;
  title: string;
  state: string;
  merged: boolean;
  draft: boolean;
  /** null while GitHub is still working it out. */
  mergeable: boolean | null;
  /** clean, dirty, blocked, behind, unstable, unknown, draft, has_hooks */
  mergeableState: string;
  headRef: string;
  headSha: string;
  /** "owner/repo" the head branch lives in. */
  headRepo: string;
  baseRef: string;
}

export interface CheckSummary {
  /** False when the token can't read the checks; then GitHub's own merge state has to be clean. */
  readable: boolean;
  failing: string[];
  pending: string[];
  passed: number;
}

export const FLICKER_BRANCH_PREFIX = "flicker/";

const list = (names: string[]) => names.slice(0, 6).join(", ") + (names.length > 6 ? ` and ${names.length - 6} more` : "");

/** Why this pull request must not be merged now, or null when it may be. */
export function mergeBlocker(pr: PullInfo, checks: CheckSummary, repoFullName: string, defaultBranch: string): string | null {
  if (pr.merged) return `Pull request #${pr.number} is already merged.`;
  if (pr.state !== "open") return `Pull request #${pr.number} is closed, so it can't be merged.`;
  if (!pr.headRef.startsWith(FLICKER_BRANCH_PREFIX)) {
    return `Pull request #${pr.number} comes from the branch ${pr.headRef}, not a ${FLICKER_BRANCH_PREFIX} branch, so it wasn't opened by a Flicker. Only Flicker pull requests can be merged with this tool; merge it on GitHub yourself.`;
  }
  if (pr.headRepo.toLowerCase() !== repoFullName.toLowerCase()) {
    return `Pull request #${pr.number} comes from another copy of the repo (${pr.headRepo || "a fork"}), so it can't be merged with this tool.`;
  }
  if (pr.baseRef !== defaultBranch) {
    return `Pull request #${pr.number} goes into ${pr.baseRef}, not the default branch ${defaultBranch}. Only merges into ${defaultBranch} are allowed.`;
  }
  if (pr.draft || pr.mergeableState === "draft") return `Pull request #${pr.number} is still a draft. Mark it ready for review first.`;
  if (pr.mergeable === false || pr.mergeableState === "dirty") {
    return `Pull request #${pr.number} has conflicts with ${pr.baseRef}. Bring ${pr.baseRef} into the branch and fix the conflicts first (refract_pull with rebase, then refract_push).`;
  }
  if (checks.failing.length) return `Checks failed on pull request #${pr.number}: ${list(checks.failing)}. Fix them before merging.`;
  if (checks.pending.length) return `Checks are still running on pull request #${pr.number} (${list(checks.pending)}). Wait for them to finish, then try again.`;
  if (pr.mergeable === null || pr.mergeableState === "unknown") {
    return `GitHub is still working out whether pull request #${pr.number} can be merged. Try again in a minute.`;
  }
  if (pr.mergeableState === "behind") {
    return `Pull request #${pr.number} is behind ${pr.baseRef} and the repo requires it to be up to date. Bring ${pr.baseRef} into the branch first.`;
  }
  if (pr.mergeableState === "blocked") {
    return `GitHub is blocking pull request #${pr.number} (branch protection: a required review or check is missing).`;
  }
  if (pr.mergeableState === "unstable") {
    return `Some checks on pull request #${pr.number} haven't passed${checks.readable ? "" : " (the token can't read which ones)"}. Wait for them, or fix them, before merging.`;
  }
  if (pr.mergeableState !== "clean" && pr.mergeableState !== "has_hooks") {
    return `GitHub reports pull request #${pr.number} as "${pr.mergeableState}", which isn't a clean merge.`;
  }
  return null;
}

/** GitHub check-run conclusions that count as failed. */
export const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "cancelled", "action_required", "stale", "startup_failure"]);
