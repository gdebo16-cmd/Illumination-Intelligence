import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import UmbraShell from './_components/UmbraShell';

export const metadata: Metadata = { title: 'Umbra' };

// Every Umbra page: the banner header, the side panel (filled by each page), then the page itself.
export default function UmbraLayout({ children }: { children: ReactNode }) {
  return <UmbraShell>{children}</UmbraShell>;
}
