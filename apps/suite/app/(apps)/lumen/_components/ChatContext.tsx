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
import { useArtifacts, type ArtifactSummary, type OpenDocument } from '@/components/documents';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  /** Photos sent with the message: saved photo ids (or, just after sending, local previews). */
  images?: string[];
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
  /** The documents Lumen has written, across every chat (the sidebar's Artifacts list). */
  artifacts: ArtifactSummary[] | null;
  refreshArtifacts: () => Promise<void>;
  openArtifact: (artifact: ArtifactSummary) => Promise<void>;
  deleteArtifact: (artifact: ArtifactSummary) => Promise<void>;
  /** The document shown in the side panel, if any. */
  openDoc: OpenDocument | null;
  setOpenDoc: (doc: OpenDocument | null) => void;
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
  const { artifacts, refresh: refreshArtifacts, open: loadArtifact, remove: deleteArtifact } = useArtifacts('lumen');
  const [openDoc, setOpenDoc] = useState<OpenDocument | null>(null);
  const openArtifact = useCallback(async (artifact: ArtifactSummary) => {
    const doc = await loadArtifact(artifact);
    if (doc) setOpenDoc(doc);
  }, [loadArtifact]);

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
      artifacts,
      refreshArtifacts,
      openArtifact,
      deleteArtifact,
      openDoc,
      setOpenDoc,
    }),
    [selectedModel, messages, conversationId, conversations, refreshConversations, loadConversation, deleteConversation, startNewChat, loadingConversation, isSidebarOpen, toggleSidebar, closeSidebar, artifacts, refreshArtifacts, openArtifact, deleteArtifact, openDoc],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChat = () => {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
};