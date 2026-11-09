'use client';

import ModelSelect from '@/app/ModelSelect';
import { useChat } from '@/app/ChatContext';
import Image from 'next/image';

const Header = () => {
  const { setSelectedModel, isSidebarOpen, toggleSidebar } = useChat();
  return (
        <header>
        <Image src="/lumen.png" alt="Lumen" width={3840} height={2160} className="banner" priority />
        <button className="sidebar-toggle" onClick={toggleSidebar}>
            {isSidebarOpen ? '✕' : '☰'}
        </button>
        <ModelSelect pageType="chat" onChange={setSelectedModel} />
        </header>
    );
  };

export default Header;