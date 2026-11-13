import { connection, NextResponse } from 'next/server';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { listArtifacts, type ArtifactApp } from '@/lib/artifacts';

const APPS: ArtifactApp[] = ['lumen', 'umbra'];

// GET /api/artifacts?app=lumen|umbra[&source=<chat, Flicker or team id>]
// The signed-in profile's artifacts (Markdown documents), newest first, without their text.
export async function GET(req: Request) {
  // Run on every request, so new artifacts always show up in a production build.
  await connection();
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();

  const url = new URL(req.url);
  const app = url.searchParams.get('app') as ArtifactApp | null;
  if (!app || !APPS.includes(app)) return NextResponse.json({ error: 'Say which app: lumen or umbra.' }, { status: 400 });
  const source = url.searchParams.get('source') || undefined;

  return NextResponse.json(listArtifacts(userId, app, source));
}
