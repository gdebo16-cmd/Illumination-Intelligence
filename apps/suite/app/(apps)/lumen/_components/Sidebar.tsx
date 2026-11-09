'use client';

import { useChat } from './ChatContext';
import { useRouter } from 'next/navigation';
import ModelSelect from './ModelSelect';
  

const Sidebar = () => {
  const { setSelectedModel } = useChat();
  const router = useRouter();
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
        <div className="sidebar-top">
          <span className="sidebar-title">Chats</span>
          <button className="sidebar-close" onClick={closeSidebar} aria-label="Close chat list">✕</button>
        </div>
        <button className='new-chat-button' onClick={() => { startNewChat(); closeSidebar(); }}>+ New chat</button>
        <span className='sidebar-separator'>Previous Chats</span>
        {conversations.map((c) => (
          <button
            className='chat-button'
            key={c.id}
            aria-current={c.id === conversationId}
            onClick={() => { loadConversation(c.id); closeSidebar(); }}
          >
            {c.title}
          </button>
        ))}
        <span className='sidebar-separator'>
          Settings
        </span>
        <button className='switch-profile-button' onClick={() => { fetch('/api/users/select', {method: 'DELETE',}); router.push('/select-user');}}>
            Switch Profile
        </button>
        <span className='sidebar-separator'>
          Model
        </span>
        <ModelSelect pageType="chat" onChange={setSelectedModel} />
      </aside>
      
    </div>
  );
};

export default Sidebar;