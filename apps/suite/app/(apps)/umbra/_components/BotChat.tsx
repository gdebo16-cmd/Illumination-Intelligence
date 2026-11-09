'use client';

// /umbra/<id> — chatting with one bot.

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { flameColor } from '@/config/umbra';
import { MessageContent } from '@/components/MessageContent';
import Flame from './Flame';
import type { Bot, BotMessage } from './types';

export default function BotChat({ botId }: { botId: string }) {
  const [bot, setBot] = useState<Bot | null>(null);
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  // Load the bot and its chat.
  useEffect(() => {
    Promise.all([fetch(`/api/umbra/bots/${botId}`), fetch(`/api/umbra/bots/${botId}/messages`)])
      .then(async ([botRes, msgRes]) => {
        if (!botRes.ok) throw new Error((await botRes.json()).error ?? 'Could not load this bot.');
        setBot(await botRes.json());
        if (msgRes.ok) setMessages(await msgRes.json());
      })
      .catch((err: Error) => setError(err.message));
  }, [botId]);

  // Keep the newest message in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || thinking) return;
    setInput('');
    setError('');
    setThinking(true);
    // Show your message straight away; the server's saved copy replaces it below.
    const draft: BotMessage = { id: `draft-${Date.now()}`, role: 'user', content: text, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, draft]);
    try {
      const res = await fetch(`/api/umbra/bots/${botId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      setMessages((m) => m.map((x) => (x.id === draft.id && data.sent ? data.sent : x)));
      if (!res.ok) throw new Error(data.error ?? 'The bot could not reply.');
      setMessages((m) => [...m, data.reply]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setThinking(false);
    }
  };

  const clearChat = async () => {
    if (!bot || !window.confirm(`Clear your whole chat with ${bot.name}? The bot itself stays.`)) return;
    const res = await fetch(`/api/umbra/bots/${botId}/messages`, { method: 'DELETE' });
    if (res.ok) setMessages([]);
  };

  if (!bot) {
    return (
      <main className="umbra">
        <div className="umbra-page">
          <Link href="/umbra" className="umbra-back">← Your bots</Link>
          {error ? <p className="umbra-error" role="alert">{error}</p> : <p className="umbra-muted">Waking your bot…</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="umbra umbra-chat" style={{ '--bot-color': flameColor(bot.flame) } as React.CSSProperties}>
      {/* Who you're talking to */}
      <div className="umbra-chat-bar">
        <Link href="/umbra" className="umbra-back" aria-label="Your bots">←</Link>
        <Flame flame={bot.flame} size={40} />
        <div className="umbra-chat-who">
          <span className="umbra-chat-name">{bot.name}</span>
          {bot.purpose && <span className="umbra-chat-purpose">{bot.purpose}</span>}
        </div>
        <Link href={`/umbra/${bot.id}/edit`} className="umbra-chat-action">Edit</Link>
        <button type="button" className="umbra-chat-action" onClick={clearChat} disabled={messages.length === 0}>Clear</button>
      </div>

      {/* The conversation */}
      <div className="umbra-messages">
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
              {m.role === 'assistant' ? <MessageContent content={m.content} /> : m.content}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="umbra-message assistant">
            <Flame flame={bot.flame} size={32} className="umbra-message-flame" />
            <div className="umbra-bubble umbra-thinking">{bot.name} is thinking…</div>
          </div>
        )}
        {error && <p className="umbra-error" role="alert">{error}</p>}
        <div ref={endRef} />
      </div>

      {/* Your message */}
      <form className="umbra-input" onSubmit={send}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Message ${bot.name}…`}
          aria-label={`Message ${bot.name}`}
          enterKeyHint="send"
          autoComplete="off"
          maxLength={4000}
        />
        <button type="submit" disabled={thinking || !input.trim()}>Send</button>
      </form>
    </main>
  );
}
