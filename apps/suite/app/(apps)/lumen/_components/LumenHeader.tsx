'use client';

import Image from 'next/image';
import AppLauncher from '@/components/AppLauncher';
import { useChat } from './ChatContext';

const LumenHeader = () => {
  const { isSidebarOpen, toggleSidebar } = useChat();
  return (
    <header>
      <Image src="/brand/lumen.png" alt="Lumen" width={3840} height={2160} className="banner" priority />
      <button className="sidebar-toggle" onClick={toggleSidebar}>
        {isSidebarOpen ? '✕' : '☰'}
      </button>
      <AppLauncher />
    </header>
  );
};

export default LumenHeader;
