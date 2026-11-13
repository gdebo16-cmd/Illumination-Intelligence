// lib/umbra/runs.ts — a Flicker's reply runs on the server, not in the page.
//
// A chat message starts a "run": the agent loop (lib/umbra/agent.ts) with the bot's tools. The run
// doesn't depend on the request that started it, so leaving the app, minimizing it on a phone, or
// losing the connection changes nothing: the tools keep going and the reply is saved to the chat.
// Like Prism's background pictures (lib/prism/imageJobs.ts), each run has a row that the page can
// check while it's away: its status and its steps so far, saved as they happen.
//
//   startRun()   starts the work and answers right away with a run id and a promise of the outcome.
//   activeRun()  the run a bot is working on now, if any. One at a time per bot, so two loops never
//                write into the same chat at once.
//   latestRun()  for GET /api/umbra/bots/<id>/run: the live steps of the current (or last) run.
//
// Surviving a restart: each run also saves a checkpoint (column `state`) every time its conversation
// grows: the messages so far (system prompt, tool requests and tool results), the round it's on, and
// the model, tools, think switch and repo it runs with. Photos are saved once (`base_images`), not
// with every checkpoint. When the server comes back (instrumentation.ts calls resumeOrphanedRuns),
// any run still marked working whose heartbeat stopped is claimed and picked up where it left off:
// a tool that was in the middle of running is recorded as interrupted (the model is told it may or
// may not have happened, so it can check and retry) and the loop goes on from the last finished
// turn. The page just sees the same run keep going. Runs that can't be picked up (from before this
// existed, unreadable checkpoint, too old, kept stopping, Flicker deleted) are marked failed with
// the reason, and the user is told.
//
// Delegation: a Flicker can hand a job to another of the same profile's Flickers with
// delegate_to_flicker. That starts a run on the other Flicker (its own model, tools and chat) and
// waits a while for the result; if it's still going, the first Flicker gets a job id it can check
// with check_flicker_job, and the result is posted in its chat when it's done. A Flicker working on
// a handed-off job can't hand it on again (MAX_DEPTH), so it can't loop. Handed-off jobs resume too.

import 'server-only';
import crypto from 'node:crypto';
import db from '@/lib/db';
import { USERS, type UserId } from '@/lib/user';
import type { ToolId } from '@/config/umbra';
import { runAgent, type AgentStep, type ChatMessage } from './agent';
import { addMessage, getBot, listBots, listNotes, systemPrompt, type Bot, type BotMessage } from './bots';
import { endWork, startWork, workFailed } from './busy';
import type { ToolDef, ToolResult } from './tools';
import { restartResumeNote } from './prod-control';

/** 0 = started from the chat; 1 = a job handed over by another Flicker. Runs at MAX_DEPTH can't delegate. */
const MAX_DEPTH = 1;
// While a run works it touches its row every few seconds. A row that stops being touched belonged to
// a server that stopped (a restart), so it's picked back up (see resumeRow).
const HEARTBEAT_MS = 5_000;
/** At boot: a working row untouched this long has lost its process (the dev server shares the database, so not 0). */
const ORPHAN_MS = 20_000;
/** While serving requests: a working row untouched this long is surely orphaned; pick it up then too. */
const STALE_MS = 60_000;
/** Runs older than this aren't picked back up. */
const MAX_RESUME_AGE_MS = 6 * 60 * 60_000;
/** A run that keeps dying (say a tool crashes the server) is given up on after this many pick-ups. */
const MAX_RESUMES = 3;
/** Version of the saved checkpoint shape. */
const STATE_VERSION = 1;
// How long the page keeps showing a finished run's steps.
const RECENT_MS = 10 * 60_000;
const DEFAULT_WAIT_S = 300;
const MAX_WAIT_S = 900;

export type RunStatus = 'working' | 'done' | 'failed';

export interface RunView {
  id: string;
  botId: string;
  source: 'chat' | 'delegate';
  parentBotId: string | null;
  depth: number;
  request: string;
  status: RunStatus;
  steps: AgentStep[];
  reply: string | null;
  messageId: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export type RunOutcome = {
  status: 'done' | 'failed';
  reply?: string;
  message?: BotMessage;
  error?: string;
  steps: AgentStep[];
};

export class RunBusyError extends Error {}

/** What a run needs to carry on after a restart (column `state`, JSON). Photos live in `base_images`. */
interface RunState {
  v: number;
  model: string;
  toolIds: ToolId[];
  think: boolean;
  workshop?: { name: string; url: string };
  /** The conversation so far, system prompt first, photos taken out. */
  messages: ChatMessage[];
  /** The round in progress when this was saved; -1 before the first. Picking up goes on at round + 1. */
  round: number;
}

const g = globalThis as unknown as {
  umbraRunsReady?: boolean;
  umbraRunPromises?: Map<string, Promise<RunOutcome>>;
  umbraLiveRunBots?: Set<string>;
};
const promises: Map<string, Promise<RunOutcome>> = (g.umbraRunPromises ??= new Map());
/** Bots with a run going in this process, so a pick-up never starts a second loop for one. */
const liveBots: Set<string> = (g.umbraLiveRunBots ??= new Set());

function addColumn(table: string, have: string[], name: string, type: string): void {
  if (have.includes(name)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  } catch (err) {
    // `next build` workers can race to add it; one of them wins.
    if (!/duplicate column/i.test((err as Error)?.message ?? '')) throw err;
  }
}

// Set up on first use, not when the file loads (`next build` loads routes in many workers at once).
function ready(): void {
  if (g.umbraRunsReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS UmbraChatRun (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'chat',
      parent_bot_id TEXT,
      parent_run_id TEXT,
      depth INTEGER NOT NULL DEFAULT 0,
      request TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'working',
      steps TEXT,
      reply TEXT,
      message_id TEXT,
      error TEXT,
      startedAt TEXT NOT NULL,
      heartbeatAt TEXT NOT NULL,
      finishedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_umbra_chat_run_bot ON UmbraChatRun (bot_id, startedAt);
  `);
  // Added for picking runs back up after a restart. Older rows keep NULL here (they can't be resumed).
  const have = (db.prepare('PRAGMA table_info(UmbraChatRun)').all() as { name: string }[]).map((c) => c.name);
  addColumn('UmbraChatRun', have, 'state', 'TEXT');
  addColumn('UmbraChatRun', have, 'base_images', 'TEXT');
  addColumn('UmbraChatRun', have, 'resumes', 'INTEGER NOT NULL DEFAULT 0');
  g.umbraRunsReady = true;
}

type Row = {
  id: string;
  bot_id: string;
  user_id: string;
  source: string;
  parent_bot_id: string | null;
  depth: number;
  request: string;
  status: string;
  steps: string | null;
  reply: string | null;
  message_id: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type ResumeRow = Row & {
  parent_run_id: string | null;
  state: string | null;
  base_images: string | null;
  resumes: number;
  heartbeatAt: string;
};

const toView = (row: Row): RunView => {
  let steps: AgentStep[] = [];
  try {
    steps = row.steps ? JSON.parse(row.steps) : [];
  } catch {}
  return {
    id: row.id,
    botId: row.bot_id,
    source: row.source === 'delegate' ? 'delegate' : 'chat',
    parentBotId: row.parent_bot_id,
    depth: row.depth,
    request: row.request,
    status: (['working', 'done', 'failed'].includes(row.status) ? row.status : 'failed') as RunStatus,
    steps,
    reply: row.reply,
    messageId: row.message_id,
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
};

const COLUMNS = 'id, bot_id, user_id, source, parent_bot_id, depth, request, status, steps, reply, message_id, error, startedAt, finishedAt';
const RESUME_COLUMNS = `${COLUMNS}, parent_run_id, state, base_images, resumes, heartbeatAt`;

/** Working rows of this bot whose server stopped: pick them back up (or fail them, if they can't be). */
function recoverStale(botId: string): void {
  const rows = db
    .prepare(`SELECT ${RESUME_COLUMNS} FROM UmbraChatRun WHERE bot_id = ? AND status = 'working' AND heartbeatAt < ? ORDER BY startedAt ASC`)
    .all(botId, new Date(Date.now() - STALE_MS).toISOString()) as ResumeRow[];
  for (const row of rows) resumeRow(row, STALE_MS);
}

/** The run this bot is working on right now, if any. */
export function activeRun(botId: string): RunView | null {
  ready();
  recoverStale(botId);
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM UmbraChatRun WHERE bot_id = ? AND status = 'working' ORDER BY startedAt DESC LIMIT 1`)
    .get(botId) as Row | undefined;
  return row ? toView(row) : null;
}

/** The current run, or the last one if it finished in the last few minutes. */
export function latestRun(botId: string): RunView | null {
  const active = activeRun(botId);
  if (active) return active;
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM UmbraChatRun WHERE bot_id = ? AND finishedAt > ? ORDER BY startedAt DESC LIMIT 1`)
    .get(botId, new Date(Date.now() - RECENT_MS).toISOString()) as Row | undefined;
  return row ? toView(row) : null;
}

/** One run, only if it belongs to this profile. */
export function getRun(userId: string, runId: string): RunView | null {
  ready();
  const row = db.prepare(`SELECT ${COLUMNS} FROM UmbraChatRun WHERE id = ? AND user_id = ?`).get(runId, userId) as Row | undefined;
  if (row?.status === 'working') recoverStale(row.bot_id);
  const fresh = row ? (db.prepare(`SELECT ${COLUMNS} FROM UmbraChatRun WHERE id = ?`).get(runId) as Row | undefined) : undefined;
  return fresh ? toView(fresh) : null;
}

/** Wait up to `ms` for a run to finish. Null if it's still working. */
async function waitForRun(runId: string, userId: string, ms: number): Promise<RunView | null> {
  const until = Date.now() + ms;
  const live = promises.get(runId);
  if (live) {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([live, new Promise((r) => (timer = setTimeout(r, Math.max(0, ms))))]);
    clearTimeout(timer);
  }
  for (;;) {
    const run = getRun(userId, runId);
    if (!run || run.status !== 'working') return run;
    if (Date.now() >= until) return null;
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

/** Turn an agent failure into something a person can act on. */
export function friendlyRunError(err: unknown, bot: Bot): string {
  const text = (err as Error)?.message ?? '';
  if (/fetch failed|ECONNREFUSED/i.test(text)) return 'Ollama isn’t running, so the bot can’t think right now.';
  if (/not found/i.test(text)) return `The model ${bot.model} isn’t installed. Pick another in the bot’s settings.`;
  return text || 'Something went wrong.';
}

/** The extra instructions for a chat where the user picked a GitHub repo in the dropdown. */
export function workshopPrompt(repo: { name: string; url: string } | undefined): string {
  if (!repo) return '';
  return (
    `\n\nThe user selected the GitHub repo ${repo.name} (${repo.url}) with the repo dropdown. ` +
    `If it is not already a workspace in Refract, copy it with refract_clone using that exact URL and the workspace name "${repo.name}". ` +
    'Do all Refract workshop work in that workspace unless they ask otherwise. ' +
    'You can omit the workspace argument on those tools; it defaults to this repo.'
  );
}

const userNameOf = (userId: string) => USERS[userId as UserId] ?? 'the user';

/** The messages without photos (those are saved once, separately), for a checkpoint. */
const withoutImages = (messages: ChatMessage[]): ChatMessage[] =>
  messages.map((m) => {
    if (!m.images) return m;
    const rest = { ...m };
    delete rest.images;
    return rest;
  });

function stateJson(base: Omit<RunState, 'messages' | 'round' | 'v'>, messages: ChatMessage[], round: number): string {
  const state: RunState = { v: STATE_VERSION, ...base, messages: withoutImages(messages), round };
  return JSON.stringify(state);
}

/**
 * Start a Flicker working. Throws RunBusyError if it's already working on something.
 * `messages` is the whole conversation for the model, system prompt first.
 */
export function startRun(options: {
  userId: string;
  bot: Bot;
  messages: ChatMessage[];
  workshop?: { name: string; url: string };
  source: 'chat' | 'delegate';
  depth: number;
  request: string;
  parentBotId?: string;
  parentRunId?: string;
  /** Live steps, for a page that's still connected (or a Flicker waiting on a job it handed off). */
  onStep?: (step: AgentStep) => void;
}): { runId: string; done: Promise<RunOutcome> } {
  const { userId, bot } = options;
  if (options.depth > MAX_DEPTH) throw new Error('A handed-off job can’t be handed off again.');
  if (activeRun(bot.id) || liveBots.has(bot.id)) {
    throw new RunBusyError(`${bot.name} is still working on something. Wait for that to finish first.`);
  }

  // Flickers working on a chat message can hand jobs to the others; handed-off jobs can't.
  const userName = userNameOf(userId);
  const messages = [...options.messages];
  if (options.depth < MAX_DEPTH && messages[0]?.role === 'system' && listBots(userId).some((b) => b.id !== bot.id)) {
    messages[0] = { ...messages[0], content: messages[0].content + delegationBrief(userId, bot, userName) };
  }

  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const base = { model: bot.model, toolIds: bot.tools, think: Boolean(bot.think), workshop: options.workshop };
  const images = messages.flatMap((m, i) => (m.images?.length ? [{ i, images: m.images }] : []));
  db.prepare(
    `INSERT INTO UmbraChatRun (id, bot_id, user_id, source, parent_bot_id, parent_run_id, depth, request, status, steps, startedAt, heartbeatAt, state, base_images, resumes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'working', '[]', ?, ?, ?, ?, 0)`,
  ).run(runId, bot.id, userId, options.source, options.parentBotId ?? null, options.parentRunId ?? null, options.depth,
    options.request.slice(0, 4000), now, now, stateJson(base, messages, -1), images.length ? JSON.stringify(images) : null);

  return launch({
    runId, userId, bot, source: options.source, depth: options.depth, request: options.request,
    parentBotId: options.parentBotId ?? null, ...base, messages, startRound: 0, initialSteps: [], resumed: false,
    onStep: options.onStep,
  });
}

/** Run (or keep running) the agent loop for a row that's already in the table. */
function launch(run: {
  runId: string;
  userId: string;
  bot: Bot;
  source: 'chat' | 'delegate';
  depth: number;
  request: string;
  parentBotId: string | null;
  model: string;
  toolIds: ToolId[];
  think: boolean;
  workshop?: { name: string; url: string };
  messages: ChatMessage[];
  startRound: number;
  initialSteps: AgentStep[];
  resumed: boolean;
  onStep?: (step: AgentStep) => void;
}): { runId: string; done: Promise<RunOutcome> } {
  const { runId, userId, bot } = run;
  const base = { model: run.model, toolIds: run.toolIds, think: run.think, workshop: run.workshop };
  const workKey = `bot:${bot.id}`;
  startWork(workKey);
  liveBots.add(bot.id);

  // Steps so far, saved with each heartbeat (and straight away when one starts or finishes).
  const steps: AgentStep[] = [...run.initialSteps];
  let dirty = false;
  const save = () => {
    db.prepare('UPDATE UmbraChatRun SET steps = ?, heartbeatAt = ? WHERE id = ?').run(JSON.stringify(steps), new Date().toISOString(), runId);
    dirty = false;
  };
  // The conversation so far, so a restart can go on from here.
  const checkpoint = ({ messages, round }: { messages: ChatMessage[]; round: number }) => {
    db.prepare('UPDATE UmbraChatRun SET state = ?, steps = ?, heartbeatAt = ? WHERE id = ?').run(
      stateJson(base, messages, round), JSON.stringify(steps), new Date().toISOString(), runId,
    );
    dirty = false;
  };
  if (run.resumed) {
    // Save the repaired conversation (interrupted tools marked) before going on.
    try {
      checkpoint({ messages: run.messages, round: run.startRound - 1 });
    } catch {}
  }
  const heartbeat = setInterval(() => {
    try {
      if (dirty) save();
      else db.prepare('UPDATE UmbraChatRun SET heartbeatAt = ? WHERE id = ?').run(new Date().toISOString(), runId);
    } catch (err) {
      console.error('[umbra-runs] heartbeat failed', (err as Error).message);
    }
  }, HEARTBEAT_MS);

  const onStep = (step: AgentStep) => {
    const i = steps.findIndex((s) => s.id === step.id);
    const changed = i < 0 || steps[i].status !== step.status;
    if (i >= 0) steps[i] = step;
    else steps.push(step);
    dirty = true;
    if (changed) {
      try {
        save();
      } catch {}
    }
    run.onStep?.(step);
  };

  const userName = userNameOf(userId);
  const extraTools = run.depth < MAX_DEPTH ? delegationTools(userId, bot, userName) : [];

  const done = (async (): Promise<RunOutcome> => {
    let outcome: RunOutcome;
    try {
      const result = await runAgent({
        model: run.model,
        toolIds: run.toolIds,
        think: run.think,
        extraTools,
        messages: run.messages,
        context: { userId, botId: bot.id, workshop: run.workshop, runId, depth: run.depth },
        onStep,
        startRound: run.startRound,
        initialSteps: run.initialSteps.filter((s) => s.status !== 'running'),
        onCheckpoint: checkpoint,
      });
      const message = addMessage(bot.id, 'assistant', result.reply, result.steps);
      db.prepare(
        `UPDATE UmbraChatRun SET status = 'done', steps = ?, reply = ?, message_id = ?, finishedAt = ?, heartbeatAt = ? WHERE id = ?`,
      ).run(JSON.stringify(result.steps), result.reply, message.id, message.createdAt, message.createdAt, runId);
      outcome = { status: 'done', reply: result.reply, message, steps: result.steps };
    } catch (err) {
      console.error('Umbra run error:', (err as Error)?.message ?? err);
      const error = friendlyRunError(err, bot);
      const at = new Date().toISOString();
      try {
        db.prepare(`UPDATE UmbraChatRun SET status = 'failed', steps = ?, error = ?, finishedAt = ?, heartbeatAt = ? WHERE id = ?`).run(
          JSON.stringify(steps), error, at, at, runId,
        );
      } catch {}
      workFailed(workKey, error);
      outcome = { status: 'failed', error, steps };
    } finally {
      clearInterval(heartbeat);
      endWork(workKey);
      liveBots.delete(bot.id);
    }
    // A handed-off job picked up after a restart: the Flicker that handed it off lost its wait (or
    // its "post it when done"), so post the result in its chat.
    if (run.resumed && run.source === 'delegate' && run.parentBotId) {
      postJobResult(userId, run.parentBotId, bot, run.request, outcome);
    }
    return outcome;
  })();
  promises.set(runId, done);
  void done.finally(() => promises.delete(runId));
  return { runId, done };
}

// ------------------------------------------------------------------ picking runs back up

const INTERRUPTED =
  'Error: The server restarted while this tool was running, so it was interrupted. It may or may not have taken effect. ' +
  'Check the current state before retrying it.';

/** Give up on a run that can't be picked up, and tell the user why. */
function failRun(row: ResumeRow, reason: string): void {
  const at = new Date().toISOString();
  let steps: AgentStep[] = [];
  try {
    steps = row.steps ? JSON.parse(row.steps) : [];
  } catch {}
  const fixed = steps.map((s) => (s.status === 'running' ? { ...s, status: 'error' as const, summary: 'Interrupted by a server restart' } : s));
  try {
    db.prepare(`UPDATE UmbraChatRun SET status = 'failed', steps = ?, error = ?, finishedAt = ?, heartbeatAt = ? WHERE id = ? AND status = 'working'`).run(
      JSON.stringify(fixed), reason, at, at, row.id,
    );
  } catch {}
  workFailed(`bot:${row.bot_id}`, reason);
  console.error(`[umbra-runs] could not resume run ${row.id}: ${reason}`);
  if (row.source === 'delegate' && row.parent_bot_id) {
    const bot = getBot(row.user_id, row.bot_id);
    if (bot) postJobResult(row.user_id, row.parent_bot_id, bot, row.request, { status: 'failed', error: reason, steps: fixed });
  }
}

function parseState(text: string | null): RunState | null {
  if (!text) return null;
  try {
    const state = JSON.parse(text) as RunState;
    if (state?.v !== STATE_VERSION || typeof state.model !== 'string' || !Array.isArray(state.toolIds)) return null;
    if (!Array.isArray(state.messages) || state.messages[0]?.role !== 'system') return null;
    if (typeof state.round !== 'number' || !Number.isFinite(state.round)) return null;
    return state;
  } catch {
    return null;
  }
}

/** A tool cut off by the restart: tell the model, and for a handed-off job, which job it was. */
function interruptedNote(runId: string, toolName: string): string {
  // Prod control: the restart it asked for is what stopped the server; say how it went.
  if (toolName === 'restart_prod') return `Error: ${restartResumeNote()}`;
  if (toolName !== 'delegate_to_flicker') return INTERRUPTED;
  const jobs = db
    .prepare(`SELECT id, status FROM UmbraChatRun WHERE parent_run_id = ? ORDER BY startedAt DESC LIMIT 3`)
    .all(runId) as { id: string; status: string }[];
  if (!jobs.length) return INTERRUPTED;
  const list = jobs.map((j) => `job id ${j.id} (${j.status})`).join(', ');
  return `${INTERRUPTED} Jobs you had handed off from this conversation: ${list}. Check on them with check_flicker_job instead of handing the job off again.`;
}

/**
 * Pick up one orphaned run. Claims it first (only if its heartbeat is still older than `orphanMs`),
 * so two servers, or two checks, never both run it. Returns true if it's running again.
 */
function resumeRow(row: ResumeRow, orphanMs: number): boolean {
  const now = Date.now();
  const claimed = db
    .prepare(`UPDATE UmbraChatRun SET heartbeatAt = ?, resumes = resumes + 1 WHERE id = ? AND status = 'working' AND heartbeatAt < ?`)
    .run(new Date(now).toISOString(), row.id, new Date(now - orphanMs).toISOString()) as { changes: number | bigint };
  if (Number(claimed.changes) !== 1) return false;

  if (liveBots.has(row.bot_id)) {
    failRun(row, 'This work stopped when the server restarted, and the Flicker has already moved on to something else.');
    return false;
  }
  if ((row.resumes ?? 0) + 1 > MAX_RESUMES) {
    failRun(row, 'This work kept stopping when the server restarted, so it was stopped for good. Send the message again to retry it.');
    return false;
  }
  if (now - Date.parse(row.startedAt) > MAX_RESUME_AGE_MS) {
    failRun(row, 'This work stopped when the server restarted, too long ago to pick back up. Send the message again to pick it back up.');
    return false;
  }
  if (!row.state) {
    failRun(row, 'This work stopped when the server restarted, before Flickers could pick work back up. Send the message again to pick it back up.');
    return false;
  }
  const state = parseState(row.state);
  if (!state) {
    failRun(row, 'This work stopped when the server restarted, and its saved progress couldn’t be read. Send the message again to pick it back up.');
    return false;
  }
  const bot = getBot(row.user_id, row.bot_id);
  if (!bot) {
    failRun(row, 'This work stopped when the server restarted, and the Flicker no longer exists.');
    return false;
  }

  try {
    // Photos go back where they were (they're only in the first messages, which never change).
    const messages: ChatMessage[] = state.messages.map((m) => ({ ...m }));
    if (row.base_images) {
      try {
        for (const { i, images } of JSON.parse(row.base_images) as { i: number; images: string[] }[]) {
          if (messages[i] && Array.isArray(images)) messages[i].images = images;
        }
      } catch {
        // Without the photos the run can still go on.
      }
    }

    // Tool requests from the last turn that never got a result were cut off by the restart.
    let lastAsk = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].tool_calls?.length) {
        lastAsk = i;
        break;
      }
      if (messages[i].role !== 'tool') break;
    }
    if (lastAsk >= 0) {
      const calls = messages[lastAsk].tool_calls ?? [];
      const answered = messages.length - 1 - lastAsk;
      for (let k = answered; k < calls.length; k++) {
        const name = calls[k].function.name;
        messages.push({ role: 'tool', tool_name: name, content: interruptedNote(row.id, name) });
      }
    }

    // Steps: a running tool step was interrupted; an unfinished "Thinking" step just goes away.
    let saved: AgentStep[] = [];
    try {
      saved = row.steps ? (JSON.parse(row.steps) as AgentStep[]) : [];
    } catch {}
    const steps: AgentStep[] = saved
      .filter((s) => !(s.tool === 'thinking' && s.status === 'running'))
      .map((s) => (s.status === 'running' ? { ...s, status: 'error' as const, summary: 'Interrupted by a server restart' } : s));
    steps.push({ id: crypto.randomUUID(), tool: 'resume', label: 'Picked back up after a server restart', status: 'done' });

    launch({
      runId: row.id,
      userId: row.user_id,
      bot,
      source: row.source === 'delegate' ? 'delegate' : 'chat',
      depth: Math.min(MAX_DEPTH, Math.max(0, row.depth)),
      request: row.request,
      parentBotId: row.parent_bot_id,
      model: state.model,
      toolIds: state.toolIds,
      think: state.think,
      workshop: state.workshop,
      messages,
      startRound: state.round + 1,
      initialSteps: steps,
      resumed: true,
    });
    console.log(`[umbra-runs] resumed run ${row.id} for Flicker ${bot.name} at round ${state.round + 1}`);
    return true;
  } catch (err) {
    console.error('[umbra-runs] resume failed', (err as Error)?.message);
    failRun(row, 'This work stopped when the server restarted, and picking it back up failed. Send the message again to retry it.');
    return false;
  }
}

/**
 * At server start (instrumentation.ts): pick up every run that was working when the last server
 * stopped. Safe to call more than once; each run is claimed before it's picked up.
 */
export function resumeOrphanedRuns(): number {
  ready();
  const rows = db
    .prepare(`SELECT ${RESUME_COLUMNS} FROM UmbraChatRun WHERE status = 'working' AND heartbeatAt < ? ORDER BY startedAt ASC`)
    .all(new Date(Date.now() - ORPHAN_MS).toISOString()) as ResumeRow[];
  let resumed = 0;
  for (const row of rows) {
    try {
      if (resumeRow(row, ORPHAN_MS)) resumed++;
    } catch (err) {
      console.error('[umbra-runs] resume check failed', (err as Error)?.message);
    }
  }
  return resumed;
}

/** Post a handed-off job's result in the chat of the Flicker that handed it off, once that one is free. */
function postJobResult(userId: string, parentBotId: string, target: Bot, task: string, outcome: RunOutcome): void {
  void (async () => {
    for (let i = 0; i < 360 && activeRun(parentBotId); i++) await new Promise((r) => setTimeout(r, 5_000));
    if (activeRun(parentBotId) || !getBot(userId, parentBotId)) return;
    const who = { id: target.id, name: target.name, flame: target.flame };
    const text =
      outcome.status === 'done'
        ? `${target.name} finished the job I handed off (“${summarize(task)}”):\n\n${outcome.reply ?? ''}`
        : `${target.name} couldn't finish the job I handed off (“${summarize(task)}”): ${outcome.error ?? 'it stopped.'}`;
    try {
      addMessage(parentBotId, 'assistant', text, outcome.steps.length ? [{
        id: crypto.randomUUID(), tool: 'delegate_to_flicker', label: `${target.name}'s job`,
        status: outcome.status === 'done' ? 'done' : 'error', summary: summarize(outcome.reply ?? outcome.error ?? ''),
        bot: who, children: outcome.steps, detail: outcome.reply,
      }] : undefined);
    } catch (err) {
      console.error('[umbra-runs] could not post a finished job', (err as Error).message);
    }
  })();
}

// ------------------------------------------------------------------ delegation

function delegationBrief(userId: string, bot: Bot, userName: string): string {
  const others = listBots(userId).filter((b) => b.id !== bot.id);
  const list = others.map((b) => `- ${b.name}${b.purpose ? `: ${b.purpose}` : ''}`).join('\n');
  return (
    `\n\nYou can hand a job to another of ${userName}'s Flickers with delegate_to_flicker. They are:\n${list}\n` +
    'Delegate when a job fits another Flicker’s purpose or tools better, or when it is a separate piece that can be done on its own. ' +
    'They do NOT see this chat, so give complete instructions. Set share_repo to let them work in the same Refract repo. ' +
    'If they are still working when the wait ends, you get a job id; check on it later with check_flicker_job (their result is also posted here when it’s done). ' +
    'A Flicker you hand a job to can’t hand it on again.'
  );
}

function delegatedBrief(from: Bot, userName: string): string {
  return (
    `\n\n${from.name}, another of ${userName}'s Flickers, handed you the job below. Do it with your own tools, then reply with a clear, ` +
    'complete result: what you did, what you found, and any links. You can’t hand this job on to another Flicker. ' +
    `${userName} may read this chat later.`
  );
}

function summarize(text: string): string {
  const short = text.replace(/\s+/g, ' ').trim();
  return short.length > 140 ? `${short.slice(0, 140)}…` : short;
}

function jobResult(target: Bot, run: RunView): ToolResult {
  const who = { id: target.id, name: target.name, flame: target.flame };
  if (run.status === 'failed') throw new Error(`${target.name} couldn't finish the job: ${run.error ?? 'it stopped.'}`);
  const reply = run.reply ?? '';
  return {
    output: `${target.name} finished the job (job id ${run.id}). Their answer:\n${reply}`,
    summary: summarize(reply) || `${target.name} finished`,
    bot: who,
    children: run.steps,
    detail: reply,
  };
}

/** delegate_to_flicker and check_flicker_job, built for this bot and this run. */
function delegationTools(userId: string, bot: Bot, userName: string): ToolDef[] {
  const others = listBots(userId).filter((b) => b.id !== bot.id);
  if (others.length === 0) return [];
  const names = others.map((b) => b.name);
  const find = (raw: unknown) => {
    const name = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return others.find((b) => b.name.toLowerCase() === name || b.id === name);
  };

  const delegate: ToolDef = {
    schema: {
      type: 'function',
      function: {
        name: 'delegate_to_flicker',
        description:
          `Hand a job to another of ${userName}'s Flickers. They work on it with their own model and tools, in the background, and reply with the result. ` +
          'They cannot see this conversation, so the task must be complete instructions. Waits up to wait_seconds for the result; ' +
          'if they are still working, returns a job id to check with check_flicker_job.',
        parameters: {
          type: 'object',
          properties: {
            flicker: { type: 'string', enum: names, description: 'Which Flicker to hand the job to.' },
            task: { type: 'string', description: 'Complete instructions for the job, including what result you need back.' },
            share_repo: {
              type: 'boolean',
              description: 'Let them work in the same Refract repo/workspace you are using (only for Flickers with the Refract workshop). Default true when a repo is picked.',
            },
            wait_seconds: { type: 'number', description: `How long to wait for the result before moving on. Default ${DEFAULT_WAIT_S}, max ${MAX_WAIT_S}.` },
          },
          required: ['flicker', 'task'],
        },
      },
    },
    label: (a) => {
      const target = find(a.flicker);
      return target ? `Handing a job to ${target.name}` : 'Handing a job to another Flicker';
    },
    run: async (a, ctx) => {
      const picked = find(a.flicker);
      // Check again that it's still this profile's Flicker (it may have been deleted since).
      const target = picked ? getBot(userId, picked.id) : null;
      if (!target) throw new Error(`There's no Flicker called "${String(a.flicker ?? '')}". You can hand jobs to: ${names.join(', ')}.`);
      if ((ctx.depth ?? 0) >= MAX_DEPTH) throw new Error('A handed-off job can’t be handed off again.');
      const task = typeof a.task === 'string' ? a.task.trim() : '';
      if (!task) throw new Error('Say what the job is.');
      if (task.length > 4000) throw new Error('Keep the job under 4000 characters.');

      const wantsRepo = a.share_repo !== false && Boolean(ctx.workshop);
      const workshop = wantsRepo && target.tools.includes('refract') ? ctx.workshop : undefined;
      const repoNote =
        wantsRepo && !workshop ? ` (${target.name} doesn't have the Refract workshop turned on, so they can't use the repo.)` : '';
      if (activeRun(target.id)) {
        throw new Error(`${target.name} is busy with another job right now. Try again later, or hand it to someone else.`);
      }

      const content = `Job from ${bot.name}: ${task}`;
      const prompt = systemPrompt(target, userName, listNotes(target.id)) + workshopPrompt(workshop) + delegatedBrief(bot, userName);
      const who = { id: target.id, name: target.name, flame: target.flame };
      const children: AgentStep[] = [];
      let watching = true; // stop updating this step once this tool has handed back its result
      ctx.progress?.({ bot: who, children: [] });

      let started: { runId: string; done: Promise<RunOutcome> };
      try {
        // Saved in their chat too, so the job and its answer are there to read later.
        addMessage(target.id, 'user', content);
        started = startRun({
          userId,
          bot: target,
          messages: [{ role: 'system', content: prompt }, { role: 'user', content }],
          workshop,
          source: 'delegate',
          depth: (ctx.depth ?? 0) + 1,
          request: task,
          parentBotId: bot.id,
          parentRunId: ctx.runId,
          onStep: (step) => {
            const i = children.findIndex((s) => s.id === step.id);
            if (i >= 0) children[i] = step;
            else children.push(step);
            if (watching) ctx.progress?.({ bot: who, children: [...children] });
          },
        });
      } catch (err) {
        if (err instanceof RunBusyError) throw new Error(`${target.name} is busy with another job right now.`);
        throw err;
      }

      const waitS = Math.max(0, Math.min(MAX_WAIT_S, Math.floor(Number(a.wait_seconds ?? DEFAULT_WAIT_S)) || 0));
      const finished = await waitForRun(started.runId, userId, waitS * 1000);
      watching = false;
      if (finished) return jobResult(target, finished);

      // Still working: when it's done, post the result in this Flicker's chat (after any reply it's
      // in the middle of, so the chat stays in order).
      void started.done.then((outcome) => postJobResult(userId, bot.id, target, task, outcome));
      return {
        output:
          `${target.name} is still working on the job (job id ${started.runId}).${repoNote} ` +
          'Their result will be posted in this chat when they finish; you can also check with check_flicker_job.',
        summary: `${target.name} is still working`,
        bot: who,
        children: [...children],
      };
    },
  };

  const check: ToolDef = {
    schema: {
      type: 'function',
      function: {
        name: 'check_flicker_job',
        description: 'Check on a job you handed to another Flicker with delegate_to_flicker: whether it is still running, and its result when done.',
        parameters: {
          type: 'object',
          properties: {
            job_id: { type: 'string', description: 'The job id delegate_to_flicker gave you.' },
            wait_seconds: { type: 'number', description: `Optionally wait up to this long for it to finish. Default 0, max ${MAX_WAIT_S}.` },
          },
          required: ['job_id'],
        },
      },
    },
    label: () => 'Checking on a handed-off job',
    run: async (a) => {
      const id = typeof a.job_id === 'string' ? a.job_id.trim() : '';
      const run = id ? getRun(userId, id) : null;
      if (!run || run.source !== 'delegate' || run.parentBotId !== bot.id) throw new Error('There is no job with that id that you handed off.');
      const target = getBot(userId, run.botId);
      if (!target) throw new Error('The Flicker doing that job has been deleted.');
      const waitS = Math.max(0, Math.min(MAX_WAIT_S, Math.floor(Number(a.wait_seconds ?? 0)) || 0));
      const now = run.status === 'working' && waitS > 0 ? (await waitForRun(run.id, userId, waitS * 1000)) ?? run : run;
      if (now.status !== 'working') return jobResult(target, now);
      const doing = now.steps.filter((s) => s.tool !== 'thinking').map((s) => `- ${s.label} (${s.status})`).join('\n');
      return {
        output: `${target.name} is still working on the job (started ${now.startedAt}).${doing ? `\nSteps so far:\n${doing}` : ''}`,
        summary: `${target.name} is still working`,
        bot: { id: target.id, name: target.name, flame: target.flame },
        children: now.steps,
      };
    },
  };

  return [delegate, check];
}
