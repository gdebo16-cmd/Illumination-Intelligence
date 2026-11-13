// Shared by the team routes: who is asking, and is it their team?

import 'server-only';
import { NextResponse } from 'next/server';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { getTeam, viewTeam } from '@/lib/umbra/teams';

export async function ownedTeam(params: Promise<{ id: string }>) {
  const userId = await getCurrentUserId();
  if (!userId) return { error: noProfile() };
  const row = getTeam(userId, (await params).id);
  const team = row && viewTeam(userId, row);
  if (!team) return { error: NextResponse.json({ error: 'Team not found.' }, { status: 404 }) };
  return { userId, team };
}
