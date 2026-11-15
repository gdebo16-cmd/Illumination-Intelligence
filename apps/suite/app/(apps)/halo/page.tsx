import type { Metadata } from 'next';
import Halo from './_components/Halo';

export const metadata: Metadata = { title: 'Halo' };

export default function HaloPage() {
  return <Halo />;
}
