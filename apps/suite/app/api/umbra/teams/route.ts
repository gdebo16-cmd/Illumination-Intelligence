// GET  /api/umbra/teams — your teams, with their bots filled in
// POST /api/umbra/teams — create one: { name, purpose, leaderId, members: [{ botId, role }] }

import { connection, NextResponse } from 'next/server';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { createTeam, listTeams, validateTeam, viewTeam } from '@/lib/umbra/teams';

export async function GET() {
  await connection();
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  return NextResponse.json(listTeams(userId).flatMap((t) => viewTeam(userId, t) ?? []));
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const checked = validateTeam(userId, await req.json().catch(() => ({})));
  if ('error' in checked) return NextResponse.json(checked, { status: 400 });
  return NextResponse.json(viewTeam(userId, createTeam(userId, checked.team)), { status: 201 });
}
