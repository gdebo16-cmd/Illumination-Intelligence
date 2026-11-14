// GET /api/astra/fonts/<id>/download — the font as a .ttf file you can install (lib/astra/font-file.ts)

import { NextResponse } from 'next/server';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { getFont } from '@/lib/astra/fonts';
import { buildFontFile } from '@/lib/astra/font-file';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const font = getFont(userId, (await params).id);
  if (!font) return NextResponse.json({ error: 'Font not found.' }, { status: 404 });
  const file = buildFontFile(font.name, font.glyphs, font.penWidth);
  if (!file) return NextResponse.json({ error: 'Make at least one character first.' }, { status: 400 });

  // The file name: plain letters and numbers for older programs, the real name for newer ones.
  const plainName = font.name.replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'Astra font';
  return new NextResponse(Buffer.from(file), {
    headers: {
      'Content-Type': 'font/ttf',
      'Content-Disposition': `attachment; filename="${plainName}.ttf"; filename*=UTF-8''${encodeURIComponent(font.name)}.ttf`,
      'Cache-Control': 'no-store',
    },
  });
}
