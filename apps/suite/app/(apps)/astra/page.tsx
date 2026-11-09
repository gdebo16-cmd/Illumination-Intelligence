import type { Metadata } from 'next';
import ComingSoon from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Astra' };

export default function AstraPage() {
  return <ComingSoon appId="astra" />;
}
