// lib/umbra/tasks.ts — tasks bots run on their own, and the reports they leave in the inbox.
//
// A task = a bot + a job ("check the weather…") + a schedule ("every day at 7 am").
// When a task runs, the bot works through it with its tools (no one watching), and the
// result is saved as a report ("run") in the profile's inbox.

import 'server-only';
import crypto from 'node:crypto';
import db from '@/lib/db';
import { USERS, type UserId } from '@/lib/users';
import { nextRun, parseSchedule, type Schedule } from '@/config/umbra-schedule';
import { runAgent, type AgentStep } from './agent';
import { getBot, listNotes, systemPrompt } from './bots';
import { getTeam, listTeamMessages, runTeam, viewTeam } from './teams';
import { saveDocumentArtifacts } from '@/lib/artifacts';

export const TASK_LIMITS = { title: 80, instructions: 2000 };

export interface Task {
  id: string;
  botId: string;
  /** Set for a team's task (then botId is the team's leader). */
  teamId: string | null;
  title: string;
  instructions: string;
  schedule: Schedule;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
}

export interface Run {
  id: string;
  taskId: string | null;
  botId: string;
  teamId: string | null;
  title: string;
  status: 'running' | 'done' | 'error';
  report: string | null;
  steps: AgentStep[];
  read: boolean;
  startedAt: string;
  finishedAt: string | null;
}

// ------------------------------------------------------------------ reading rows

type TaskRow = {
  id: string; bot_id: string; team_id: string | null; title: string; instructions: string; schedule: string;
  enabled: number; nextRunAt: string | null; lastRunAt: string | null; createdAt: string;
};
const toTask = (r: TaskRow): Task => ({
  id: r.id,
  botId: r.bot_id,
  teamId: r.team_id ?? null,
  title: r.title,
  instructions: r.instructions,
  schedule: parseSchedule(safeJson(r.schedule)) ?? { kind: 'once' },
  enabled: r.enabled === 1,
  nextRunAt: r.nextRunAt,
  lastRunAt: r.lastRunAt,
  createdAt: r.createdAt,
});

type RunRow = {
  id: string; task_id: string | null; bot_id: string; team_id: string | null; title: string; status: Run['status'];
  report: string | null; steps: string | null; read: number; startedAt: string; finishedAt: string | null;
};
const toRun = (r: RunRow): Run => ({
  id: r.id,
  taskId: r.task_id,
  botId: r.bot_id,
  teamId: r.team_id ?? null,
  title: r.title,
  status: r.status,
  report: r.report,
  steps: (safeJson(r.steps) as AgentStep[] | null) ?? [],
  read: r.read === 1,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
});

function safeJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ tasks

/** Check what the task form sent. */
export function validateTask(input: Record<string, unknown>):
  { error: string } | { task: Pick<Task, 'title' | 'instructions' | 'schedule'> } {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const instructions = typeof input.instructions === 'string' ? input.instructions.trim() : '';
  const schedule = parseSchedule(input.schedule);
  if (!title) return { error: 'Give the task a short title.' };
  if (title.length > TASK_LIMITS.title) return { error: `Keep the title under ${TASK_LIMITS.title} characters.` };
  if (!instructions) return { error: 'Describe what the Flicker should do.' };
  if (instructions.length > TASK_LIMITS.instructions) return { error: 'The instructions are too long.' };
  if (!schedule) return { error: 'Pick when the task should run.' };
  return { task: { title, instructions, schedule } };
}

export function listTasks(userId: string, botId: string): Task[] {
  const rows = db
    .prepare('SELECT * FROM UmbraTask WHERE user_id = ? AND bot_id = ? AND team_id IS NULL ORDER BY createdAt ASC')
    .all(userId, botId) as unknown as TaskRow[];
  return rows.map(toTask);
}

export function listTeamTasks(userId: string, teamId: string): Task[] {
  const rows = db
    .prepare('SELECT * FROM UmbraTask WHERE user_id = ? AND team_id = ? ORDER BY createdAt ASC')
    .all(userId, teamId) as unknown as TaskRow[];
  return rows.map(toTask);
}

export function getTask(userId: string, id: string): Task | null {
  const row = db.prepare('SELECT * FROM UmbraTask WHERE id = ? AND user_id = ?').get(id, userId) as TaskRow | undefined;
  return row ? toTask(row) : null;
}

/**
 * A new task. "Once" tasks are due right away; others at their first scheduled time.
 * For a team's task, botId is the team's leader.
 */
export function createTask(
  userId: string,
  botId: string,
  input: Pick<Task, 'title' | 'instructions' | 'schedule'>,
  teamId: string | null = null,
): Task {
  const id = crypto.randomUUID();
  const now = new Date();
  const due = input.schedule.kind === 'once' ? now : nextRun(input.schedule, now);
  db.prepare(
    `INSERT INTO UmbraTask (id, bot_id, team_id, user_id, title, instructions, schedule, enabled, nextRunAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, botId, teamId, userId, input.title, input.instructions, JSON.stringify(input.schedule), due?.toISOString() ?? null, now.toISOString());
  return getTask(userId, id)!;
}

export function updateTask(userId: string, id: string, input: Pick<Task, 'title' | 'instructions' | 'schedule'>): Task | null {
  if (!getTask(userId, id)) return null;
  const due = input.schedule.kind === 'once' ? null : nextRun(input.schedule, new Date());
  db.prepare('UPDATE UmbraTask SET title = ?, instructions = ?, schedule = ?, nextRunAt = ? WHERE id = ?').run(
    input.title, input.instructions, JSON.stringify(input.schedule), due?.toISOString() ?? null, id,
  );
  return getTask(userId, id);
}

/** Pause or resume. Resuming a repeating task schedules it from now. */
export function setTaskEnabled(userId: string, id: string, enabled: boolean): Task | null {
  const task = getTask(userId, id);
  if (!task) return null;
  const due = enabled && task.schedule.kind !== 'once' ? nextRun(task.schedule, new Date()) : task.nextRunAt ? new Date(task.nextRunAt) : null;
  db.prepare('UPDATE UmbraTask SET enabled = ?, nextRunAt = ? WHERE id = ?').run(enabled ? 1 : 0, due?.toISOString() ?? null, id);
  return getTask(userId, id);
}

export function deleteTask(userId: string, id: string): boolean {
  return db.prepare('DELETE FROM UmbraTask WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}


// ------------------------------------------------------------------ the inbox

export function listRuns(userId: string, limit = 100): Run[] {
  const rows = db
    .prepare('SELECT * FROM UmbraRun WHERE user_id = ? ORDER BY startedAt DESC LIMIT ?')
    .all(userId, limit) as unknown as RunRow[];
  return rows.map(toRun);
}

export function unreadCount(userId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM UmbraRun WHERE user_id = ? AND read = 0 AND status != 'running'")
    .get(userId) as { n: number };
  return row.n;
}

export function markRunRead(userId: string, id: string, read = true): boolean {
  return db.prepare('UPDATE UmbraRun SET read = ? WHERE id = ? AND user_id = ?').run(read ? 1 : 0, id, userId).changes > 0;
}

export function deleteRun(userId: string, id: string): boolean {
  return db.prepare('DELETE FROM UmbraRun WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

// ------------------------------------------------------------------ running a task

/**
 * Claim a task so only one copy of the app runs it (production and dev may both be on).
 * Moves its next run time forward; returns false if another copy got there first.
 */
function claim(task: Task, now: Date): boolean {
  const next = task.schedule.kind === 'once' ? null : nextRun(task.schedule, now);
  const result = db
    .prepare('UPDATE UmbraTask SET nextRunAt = ?, lastRunAt = ? WHERE id = ? AND nextRunAt IS ?')
    .run(next?.toISOString() ?? null, now.toISOString(), task.id, task.nextRunAt);
  return result.changes > 0;
}

/** Run a task now: the bot works on it with its tools, and the report lands in the inbox. */
export async function runTask(userId: string, task: Task): Promise<Run> {
  const bot = getBot(userId, task.botId);
  if (!bot) throw new Error('The Flicker for this task no longer exists.');
  const teamRow = task.teamId ? getTeam(userId, task.teamId) : null;
  const team = teamRow ? viewTeam(userId, teamRow) : null;
  if (task.teamId && !team) throw new Error('The team for this task no longer exists.');

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO UmbraRun (id, task_id, bot_id, team_id, user_id, title, status, read, startedAt) VALUES (?, ?, ?, ?, ?, ?, 'running', 0, ?)`,
  ).run(runId, task.id, bot.id, task.teamId, userId, task.title, startedAt);

  const userName = USERS[userId as UserId] ?? 'your user';
  const job = [
    team
      ? `This is a task your team is doing on its own; ${userName} isn't watching. They'll read your report later in their inbox.`
      : `This is a task you're doing on your own; ${userName} isn't watching. They'll read your report later in their inbox.`,
    `Task: ${task.title}`,
    `Instructions: ${task.instructions}`,
    'Do the task now, using your tools where they help. Your final message IS the report: a short, clear write-up ' +
      'of what you found or did, with links for anything from the web. Never end with "I’ll try…" or a question; ' +
      'there is no next turn. If a page won’t open, work from the search results’ snippets or other results instead. ' +
      'If something is missing, make a sensible choice and say what you assumed.',
  ].join('\n\n');

  try {
    const result = team
      ? await runTeam({
          userId,
          userName,
          team,
          // The leader gets the recent team chat for context, like in a live chat.
          history: listTeamMessages(team.id, 10).map((m) => ({ role: m.role, content: m.content })),
          message: job,
          priority: 'low',
          onStep: () => {},
        })
      : await runAgent({
          model: bot.model,
          toolIds: bot.tools,
          think: bot.think,
          messages: [
            { role: 'system', content: systemPrompt(bot, userName, listNotes(bot.id)) },
            { role: 'user', content: job },
          ],
          context: { userId, botId: bot.id },
          priority: 'low',
          onStep: () => {},
        });
    db.prepare("UPDATE UmbraRun SET status = 'done', report = ?, steps = ?, finishedAt = ? WHERE id = ?").run(
      result.reply, JSON.stringify(result.steps), new Date().toISOString(), runId,
    );
    // A document in the report goes to Umbra's artifacts, under the team or Flicker that wrote it.
    saveDocumentArtifacts(
      team
        ? { userId, app: 'umbra', sourceKind: 'team', sourceId: team.id, sourceName: team.name }
        : { userId, app: 'umbra', sourceKind: 'bot', sourceId: bot.id, sourceName: bot.name },
      result.reply,
    );
  } catch (err) {
    const message = (err as Error).message || 'The task failed.';
    db.prepare("UPDATE UmbraRun SET status = 'error', report = ?, finishedAt = ? WHERE id = ?").run(
      /fetch failed|ECONNREFUSED/i.test(message) ? 'Ollama wasn’t running, so the Flicker couldn’t work on this.' : message,
      new Date().toISOString(),
      runId,
    );
  }
  const row = db.prepare('SELECT * FROM UmbraRun WHERE id = ?').get(runId) as RunRow;
  return toRun(row);
}

/** "Run now" from the page: claim the task and run it, even if it isn't due. */
export async function runTaskNow(userId: string, task: Task): Promise<Run> {
  const now = new Date();
  db.prepare('UPDATE UmbraTask SET lastRunAt = ? WHERE id = ?').run(now.toISOString(), task.id);
  return runTask(userId, task);
}

/** The scheduler's job: run every enabled task that's due, one at a time. */
export async function runDueTasks(): Promise<number> {
  const now = new Date();
  const due = db
    .prepare('SELECT * FROM UmbraTask WHERE enabled = 1 AND nextRunAt IS NOT NULL AND nextRunAt <= ? ORDER BY nextRunAt ASC')
    .all(now.toISOString()) as unknown as (TaskRow & { user_id: string })[];

  let ran = 0;
  for (const row of due) {
    const task = toTask(row);
    if (!claim(task, new Date())) continue; // another copy of the app took it
    await runTask(row.user_id, task).catch((err) => console.error('Umbra task failed to start:', err));
    ran++;
  }
  return ran;
}

/** After a restart, any report still marked "running" was interrupted. */
export function markInterruptedRuns(): void {
  db.prepare(
    "UPDATE UmbraRun SET status = 'error', report = 'Interrupted: the app stopped while this task was running.', finishedAt = ? WHERE status = 'running'",
  ).run(new Date().toISOString());
}
