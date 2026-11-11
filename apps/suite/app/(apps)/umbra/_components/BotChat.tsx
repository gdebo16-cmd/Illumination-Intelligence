'use client';

// /umbra/<id> — chatting with one bot. Tool steps appear live while the bot works.

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { flameColor } from '@/config/umbra';
import { MessageContent } from '@/components/MessageContent';
import QueueNotice from '@/components/QueueNotice';
import AppLauncher from '@/components/AppLauncher';
import { useBarHeight } from '@/hooks/use-bar-height';
import { canSeeImages } from '@/config/models';
import { MessagePhotos, PhotoButton, PhotoTray, releasePhotos, usePhotos } from '@/components/PhotoAttach';
import Flame from './Flame';
import { Steps } from './Steps';
import type { AgentStep, Bot, BotMessage } from './types';

export default function BotChat({ botId }: { botId: string }) {
  const [bot, setBot] = useState<Bot | null>(null);
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useBarHeight(barRef, listRef, Boolean(bot));
  // Photos can only be added when this bot's model can see images.
  const canSee = bot ? canSeeImages(bot.model) : false;
  const { photos, problem, add: addPhotos, remove: removePhoto, take: takePhotos, onPaste } = usePhotos(canSee);

  // Load the bot and its chat.
  useEffect(() => {
    Promise.all([fetch(`/api/umbra/bots/${botId}`), fetch(`/api/umbra/bots/${botId}/messages`)])
      .then(async ([botRes, msgRes]) => {
        if (!botRes.ok) throw new Error((await botRes.json()).error ?? 'Could not load this Flicker.');
        setBot(await botRes.json());
        if (msgRes.ok) setMessages(await msgRes.json());
      })
      .catch((err: Error) => setError(err.message));
  }, [botId]);

  // Keep the newest message in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking, liveSteps]);

  // A step started (new) or finished (replace the running version).
  const applyStep = (step: AgentStep) =>
    setLiveSteps((list) => (list.some((s) => s.id === step.id) ? list.map((s) => (s.id === step.id ? step : s)) : [...list, step]));

  // Tapping to type: jump the newest messages to just above the bar. iOS raises the keyboard over
  // a few hundred milliseconds, so jump again as it settles.
  const jumpToLatest = () => {
    const go = () => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; };
    go();
    setTimeout(go, 150);
    setTimeout(go, 400);
  };

  // The box grows with what you type (up to about six lines), then scrolls.
  useEffect(() => {
    const box = inputRef.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight + box.offsetHeight - box.clientHeight, 160)}px`;
  }, [input]);

  // Enter adds a new line. Ctrl+Enter (Cmd+Enter on a Mac) sends, like the send button.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      barRef.current?.requestSubmit();
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    // A photo can go on its own; otherwise there has to be something written.
    if ((!text && photos.length === 0) || thinking) return;
    const sending = takePhotos();
    setInput('');
    setError('');
    setLiveSteps([]);
    setThinking(true);
    // Show your message straight away (photos as local previews); the server's saved copy replaces it.
    const draft: BotMessage = { id: `draft-${Date.now()}`, role: 'user', content: text, createdAt: new Date().toISOString() };
    if (sending.length) draft.images = sending.map((p) => p.preview);
    setMessages((m) => [...m, draft]);

    try {
      let res: Response;
      if (sending.length) {
        // Photos go as a form, the way a browser uploads attachments.
        const form = new FormData();
        form.append('message', text);
        for (const photo of sending) form.append('image', photo.file);
        res = await fetch(`/api/umbra/bots/${botId}/chat`, { method: 'POST', body: form });
      } else {
        res = await fetch(`/api/umbra/bots/${botId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        });
      }
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? 'The Flicker could not reply.');

      // Read the stream line by line: each line is one event.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === 'sent') {
            setMessages((m) => m.map((x) => (x.id === draft.id ? event.message : x)));
            releasePhotos(sending); // the saved copies are shown now
          }
          else if (event.type === 'step') applyStep(event.step);
          else if (event.type === 'reply') setMessages((m) => [...m, event.message]);
          else if (event.type === 'error') setError(event.error);
        }
      }
    } catch (err) {
      setError((err as Error).message || 'The Flicker could not reply.');
    } finally {
      setThinking(false);
      setLiveSteps([]);
    }
  };

  const clearChat = async () => {
    if (!bot || !window.confirm(`Clear your whole chat with ${bot.name}? The Flicker itself stays.`)) return;
    const res = await fetch(`/api/umbra/bots/${botId}/messages`, { method: 'DELETE' });
    if (res.ok) setMessages([]);
  };

  if (!bot) {
    return (
      <main className="umbra">
        <div className="umbra-page">
          <Link href="/umbra" className="umbra-back">← Your Flickers</Link>
          {error ? <p className="umbra-error" role="alert">{error}</p> : <p className="umbra-muted">Waking your Flicker…</p>}
        </div>
      </main>
    );
  }

  const runningStep = liveSteps.find((s) => s.status === 'running');

  return (
    <main className="umbra umbra-chat" style={{ '--bot-color': flameColor(bot.flame) } as React.CSSProperties}>
      <QueueNotice active={thinking} />
      {/* Who you're talking to */}
      <div className="umbra-chat-bar">
        <Link href="/umbra" className="umbra-back" aria-label="Your Flickers">←</Link>
        <Flame flame={bot.flame} size={40} mood={thinking ? 'working' : 'idle'} />
        <div className="umbra-chat-who">
          <span className="umbra-chat-name">{bot.name}</span>
          {bot.purpose && <span className="umbra-chat-purpose">{bot.purpose}</span>}
        </div>
        <Link href={`/umbra/${bot.id}/tasks`} className="umbra-chat-action">Tasks</Link>
        <Link href={`/umbra/${bot.id}/edit`} className="umbra-chat-action">Edit</Link>
        <button type="button" className="umbra-chat-action" onClick={clearChat} disabled={messages.length === 0}>Clear</button>
      </div>

      {/* The conversation */}
      <div ref={listRef} className="umbra-messages">
        {messages.length === 0 && !thinking && (
          <div className="umbra-hello">
            <Flame flame={bot.flame} size={120} />
            <p>Say hi to {bot.name}.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`umbra-message ${m.role}`}>
            {m.role === 'assistant' && <Flame flame={bot.flame} size={32} still className="umbra-message-flame" />}
            <div className="umbra-bubble">
              {m.role === 'assistant' ? (
                <>
                  {m.steps && <Steps steps={m.steps} />}
                  <MessageContent content={m.content} />
                </>
              ) : (
                <>
                  <MessagePhotos images={m.images} withText={Boolean(m.content)} />
                  {m.content}
                </>
              )}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="umbra-message assistant">
            <Flame flame={bot.flame} size={32} mood="working" className="umbra-message-flame" />
            <div className="umbra-bubble">
              <Steps steps={liveSteps} />
              {/* A "Thinking" step already says what's happening, with the thinking itself. */}
              {runningStep?.tool !== 'thinking' && (
                <span className="umbra-thinking">
                  {runningStep ? `${runningStep.label}…` : `${bot.name} is thinking…`}
                </span>
              )}
            </div>
          </div>
        )}
        {error && <p className="umbra-error" role="alert">{error}</p>}
        <div ref={endRef} />
      </div>

      {/* Your message */}
      <form ref={barRef} className="umbra-input" onSubmit={send}>
        <PhotoTray photos={photos} problem={problem} onRemove={removePhoto} />
        <AppLauncher placement="up" />
        <span className={`umbra-field ${canSee ? 'has-photo-button' : ''}`}>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Message ${bot.name}…`}
            aria-label={`Message ${bot.name}`}
            enterKeyHint="enter"
            autoComplete="off"
            onFocus={jumpToLatest}
            onKeyDown={handleKeyDown}
            onPaste={onPaste}
            maxLength={4000}
          />
          {/* Only for bots whose model can see images */}
          {canSee && <PhotoButton onPick={addPhotos} disabled={thinking} />}
          <button type="submit" className="umbra-send" aria-label="Send" disabled={thinking || (!input.trim() && photos.length === 0)}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </span>
      </form>
    </main>
  );
}
