// lib/umbra/refract-tools.ts â€” the "Refract workshop" tools: a Flicker can copy a git repo into
// the Refract virtual machine, read and edit files there, run commands, and snapshot or roll
// back that workspace. Nothing here touches the host PC.
//
// These run as the `refract` user over SSH (lib/refract/workspace.ts). The virtual machine is
// the sandbox; workspace snapshots undo project-level mistakes without resetting the whole VM.

import "server-only";
import type { ToolContext, ToolDef, ToolResult } from "./types";
import {
  listWorkspaces,
  cloneRepo,
  listFolder,
  readWorkFile,
  searchWork,
  writeWorkFile,
  runInWorkspace,
  takeWorkspaceSnapshot,
  restoreWorkspaceSnapshot,
} from "@/lib/refract/workspace";
import db from "@/lib/db";
import { saveArtifact, type ArtifactType } from "@/lib/artifacts";
import { formatForPath } from "@/lib/document-blocks";
import {
  commitWork,
  pushWork,
  pullWork,
  commitsSince,
  repoDir,
  workspaceRemote,
  localDefaultBranch,
  currentBranch,
  githubToken,
  TOKEN_MISSING,
} from "@/lib/refract/git";
import { openPullRequest, repoDefaultBranch, openPullForBranch, getPull, headChecks, mergePull, deleteBranch } from "@/lib/github/pulls";
import { mergeBlocker, FLICKER_BRANCH_PREFIX } from "@/lib/github/merge-rules";
import { scrub } from "@/lib/refract/github-auth";
import { ensureRefractReady } from "@/lib/refract/autostart";


const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const params = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required });

/** Workspace name from the tool call, or the repo the user picked in the dropdown. */
function workspaceOf(a: Record<string, unknown>, ctx?: ToolContext): string {
  return str(a.workspace) || ctx?.workshop?.name || "";
}

function formatExec(result: { code: number; stdout: string; stderr: string; timedOut: boolean; truncated: boolean }): string {
  if (result.timedOut) return "The command ran too long and was stopped.";
  const parts = [];
  if (result.stdout) parts.push(result.stdout);
  if (result.stderr) parts.push(result.stderr);
  const body = parts.join("\n").trim() || "(no output)";
  const tail = result.truncated ? "\nâ€¦(output truncated)" : "";
  return `Exit code ${result.code}\n${body}${tail}`;
}

const workspaces: ToolDef = {
  schema: {
    type: "function",
    function: {
      name: "refract_workspaces",
      description:
        "List the project workspaces in the Refract virtual machine, with their git remotes and workspace snapshots. Start here to see what is already copied in.",
      parameters: params({}, []),
    },
  },
  label: () => "Looking at Refract workspaces",
  run: async (): Promise<ToolResult> => {
    const list = await listWorkspaces();
    if (list.length === 0) {
      return {
        output: 'No workspaces yet. Use refract_clone with an https git link (or the repo picked in the dropdown) to copy a repo in.',
        summary: "No workspaces yet",
      };
    }
    const lines = list.map((w) => {
      const snaps =
        w.snapshots.length === 0
          ? "no snapshots"
          : w.snapshots
              .slice(0, 5)
              .map((s) => `${s.id} (${s.label}, ${s.takenAt})`)
              .join("; ") + (w.snapshots.length > 5 ? ` and ${w.snapshots.length - 5} more` : "");
      return `- ${w.name}${w.git ? `  (${w.git})` : ""}\n  snapshots: ${snaps}`;
    });
    return {
      output: `Workspaces in Refract:\n${lines.join("\n")}`,
      summary: `${list.length} workspace${list.length === 1 ? "" : "s"}`,
    };
  },
};

const clone: ToolDef = {
  schema: {
    type: "function",
    function: {
      name: "refract_clone",
      description:
        "Copy a git repository into a new workspace in the Refract virtual machine. Use an https:// link; private GitHub repos work when the server has a GitHub token (GITHUB_TOKEN), and without one it explains how to add it. The host PC is not touched. To put it under a specific name, pass name. If the user picked a repo in the dropdown, url and name default to that repo.",
      parameters: params(
        {
          url: { type: "string", description: "The git link, starting with https://. Defaults to the repo the user picked." },
          name: { type: "string", description: "Optional workspace name, e.g. \"my-app\". Defaults to the repo name." },
        },
        [],
      ),
    },
  },
  label: (a) => `Copying ${str(a.name) || str(a.url) || "a repo"} into Refract`,
  run: async (a, ctx): Promise<ToolResult> => {
    const url = str(a.url) || ctx.workshop?.url || "";
    const name = str(a.name) || ctx.workshop?.name || undefined;
    if (!url) throw new Error("Give a git link, or pick a repo in the dropdown.");
    const copied = await cloneRepo(url, name);
    return {
      output: `Copied ${copied.safeUrl} into the workspace "${copied.name}" in the Refract virtual machine.\n${copied.output}`,
      summary: `Copied into ${copied.name}`,
    };
  },
};

const list: ToolDef = {
  schema: {
    type: "function",
    function: {
      name: "refract_list",
      description: 'List the files and folders in a Refract workspace (or a folder inside it). Folders end with "/".',
      parameters: params(
        {
          workspace: { type: "string", description: 'The workspace name, e.g. "my-app". Defaults to the repo the user picked.' },
          path: { type: "string", description: 'Folder path relative to the workspace, e.g. "src". Leave empty for the top.' },
        },
        [],
      ),
    },
  },
  label: (a) => `Looking in ${str(a.workspace) || "the selected repo"}${str(a.path) ? `/${str(a.path)}` : ""}`,
  run: async (a, ctx): Promise<ToolResult> => {
    const workspace = workspaceOf(a, ctx);
    if (!workspace) throw new Error("Pick a repo in the dropdown, or pass a workspace name.");
    const result = await listFolder(workspace, a.path);
    const extra = result.total > result.entries.length ? `\nâ€¦and ${result.total - result.entries.length} more` : "";
    return {
      output: `${workspace}/${result.path}:\n${result.entries.join("\n") || "(empty folder)"}${extra}`,
      summary: `${result.total} item${result.total === 1 ? "" : "s"} in ${result.path}`,
    };
  },
};

const read: ToolDef = {
  schema: {
    type: "function",
    function: {
      name: "refract_read",
      description: "Read a text file in a Refract workspace, with line numbers. For long files, read a part with start_line and end_line.",
      parameters: params(
        {
          workspace: { type: "string", description: "The workspace name. Defaults to the repo the user picked." },
          path: { type: "string", description: 'File path relative to the workspace, e.g. "src/app.ts".' },
          start_line: { type: "number", description: "First line to read (optional)." },
          end_line: { type: "number", description: "Last line to read (optional)." },
        },
        ["path"],
      ),
    },
  },
  label: (a) => `Reading ${str(a.workspace) || "the selected repo"}/${str(a.path)}`,
  run: async (a, ctx): Promise<ToolResult> => {
    const workspace = workspaceOf(a, ctx);
    if (!workspace) throw new Error("Pick a repo in the dropdown, or pass a workspace name.");
    const file = await readWorkFile(workspace, a.path, a.start_line, a.end_line);
    const more = file.last < file.total ? `\nâ€¦(file continues to line ${file.total}; read more with start_line ${file.last + 1})` : "";
    return {
      output: `${workspace}/${file.path} (lines ${file.start}-${file.last} of ${file.total}):\n${file.text}${more}`,
      summary: `Read ${file.last - file.start + 1} of ${file.total} lines`,
    };
  },
};

const search: ToolDef = {
  schema: {
    type: "function",
    function: {
      name: "refract_search",
      description: "Search every text file in a Refract workspace (or a folder inside it) for some exact text.",
      parameters: params(
        {
          workspace: { type: "string", description: "The workspace name. Defaults to the repo the user picked." },
          query: { type: "string", description: "The exact text to search for." },
          path: { type: "string", description: "Optional folder to limit the search to." },
        },
        ["query"],
      ),
    },
  },
  label: (a) => `Searching ${str(a.workspace) || "the selected repo"} for â€œ${str(a.query)}â€`,
  run: async (a, ctx): Promise<ToolResult> => {
    const workspace = workspaceOf(a, ctx);
    if (!workspace) throw new Error("Pick a repo in the dropdown, or pass a workspace name.");
    const hits = await searchWork(workspace, a.query, a.path);
    if (hits.length === 0) return { output: "No matches.", summary: "No matches" };
    const capped = hits.length >= 60 ? "\nâ€¦(more matches; search for something more specific)" : "";
    return { output: hits.join("\n") + capped, summary: `${hits.length} match${hits.length === 1 ? "" : "es"}` };
  },
};

const write: ToolDef = {
  schema: {
    type: "function",
    function: {
      name: "refract_write",
      description:
        "Create or change a text file in a Refract workspace. Changes are written in the virtual machine straight away (the host PC is not touched). " +
        "To change part of a file, give the exact text to replace in find (copied from refract_read, without line numbers, and long enough to appear only once) and the new text in replace. " +
        "To create a file or replace its whole contents, leave find empty and put the whole file in replace. One change per call. Take a refract_snapshot first if the change is risky.",
      parameters: params(
        {
          workspace: { type: "string", description: "The workspace name. Defaults to the repo the user picked." },
          path: { type: "string", description: "File path relative to the workspace." },
          find: { type: "string", description: "The exact existing text to replace. Empty to write the whole file." },
          replace: { type: "string", description: "The new text." },
        },
        ["path", "replace"],
      ),
    },
  },
  label: (a) => `Writing ${str(a.workspace) || "the selected repo"}/${str(a.path)}`,
  run: async (a, ctx): Promise<ToolResult> => {
    const workspace = workspaceOf(a, ctx);
    if (!workspace) throw new Error("Pick a repo in the dropdown, or pass a workspace name.");
    const find = typeof a.find === "string" ? a.find.replace(/\r\n/g, "\n") : "";
    const replace = typeof a.replace === "string" ? a.replace.replace(/\r\n/g, "\n") : "";
    const result = await writeWorkFile(workspace, a.path, replace, find || undefined);
    // A Markdown, HTML, SVG or Mermaid file the Flicker wrote shows up in Umbra's artifacts, as it is now.
    const type = formatForPath(result.path);
    if (type) keepFile(ctx.userId, ctx.botId, `${workspace}/${result.path}`, result.text, type);
    return {
      output: `${result.message} Path: ${workspace}/${result.path}. This is only inside the virtual machine.`,
      summary: result.created ? `Created ${result.path}` : `Updated ${result.path}`,
    };
  },
};

/** Save a file from Refract as an artifact of the Flicker that wrote it. Never breaks the tool. */
function keepFile(userId: string, botId: string, path: string, text: string, type: ArtifactType): void {
  try {
    const bot = db.prepare("SELECT name FROM UmbraBot WHERE id = ? AND user_id = ?").get(botId, userId) as { name: string } | undefined;
    if (!bot) return;
    saveArtifact({ userId, app: "umbra", sourceKind: "bot", sourceId: botId, sourceName: bot.name }, "file", path, text.replace(/\r\n/g, "\n"), type);
  } catch (err) {
    console.error("Saving a Refract file as an artifact failed:", err);
  }
}

const run: ToolDef = {
  schema: {
    type: "function",
    function: {
      name: "refract_run",
      description:
        "Run a shell command inside a Refract workspace, as the refract user (not root). Use this for installs, builds, tests, git, and other project commands. " +
        "The working directory is the workspace root. Commands cannot touch the host PC. A command that runs longer than timeout_ms (default 60000, max 300000) is stopped.",
      parameters: params(
        {
          workspace: { type: "string", description: "The workspace name. Defaults to the repo the user picked." },
          command: { type: "string", description: 'The shell command, e.g. "npm test".' },
          timeout_ms: { type: "number", description: "How long to wait, in milliseconds. Default 60000." },
        },
        ["command"],
      ),
    },
  },
  label: (a) => `Running in ${str(a.workspace) || "the selected repo"}: ${str(a.command).slice(0, 50)}`,
  run: async (a, ctx): Promise<ToolResult> => {
    const workspace = workspaceOf(a, ctx);
    if (!workspace) throw new Error("Pick a repo in the dropdown, or pass a workspace name.");
    const result = await runInWorkspace(workspace, a.command, a.timeout_ms);
    const summary = result.timedOut
      ? "Command timed out"
      : result.code === 0
        ? "Command finished"
        : `Command exited ${result.code}`;
    return { output: formatExec(result), summary };
  },
};

const snapshot: ToolDef = {
  schema: {
    type: "function",
    function: {
      name: "refract_snapshot",
      description:
        "Take a snapshot of one Refract workspace, or restore an earlier one. This only affects that project, not the whole virtual machine and not other workspaces. " +
        "Pass snapshot_id to restore; omit it to take a new snapshot. List ids with refract_workspaces.",
      parameters: params(
        {
          workspace: { type: "string", description: "The workspace name. Defaults to the repo the user picked." },
          snapshot_id: { type: "string", description: "The snapshot to restore. Leave empty to take a new one." },
          label: { type: "string", description: "A short label for a new snapshot, e.g. \"before-refactor\"." },
        },
        [],
      ),
    },
  },
  label: (a) =>
    str(a.snapshot_id)
      ? `Restoring ${str(a.workspace) || "the selected repo"} to a snapshot`
      : `Snapshotting ${str(a.workspace) || "the selected repo"}`,
  run: async (a, ctx): Promise<ToolResult> => {
    const workspace = workspaceOf(a, ctx);
    if (!workspace) throw new Error("Pick a repo in the dropdown, or pass a workspace name.");
    if (str(a.snapshot_id)) {
      const restored = await restoreWorkspaceSnapshot(workspace, a.snapshot_id);
      return {
        output: `Restored the workspace "${workspace}" to snapshot "${restored.label}" (${restored.takenAt}).`,
        summary: `Restored ${restored.label}`,
      };
    }
    const taken = await takeWorkspaceSnapshot(workspace, a.label);
    return {
      output: `Took snapshot "${taken.label}" of workspace "${workspace}". Id: ${taken.id}. Restore it later with refract_snapshot and this snapshot_id.`,
      summary: `Snapshot ${taken.label}`,
    };
  },
};

const NEED_WORKSPACE = "Pick a repo in the dropdown, or pass a workspace name.";

const commit: ToolDef = {
  schema: {
    type: "function",
    function: {
      name: "refract_commit",
      description:
        "Commit the changes in a Refract workspace with git, inside the virtual machine. Stages everything that changed (or just the paths you list), " +
        "respects .gitignore, and never includes files that may hold secrets (.env, keys, credential files). Needs a message saying what changed and why. " +
        "Does nothing if there is nothing to commit. Commits stay in the virtual machine until you push them with refract_push or refract_pull_request.",
      parameters: params(
        {
          workspace: { type: "string", description: "The workspace name. Defaults to the repo the user picked." },
          message: { type: "string", description: 'The commit message, e.g. "Fix the login redirect loop".' },
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Optional: only commit these files or folders (relative to the workspace). Leave out to commit every change.",
          },
        },
        ["message"],
      ),
    },
  },
  label: (a) => `Committing in ${str(a.workspace) || "the selected repo"}: ${str(a.message).split("\n")[0].slice(0, 50)}`,
  run: async (a, ctx): Promise<ToolResult> => {
    const workspace = workspaceOf(a, ctx);
    if (!workspace) throw new Error(NEED_WORKSPACE);
    const result = await commitWork(workspace, a.message, a.paths);
    const skipped = result.skipped.length
      ? `\nLeft out because they may hold secrets: ${result.skipped.join(", ")}`
      : "";
    if (!result.committed) {
      return {
        output: `Nothing to commit in "${workspace}": no changes (outside .gitignore) since the last commit.${skipped}`,
        summary: "Nothing to commit",
      };
    }
    const shown = result.files.slice(0, 20).join(", ") + (result.files.length > 20 ? ` and ${result.files.length - 20} more` : "");
    return {
      output:
        `Committed ${result.files.length} file${result.files.length === 1 ? "" : "s"} in "${workspace}" on branch ${result.branch} as ${result.sha}.\n` +
        `Files: ${shown}${skipped}\n${result.stat ?? ""}\n` +
        "This commit is only in the virtual machine. Push it with refract_push, or open a pull request with refract_pull_request.",
      summary: `Committed ${result.shortSha} (${result.files.length} file${result.files.length === 1 ? "" : "s"})`,
    };
  },
};

const push: ToolDef = {
  schema: {
    type: "function",
    function: {
      name: "refract_push",
      description:
        "Push a Refract workspace's commits to its GitHub repo. Never force-pushes. If the workspace is on the default branch (main/master), " +
        "a feature branch is made automatically so the work can go through a pull request; pass branch to name it. " +
        "Needs a GitHub token on the server (GITHUB_TOKEN); without one it explains how to add it. Usually prefer refract_pull_request, which pushes and opens the PR in one step.",
      parameters: params(
        {
          workspace: { type: "string", description: "The workspace name. Defaults to the repo the user picked." },
          branch: { type: "string", description: 'Optional branch name to push to, e.g. "flicker/fix-login". Defaults to the current feature branch, or a new one.' },
          push_to_default: {
            type: "boolean",
            description: "Only set true if the user explicitly asked to push straight onto the default branch instead of a feature branch.",
          },
        },
        [],
      ),
    },
  },
  label: (a) => `Pushing ${str(a.workspace) || "the selected repo"} to GitHub`,
  run: async (a, ctx): Promise<ToolResult> => {
    const workspace = workspaceOf(a, ctx);
    if (!workspace) throw new Error(NEED_WORKSPACE);
    const result = await pushWork(workspace, {
      branch: a.branch,
      pushToDefault: a.push_to_default === true,
      fallbackUrl: ctx.workshop?.url,
    });
    const where = `https://github.com/${result.remote.owner}/${result.remote.repo}/tree/${result.branch}`;
    const notes = [
      result.createdBranch ? `Made the feature branch ${result.branch} for this work.` : "",
      result.upToDate ? "GitHub already had these commits." : "",
      result.uncommitted ? `${result.uncommitted} changed file${result.uncommitted === 1 ? " is" : "s are"} not committed yet, so they were not pushed.` : "",
    ].filter(Boolean);
    return {
      output: `Pushed "${workspace}" to ${result.remote.owner}/${result.remote.repo}, branch ${result.branch}. ${notes.join(" ")}\n${where}\n${result.output}`,
      summary: result.upToDate ? `Already up to date on ${result.branch}` : `Pushed to ${result.branch}`,
      links: [{ title: `${result.remote.owner}/${result.remote.repo} Â· ${result.branch}`, url: where }],
    };
  },
};

const pull: ToolDef = {
  schema: {
    type: "function",
    function: {
      name: "refract_pull",
      description:
        "Bring a Refract workspace up to date with its GitHub repo. Logs in with the server's GitHub token for private repos, so use this instead of running git pull or git fetch with refract_run. " +
        "By default does a fast-forward pull of the current branch; set rebase to put local commits on top of the remote's, or fetch_only to just fetch. Never force-pushes or discards work.",
      parameters: params(
        {
          workspace: { type: "string", description: "The workspace name. Defaults to the repo the user picked." },
          branch: { type: "string", description: "Branch to pull from the remote. Defaults to the current branch." },
          rebase: { type: "boolean", description: "Rebase local commits on top of the remote branch instead of fast-forward only." },
          fetch_only: { type: "boolean", description: "Only fetch from the remote; don't change the files." },
        },
        [],
      ),
    },
  },
  label: (a) => `Getting the latest for ${str(a.workspace) || "the selected repo"}`,
  run: async (a, ctx): Promise<ToolResult> => {
    const workspace = workspaceOf(a, ctx);
    if (!workspace) throw new Error(NEED_WORKSPACE);
    const result = await pullWork(workspace, { branch: a.branch, rebase: a.rebase === true, fetchOnly: a.fetch_only === true });
    const what = result.mode === "fetch" ? "Fetched the latest from" : `Pulled ${result.branch} from`;
    return {
      output: `${what} ${result.url} into "${workspace}".\n${result.output || "(no output)"}`,
      summary: result.mode === "fetch" ? "Fetched" : /up to date/i.test(result.output) ? "Already up to date" : `Pulled ${result.branch}`,
    };
  },
};

const pullRequest: ToolDef = {
  schema: {
    type: "function",
    function: {
      name: "refract_pull_request",
      description:
        "Open a GitHub pull request for a Refract workspace's committed work: pushes it to a feature branch (made automatically if the workspace is on main/master; never force-pushes), " +
        "then opens a pull request into the repo's default branch and returns its link. If a pull request is already open for that branch, returns that one. " +
        "Commit first with refract_commit. Needs a GitHub token on the server (GITHUB_TOKEN); without one it explains how to add it.",
      parameters: params(
        {
          workspace: { type: "string", description: "The workspace name. Defaults to the repo the user picked." },
          title: { type: "string", description: "Pull request title. Defaults to the latest commit message." },
          body: { type: "string", description: "Pull request description: what changed and why, and how it was tested." },
          branch: { type: "string", description: "Optional feature branch name. Defaults to the current feature branch, or a new one." },
          base: { type: "string", description: "Branch to merge into. Defaults to the repo's default branch." },
        },
        [],
      ),
    },
  },
  label: (a) => `Opening a pull request for ${str(a.workspace) || "the selected repo"}`,
  run: async (a, ctx): Promise<ToolResult> => {
    const workspace = workspaceOf(a, ctx);
    if (!workspace) throw new Error(NEED_WORKSPACE);
    const token = githubToken();
    if (!token) throw new Error(TOKEN_MISSING);
    const dir = await repoDir(workspace);
    const remote = await workspaceRemote(dir, ctx.workshop?.url);
    const base = str(a.base) || (await localDefaultBranch(dir)) || (await repoDefaultBranch(token, remote.owner, remote.repo));
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(base) || base.includes("..")) throw new Error("That base branch name isn't valid.");

    const pushed = await pushWork(workspace, { branch: a.branch, fallbackUrl: ctx.workshop?.url, defaultBranch: base });
    if (pushed.branch === base) throw new Error("The work is on the base branch itself, so there's nothing to open a pull request from.");

    const log = await commitsSince(dir, base);
    const title = (str(a.title) || log.subject || `Changes from ${workspace}`).slice(0, 250);
    const body =
      str(a.body) ||
      [log.lines.length ? `Commits:\n${log.lines.map((l) => `- ${l}`).join("\n")}` : "", "Opened by a Flicker from the Refract workshop."]
        .filter(Boolean)
        .join("\n\n");
    const pr = await openPullRequest({ token, owner: remote.owner, repo: remote.repo, branch: pushed.branch, base, title, body });
    const notes = [
      pushed.createdBranch ? `Made the feature branch ${pushed.branch}.` : "",
      pushed.uncommitted ? `${pushed.uncommitted} changed file${pushed.uncommitted === 1 ? " is" : "s are"} not committed, so not in the pull request.` : "",
    ].filter(Boolean);
    return {
      output: pr.existed
        ? `A pull request for ${pushed.branch} was already open: ${pr.url} (into ${pr.base || base}). The latest commits were pushed to it. ${notes.join(" ")}`
        : `Opened pull request #${pr.number} from ${pushed.branch} into ${base}: ${pr.url} ${notes.join(" ")}`,
      summary: pr.existed ? `Pull request #${pr.number} already open` : `Opened pull request #${pr.number}`,
      links: [{ title: `${remote.owner}/${remote.repo} #${pr.number}: ${title}`, url: pr.url }],
    };
  },
};

const mergePr: ToolDef = {
  schema: {
    type: "function",
    function: {
      name: "refract_merge_pr",
      description:
        "Squash-merge a GitHub pull request that a Flicker opened into the repo's default branch. Only use this when the user asked you to merge or approved merging. " +
        "It only merges pull requests from flicker/ branches of the same repo, into the default branch, and refuses when GitHub reports conflicts, branch protection, or checks that failed or are still running (then wait and try again). Never forces anything. " +
        "Pass number, or leave it out to merge the open pull request for the workspace's current branch. Afterwards the flicker/ branch is deleted on GitHub (unless delete_branch is false) " +
        "and the workspace is moved to the default branch and brought up to date when it has no uncommitted changes. Returns the pull request link and the merge commit.",
      parameters: params(
        {
          workspace: { type: "string", description: "The workspace name. Defaults to the repo the user picked." },
          number: { type: "number", description: "The pull request number. Defaults to the open pull request for the workspace's current branch." },
          delete_branch: { type: "boolean", description: "Delete the flicker/ branch on GitHub after merging. Default true." },
        },
        [],
      ),
    },
  },
  label: (a) => `Merging ${Number(a.number) > 0 ? `pull request #${Math.floor(Number(a.number))}` : "the pull request"} for ${str(a.workspace) || "the selected repo"}`,
  run: async (a, ctx): Promise<ToolResult> => {
    const workspace = workspaceOf(a, ctx);
    if (!workspace) throw new Error(NEED_WORKSPACE);
    const token = githubToken();
    if (!token) throw new Error(TOKEN_MISSING);
    try {
      return await mergeFlickerPull(workspace, a, ctx, token);
    } catch (err) {
      throw new Error(scrub((err as Error)?.message || "Merging failed.", token));
    }
  },
};

async function mergeFlickerPull(workspace: string, a: Record<string, unknown>, ctx: ToolContext, token: string): Promise<ToolResult> {
  const dir = await repoDir(workspace);
  const remote = await workspaceRemote(dir, ctx.workshop?.url);
  const fullName = `${remote.owner}/${remote.repo}`;

  let number = Number(a.number);
  if (a.number !== undefined && a.number !== null && a.number !== "" && (!Number.isInteger(number) || number < 0)) {
    throw new Error("Give the pull request number as a whole number, e.g. 12.");
  }
  if (!number) {
    const branch = await currentBranch(dir);
    if (!branch) throw new Error("The workspace isn't on a branch. Pass the pull request number.");
    if (!branch.startsWith(FLICKER_BRANCH_PREFIX)) {
      throw new Error(`The workspace is on ${branch}, not a ${FLICKER_BRANCH_PREFIX} branch, so there's no Flicker pull request to find. Pass the pull request number.`);
    }
    const found = await openPullForBranch(token, remote.owner, remote.repo, branch);
    if (!found) throw new Error(`There's no open pull request for ${branch} in ${fullName}. Open one with refract_pull_request first.`);
    number = found;
  }

  const defaultBranch = await repoDefaultBranch(token, remote.owner, remote.repo);
  ctx.progress?.({ summary: `Checking pull request #${number}` });
  // GitHub works out whether a pull request merges cleanly in the background; give it a moment.
  let pr = await getPull(token, remote.owner, remote.repo, number);
  for (let i = 0; i < 3 && pr.state === "open" && !pr.merged && (pr.mergeable === null || pr.mergeableState === "unknown"); i++) {
    await new Promise((r) => setTimeout(r, 2_000));
    pr = await getPull(token, remote.owner, remote.repo, number);
  }
  const link = { title: `${fullName} #${pr.number}: ${pr.title}`, url: pr.url };
  if (pr.merged) {
    return { output: `Pull request #${pr.number} was already merged: ${pr.url}. Nothing was changed.`, summary: `#${pr.number} already merged`, links: [link] };
  }
  const checks = await headChecks(token, remote.owner, remote.repo, pr.headSha);
  const blocker = mergeBlocker(pr, checks, fullName, defaultBranch);
  if (blocker) throw new Error(`Not merged. ${blocker} ${pr.url}`);

  ctx.progress?.({ summary: `Merging pull request #${pr.number}` });
  const merged = await mergePull(token, remote.owner, remote.repo, pr);

  const notes: string[] = [];
  if (a.delete_branch !== false) {
    try {
      notes.push((await deleteBranch(token, remote.owner, remote.repo, pr.headRef)) ? `Deleted the branch ${pr.headRef} on GitHub.` : `The branch ${pr.headRef} was already gone on GitHub.`);
    } catch (err) {
      notes.push(`The branch ${pr.headRef} couldn't be deleted on GitHub: ${(err as Error).message}`);
    }
  }
  try {
    notes.push(await refreshAfterMerge(workspace, dir, pr.headRef, pr.baseRef));
  } catch (err) {
    notes.push(`The workspace wasn't refreshed: ${(err as Error).message}`);
  }
  const checksNote = checks.readable
    ? checks.passed ? `${checks.passed} check${checks.passed === 1 ? "" : "s"} passed.` : "No checks ran on it."
    : "The token can't read check details, so GitHub's merge state (clean) was relied on.";
  return {
    output:
      `Squash-merged pull request #${pr.number} (${pr.headRef} into ${pr.baseRef}) in ${fullName}: ${pr.url}\n` +
      `Merge commit: ${merged.sha}\n${checksNote} ${notes.join(" ")}`,
    summary: `Merged #${pr.number} into ${pr.baseRef}`,
    links: [link],
  };
}

/** After a merge: put the workspace on the default branch with the merged work, if that's safe. */
async function refreshAfterMerge(workspace: string, dir: string, headRef: string, baseRef: string): Promise<string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(baseRef) || baseRef.includes("..")) return "The workspace was left as it was.";
  const branch = await currentBranch(dir);
  if (branch === headRef) {
    const status = await runInWorkspace(workspace, "git status --porcelain --untracked-files=no");
    if (status.code !== 0 || status.stdout.trim()) {
      return `The workspace is still on ${headRef} because it has uncommitted changes; switch to ${baseRef} and refract_pull when ready.`;
    }
    const checkout = await runInWorkspace(workspace, `git checkout ${baseRef} 2>&1`);
    if (checkout.code !== 0) return `The workspace stayed on ${headRef} (switching to ${baseRef} failed).`;
  } else if (branch !== baseRef) {
    await pullWork(workspace, { fetchOnly: true });
    return `Fetched the latest; the workspace stays on ${branch || "its current commit"}.`;
  }
  await pullWork(workspace, { branch: baseRef });
  return `The workspace is now on ${baseRef} with the merged work.`;
}

// ------------------------------------------------------------------ starting Refract

/** Turn the VM on if it's off and wait for SSH, showing what's happening on the tool's step. */
async function bootRefract(ctx: ToolContext): Promise<boolean> {
  const { started } = await ensureRefractReady({
    userId: ctx.userId,
    onStatus: (text) => ctx.progress?.({ summary: text }),
  });
  if (started) ctx.progress?.({ summary: "Refract is ready" });
  return started;
}

const STARTED_NOTE = "(Refract was off, so it was started first. It is running now.)";

/** Every workshop tool needs the VM: start it when it's off, then do the tool's work. */
function needsVm(def: ToolDef): ToolDef {
  return {
    ...def,
    run: async (a, ctx): Promise<ToolResult> => {
      const started = await bootRefract(ctx);
      const result = await def.run(a, ctx);
      return started ? { ...result, output: `${STARTED_NOTE}\n${result.output}` } : result;
    },
  };
}

const start: ToolDef = {
  schema: {
    type: "function",
    function: {
      name: "refract_start",
      description:
        "Turn on the Refract virtual machine if it is off, and wait until it is ready to use. Does nothing if it is already running. " +
        "The other refract_ tools also start it automatically when needed, so you rarely need this on its own.",
      parameters: params({}, []),
    },
  },
  label: () => "Starting Refract",
  run: async (_a, ctx): Promise<ToolResult> => {
    const started = await bootRefract(ctx);
    return started
      ? { output: "Refract was off. It has been started and is ready (SSH answers).", summary: "Started Refract" }
      : { output: "Refract is already running. Nothing was changed.", summary: "Refract is already on" };
  },
};

export const REFRACT_TOOLS: ToolDef[] = [
  start,
  ...[workspaces, clone, list, read, search, write, run, snapshot, commit, pull, push, pullRequest, mergePr].map(needsVm),
];
