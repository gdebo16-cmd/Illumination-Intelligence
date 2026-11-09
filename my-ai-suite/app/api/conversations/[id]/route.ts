import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const msgStmt = db.prepare(
      'SELECT role, content FROM Message WHERE conversationId = ? ORDER BY createdAt ASC'
    );
    const messages = msgStmt.all(id);

    return NextResponse.json({ messages });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Fetch Single Conversation Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}