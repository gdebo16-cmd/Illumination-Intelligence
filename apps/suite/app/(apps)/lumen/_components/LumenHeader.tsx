'use client';

import AppBanner from '@/components/AppBanner';
import SidebarToggle from '@/components/SidebarToggle';
import { useChat } from './ChatContext';

const LumenHeader = () => {
  const { isSidebarOpen, toggleSidebar } = useChat();
  return (
    <header>
      <AppBanner appId="lumen" />
      <SidebarToggle open={isSidebarOpen} onToggle={toggleSidebar} label="chat list" />
      {/* The app switcher lives next to the message box, on the left. */}
      <span className="header-spacer" />
    </header>
  );
};

export default LumenHeader;
