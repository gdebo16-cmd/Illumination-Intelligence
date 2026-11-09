export const USERS = {
    'user-1': 'Gabe',
    'user-2': 'Alice',
  } as const;
  
  export type UserId = keyof typeof USERS;