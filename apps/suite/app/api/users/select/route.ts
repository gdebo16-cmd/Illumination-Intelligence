
import { NextRequest, NextResponse } from 'next/server';
import { USERS, UserId } from '@/lib/profiles';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userId = body.userId as string;

    if (!Object.hasOwn(USERS, userId)) {
      return NextResponse.json(
        { error: 'Invalid user selection' },
        { status: 400 }
      );
    }

    const response = NextResponse.json({
      success: true,
      userId,
      name: USERS[userId as UserId],
    });

    response.cookies.set('assistant-user', userId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: 'Unable to select user' },
      { status: 400 }
    );
  }
}

// "Switch Profile" in the sidebar calls this to clear the selection.
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete('assistant-user');
  return response;
}
