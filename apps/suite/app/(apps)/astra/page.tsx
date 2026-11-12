import type { Metadata } from 'next';
import Astra from './components/astra';

export const metadata: Metadata = { title: 'Astra' };

export default function AstraPage() {
  return <Astra />;
}
