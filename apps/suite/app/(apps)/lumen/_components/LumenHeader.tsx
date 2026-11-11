'use client';

import AppBanner from '@/components/AppBanner';
import { useChat } from './ChatContext';

const LumenHeader = () => {
  const { isSidebarOpen, toggleSidebar } = useChat();
  return (
    <header>
      <AppBanner appId="lumen" />
      <button className="sidebar-toggle" onClick={toggleSidebar}>
        {isSidebarOpen ? '✕' : '☰'}
      </button>
      {/* The app switcher lives next to the message box, on the left. */}
      <span className="header-spacer" />
    </header>
  );
};

export default LumenHeader;
