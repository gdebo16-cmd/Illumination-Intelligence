import type { Metadata } from 'next';
import ComingSoon from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Aegis' };

export default function AegisPage() {
  return <ComingSoon appId="aegis" />;
}
