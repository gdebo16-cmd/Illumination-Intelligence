import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUserId } from '@/lib/user';
import { chatKey, deletePhotos, photoIds } from '@/lib/chat-images';

// Returns one chat's messages, only if it belongs to the signed-in profile.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
    }

    const { id } = await params;
    const conversation = db
      .prepare('SELECT user_id FROM Conversation WHERE id = ?')
      .get(id) as { user_id: string | null } | undefined;
    if (!conversation || conversation.user_id !== userId) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
    }

    const rows = db
      .prepare('SELECT role, content, images FROM Message WHERE conversationId = ? ORDER BY createdAt ASC, rowid ASC')
      .all(id) as { role: string; content: string; images: string | null }[];
    // A message's photos are sent as a list of ids; the page loads each from /api/chat-images/<id>.
    const messages = rows.map(({ images, ...message }) => {
      const ids = photoIds(images);
      return ids.length ? { ...message, images: ids } : message;
    });

    return NextResponse.json({ messages });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Fetch Single Conversation Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

// Deletes one chat and its messages, only if it belongs to the signed-in profile.
// Memories learned from the chat are kept: they belong to the profile, not the chat.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
    }

    const { id } = await params;
    const conversation = db
      .prepare('SELECT user_id FROM Conversation WHERE id = ?')
      .get(id) as { user_id: string | null } | undefined;
    if (!conversation || conversation.user_id !== userId) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
    }

    db.prepare('DELETE FROM Message WHERE conversationId = ?').run(id);
    deletePhotos(chatKey.lumen(id));
    db.prepare('DELETE FROM memory_extractions WHERE conversation_id = ?').run(id);
    db.prepare('DELETE FROM Conversation WHERE id = ?').run(id);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Delete Conversation Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
