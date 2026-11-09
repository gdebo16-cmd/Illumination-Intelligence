import type { Metadata } from 'next';
import ComingSoon from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Umbra' };

export default function UmbraPage() {
  return <ComingSoon appId="umbra" />;
}
