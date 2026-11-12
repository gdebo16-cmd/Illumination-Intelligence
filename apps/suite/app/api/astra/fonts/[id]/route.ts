// PATCH  /api/astra/fonts/<id> — rename a font: { name }
// DELETE /api/astra/fonts/<id> — delete it

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { cleanName, deleteFont, renameFont } from '@/lib/astra/fonts';

type Params = { params: Promise<{ id: string }> };
const noProfile = () => NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
const notFound = () => NextResponse.json({ error: 'Font not found.' }, { status: 404 });

export async function PATCH(req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const body = await req.json().catch(() => ({}));
  const name = cleanName(body.name);
  if (!name) return NextResponse.json({ error: 'A font needs a name.' }, { status: 400 });
  const font = renameFont(userId, (await params).id, name);
  return font ? NextResponse.json(font) : notFound();
}

export async function DELETE(_req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  return deleteFont(userId, (await params).id) ? NextResponse.json({ deleted: true }) : notFound();
}