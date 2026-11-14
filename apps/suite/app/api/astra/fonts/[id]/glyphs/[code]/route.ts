// PUT /api/astra/fonts/<id>/glyphs/<code> — save one character: { strokes, shapes }
//     <code> is the character's number (65 = "A", 97 = "a", 63 = "?"), so characters like / ? #
//     don't get mixed up with the web address. In the page: char.codePointAt(0).
//     strokes are drawn with the pen, shapes are traced from a picture (see config/astra.ts).
//     Sending neither erases that character.

import { NextResponse } from 'next/server';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { cleanGlyph, saveGlyph } from '@/lib/astra/fonts';
import { isCharacter } from '@/config/astra';

type Params = { params: Promise<{ id: string; code: string }> };
export async function PUT(req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const { id, code } = await params;
  const char = /^\d{1,6}$/.test(code) ? String.fromCodePoint(Number(code)) : '';
  if (!isCharacter(char)) return NextResponse.json({ error: 'That character isn’t in the font.' }, { status: 400 });
  const glyph = cleanGlyph(await req.json().catch(() => null));
  if (!glyph) return NextResponse.json({ error: 'That character couldn’t be read.' }, { status: 400 });
  const font = saveGlyph(userId, id, char, glyph);
  return font ? NextResponse.json(font) : NextResponse.json({ error: 'Font not found.' }, { status: 404 });
}
