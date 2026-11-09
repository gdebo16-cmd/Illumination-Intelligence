import type { Metadata } from 'next';
import AppHeader from '@/components/AppHeader';
import Prism from './_components/Prism';

export const metadata: Metadata = { title: 'Prism' };

export default function PrismPage() {
  return (
    <div className="site-container">
      <div className="content-area">
        <AppHeader appId="prism" />
        <Prism />
      </div>
    </div>
  );
}
