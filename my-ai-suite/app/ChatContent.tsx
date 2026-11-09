'use client';

import React, { useState, useEffect, useRef } from 'react';
import ModelSelect from './ModelSelect';

interface Message {
    role: 'user' | 'assistant';
    content: string;
  }

interface ConversationItem {
  id: string;
  title: string;
  updatedAt: string;
}

const Chat = () => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [activeQuery, setActiveQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [conversations, setConversations] = useState<ConversationItem[]>([]);
    const [selectedModel, setSelectedModel] = useState('');


const fetchConversations = async () => {
    try {
      const res = await fetch('/api/conversations');
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
    } catch (err) {
      console.error('Failed to load conversations list', err);
    }
  };

  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      fetchConversations();
    }
  }, []);

  const loadConversation = async (id: string) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/conversations/${id}`);
        if (res.ok) {
          const data = await res.json();
          setConversationId(id);
          setMessages(data.messages);
        }
    } catch (err) {
      console.error('Failed to load conversation messages', err);
    } finally {
      setLoading(false);
    }
  };

  const startNewChat = () => {
    setConversationId(null);
    setMessages([]);
  };

  const handleSubmit = async (e: React.SubmitEvent) => {
    e.preventDefault(); 
    
    if (!input.trim() || loading) return;
  
    const userPrompt = input;
    setActiveQuery(getAdaptiveLoadingText(userPrompt)); 
    setInput('');
    setLoading(true);
  
    setMessages((prev) => [...prev, { role: 'user', content: userPrompt }]);
  
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          prompt: userPrompt,
          model: ModelSelect,
        }),
      });
  
      const data = await res.json();
  
      if (!res.ok) {
        throw new Error(data.error || `Server error: ${res.status}`);
      }
  
      setConversationId(data.conversationId);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
      
      fetchConversations();
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

  const getAdaptiveLoadingText = (prompt: string): string => {
    const trimmed = prompt.trim().toLowerCase();
    
    // Check for common question starters or intents
    if (trimmed.startsWith('what') || trimmed.startsWith('how') || trimmed.startsWith('why') || trimmed.startsWith('can you')) {
      // If it's a question, turn "what is..." into "finding out..."
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

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

useEffect(() => {
  scrollToBottom();
}, [messages, loading]);

return (
    <>
        <div className="messages-container">
            {messages.length === 0 && (
                <div className="messages-empty">
                    <p className="messages-empty-subtitle">Select your model above and write a prompt to begin.</p>
                </div>
            )}
            {messages.map((msg, idx) => (
                <div key={idx} className={`message-item ${msg.role === 'user' ? 'user' : 'assistant'}`}>
                    <div className={`message-content ${msg.role === 'user' ? 'user' : 'assistant'}`}>
                        {msg.content}
                    </div>
                </div>
            ))}
            {loading && (
                <div className="loading-container">
                    <div className="loading-content">
                        {activeQuery}...
                    </div>
                </div>
            )}
            <div ref={messagesEndRef} />
        </div>
            <div className="input-container">
               <form onSubmit={handleSubmit} className="input-form">
                   <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => {
                       if (e.key === 'Enter') { e.preventDefault() }}} placeholder="Type a prompt..." className="input-field" />
                    <button type="submit" disabled={loading} className="input-button send-button">ask</button>
                </form>
            </div>
    </>
    );
}

export default Chat;