'use client';

import { useChat } from './ChatContext';
import Header from './Header';
import Sidebar from './Sidebar';
import Chat from './ChatContent';

const Lumen = () => {
  const { isSidebarOpen } = useChat();

  return (
    <div className={`site-container ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Sidebar />
      <div className="content-area">
        <Header />
        <main>
          <Chat />
        </main>
      </div>
    </div>
  );
};

export default Lumen;