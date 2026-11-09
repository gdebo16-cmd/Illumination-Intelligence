'use client';

// /umbra/<id> — chatting with one bot. Tool steps appear live while the bot works.

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { flameColor } from '@/config/umbra';
import { MessageContent } from '@/components/MessageContent';
import Flame from './Flame';
import type { AgentStep, Bot, BotMessage } from './types';

// The tool steps behind a reply: what the bot did, with links and pictures.
function Steps({ steps }: { steps: AgentStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="umbra-steps">
      {steps.map((step) => (
        <li key={step.id} className={`umbra-step is-${step.status}`}>
          <span className="umbra-step-mark" aria-hidden>
            {step.status === 'running' ? '' : step.status === 'done' ? '✓' : '!'}
          </span>
          <span className="umbra-step-body">
            <span className="umbra-step-label">{step.label}</span>
            {step.summary && step.status !== 'running' && <span className="umbra-step-summary">{step.summary}</span>}
            {step.links && step.links.length > 0 && (
              <span className="umbra-step-links">
                {step.links.slice(0, 5).map((link) => (
                  <a key={link.url} href={link.url} target="_blank" rel="noreferrer noopener" title={link.url}>
                    {link.title}
                  </a>
                ))}
              </span>
            )}
            {step.image && (
              <a href={step.image.url} target="_blank" rel="noreferrer" className="umbra-step-image">
                {/* eslint-disable-next-line @next/next/no-img-element -- a picture Prism made, served by our own API */}
                <img src={step.image.url} alt={step.image.prompt} loading="lazy" />
              </a>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function BotChat({ botId }: { botId: string }) {
  const [bot, setBot] = useState<Bot | null>(null);
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
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
  }, [messages, thinking, liveSteps]);

  // A step started (new) or finished (replace the running version).
  const applyStep = (step: AgentStep) =>
    setLiveSteps((list) => (list.some((s) => s.id === step.id) ? list.map((s) => (s.id === step.id ? step : s)) : [...list, step]));

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || thinking) return;
    setInput('');
    setError('');
    setLiveSteps([]);
    setThinking(true);
    // Show your message straight away; the server's saved copy replaces it.
    const draft: BotMessage = { id: `draft-${Date.now()}`, role: 'user', content: text, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, draft]);

    try {
      const res = await fetch(`/api/umbra/bots/${botId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? 'The bot could not reply.');

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
          if (event.type === 'sent') setMessages((m) => m.map((x) => (x.id === draft.id ? event.message : x)));
          else if (event.type === 'step') applyStep(event.step);
          else if (event.type === 'reply') setMessages((m) => [...m, event.message]);
          else if (event.type === 'error') setError(event.error);
        }
      }
    } catch (err) {
      setError((err as Error).message || 'The bot could not reply.');
    } finally {
      setThinking(false);
      setLiveSteps([]);
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

  const runningStep = liveSteps.find((s) => s.status === 'running');

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
              {m.role === 'assistant' ? (
                <>
                  {m.steps && <Steps steps={m.steps} />}
                  <MessageContent content={m.content} />
                </>
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="umbra-message assistant">
            <Flame flame={bot.flame} size={32} className="umbra-message-flame" />
            <div className="umbra-bubble">
              <Steps steps={liveSteps} />
              <span className="umbra-thinking">
                {runningStep ? `${runningStep.label}…` : `${bot.name} is thinking…`}
              </span>
            </div>
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
