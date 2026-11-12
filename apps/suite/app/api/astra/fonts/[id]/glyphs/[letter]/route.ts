// PUT /api/astra/fonts/<id>/glyphs/<letter> — save a letter: { strokes, shapes }
//     strokes are drawn with the pen, shapes are traced from a picture (see config/astra.ts).
//     Sending neither erases that letter.

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { cleanGlyph, saveGlyph } from '@/lib/astra/fonts';
import { isLetter } from '@/config/astra';

type Params = { params: Promise<{ id: string; letter: string }> };
const noProfile = () => NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });

export async function PUT(req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const { id, letter } = await params;
  if (!isLetter(letter)) return NextResponse.json({ error: 'That letter isn’t in the font.' }, { status: 400 });
  const glyph = cleanGlyph(await req.json().catch(() => null));
  if (!glyph) return NextResponse.json({ error: 'That letter couldn’t be read.' }, { status: 400 });
  const font = saveGlyph(userId, id, letter, glyph);
  return font ? NextResponse.json(font) : NextResponse.json({ error: 'Font not found.' }, { status: 404 });
}
