// GET  /api/umbra/teams/<id>/tasks — the team's tasks
// POST /api/umbra/teams/<id>/tasks — add one: { title, instructions, schedule }

import { NextResponse } from 'next/server';
import { createTask, listTeamTasks, validateTask } from '@/lib/umbra/tasks';
import { ownedTeam } from '../../owned';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const found = await ownedTeam(params);
  return 'error' in found ? found.error : NextResponse.json(listTeamTasks(found.userId, found.team.id));
}

export async function POST(req: Request, { params }: Params) {
  const found = await ownedTeam(params);
  if ('error' in found) return found.error;
  const checked = validateTask(await req.json().catch(() => ({})));
  if ('error' in checked) return NextResponse.json(checked, { status: 400 });
  return NextResponse.json(createTask(found.userId, found.team.leaderId, checked.task, found.team.id), { status: 201 });
}
