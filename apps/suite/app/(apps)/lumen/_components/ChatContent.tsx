'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useChat, type Message } from './ChatContext';
import QueueNotice from '@/components/QueueNotice';
import AppLauncher from '@/components/AppLauncher';
import { useBarHeight } from '@/hooks/use-bar-height';
import { canSeeImages } from '@/config/models';
import { MessagePhotos, PhotoButton, PhotoTray, releasePhotos, usePhotos } from '@/components/PhotoAttach';
import { ReplyContent, DocumentPanel, documentVersions } from '@/components/documents';

// Shown while Lumen works on a prompt that doesn't fit a more specific line. One is picked per message.
const LIGHT_PHRASES = [
  'shedding some light',
  'letting it dawn',
  'bringing it into focus',
  'chasing a spark',
  'warming up the filament',
  'connecting the bright dots',
  'waiting for the lightbulb moment',
  'turning up the glow',
];

const getAdaptiveLoadingText =(prompt: string): string => {
  const trimmed = prompt.trim().toLowerCase();
  if (!trimmed) return 'looking at your photo';

  if (trimmed.startsWith('what') || trimmed.startsWith('how') || trimmed.startsWith('why') || trimmed.startsWith('can you')) {
    return `shedding light on ${prompt.trim().replace(/^(what is|what's|how to|how do i|can you)\s*/i, '').replace(/[?.!\s]+$/, '')}`;
  }

  if (trimmed.startsWith('write') || trimmed.startsWith('draft') || trimmed.startsWith('create')) {
    return `drafting ${prompt.replace(/^(write a|write|draft a|draft|create a|create)\s*/i, '')}`;
  }

  if (trimmed.startsWith('code') || trimmed.startsWith('build') || trimmed.startsWith('fix')) {
    return `building ${prompt.replace(/^(code a|code|build a|build|fix)\s*/i, '')}`;
  }

  return LIGHT_PHRASES[Math.floor(Math.random() * LIGHT_PHRASES.length)];
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
    refreshArtifacts,
    openDoc,
    setOpenDoc,
  } = useChat();

  const [input, setInput] = useState('');
  // Every version of each document in this chat, so a revised one can be stepped through.
  const versions = useMemo(() => documentVersions(messages.filter((m) => m.role === 'assistant').map((m) => m.content)), [messages]);
  const [activeQuery, setActiveQuery] = useState('');
  const [loading, setLoading] = useState(false);
  // Photos can only be added while the chosen model can see images.
  const canSee = canSeeImages(selectedModel);
  const { photos, problem, add: addPhotos, remove: removePhoto, take: takePhotos, onPaste } = usePhotos(canSee);

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
    box.style.height = `${Math.min(box.scrollHeight + box.offsetHeight - box.clientHeight, 160)}px`;
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

    // A photo can go on its own; otherwise there has to be something written.
    if ((!input.trim() && photos.length === 0) || !selectedModel || loading || loadingConversation) return;

    const userPrompt = input;
    const sending = takePhotos();
    setActiveQuery(getAdaptiveLoadingText(userPrompt));
    setInput('');
    setLoading(true);

    // Show the message straight away, with the photos' local previews.
    const mine: Message = { role: 'user', content: userPrompt };
    if (sending.length) mine.images = sending.map((p) => p.preview);
    setMessages((prev) => [...prev, mine]);

    try {
      let res: Response;
      if (sending.length) {
        // Photos go as a form, the way a browser uploads attachments.
        const form = new FormData();
        if (conversationId) form.append('conversationId', conversationId);
        form.append('prompt', userPrompt);
        form.append('model', selectedModel);
        for (const photo of sending) form.append('image', photo.file);
        res = await fetch('/api/lumen/chat', { method: 'POST', body: form });
      } else {
        res = await fetch('/api/lumen/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId,
            prompt: userPrompt,
            model: selectedModel,
          }),
        });
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Server error: ${res.status}`);
      }

      setConversationId(data.conversationId);
      // The photos are saved now: point the message at the saved copies and free the previews.
      const saved: string[] = Array.isArray(data.images) ? data.images : [];
      setMessages((prev) => [
        ...prev.map((m) => (m === mine && saved.length ? { ...m, images: saved } : m)),
        { role: 'assistant' as const, content: data.reply },
      ]);
      if (saved.length) releasePhotos(sending);

      refreshConversations();
      // The reply wrote a document: show it in the sidebar's Artifacts list.
      if (data.artifacts > 0) void refreshArtifacts();
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
              {/* A reply's documents show as cards that open in the side panel. */}
              {msg.role === 'assistant'
                ? <ReplyContent content={msg.content} onOpen={setOpenDoc} versions={versions} open={openDoc} />
                : (
                  <>
                    <MessagePhotos images={msg.images} withText={Boolean(msg.content.trim())} />
                    {msg.content}
                  </>
                )}
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
        <PhotoTray photos={photos} problem={problem} onRemove={removePhoto} />
        <form ref={formRef} onSubmit={handleSubmit} className={`input-form ${canSee ? 'has-photo-button' : ''}`}>
          <AppLauncher placement="up" />
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={jumpToLatest}
            onPaste={onPaste}
            placeholder="Type a prompt..."
            aria-label="Message"
            enterKeyHint="enter"
            autoComplete="off"
            className="input-field"
          />
          {/* Only for models that can see images */}
          {canSee && <PhotoButton onPick={addPhotos} disabled={loading} />}
          <button type="submit" disabled={loading} className="input-button send-button" aria-label="Ask">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </form>
      </div>

      {/* Side panel for an opened document */}
      {openDoc && (
        <DocumentPanel {...openDoc} onClose={() => setOpenDoc(null)} />
      )}
    </>
  );
};

export default Chat;
