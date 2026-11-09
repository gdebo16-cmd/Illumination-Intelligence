import type { Metadata } from 'next';
import ComingSoon from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Prism' };

export default function PrismPage() {
  return <ComingSoon appId="prism" />;
}
