import { connection, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUserId } from '@/lib/user';

// Lists the signed-in profile's chats, newest first.
export async function GET() {
  // Run on every request. Without this, a production build saves one copy of the list
  // at build time and new chats never show up.
  await connection();
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
    }

    const conversations = db
      .prepare('SELECT id, title, updatedAt FROM Conversation WHERE user_id = ? ORDER BY updatedAt DESC')
      .all(userId);
    return NextResponse.json(conversations);
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Fetch Conversations Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
