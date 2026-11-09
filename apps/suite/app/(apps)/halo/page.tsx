import type { Metadata } from 'next';
import ComingSoon from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Halo' };

export default function HaloPage() {
  return <ComingSoon appId="halo" />;
}
