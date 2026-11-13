// What the Umbra API sends back. (Mirrors lib/umbra/bots.ts, which is server-only.)

export interface Bot {
  id: string;
  name: string;
  flame: string;
  personality: string;
  purpose: string;
  model: string;
  tools: string[];
  codeFolder: string;
  codeAutoWrite: boolean;
  /** Think before answering: reason step by step first, and show the thinking in the chat. */
  think: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A file change the Code helper suggested. (Mirrors lib/umbra/code.ts.) */
export interface CodeEdit {
  id: string;
  path: string;
  diff: string;
  status: 'pending' | 'applied' | 'rejected' | 'failed';
  note?: string;
}

/** Something a Flicker asked to do that needs your OK first. (Mirrors lib/umbra/prod-control.ts.) */
export interface ApprovalRequest {
  id: string;
  kind: 'restart_prod';
  title: string;
  detail: string[];
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'failed';
  outcome?: 'running' | 'done' | 'failed';
  progress?: string;
  note?: string;
}

/** One tool use, as shown in the chat. */
export interface AgentStep {
  id: string;
  tool: string;
  label: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
  links?: { title: string; url: string }[];
  image?: { url: string; prompt: string };
  edit?: CodeEdit;
  approval?: ApprovalRequest;
  /** Teams: the teammate who did this step's work, the tools it used, and its full answer. */
  bot?: { id: string; name: string; flame: string };
  children?: AgentStep[];
  detail?: string;
  /** A "Thinking" step (tool: 'thinking'): what the bot reasoned before acting or answering. */
  thought?: string;
}

export interface BotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  steps?: AgentStep[];
  /** Photos sent with the message: saved photo ids (or, just after sending, local previews). */
  images?: string[];
}

export interface Task {
  id: string;
  botId: string;
  teamId: string | null;
  title: string;
  instructions: string;
  schedule: import('@/config/umbra-schedule').Schedule;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
}

/** One task report in the inbox. */
export interface Run {
  id: string;
  taskId: string | null;
  botId: string;
  botName: string;
  botFlame: string;
  /** Set when a team did this task. */
  teamId: string | null;
  teamName: string | null;
  title: string;
  status: 'running' | 'done' | 'error';
  report: string | null;
  steps: AgentStep[];
  read: boolean;
  startedAt: string;
  finishedAt: string | null;
}

export interface BotNote {
  id: string;
  content: string;
  createdAt: string;
}

/** A team: a leader bot plus teammates with roles. */
export interface Team {
  id: string;
  name: string;
  purpose: string;
  leaderId: string;
  members: { botId: string; role: string }[];
  leader: Bot;
  crew: { bot: Bot; role: string }[];
  createdAt: string;
  updatedAt: string;
}
