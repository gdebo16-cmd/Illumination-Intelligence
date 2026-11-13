// POST /api/aegis/scan — scan a repo: { repo: "C:\\code\\my-app" | "https://github.com/o/r" | "o/r" }
// Answers with the report (lib/aegis/types.ts). A folder is read in place and never changed;
// a link is copied in for the scan and deleted afterwards.

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { RepoError } from '@/lib/aegis/repo';
import { scanRepo } from '@/lib/aegis/scan';

export const maxDuration = 300;

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await scanRepo(body.repo));
  } catch (err) {
    if (err instanceof RepoError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('Aegis scan failed:', err);
    return NextResponse.json({ error: 'The scan failed. See the server log for details.' }, { status: 500 });
  }
}
