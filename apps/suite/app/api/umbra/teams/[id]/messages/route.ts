// GET    /api/umbra/teams/<id>/messages — the team chat, oldest first
// DELETE /api/umbra/teams/<id>/messages — clear it

import { NextResponse } from 'next/server';
import { clearTeamMessages, listTeamMessages } from '@/lib/umbra/teams';
import { workHeaders } from '@/lib/umbra/busy';
import { ownedTeam } from '../../owned';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const found = await ownedTeam(params);
  return 'error' in found ? found.error : NextResponse.json(listTeamMessages(found.team.id), { headers: workHeaders(`team:${found.team.id}`) });
}

export async function DELETE(_req: Request, { params }: Params) {
  const found = await ownedTeam(params);
  if ('error' in found) return found.error;
  clearTeamMessages(found.team.id);
  return NextResponse.json({ cleared: true });
}
