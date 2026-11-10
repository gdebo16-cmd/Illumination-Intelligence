'use client';

import AppBanner from '@/components/AppBanner';
import AppLauncher from '@/components/AppLauncher';
import { useChat } from './ChatContext';

const LumenHeader = () => {
  const { isSidebarOpen, toggleSidebar } = useChat();
  return (
    <header>
      <AppBanner appId="lumen" />
      <button className="sidebar-toggle" onClick={toggleSidebar}>
        {isSidebarOpen ? '✕' : '☰'}
      </button>
      <AppLauncher />
    </header>
  );
};

export default LumenHeader;
