import type { Metadata } from 'next';
import Astra from './_components/Astra';

export const metadata: Metadata = { title: 'Astra' };

export default function AstraPage() {
  return <Astra />;
}
