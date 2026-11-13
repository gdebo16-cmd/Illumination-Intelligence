// The suite's profiles: who can use it. Plain data, so pages in the browser can list them too;
// lib/user.ts reads which one is selected (server only).

export const USERS = {
    'user-1': 'Gabe',
    'user-2': 'Alice',
  } as const;
  
  export type UserId = keyof typeof USERS;