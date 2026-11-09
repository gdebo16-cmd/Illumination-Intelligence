
import 'server-only';
import { cookies } from 'next/headers';
import { USERS, UserId } from './users';

export { USERS, type UserId };

export async function getCurrentUserId(): Promise<UserId | null> {
  const cookieStore = await cookies();
  const userId = cookieStore.get('assistant-user')?.value;

  if (userId && Object.hasOwn(USERS, userId)) {
    return userId as UserId;
  }

  return null;
}
