import { redirect } from 'next/navigation';

// The suite opens on Lumen. Swap this for a home grid of APPS later if wanted.
export default function Home() {
  redirect('/lumen');
}
