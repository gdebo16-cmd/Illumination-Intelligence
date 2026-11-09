// GET    /api/umbra/teams/<id> — one team, with its bots
// PUT    /api/umbra/teams/<id> — change it (same fields as creating)
// DELETE /api/umbra/teams/<id> — delete it (the bots themselves stay)

import { NextResponse } from 'next/server';
import { deleteTeam, updateTeam, validateTeam, viewTeam } from '@/lib/umbra/teams';
import { ownedTeam } from '../owned';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const found = await ownedTeam(params);
  return 'error' in found ? found.error : NextResponse.json(found.team);
}

export async function PUT(req: Request, { params }: Params) {
  const found = await ownedTeam(params);
  if ('error' in found) return found.error;
  const checked = validateTeam(found.userId, await req.json().catch(() => ({})));
  if ('error' in checked) return NextResponse.json(checked, { status: 400 });
  const team = updateTeam(found.userId, found.team.id, checked.team);
  return NextResponse.json(team && viewTeam(found.userId, team));
}

export async function DELETE(_req: Request, { params }: Params) {
  const found = await ownedTeam(params);
  if ('error' in found) return found.error;
  deleteTeam(found.userId, found.team.id);
  return NextResponse.json({ deleted: true });
}
