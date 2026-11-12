import type { Metadata } from 'next';
import Prism from './_components/Prism';

export const metadata: Metadata = { title: 'Prism' };

// Prism draws its own page frame (side panel, header and studio), because the ☰ button in
// the header and the side panel share one on/off switch that lives inside it.
export default function PrismPage() {
  return <Prism />;
}