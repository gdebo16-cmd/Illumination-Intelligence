import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/user';
import Lumen from './lumen';

async function UserGate() {
  const userId = await getCurrentUserId();

  if (!userId) {
    redirect('/select-user');
  }

  return <Lumen />;
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <UserGate />
    </Suspense>
  );
}