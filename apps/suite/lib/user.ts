
import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { USERS, UserId } from './profiles';

export async function getCurrentUserId(): Promise<UserId | null> {
  const cookieStore = await cookies();
  const userId = cookieStore.get('assistant-user')?.value;

  if (userId && Object.hasOwn(USERS, userId)) {
    return userId as UserId;
  }

  return null;
}

/** What an API route answers when no profile is selected. */
export function noProfile(headers?: HeadersInit) {
  return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401, headers });
}
