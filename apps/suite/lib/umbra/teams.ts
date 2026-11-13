// lib/umbra/teams.ts — bots working together.
//
// A team = a leader bot + teammates, each with a role ("Researcher", "Writer", "Critic"…).
// You talk to the team; the leader reads your message and can hand parts of the job to
// teammates with its "ask_teammate" tool. Each teammate works with its own tools and model,
// then answers the leader. The leader combines their work into the reply you see.

import 'server-only';
import crypto from 'node:crypto';
import db from '@/lib/db';
import { BOT_TOOLS } from '@/config/umbra';
import { runAgent, type AgentStep, type ChatMessage } from './agent';
import { getBot, listNotes, systemPrompt, type Bot } from './bots';
import type { ToolDef } from './tools';
import { renameArtifactSource, saveDocumentArtifacts } from '@/lib/artifacts';
import { mayHoldDocument } from '@/lib/document-blocks';

export const TEAM_LIMITS = { name: 40, purpose: 1000, role: 60, members: 5 };

export interface TeamMember {
  botId: string;
  role: string;
}

export interface Team {
  id: string;
  name: string;
  purpose: string;
  leaderId: string;
  members: TeamMember[];
  createdAt: string;
  updatedAt: string;
}

/** A team with its bots filled in, for the pages. Deleted bots are left out. */
export interface TeamView extends Team {
  leader: Bot;
  crew: { bot: Bot; role: string }[];
}

export interface TeamMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  steps?: AgentStep[];
}

export type TeamInput = Pick<Team, 'name' | 'purpose' | 'leaderId' | 'members'>;

// ------------------------------------------------------------------ saving teams

type TeamRow = { id: string; name: string; purpose: string; leader_id: string; createdAt: string; updatedAt: string };

function membersOf(teamId: string): TeamMember[] {
  return db
    .prepare('SELECT bot_id AS botId, role FROM UmbraTeamMember WHERE team_id = ? ORDER BY position ASC')
    .all(teamId) as unknown as TeamMember[];
}

const toTeam = (r: TeamRow): Team => ({
  id: r.id,
  name: r.name,
  purpose: r.purpose,
  leaderId: r.leader_id,
  members: membersOf(r.id),
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** Check what the team form sent: every bot must be one of yours, and the leader isn't also a teammate. */
export function validateTeam(userId: string, input: Record<string, unknown>): { error: string } | { team: TeamInput } {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const name = text(input.name);
  const purpose = text(input.purpose);
  const leaderId = text(input.leaderId);
  const raw = Array.isArray(input.members) ? input.members : [];
  const members: TeamMember[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const botId = text((m as Record<string, unknown>).botId);
    const role = text((m as Record<string, unknown>).role);
    if (botId && botId !== leaderId && !members.some((x) => x.botId === botId)) members.push({ botId, role });
  }

  if (!name) return { error: 'Give your team a name.' };
  if (name.length > TEAM_LIMITS.name) return { error: `Keep the name under ${TEAM_LIMITS.name} characters.` };
  if (purpose.length > TEAM_LIMITS.purpose) return { error: 'The purpose is too long.' };
  if (!leaderId || !getBot(userId, leaderId)) return { error: 'Pick a leader for the team.' };
  if (members.length === 0) return { error: 'Add at least one teammate.' };
  if (members.length > TEAM_LIMITS.members) return { error: `A team can have up to ${TEAM_LIMITS.members} teammates.` };
  for (const m of members) {
    if (!getBot(userId, m.botId)) return { error: 'One of the teammates no longer exists.' };
    if (m.role.length > TEAM_LIMITS.role) return { error: `Keep each role under ${TEAM_LIMITS.role} characters.` };
  }
  return { team: { name, purpose, leaderId, members } };
}

export function listTeams(userId: string): Team[] {
  const rows = db
    .prepare('SELECT id, name, purpose, leader_id, createdAt, updatedAt FROM UmbraTeam WHERE user_id = ? ORDER BY updatedAt DESC')
    .all(userId) as unknown as TeamRow[];
  return rows.map(toTeam);
}

export function getTeam(userId: string, id: string): Team | null {
  const row = db
    .prepare('SELECT id, name, purpose, leader_id, createdAt, updatedAt FROM UmbraTeam WHERE id = ? AND user_id = ?')
    .get(id, userId) as TeamRow | undefined;
  return row ? toTeam(row) : null;
}

/** Fill in the bots. Null if the leader is gone. */
export function viewTeam(userId: string, team: Team): TeamView | null {
  const leader = getBot(userId, team.leaderId);
  if (!leader) return null;
  const crew = team.members.flatMap((m) => {
    const bot = getBot(userId, m.botId);
    return bot ? [{ bot, role: m.role }] : [];
  });
  return { ...team, leader, crew };
}

function saveMembers(teamId: string, members: TeamMember[]) {
  db.prepare('DELETE FROM UmbraTeamMember WHERE team_id = ?').run(teamId);
  const insert = db.prepare('INSERT INTO UmbraTeamMember (team_id, bot_id, role, position) VALUES (?, ?, ?, ?)');
  members.forEach((m, i) => insert.run(teamId, m.botId, m.role, i));
}

export function createTeam(userId: string, input: TeamInput): Team {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO UmbraTeam (id, user_id, name, purpose, leader_id, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, userId, input.name, input.purpose, input.leaderId, now, now,
  );
  saveMembers(id, input.members);
  return getTeam(userId, id)!;
}

export function updateTeam(userId: string, id: string, input: TeamInput): Team | null {
  if (!getTeam(userId, id)) return null;
  db.prepare('UPDATE UmbraTeam SET name = ?, purpose = ?, leader_id = ?, updatedAt = ? WHERE id = ?').run(
    input.name, input.purpose, input.leaderId, new Date().toISOString(), id,
  );
  saveMembers(id, input.members);
  renameArtifactSource(userId, id, input.name);
  // The team's tasks run as its leader, so follow a change of leader.
  db.prepare('UPDATE UmbraTask SET bot_id = ? WHERE team_id = ?').run(input.leaderId, id);
  return getTeam(userId, id);
}

/** Delete a team, its chat and its tasks. Its past reports stay in the inbox. */
export function deleteTeam(userId: string, id: string): boolean {
  if (!getTeam(userId, id)) return false;
  removeTeams([id]);
  return true;
}

/** Used here and when a bot that leads teams is deleted. */
export function removeTeams(ids: string[]) {
  for (const id of ids) {
    db.prepare('DELETE FROM UmbraTeamMessage WHERE team_id = ?').run(id);
    db.prepare('DELETE FROM UmbraTeamMember WHERE team_id = ?').run(id);
    db.prepare('DELETE FROM UmbraTask WHERE team_id = ?').run(id);
    db.prepare('DELETE FROM UmbraTeam WHERE id = ?').run(id);
  }
}

// ------------------------------------------------------------------ the team chat

type MessageRow = Omit<TeamMessage, 'steps'> & { steps: string | null };

export function listTeamMessages(teamId: string, limit = 200): TeamMessage[] {
  const rows = db
    .prepare('SELECT id, role, content, createdAt, steps FROM UmbraTeamMessage WHERE team_id = ? ORDER BY createdAt DESC, rowid DESC LIMIT ?')
    .all(teamId, limit) as unknown as MessageRow[];
  return rows.reverse().map(({ steps, ...m }) => {
    let parsed: AgentStep[] | undefined;
    try {
      parsed = steps ? JSON.parse(steps) : undefined;
    } catch {}
    return parsed?.length ? { ...m, steps: parsed } : m;
  });
}

export function addTeamMessage(teamId: string, role: TeamMessage['role'], content: string, steps?: AgentStep[]): TeamMessage {
  const message: TeamMessage = { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString() };
  if (steps?.length) message.steps = steps;
  db.prepare('INSERT INTO UmbraTeamMessage (id, team_id, role, content, steps, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
    message.id, teamId, role, content, steps?.length ? JSON.stringify(steps) : null, message.createdAt,
  );
  db.prepare('UPDATE UmbraTeam SET updatedAt = ? WHERE id = ?').run(message.createdAt, teamId);
  // A document the team wrote goes to Umbra's artifacts too.
  if (role === 'assistant' && mayHoldDocument(content)) {
    const owner = db.prepare('SELECT user_id, name FROM UmbraTeam WHERE id = ?').get(teamId) as { user_id: string; name: string } | undefined;
    if (owner) {
      saveDocumentArtifacts(
        { userId: owner.user_id, app: 'umbra', sourceKind: 'team', sourceId: teamId, sourceName: owner.name },
        content,
        message.createdAt,
      );
    }
  }
  return message;
}

export function clearTeamMessages(teamId: string): void {
  db.prepare('DELETE FROM UmbraTeamMessage WHERE team_id = ?').run(teamId);
}

// ------------------------------------------------------------------ running the team

const toolList = (bot: Bot) => BOT_TOOLS.filter((t) => bot.tools.includes(t.id)).map((t) => t.name.toLowerCase()).join(', ') || 'no tools';

/** The leader's extra instructions: who's on the team and how to hand out work. */
function leaderBrief(team: TeamView, userName: string): string {
  return [
    `Right now you are leading a team called "${team.name}" for ${userName}.`,
    team.purpose && `The team's purpose: ${team.purpose}`,
    'Your teammates:',
    ...team.crew.map(({ bot, role }) =>
      `- ${bot.name}${role ? ` (${role})` : ''}${bot.purpose ? `: ${bot.purpose}` : ''}. Tools: ${toolList(bot)}.`),
    'How to work as the leader:',
    '1. Read the request and decide which parts each teammate should do, based on their role and tools.',
    '2. Hand out work with the ask_teammate tool. Teammates do NOT see this conversation, so give each one complete, ' +
      'self-contained instructions (include any facts they need, including what other teammates already found).',
    '3. You can ask teammates one after another, passing one teammate\'s work to the next (e.g. research → write → review).',
    '4. Check each teammate\'s work before using it. Facts (names, dates, times, places, addresses, prices) must come from ' +
      'the research or tool results. If a teammate added details nobody looked up, leave them out or mark them "to confirm". ' +
      'Never pass along a teammate\'s answer without checking it.',
    '5. When you have what you need, write the final answer yourself, combining their work. Credit teammates briefly where it helps.',
    'For a simple message (a greeting, a quick question) just answer yourself without involving the team.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** What a teammate is told when the leader hands it a piece of work. */
function teammateBrief(team: TeamView, leader: Bot, role: string): string {
  return [
    `You are on the team "${team.name}"${role ? ` as the ${role}` : ''}. ${leader.name} leads the team and is handing you part of a job.`,
    `Do it now, using your tools where they help. Reply with your finished work for ${leader.name}: clear and complete, ` +
      'with links for anything from the web. Don\'t ask questions back; there is no next turn. ' +
      'If something is missing, make a sensible choice and say what you assumed.',
    'Stick to real facts: only use names, dates, times, places, addresses and prices that you were given or found with ' +
      'your tools. Never invent them. If a detail is unknown, say "check the event page" (or similar) instead. ' +
      'Your personality shapes how you write, not the facts. (Umbra is the app you live in, not a real place.)',
  ].join('\n');
}

/** The leader's "ask_teammate" tool, built for this team and this run. */
function askTeammateTool(
  userId: string,
  userName: string,
  team: TeamView,
  priority: 'high' | 'low',
): ToolDef {
  const names = team.crew.map((c) => c.bot.name);
  const find = (name: string) => team.crew.find((c) => c.bot.name.toLowerCase() === name.trim().toLowerCase());

  return {
    schema: {
      type: 'function',
      function: {
        name: 'ask_teammate',
        description: 'Give one of your teammates a piece of work. They do it with their own tools and reply with the result.',
        parameters: {
          type: 'object',
          properties: {
            teammate: { type: 'string', enum: names, description: 'Which teammate to ask.' },
            request: { type: 'string', description: 'Complete instructions for the teammate. They cannot see the conversation.' },
          },
          required: ['teammate', 'request'],
        },
      },
    },
    label: (args) => {
      const member = typeof args.teammate === 'string' ? find(args.teammate) : undefined;
      return member ? `Asking ${member.bot.name}${member.role ? ` (${member.role})` : ''}` : 'Asking a teammate';
    },
    run: async (args, ctx) => {
      const member = typeof args.teammate === 'string' ? find(args.teammate) : undefined;
      const request = typeof args.request === 'string' ? args.request.trim() : '';
      if (!member) throw new Error(`There's no teammate called "${String(args.teammate ?? '')}". Teammates: ${names.join(', ')}.`);
      if (!request) throw new Error('Tell the teammate what to do.');

      const { bot, role } = member;
      const who = { id: bot.id, name: bot.name, flame: bot.flame };
      const children: AgentStep[] = [];
      ctx.progress?.({ bot: who, children: [] });

      const result = await runAgent({
        model: bot.model,
        toolIds: bot.tools,
        think: bot.think,
        messages: [
          { role: 'system', content: `${systemPrompt(bot, userName, listNotes(bot.id))}\n\n${teammateBrief(team, team.leader, role)}` },
          { role: 'user', content: `From ${team.leader.name}: ${request}` },
        ],
        context: { userId, botId: bot.id },
        priority,
        // Show the teammate's tools live, under the leader's step.
        onStep: (step) => {
          const i = children.findIndex((s) => s.id === step.id);
          if (i >= 0) children[i] = step;
          else children.push(step);
          ctx.progress?.({ bot: who, children: [...children] });
        },
      });

      const short = result.reply.replace(/\s+/g, ' ');
      return {
        output: `${bot.name}'s answer:\n${result.reply}`,
        summary: short.length > 140 ? `${short.slice(0, 140)}…` : short,
        bot: who,
        children: result.steps,
        detail: result.reply,
      };
    },
  };
}

/**
 * The team works on a message. History is the team chat so far (the leader remembers it;
 * teammates only see what the leader tells them).
 */
export async function runTeam(options: {
  userId: string;
  userName: string;
  team: TeamView;
  history: ChatMessage[];
  message: string;
  priority?: 'high' | 'low';
  onStep: (step: AgentStep) => void;
}): Promise<{ reply: string; steps: AgentStep[] }> {
  const { userId, userName, team } = options;
  const leader = team.leader;
  const priority = options.priority ?? 'high';
  return runAgent({
    model: leader.model,
    toolIds: leader.tools,
    think: leader.think,
    extraTools: team.crew.length ? [askTeammateTool(userId, userName, team, priority)] : [],
    messages: [
      { role: 'system', content: `${systemPrompt(leader, userName, listNotes(leader.id))}\n\n${leaderBrief(team, userName)}` },
      ...options.history,
      { role: 'user', content: options.message },
    ],
    context: { userId, botId: leader.id },
    priority,
    onStep: options.onStep,
  });
}
