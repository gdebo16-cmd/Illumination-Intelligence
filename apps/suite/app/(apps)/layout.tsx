import { Suspense, type ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/user';

// Every product in the suite needs a selected profile.
async function UserGate({ children }: { children: ReactNode }) {
  const userId = await getCurrentUserId();
  if (!userId) redirect('/select-user');
  return <>{children}</>;
}

export default function AppsLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <UserGate>{children}</UserGate>
    </Suspense>
  );
}
