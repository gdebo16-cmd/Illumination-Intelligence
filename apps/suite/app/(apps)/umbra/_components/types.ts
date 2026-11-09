// What the Umbra API sends back. (Mirrors lib/umbra/bots.ts, which is server-only.)

export interface Bot {
  id: string;
  name: string;
  flame: string;
  personality: string;
  purpose: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface BotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}
