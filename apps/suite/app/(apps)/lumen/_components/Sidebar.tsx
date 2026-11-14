'use client';

import { useRouter } from 'next/navigation';
import SidebarFrame from '@/components/Sidebar';
import { useChat } from './ChatContext';
import ModelSelect from './ModelSelect';
import { ArtifactIcon } from '@/components/documents';

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
    artifacts,
    openArtifact,
    deleteArtifact,
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
      {/* Documents, web pages, images, diagrams, components and code Lumen made, from every chat. Deleting one leaves its chat as it is. */}
      <span className='sidebar-separator'>Artifacts</span>
      <div className='chat-list artifact-list'>
        {artifacts?.length === 0 && <p className='artifact-empty'>Documents, web pages, diagrams, apps and code Lumen makes for you show up here.</p>}
        {artifacts?.map((a) => (
          <div className='chat-row' key={a.id}>
            <button
              className='chat-button artifact-button'
              title={`From: ${a.sourceName}`}
              onClick={() => { void openArtifact(a); closeSidebar(); }}
            >
              <span className='artifact-icon'><ArtifactIcon format={a.format} size={16} /></span>
              <span className='artifact-title'>{a.title}</span>
            </button>
            <button
              className='chat-delete'
              aria-label={`Delete artifact: ${a.title}`}
              title='Delete artifact'
              onClick={() => {
                if (window.confirm(`Delete the artifact "${a.title}"? Its chat stays.`)) void deleteArtifact(a);
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
