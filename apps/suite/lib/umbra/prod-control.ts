// lib/umbra/prod-control.ts — "Prod control": a Flicker can ask to update and restart the live app
// (port 3000) on this PC, and nothing happens until you approve it in the chat.
//
// How it works:
//   - restart_prod makes a request (table UmbraApproval) and the chat shows it as a card with
//     Approve and Deny buttons. The tool waits for your answer (up to APPROVAL_MS).
//   - Approve (POST /api/umbra/approvals/<id>) starts scripts/prod-restart.ps1, which runs a FIXED
//     sequence. The Flicker can't pass in any commands or arguments:
//       1. git pull --ff-only illumen main in the repo (stops if it would touch uncommitted work;
//          nothing is ever stashed, reset or forced),
//       2. npm run build in apps/suite,
//       3. only if the build passed: stop the supervisor's "npm run start" (the cmd whose command
//          line has suite-prod.log). The IlluminationSuite supervisor starts prod again on the new
//          build. The dev server on port 3001 and the supervisor itself are never touched.
//   - Restarting prod stops the server this tool runs on, so the script first relaunches itself
//     outside the server's process tree, and writes how far it got to data/prod-restart.json.
//   - When the server is back, the Flicker's run picks up again (lib/umbra/runs.ts), is told what
//     happened, and can confirm with prod_status.

import 'server-only';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import db from '@/lib/db';
import type { ToolDef, ToolResult } from './tools';

const APP_DIR = process.cwd();
const RESULT_FILE = path.join(/* turbopackIgnore: true */ APP_DIR, 'data', 'prod-restart.json');
const SCRIPT = path.join(/* turbopackIgnore: true */ APP_DIR, 'scripts', 'prod-restart.ps1');
const PROD_URL = 'http://127.0.0.1:3000';
/** How long a restart request waits for your answer. */
const APPROVAL_MS = 10 * 60_000;
/** How long the tool follows an approved restart before saying "still going". */
const FOLLOW_MS = 30 * 60_000;
/** A restart whose progress file hasn't moved in this long is treated as over. */
const STUCK_MS = 25 * 60_000;
const POLL_MS = 2_000;

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'failed';

/** A request waiting for (or answered by) the user, as the chat shows it. */
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

type RestartStatus = 'queued' | 'starting' | 'pulling' | 'building' | 'restarting' | 'done' | 'failed';

/** What scripts/prod-restart.ps1 writes to data/prod-restart.json as it goes. */
export interface RestartResult {
  id: string;
  status: RestartStatus;
  stage?: string;
  message?: string;
  pull?: string;
  build?: string;
  oldPid?: number | null;
  newPid?: number | null;
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string | null;
}

const DETAIL = [
  'Get the latest main from GitHub (git pull --ff-only illumen main). If that would touch your uncommitted changes it stops; nothing is stashed or reset.',
  'Build the app (npm run build). If the build fails, the live app keeps running as it is.',
  'Only if the build passes: restart the live app on port 3000. It is down for about half a minute, then this chat carries on.',
];

// ------------------------------------------------------------------ requests

let tableReady = false;
function ready(): void {
  if (tableReady) return;
  db.exec(`CREATE TABLE IF NOT EXISTS UmbraApproval (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    run_id TEXT,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    note TEXT,
    createdAt TEXT NOT NULL,
    decidedAt TEXT
  )`);
  tableReady = true;
}

interface ApprovalRow {
  id: string;
  user_id: string;
  bot_id: string;
  status: ApprovalStatus;
  note: string | null;
  createdAt: string;
}

const isExpired = (row: ApprovalRow) => row.status === 'pending' && Date.now() - Date.parse(row.createdAt) > APPROVAL_MS;

function readResult(): RestartResult | null {
  try {
    const text = fs.readFileSync(/* turbopackIgnore: true */ RESULT_FILE, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(text) as RestartResult;
    return data && typeof data.id === 'string' ? data : null;
  } catch {
    return null;
  }
}

function writeResult(result: RestartResult): void {
  fs.mkdirSync(/* turbopackIgnore: true */ path.dirname(RESULT_FILE), { recursive: true });
  fs.writeFileSync(/* turbopackIgnore: true */ RESULT_FILE, JSON.stringify(result, null, 2), 'utf8');
}

/** True while a restart is still going (its progress file moved recently and it hasn't ended). */
function restartRunning(): boolean {
  const r = readResult();
  if (!r || r.status === 'done' || r.status === 'failed') return false;
  const at = Date.parse(r.updatedAt ?? r.startedAt ?? '');
  return Number.isFinite(at) && Date.now() - at < STUCK_MS;
}

function progressText(r: RestartResult): string {
  switch (r.status) {
    case 'queued':
    case 'starting':
      return 'Starting…';
    case 'pulling':
      return 'Getting the latest main…';
    case 'building':
      return 'Building…';
    case 'restarting':
      return 'Restarting prod…';
    case 'done':
      return r.message || 'Prod is back up on the new build.';
    case 'failed':
      return `Stopped: ${r.message || 'something went wrong.'}`;
  }
}

function toView(row: ApprovalRow): ApprovalView {
  const status: ApprovalStatus = isExpired(row) ? 'expired' : row.status;
  const view: ApprovalView = { id: row.id, kind: 'restart_prod', title: 'Restart prod?', detail: DETAIL, status };
  if (row.note) view.note = row.note;
  if (status === 'approved') {
    const r = readResult();
    if (r?.id === row.id) {
      view.progress = progressText(r);
      view.outcome = r.status === 'done' ? 'done' : r.status === 'failed' ? 'failed' : 'running';
    }
  }
  return view;
}

function getRow(id: string, userId?: string): ApprovalRow | undefined {
  ready();
  return (userId
    ? db.prepare('SELECT id, user_id, bot_id, status, note, createdAt FROM UmbraApproval WHERE id = ? AND user_id = ?').get(id, userId)
    : db.prepare('SELECT id, user_id, bot_id, status, note, createdAt FROM UmbraApproval WHERE id = ?').get(id)) as ApprovalRow | undefined;
}

function setStatus(id: string, status: ApprovalStatus, note: string | null): void {
  db.prepare('UPDATE UmbraApproval SET status = ?, note = ?, decidedAt = ? WHERE id = ?').run(status, note, new Date().toISOString(), id);
}

/** The current state of requests shown in a chat, so a reloaded chat shows the answer instead of the buttons. */
export function approvalStatuses(ids: string[]): Map<string, ApprovalView> {
  const map = new Map<string, ApprovalView>();
  if (ids.length === 0) return map;
  ready();
  const rows = db
    .prepare(`SELECT id, user_id, bot_id, status, note, createdAt FROM UmbraApproval WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as unknown as ApprovalRow[];
  for (const row of rows) map.set(row.id, toView(row));
  return map;
}

// Environment for the restart script: this server's own Next.js and npm settings would confuse
// the build, and the script doesn't need the GitHub token (git on this PC has its own login).
function scriptEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(__NEXT|NEXT_RUNTIME$|NEXT_PHASE$|NEXT_DEPLOYMENT_ID$|TURBOPACK|npm_|NODE_OPTIONS$|GITHUB_TOKEN$|PORT$)/i.test(key)) continue;
    env[key] = value;
  }
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

/** Start the fixed pull → build → restart sequence for an approved request. */
function launchRestart(id: string): void {
  if (process.platform !== 'win32') throw new Error('Prod control only works on the Windows PC that runs the live app.');
  if (!fs.existsSync(/* turbopackIgnore: true */ SCRIPT)) throw new Error('The restart script (apps/suite/scripts/prod-restart.ps1) is missing.');
  const now = new Date().toISOString();
  writeResult({ id, status: 'queued', message: 'Starting in a few seconds.', startedAt: now, updatedAt: now, finishedAt: null });
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', SCRIPT, '-Id', id, '-Suite', APP_DIR, '-Result', RESULT_FILE],
    { cwd: APP_DIR, detached: true, stdio: 'ignore', windowsHide: true, env: scriptEnv() as NodeJS.ProcessEnv },
  );
  child.on('error', (err) => {
    const at = new Date().toISOString();
    writeResult({ id, status: 'failed', stage: 'start', message: `The restart script couldn't start: ${err.message}`, startedAt: now, updatedAt: at, finishedAt: at });
  });
  child.unref();
}

/** Approve or deny a request. Only the profile it was made for can answer it, and only once. */
export function decideApproval(userId: string, id: string, approve: boolean): ApprovalView | null {
  const row = getRow(id, userId);
  if (!row) return null;
  if (row.status === 'pending') {
    if (isExpired(row)) {
      setStatus(row.id, 'expired', null);
    } else if (!approve) {
      setStatus(row.id, 'denied', null);
    } else if (restartRunning()) {
      setStatus(row.id, 'failed', 'Another restart is already running.');
    } else {
      try {
        launchRestart(row.id);
        setStatus(row.id, 'approved', null);
      } catch (err) {
        setStatus(row.id, 'failed', (err as Error).message);
      }
    }
  }
  return toView(getRow(id, userId)!);
}

// ------------------------------------------------------------------ the tools

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function resultText(r: RestartResult): string {
  const parts = [`Status: ${r.status}${r.stage ? ` (step: ${r.stage})` : ''}`, r.message ? `Message: ${r.message}` : ''];
  if (r.startedAt) parts.push(`Started: ${r.startedAt}`);
  if (r.finishedAt) parts.push(`Finished: ${r.finishedAt}`);
  if (r.oldPid) parts.push(`Old prod process: ${r.oldPid}${r.newPid ? `, new: ${r.newPid}` : ''}`);
  if (r.pull) parts.push(`git pull output (end):\n${r.pull}`);
  if (r.build) parts.push(`Build output (end):\n${r.build}`);
  return parts.filter(Boolean).join('\n');
}

async function probeProd(): Promise<string> {
  try {
    const res = await fetch(`${PROD_URL}/`, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    return res.status === 200 ? 'up (GET / answered 200)' : `answering, but GET / gave ${res.status}`;
  } catch {
    return 'not answering on port 3000 right now';
  }
}

const params = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required });

const restartProd: ToolDef = {
  schema: {
    type: 'function',
    function: {
      name: 'restart_prod',
      description:
        'Ask the user to approve updating and restarting the live app (prod, port 3000) on their PC. Only use this when they asked for a prod restart or deploy. ' +
        'Takes no arguments: after they tap Approve in the chat, a fixed sequence runs: git pull of main, npm run build, and only if the build passes, a restart of prod. ' +
        'Nothing runs if they deny it or don\'t answer within 10 minutes. The restart stops the server you run on, so this chat is picked back up afterwards; then check how it went with prod_status. ' +
        'Merging pull requests is separate (refract_merge_pr).',
      parameters: params({}, []),
    },
  },
  label: () => 'Asking to restart prod',
  run: async (_a, ctx): Promise<ToolResult> => {
    ready();
    if (process.platform !== 'win32') throw new Error('Prod control only works on the Windows PC that runs the live app.');
    if (restartRunning()) throw new Error('A prod restart is already in progress. Check on it with prod_status.');
    // One open request per Flicker: an older unanswered one is withdrawn.
    db.prepare("UPDATE UmbraApproval SET status = 'expired', decidedAt = ? WHERE bot_id = ? AND status = 'pending'").run(new Date().toISOString(), ctx.botId);
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO UmbraApproval (id, user_id, bot_id, run_id, kind, status, createdAt) VALUES (?, ?, ?, ?, 'restart_prod', 'pending', ?)").run(
      id, ctx.userId, ctx.botId, ctx.runId ?? null, new Date().toISOString(),
    );

    let view = toView(getRow(id)!);
    ctx.progress?.({ summary: 'Waiting for your OK', approval: view });
    let shown = JSON.stringify(view);
    let approvedAt = 0;
    for (;;) {
      await sleep(POLL_MS);
      const row = getRow(id);
      if (!row) throw new Error('The restart request went missing.');
      if (isExpired(row)) setStatus(id, 'expired', null);
      view = toView(getRow(id)!);
      const key = JSON.stringify(view);
      if (key !== shown) {
        shown = key;
        ctx.progress?.({ summary: view.progress ?? (view.status === 'pending' ? 'Waiting for your OK' : view.status), approval: view });
      }
      if (view.status === 'pending') continue;
      if (view.status === 'expired') {
        return { output: 'The user didn\'t answer the restart request within 10 minutes, so nothing ran. Prod was not touched.', summary: 'No answer, so nothing ran', approval: view };
      }
      if (view.status === 'denied') {
        return { output: 'The user denied the restart. Nothing ran; prod was not touched.', summary: 'You said no, so nothing ran', approval: view };
      }
      if (view.status === 'failed') {
        return { output: `The restart was approved but couldn't start: ${view.note ?? 'unknown reason'}. Prod was not touched.`, summary: 'Couldn\'t start the restart', approval: view };
      }
      // Approved: follow the script until it finishes (or until this server is stopped by it).
      approvedAt ||= Date.now();
      const r = readResult();
      if (r?.id === id && (r.status === 'done' || r.status === 'failed')) {
        return {
          output: `${r.status === 'done' ? 'The prod restart finished.' : 'The prod restart stopped before the end.'}\n${resultText(r)}`,
          summary: progressText(r),
          approval: view,
        };
      }
      if (Date.now() - approvedAt > FOLLOW_MS) {
        return { output: 'The restart is still going after 30 minutes. Check on it with prod_status.', summary: 'Still going', approval: view };
      }
    }
  },
};

const prodStatus: ToolDef = {
  schema: {
    type: 'function',
    function: {
      name: 'prod_status',
      description: 'Check the live app (prod, port 3000): whether it answers, and how the last restart_prod went (each step, with the end of the git pull and build output).',
      parameters: params({}, []),
    },
  },
  label: () => 'Checking prod',
  run: async (): Promise<ToolResult> => {
    const up = await probeProd();
    const r = readResult();
    const last = r ? `Last restart:\n${resultText(r)}` : 'No restart has been run with restart_prod yet.';
    return { output: `Prod: ${up}\n${last}`, summary: up.startsWith('up') ? 'Prod is up' : 'Prod isn\'t answering' };
  },
};

export const PROD_TOOLS: ToolDef[] = [restartProd, prodStatus];

/** For a run picked back up after a restart that cut off restart_prod (lib/umbra/runs.ts). */
export function restartResumeNote(): string {
  const r = readResult();
  const head = 'restart_prod was cut off because the server it ran on was restarted (expected when the restart went ahead). ';
  if (!r) return `${head}No restart result was recorded. Call prod_status to check prod before telling the user anything.`;
  return (
    `${head}Last restart result: ${r.status}${r.message ? `: ${r.message}` : ''}${r.updatedAt ? ` (as of ${r.updatedAt})` : ''}. ` +
    'Call prod_status to confirm prod is back up, then tell the user how it went. Don\'t ask for another restart unless they want one.'
  );
}
