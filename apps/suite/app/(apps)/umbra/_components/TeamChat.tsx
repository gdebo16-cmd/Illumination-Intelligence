'use client';

// /umbra/teams/<id> — chatting with a team. You talk to the leader; while it works you see
// each teammate it asks, with that teammate's own tool steps underneath.

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { flameColor } from '@/config/umbra';
import { DocumentPanel, ReplyContent, type OpenDocument } from '@/components/documents';
import QueueNotice from '@/components/QueueNotice';
import AppLauncher from '@/components/AppLauncher';
import { useBarHeight } from '@/hooks/use-bar-height';
import Flame from './Flame';
import { Steps } from './Steps';
import type { AgentStep, BotMessage, Team } from './types';

export default function TeamChat({ teamId }: { teamId: string }) {
  const [team, setTeam] = useState<Team | null>(null);
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const [error, setError] = useState('');
  // A document from a reply, open in the side panel.
  const [openDoc, setOpenDoc] = useState<OpenDocument | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // A reply is on its way on the server but this page isn't streaming it (you left the app mid-reply).
  const [waiting, setWaiting] = useState(false);
  const streaming = useRef(false);
  useBarHeight(barRef, listRef, Boolean(team));

  useEffect(() => {
    Promise.all([fetch(`/api/umbra/teams/${teamId}`), fetch(`/api/umbra/teams/${teamId}/messages`)])
      .then(async ([teamRes, msgRes]) => {
        if (!teamRes.ok) throw new Error((await teamRes.json()).error ?? 'Could not load this team.');
        setTeam(await teamRes.json());
        if (msgRes.ok) {
          setMessages(await msgRes.json());
          readWork(msgRes);
        }
      })
      .catch((err: Error) => setError(err.message));
  }, [teamId]);

  // Coming back to the app: reload the saved chat, and keep checking while a reply is still coming.
  function readWork(res: Response) {
    const missed = res.headers.get('X-Umbra-Error');
    if (missed) setError(decodeURIComponent(missed));
    const busy = res.headers.get('X-Umbra-Busy') === '1';
    setWaiting(busy);
    setThinking(busy);
  }
  async function syncChat() {
    if (streaming.current) return;
    const res = await fetch(`/api/umbra/teams/${teamId}/messages`, { cache: 'no-store' }).catch(() => null);
    if (!res?.ok || streaming.current) return;
    setMessages(await res.json());
    readWork(res);
  }
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === 'visible') void syncChat();
    };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('pageshow', onShow);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('pageshow', onShow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void syncChat(), 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, teamId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking, liveSteps]);

  // A step started (new) or changed (a teammate made progress, or it finished).
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
    if (!text || thinking) return;
    setInput('');
    setError('');
    setLiveSteps([]);
    setThinking(true);
    streaming.current = true;
    let dropped = false;
    const draft: BotMessage = { id: `draft-${Date.now()}`, role: 'user', content: text, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, draft]);

    try {
      const res = await fetch(`/api/umbra/teams/${teamId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? 'The team could not reply.');

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
      // A TypeError here means the connection dropped (you left the app). The reply is still being
      // made on the server, so wait for it instead of showing an error.
      if (err instanceof TypeError) dropped = true;
      else setError((err as Error).message || 'The team could not reply.');
    } finally {
      streaming.current = false;
      setLiveSteps([]);
      if (dropped) void syncChat();
      else setThinking(false);
    }
  };

  const clearChat = async () => {
    if (!team || !window.confirm(`Clear the whole chat with ${team.name}? The team stays.`)) return;
    const res = await fetch(`/api/umbra/teams/${teamId}/messages`, { method: 'DELETE' });
    if (res.ok) setMessages([]);
  };

  if (!team) {
    return (
      <main className="umbra">
        <div className="umbra-page">
          <Link href="/umbra" className="umbra-back">← Your Flickers</Link>
          {error ? <p className="umbra-error" role="alert">{error}</p> : <p className="umbra-muted">Gathering the team…</p>}
        </div>
      </main>
    );
  }

  const leader = team.leader;
  // What's happening right now: the deepest running step (a teammate's tool, if one is busy).
  // Also which teammates are busy right now, so their flames can show it.
  const busyMates = new Set<string>();
  const running = (() => {
    let found: AgentStep | undefined;
    const walk = (list: AgentStep[]) => list.forEach((s) => {
      if (s.status === 'running') {
        found = s;
        if (s.bot) busyMates.add(s.bot.id);
      }
      if (s.children) walk(s.children);
    });
    walk(liveSteps);
    return found;
  })();

  return (
    <main className="umbra umbra-chat" style={{ '--bot-color': flameColor(leader.flame) } as React.CSSProperties}>
      <QueueNotice active={thinking} />
      <div className="umbra-chat-bar">
        <Link href="/umbra" className="umbra-back" aria-label="Your Flickers">←</Link>
        <div className="umbra-team-flames" aria-hidden>
          <Flame flame={leader.flame} size={40} mood={thinking ? 'working' : 'idle'} />
          {team.crew.slice(0, 3).map((c) => (
            <Flame key={c.bot.id} flame={c.bot.flame} size={26} still mood={busyMates.has(c.bot.id) ? 'working' : 'idle'} />
          ))}
        </div>
        <div className="umbra-chat-who">
          <span className="umbra-chat-name">{team.name}</span>
          <span className="umbra-chat-purpose">
            Led by {leader.name} · with {team.crew.map((c) => (c.role ? `${c.bot.name} (${c.role})` : c.bot.name)).join(', ')}
          </span>
        </div>
        <Link href={`/umbra/teams/${team.id}/tasks`} className="umbra-chat-action">Tasks</Link>
        <Link href={`/umbra/teams/${team.id}/edit`} className="umbra-chat-action">Edit</Link>
        <Link href={`/umbra/artifacts?source=${team.id}`} className="umbra-chat-action umbra-chat-artifacts" aria-label="Artifacts" title="Artifacts">
          <span className="umbra-chat-artifacts-icon" aria-hidden>📄</span>
          <span className="umbra-chat-artifacts-label">Artifacts</span>
        </Link>
        <button type="button" className="umbra-chat-action" onClick={clearChat} disabled={messages.length === 0}>Clear</button>
      </div>

      <div ref={listRef} className="umbra-messages">
        {messages.length === 0 && !thinking && (
          <div className="umbra-hello umbra-team-hello">
            <div className="umbra-team-flames">
              <Flame flame={leader.flame} size={110} />
              {team.crew.map((c) => <Flame key={c.bot.id} flame={c.bot.flame} size={70} />)}
            </div>
            <p>Give {team.name} a job. {leader.name} will split it up and bring you the result.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`umbra-message ${m.role}`}>
            {m.role === 'assistant' && <Flame flame={leader.flame} size={32} still className="umbra-message-flame" />}
            <div className="umbra-bubble">
              {m.role === 'assistant' ? (
                <>
                  {m.steps && <Steps steps={m.steps} />}
                  <ReplyContent content={m.content} onOpen={setOpenDoc} />
                </>
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="umbra-message assistant">
            <Flame flame={leader.flame} size={32} mood="working" className="umbra-message-flame" />
            <div className="umbra-bubble">
              <Steps steps={liveSteps} />
              {/* A "Thinking" step already says what's happening, with the thinking itself. */}
              {running?.tool !== 'thinking' && (
                <span className="umbra-thinking">{running ? `${running.label}…` : `${leader.name} is thinking…`}</span>
              )}
            </div>
          </div>
        )}
        {error && <p className="umbra-error" role="alert">{error}</p>}
        <div ref={endRef} />
      </div>

      <form ref={barRef} className="umbra-input" onSubmit={send}>
        <AppLauncher placement="up" />
        <span className="umbra-field">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Give ${team.name} a job…`}
            aria-label={`Message ${team.name}`}
            enterKeyHint="enter"
            autoComplete="off"
            onFocus={jumpToLatest}
            onKeyDown={handleKeyDown}
            maxLength={4000}
          />
          <button type="submit" className="umbra-send" aria-label="Send" disabled={thinking || !input.trim()}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </span>
      </form>
      {openDoc && <DocumentPanel {...openDoc} onClose={() => setOpenDoc(null)} />}
    </main>
  );
}
