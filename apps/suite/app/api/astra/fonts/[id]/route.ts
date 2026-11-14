// PATCH  /api/astra/fonts/<id> — change a font: { name?, penWidth? }
// DELETE /api/astra/fonts/<id> — delete it

import { NextResponse } from 'next/server';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { cleanName, cleanPenWidth, deleteFont, updateFont } from '@/lib/astra/fonts';

type Params = { params: Promise<{ id: string }> };
const notFound = () => NextResponse.json({ error: 'Font not found.' }, { status: 404 });

export async function PATCH(req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const body = await req.json().catch(() => ({}));
  const changes: { name?: string; penWidth?: number } = {};
  if ('name' in body) {
    const name = cleanName(body.name);
    if (!name) return NextResponse.json({ error: 'A font needs a name.' }, { status: 400 });
    changes.name = name;
  }
  if ('penWidth' in body) {
    const penWidth = cleanPenWidth(body.penWidth);
    if (penWidth === null) return NextResponse.json({ error: 'The pen thickness must be a number.' }, { status: 400 });
    changes.penWidth = penWidth;
  }
  const font = updateFont(userId, (await params).id, changes);
  return font ? NextResponse.json(font) : notFound();
}

export async function DELETE(_req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  return deleteFont(userId, (await params).id) ? NextResponse.json({ deleted: true }) : notFound();
}
