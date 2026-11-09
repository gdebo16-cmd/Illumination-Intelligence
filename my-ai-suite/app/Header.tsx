'use client';

import ModelSelect from '@/app/ModelSelect';
import { useChat } from '@/app/ChatContext';
import Image from 'next/image';

const Header = () => {
  const { setSelectedModel, isSidebarOpen, toggleSidebar } = useChat();
  return (
    <header>
      <button className="sidebar-toggle" onClick={toggleSidebar} aria-expanded={isSidebarOpen} aria-controls="app-sidebar" aria-label="Toggle chat list">
        {isSidebarOpen ? '✕' : '☰'}
      </button>
      {/* rest unchanged */}
        <div className="header-container">  
            <Image src="/lumen.png" alt="Lumen" width={3840} height={2160} className="banner" priority unoptimized />
        </div>
        <ModelSelect pageType="chat" onChange={setSelectedModel} />
      </header>
    );
  };

export default Header;