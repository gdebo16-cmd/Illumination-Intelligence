import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  try {
    const stmt = db.prepare('SELECT id, title, updatedAt FROM Conversation ORDER BY updatedAt DESC');
    const conversations = stmt.all();
    return NextResponse.json(conversations);
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Fetch Conversations Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}