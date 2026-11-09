// What the Umbra API sends back. (Mirrors lib/umbra/bots.ts, which is server-only.)

export interface Bot {
  id: string;
  name: string;
  flame: string;
  personality: string;
  purpose: string;
  model: string;
  tools: string[];
  createdAt: string;
  updatedAt: string;
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
}

export interface BotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  steps?: AgentStep[];
}

export interface BotNote {
  id: string;
  content: string;
  createdAt: string;
}
