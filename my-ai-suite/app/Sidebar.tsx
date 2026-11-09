'use client';

import { useChat } from './ChatContext';

const Sidebar = () => {
  const {
    conversations,
    conversationId,
    loadConversation,
    startNewChat,
    isSidebarOpen,
    closeSidebar,
  } = useChat();

  return (
    <div className='sidebar-container'>
      {isSidebarOpen && <div className="sidebar-backdrop" onClick={closeSidebar} />}
      <aside id="app-sidebar" className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <button className="new-chat-button" onClick={() => { startNewChat(); closeSidebar(); }}>New chat</button>
        {conversations.map((c) => (
          <button
            key={c.id}
            aria-current={c.id === conversationId}
            onClick={() => { loadConversation(c.id); closeSidebar(); }}
          >
            {c.title}
          </button>
        ))}
      </aside>
    </div>
  );
};

export default Sidebar;