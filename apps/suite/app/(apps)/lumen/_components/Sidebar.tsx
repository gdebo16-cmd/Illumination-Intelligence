'use client';

import { useRouter } from 'next/navigation';
import SidebarFrame from '@/components/Sidebar';
import { useChat } from './ChatContext';
import ModelSelect from './ModelSelect';

// What Lumen puts in the side panel: New chat, your previous chats, Switch Profile and the
// model picker. The panel itself (frame, title, ✕, backdrop) is the shared components/Sidebar.tsx.
const Sidebar = () => {
  const router = useRouter();
  const {
    conversations,
    conversationId,
    loadConversation,
    deleteConversation,
    startNewChat,
    setSelectedModel,
    isSidebarOpen,
    closeSidebar,
  } = useChat();

  return (
    <SidebarFrame open={isSidebarOpen} onClose={closeSidebar} title="Chats">
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
    </SidebarFrame>
  );
};

export default Sidebar;
