import type { Metadata } from 'next';
import ComingSoon from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Eclipse' };

export default function EclipsePage() {
  return <ComingSoon appId="eclipse" />;
}
