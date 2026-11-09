import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import AppHeader from '@/components/AppHeader';

export const metadata: Metadata = { title: 'Umbra' };

// Every Umbra page: the banner header, then the page itself.
export default function UmbraLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site-container">
      <div className="content-area">
        <AppHeader appId="umbra" />
        {children}
      </div>
    </div>
  );
}
