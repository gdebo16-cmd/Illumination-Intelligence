import type { Metadata } from 'next';
import ComingSoon from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Refract' };

export default function RefractPage() {
  return <ComingSoon appId="refract" />;
}
