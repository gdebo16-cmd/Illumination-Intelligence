// Types the Umbra agent files share: a tool, what it gets and gives back, and the steps the chat
// shows. Kept apart so agent.ts, tools.ts, code.ts and refract-tools.ts don't import each other
// just for types.

/** One tool use, as shown in the chat. */
export interface AgentStep {
  id: string;
  tool: string;
  label: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
  links?: { title: string; url: string }[];
  image?: { url: string; prompt: string };
  /** Code helper: a suggested file change. */
  edit?: CodeEditView;
  /** Prod control: a request waiting for (or answered by) the user. */
  approval?: ApprovalView;
  /** Teams: the teammate who did this step's work, */
  bot?: { id: string; name: string; flame: string };
  /** …the tools that teammate used, */
  children?: AgentStep[];
  /** …and the full answer it gave the leader. */
  detail?: string;
  /** A "Thinking" step (tool: 'thinking'): what the bot reasoned before acting or answering. */
  thought?: string;
}

/** A suggested change, as the chat shows it. */
export interface CodeEditView {
  id: string;
  path: string;
  diff: string;
  status: 'pending' | 'applied' | 'rejected' | 'failed';
  note?: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'failed';

/** A request waiting for (or answered by) the user, as the chat shows it (Prod control). */
export interface ApprovalView {
  id: string;
  kind: 'restart_prod';
  title: string;
  detail: string[];
  status: ApprovalStatus;
  /** After approval: how the restart is going ('running', then 'done' or 'failed'). */
  outcome?: 'running' | 'done' | 'failed';
  progress?: string;
  note?: string;
}

/** Who is running the tool: the profile and the bot. */
export interface ToolContext {
  userId: string;
  botId: string;
  /** 'low' when a background task is running, so live chats go first. */
  priority?: 'high' | 'low';
  /** Show progress on this tool's step while it is still running. */
  progress?: (update: Partial<Pick<AgentStep, 'summary' | 'children' | 'bot' | 'approval'>>) => void;
  /** Repo the user picked in the Flicker chat dropdown, for Refract workshop tools. */
  workshop?: { name: string; url: string };
  /** The chat run this tool is part of (lib/umbra/runs.ts), when there is one. */
  runId?: string;
  /** 0 for a run started from the chat, 1 for a job handed over by another Flicker. */
  depth?: number;
}

/** What a tool hands back: text for the model, plus anything the chat should show. */
export interface ToolResult {
  /** What the model reads. */
  output: string;
  /** A short line for the chat, e.g. "Found 5 results". */
  summary: string;
  /** Links the chat can show (search results, the page that was read). */
  links?: { title: string; url: string }[];
  /** A picture the chat can show. */
  image?: { url: string; prompt: string };
  /** A file change the Code helper suggested, with Apply / Don't apply buttons in the chat. */
  edit?: CodeEditView;
  /** Something that needs the user's OK first (Prod control), with Approve / Deny buttons in the chat. */
  approval?: ApprovalView;
  /** Teams: who did the work, the tools they used, and their full answer. */
  bot?: AgentStep['bot'];
  children?: AgentStep[];
  detail?: string;
}

export interface ToolDef {
  /** The description the model reads (Ollama's "function" format). */
  schema: {
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  };
  /** What the chat says while it runs, e.g. "Searching the web for …". */
  label: (args: Record<string, unknown>) => string;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}
