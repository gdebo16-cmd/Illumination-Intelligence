import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import AppShell from '@/components/AppShell';

export const metadata: Metadata = { title: 'Umbra' };

// Every Umbra page: the banner header, then the page itself.
export default function UmbraLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell appId="umbra">
      {children}
    </AppShell>
  );
}
