import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ChatProvider } from './_components/ChatContext';

export const metadata: Metadata = { title: 'Lumen' };

export default function LumenLayout({ children }: { children: ReactNode }) {
  return <ChatProvider>{children}</ChatProvider>;
}
