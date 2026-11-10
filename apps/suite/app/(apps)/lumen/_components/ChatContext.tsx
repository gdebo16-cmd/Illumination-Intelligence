'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

import useToggle from '@/hooks/use-toggle';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationItem {
  id: string;
  title: string;
  updatedAt: string;
}

interface ChatContextValue {
  selectedModel: string;
  setSelectedModel: (modelId: string) => void;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  conversations: ConversationItem[];
  refreshConversations: () => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  startNewChat: () => void;
  loadingConversation: boolean;
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  closeSidebar: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

const fetchConversationList = async (): Promise<ConversationItem[] | null> => {
    try {
      const res = await fetch('/api/lumen/conversations');
      return res.ok ? await res.json() : null;
    } catch (err) {
      console.error('Failed to load conversations list', err);
      return null;
    }
  };

export const ChatProvider = ({ children }: { children: ReactNode }) => {
  const [selectedModel, setSelectedModel] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const { isOpen: isSidebarOpen, handleToggle: toggleSidebar, handleClose: closeSidebar } = useToggle(1024);

  const refreshConversations = useCallback(async () => {
    const data = await fetchConversationList();
    if (data) setConversations(data);
  }, []);
  
  useEffect(() => {
    let cancelled = false;
    fetchConversationList().then((data) => {
      if (!cancelled && data) setConversations(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    try {
      setLoadingConversation(true);
      const res = await fetch(`/api/lumen/conversations/${id}`);
      if (res.ok) {
        const data = await res.json();
        setConversationId(id);
        setMessages(data.messages);
      }
    } catch (err) {
      console.error('Failed to load conversation messages', err);
    } finally {
      setLoadingConversation(false);
    }
  }, []);

  const startNewChat = useCallback(() => {
    setConversationId(null);
    setMessages([]);
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/lumen/conversations/${id}`, { method: 'DELETE' });
      // 404 means it is already gone, so drop it from the list either way.
      if (!res.ok && res.status !== 404) return;
      setConversations((prev) => prev.filter((c) => c.id !== id));
      // Deleting the chat that is open leaves an empty, new chat.
      if (id === conversationId) startNewChat();
    } catch (err) {
      console.error('Failed to delete conversation', err);
    }
  }, [conversationId, startNewChat]);

  const value = useMemo(
    () => ({
      selectedModel,
      setSelectedModel,
      messages,
      setMessages,
      conversationId,
      setConversationId,
      conversations,
      refreshConversations,
      loadConversation,
      deleteConversation,
      startNewChat,
      loadingConversation,
      isSidebarOpen,
      toggleSidebar,
      closeSidebar,
    }),
    [selectedModel, messages, conversationId, conversations, refreshConversations, loadConversation, deleteConversation, startNewChat, loadingConversation, isSidebarOpen, toggleSidebar, closeSidebar],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChat = () => {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
};