// GET  /api/astra/fonts — your fonts, most recently changed first
// POST /api/astra/fonts — make a new font: { name }

import { connection, NextResponse } from 'next/server';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { cleanName, createFont, listFonts } from '@/lib/astra/fonts';

export async function GET() {
  await connection();
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  return NextResponse.json(listFonts(userId));
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const body = await req.json().catch(() => ({}));
  const name = cleanName(body.name) ?? 'Untitled';
  return NextResponse.json(createFont(userId, name), { status: 201 });
}