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
    deleteConversation,
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
        <div className='chat-list'>
          {conversations.map((c) => (
            <div className={`chat-row ${c.id === conversationId ? 'is-current' : ''}`} key={c.id}>
              <button
                className='chat-button'
                aria-current={c.id === conversationId}
                onClick={() => { loadConversation(c.id); closeSidebar(); }}
              >
                {c.title}
              </button>
              <button
                className='chat-delete'
                aria-label={`Delete chat: ${c.title}`}
                title='Delete chat'
                onClick={() => {
                  if (window.confirm(`Delete "${c.title}"? This can't be undone.`)) deleteConversation(c.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
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