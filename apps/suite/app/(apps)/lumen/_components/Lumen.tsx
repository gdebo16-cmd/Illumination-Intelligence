'use client';

import AppShell from '@/components/AppShell';
import { useChat } from './ChatContext';
import ChatSidebar from './ChatSidebar';
import Chat from './ChatContent';

// Lumen's page: the chat list in the side panel, the chat itself in the middle. The app switcher
// sits beside the message box (ChatContent), not in the corner, so the header leaves it out.
const Lumen = () => {
  const { panel } = useChat();

  return (
    <AppShell appId="lumen" launcher={false} sidebar={{ panel, title: 'Chats', label: 'chat list', content: <ChatSidebar /> }}>
      <main>
        <Chat />
      </main>
    </AppShell>
  );
};

export default Lumen;
