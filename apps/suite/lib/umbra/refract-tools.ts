// lib/umbra/refract-tools.ts — the "Refract workshop" tools: a Flicker can copy a git repo into
// the Refract virtual machine, read and edit files there, run commands, and snapshot or roll
// back that workspace. Nothing here touches the host PC.
//
// These run as the `refract` user over SSH (lib/refract/workspace.ts). The virtual machine is
// the sandbox; workspace snapshots undo project-level mistakes without resetting the whole VM.

import "server-only";
import type { ToolDef, ToolResult } from "./tools";
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
import { saveArtifact } from "@/lib/artifacts";
import { isMarkdownPath } from "@/lib/document-blocks";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const params = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required });

function formatExec(result: { code: number; stdout: string; stderr: string; timedOut: boolean; truncated: boolean }): string {
  if (result.timedOut) return "The command ran too long and was stopped.";
  const parts = [];
  if (result.stdout) parts.push(result.stdout);
  if (result.stderr) parts.push(result.stderr);
  const body = parts.join("\n").trim() || "(no output)";
  const tail = result.truncated ? "\n…(output truncated)" : "";
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
        output: 'No workspaces yet. Use refract_clone with a public https git link to copy a repo in.',
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
        "Copy a git repository into a new workspace in the Refract virtual machine. Use a public https:// link. The host PC is not touched. To put it under a specific name, pass name.",
      parameters: params(
        {
          url: { type: "string", description: "The git link, starting with https://." },
          name: { type: "string", description: "Optional workspace name, e.g. \"my-app\". Defaults to the repo name." },
        },
        ["url"],
      ),
    },
  },
  label: (a) => `Copying ${str(a.name) || str(a.url) || "a repo"} into Refract`,
  run: async (a): Promise<ToolResult> => {
    const copied = await cloneRepo(a.url, str(a.name) || undefined);
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
          workspace: { type: "string", description: "The workspace name, e.g. \"my-app\"." },
          path: { type: "string", description: 'Folder path relative to the workspace, e.g. "src". Leave empty for the top.' },
        },
        ["workspace"],
      ),
    },
  },
  label: (a) => `Looking in ${str(a.workspace)}${str(a.path) ? `/${str(a.path)}` : ""}`,
  run: async (a): Promise<ToolResult> => {
    const result = await listFolder(str(a.workspace), a.path);
    const extra = result.total > result.entries.length ? `\n…and ${result.total - result.entries.length} more` : "";
    return {
      output: `${str(a.workspace)}/${result.path}:\n${result.entries.join("\n") || "(empty folder)"}${extra}`,
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
          workspace: { type: "string", description: "The workspace name." },
          path: { type: "string", description: 'File path relative to the workspace, e.g. "src/app.ts".' },
          start_line: { type: "number", description: "First line to read (optional)." },
          end_line: { type: "number", description: "Last line to read (optional)." },
        },
        ["workspace", "path"],
      ),
    },
  },
  label: (a) => `Reading ${str(a.workspace)}/${str(a.path)}`,
  run: async (a): Promise<ToolResult> => {
    const file = await readWorkFile(str(a.workspace), a.path, a.start_line, a.end_line);
    const more = file.last < file.total ? `\n…(file continues to line ${file.total}; read more with start_line ${file.last + 1})` : "";
    return {
      output: `${str(a.workspace)}/${file.path} (lines ${file.start}-${file.last} of ${file.total}):\n${file.text}${more}`,
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
          workspace: { type: "string", description: "The workspace name." },
          query: { type: "string", description: "The exact text to search for." },
          path: { type: "string", description: "Optional folder to limit the search to." },
        },
        ["workspace", "query"],
      ),
    },
  },
  label: (a) => `Searching ${str(a.workspace)} for “${str(a.query)}”`,
  run: async (a): Promise<ToolResult> => {
    const hits = await searchWork(str(a.workspace), a.query, a.path);
    if (hits.length === 0) return { output: "No matches.", summary: "No matches" };
    const capped = hits.length >= 60 ? "\n…(more matches; search for something more specific)" : "";
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
          workspace: { type: "string", description: "The workspace name." },
          path: { type: "string", description: "File path relative to the workspace." },
          find: { type: "string", description: "The exact existing text to replace. Empty to write the whole file." },
          replace: { type: "string", description: "The new text." },
        },
        ["workspace", "path", "replace"],
      ),
    },
  },
  label: (a) => `Writing ${str(a.workspace)}/${str(a.path)}`,
  run: async (a, ctx): Promise<ToolResult> => {
    const find = typeof a.find === "string" ? a.find.replace(/\r\n/g, "\n") : "";
    const replace = typeof a.replace === "string" ? a.replace.replace(/\r\n/g, "\n") : "";
    const result = await writeWorkFile(str(a.workspace), a.path, replace, find || undefined);
    // A Markdown file the Flicker wrote shows up in Umbra's artifacts, as it is now.
    if (isMarkdownPath(result.path)) keepMarkdownFile(ctx.userId, ctx.botId, `${str(a.workspace)}/${result.path}`, result.text);
    return {
      output: `${result.message} Path: ${str(a.workspace)}/${result.path}. This is only inside the virtual machine.`,
      summary: result.created ? `Created ${result.path}` : `Updated ${result.path}`,
    };
  },
};

/** Save a .md file from Refract as an artifact of the Flicker that wrote it. Never breaks the tool. */
function keepMarkdownFile(userId: string, botId: string, path: string, text: string): void {
  try {
    const bot = db.prepare("SELECT name FROM UmbraBot WHERE id = ? AND user_id = ?").get(botId, userId) as { name: string } | undefined;
    if (!bot) return;
    saveArtifact({ userId, app: "umbra", sourceKind: "bot", sourceId: botId, sourceName: bot.name }, "file", path, text.replace(/\r\n/g, "\n"));
  } catch (err) {
    console.error("Saving a Markdown file as an artifact failed:", err);
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
          workspace: { type: "string", description: "The workspace name." },
          command: { type: "string", description: 'The shell command, e.g. "npm test".' },
          timeout_ms: { type: "number", description: "How long to wait, in milliseconds. Default 60000." },
        },
        ["workspace", "command"],
      ),
    },
  },
  label: (a) => `Running in ${str(a.workspace)}: ${str(a.command).slice(0, 50)}`,
  run: async (a): Promise<ToolResult> => {
    const result = await runInWorkspace(str(a.workspace), a.command, a.timeout_ms);
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
          workspace: { type: "string", description: "The workspace name." },
          snapshot_id: { type: "string", description: "The snapshot to restore. Leave empty to take a new one." },
          label: { type: "string", description: "A short label for a new snapshot, e.g. \"before-refactor\"." },
        },
        ["workspace"],
      ),
    },
  },
  label: (a) =>
    str(a.snapshot_id)
      ? `Restoring ${str(a.workspace)} to a snapshot`
      : `Snapshotting ${str(a.workspace)}`,
  run: async (a): Promise<ToolResult> => {
    if (str(a.snapshot_id)) {
      const restored = await restoreWorkspaceSnapshot(str(a.workspace), a.snapshot_id);
      return {
        output: `Restored the workspace "${str(a.workspace)}" to snapshot "${restored.label}" (${restored.takenAt}).`,
        summary: `Restored ${restored.label}`,
      };
    }
    const taken = await takeWorkspaceSnapshot(str(a.workspace), a.label);
    return {
      output: `Took snapshot "${taken.label}" of workspace "${str(a.workspace)}". Id: ${taken.id}. Restore it later with refract_snapshot and this snapshot_id.`,
      summary: `Snapshot ${taken.label}`,
    };
  },
};

export const REFRACT_TOOLS: ToolDef[] = [workspaces, clone, list, read, search, write, run, snapshot];