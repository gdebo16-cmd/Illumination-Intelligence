'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useChat } from './ChatContext';
import { MessageContent } from '@/components/MessageContent';
import QueueNotice from '@/components/QueueNotice';
import AppLauncher from '@/components/AppLauncher';
import { useBarHeight } from '@/hooks/use-bar-height';
import { splitContent, DocumentCard, DocumentPanel } from './documents';

const getAdaptiveLoadingText = (prompt: string): string => {
  const trimmed = prompt.trim().toLowerCase();

  if (trimmed.startsWith('what') || trimmed.startsWith('how') || trimmed.startsWith('why') || trimmed.startsWith('can you')) {
    return `figuring out ${prompt.replace(/^(what is|what's|how to|how do i|can you)\s*/i, '')}`;
  }

  if (trimmed.startsWith('write') || trimmed.startsWith('draft') || trimmed.startsWith('create')) {
    return `drafting ${prompt.replace(/^(write a|write|draft a|draft|create a|create)\s*/i, '')}`;
  }

  if (trimmed.startsWith('code') || trimmed.startsWith('build') || trimmed.startsWith('fix')) {
    return `building ${prompt.replace(/^(code a|code|build a|build|fix)\s*/i, '')}`;
  }

  return `figuring out "${prompt}"`;
};

const Chat = () => {
  const {
    messages,
    setMessages,
    conversationId,
    setConversationId,
    selectedModel,
    refreshConversations,
    loadingConversation,
  } = useChat();

  const [input, setInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [openDoc, setOpenDoc] = useState<{ title: string; content: string } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  useBarHeight(barRef, listRef);

  // The box grows with what you type (up to about six lines), then scrolls.
  useEffect(() => {
    const box = inputRef.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  }, [input]);

  // Enter adds a new line. Ctrl+Enter (Cmd+Enter on a Mac) sends, like the send button.
  // Tapping to type: jump the newest messages to just above the bar. iOS raises the keyboard over
  // a few hundred milliseconds, so jump again as it settles.
  const jumpToLatest = () => {
    const go = () => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; };
    go();
    setTimeout(go, 150);
    setTimeout(go, 400);
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSubmit = async (e: React.SubmitEvent) => {
    e.preventDefault();

    if (!input.trim() || !selectedModel || loading || loadingConversation) return;

    const userPrompt = input;
    setActiveQuery(getAdaptiveLoadingText(userPrompt));
    setInput('');
    setLoading(true);

    setMessages((prev) => [...prev, { role: 'user', content: userPrompt }]);

    try {
      const res = await fetch('/api/lumen/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          prompt: userPrompt,
          model: selectedModel,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Server error: ${res.status}`);
      }

      setConversationId(data.conversationId);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);

      refreshConversations();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      console.error('Chat submit error:', err);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${errorObj.message || 'Failed to fetch response.'}` },
      ]);
    } finally {
      setLoading(false);
      setActiveQuery('');
    }
  };

  return (
    <>
      <QueueNotice active={loading} />
      <div ref={listRef} className="messages-container">
        {messages.length === 0 && !loadingConversation && (
          <div className="messages-empty">
            <p className="messages-empty-subtitle">Select your model above and write a prompt to begin.</p>
          </div>
        )}
        {loadingConversation && (
          <div className="loading-container">
            <div className="loading-content">loading chat...</div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`message-item ${msg.role === 'user' ? 'user' : 'assistant'}`}>
            <div className={`message-content ${msg.role === 'user' ? 'user' : 'assistant'}`}>
              {/* This is the part that replaces {msg.content} */}
              {msg.role === 'assistant'
                ? splitContent(msg.content).map((seg, i) =>
                    seg.type === 'text' ? (
                      <MessageContent key={i} content={seg.text} />
                    ) : (
                      <DocumentCard
                        key={i}
                        title={seg.title}
                        onOpen={() => setOpenDoc({ title: seg.title, content: seg.content })}
                      />
                    ),
                  )
                : msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="loading-container">
            <div className="loading-content">{activeQuery}...</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div ref={barRef} className="input-container">
        <form ref={formRef} onSubmit={handleSubmit} className="input-form">
          <AppLauncher placement="up" />
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={jumpToLatest}
            placeholder="Type a prompt..."
            aria-label="Message"
            enterKeyHint="enter"
            autoComplete="off"
            className="input-field"
          />
          <button type="submit" disabled={loading} className="input-button send-button" aria-label="Ask">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </form>
      </div>

      {/* Side panel for an opened document */}
      {openDoc && (
        <DocumentPanel
          title={openDoc.title}
          content={openDoc.content}
          onClose={() => setOpenDoc(null)}
        />
      )}
    </>
  );
};

export default Chat;