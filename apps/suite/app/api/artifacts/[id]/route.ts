import { connection, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { deleteArtifact, getArtifact } from '@/lib/artifacts';

// GET /api/artifacts/<id> — one artifact with its full text, only if it belongs to the signed-in profile.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
  const artifact = getArtifact(userId, (await params).id);
  if (!artifact) return NextResponse.json({ error: 'Artifact not found.' }, { status: 404 });
  return NextResponse.json(artifact);
}

// DELETE /api/artifacts/<id> — remove it. The chat it came from is not changed.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
  if (!deleteArtifact(userId, (await params).id)) return NextResponse.json({ error: 'Artifact not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
