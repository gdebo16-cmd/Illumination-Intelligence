import type { Metadata } from 'next';
import Aegis from './_components/Aegis';
import './aegis.css';

export const metadata: Metadata = { title: 'Aegis' };

export default function AegisPage() {
  return <Aegis />;
}
