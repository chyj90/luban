import { useState, useRef, useEffect, useCallback } from 'react';
import { listToolGroups } from '@/api/tool';
import { useToastStore } from '@/stores/toastStore';
import type { ToolGroup } from '@/types/tool';
import './AgentChatPage.css';

const HISTORY_KEY = 'wenShu_chat_history';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: { name: string; result: string }[];
  timestamp: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
}

export default function AgentChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const list = sessions.length > 0 ? sessions[0].id : '';
    return list;
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [systems, setSystems] = useState<ToolGroup[]>([]);
  const [selectedSystemId, setSelectedSystemId] = useState<number | null>(null);
  const [showSystemPicker, setShowSystemPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const systemPickerRef = useRef<HTMLDivElement>(null);
  const toast = useToastStore((s) => s.add);

  useEffect(() => {
    listToolGroups().then((res) => {
      setSystems(res.data);
    }).catch(() => {
      toast('加载系统列表失败', 'error');
    });
  }, [toast]);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    const session = sessions.find((s) => s.id === activeSessionId);
    setMessages(session?.messages ?? []);
  }, [activeSessionId, sessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (systemPickerRef.current && !systemPickerRef.current.contains(e.target as Node)) {
        setShowSystemPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const syncSessions = useCallback((msgs: ChatMessage[], sessionId: string) => {
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === sessionId);
      const title = msgs.find((m) => m.role === 'user')?.content.slice(0, 40) ?? '新对话';
      const updated: ChatSession = {
        id: sessionId,
        title,
        messages: msgs,
        updatedAt: new Date().toISOString(),
      };
      if (idx === -1) {
        return [updated, ...prev];
      }
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
  }, []);

  const newChat = useCallback(() => {
    const id = Date.now().toString();
    setActiveSessionId(id);
    setMessages([]);
    setSelectedSystemId(null);
  }, []);

  const deleteSession = useCallback((e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      if (sessionId === activeSessionId) {
        const fallback = next[0];
        if (fallback) {
          setActiveSessionId(fallback.id);
        } else {
          setActiveSessionId('');
          setMessages([]);
        }
      }
      return next;
    });
  }, [activeSessionId]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return;
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setSending(true);

    const sessionId = activeSessionId || Date.now().toString();
    if (!activeSessionId) {
      setActiveSessionId(sessionId);
    }

    const assistantMsg: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    };
    const withAssistant = [...newMessages, assistantMsg];
    setMessages(withAssistant);
    syncSessions(withAssistant, sessionId);

    try {
      const response = await fetch('/api/v1/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: userMsg.content,
          systemId: selectedSystemId,
          availableSystems: systems.map((s) => ({ id: s.id, name: s.name, description: s.description })),
          history: newMessages.slice(-10).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      if (!response.ok) {
        throw new Error('请求失败');
      }
      const data = await response.json();
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === assistantMsg.id
            ? {
                ...m,
                content: data.answer ?? data.content ?? '返回了空响应',
                toolCalls: data.toolCalls,
              }
            : m,
        );
        syncSessions(updated, sessionId);
        return updated;
      });
    } catch {
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: '抱歉，请求失败，请稍后重试。' }
            : m,
        );
        syncSessions(updated, sessionId);
        return updated;
      });
    } finally {
      setSending(false);
    }
  }, [input, sending, activeSessionId, messages, selectedSystemId, systems, syncSessions]);

  const selectedSystem = systems.find((s) => s.id === selectedSystemId);

  return (
    <div className="agent-chat">
      <div className="agent-chat-sidebar">
        <button className="agent-chat-new-btn" onClick={newChat}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新对话
        </button>
        <div className="agent-chat-history-list">
          {sessions.length === 0 ? (
            <p className="agent-chat-history-empty">暂无历史对话</p>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                className={`agent-chat-history-item ${activeSessionId === s.id ? 'active' : ''}`}
                onClick={() => setActiveSessionId(s.id)}
              >
                <div className="agent-chat-history-item-main">
                  <span className="agent-chat-history-title">{s.title}</span>
                  <span className="agent-chat-history-time">
                    {new Date(s.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <button
                  className="agent-chat-history-delete"
                  onClick={(e) => deleteSession(e, s.id)}
                  title="删除对话"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="agent-chat-main">
        <div className="agent-chat-header">
          <h2 className="agent-chat-title">问数</h2>
          <div className="agent-chat-system-picker" ref={systemPickerRef}>
            <button
              className="agent-chat-system-trigger"
              onClick={() => setShowSystemPicker(!showSystemPicker)}
            >
              {selectedSystem ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                  </svg>
                  {selectedSystem.name}
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  自动选择系统
                </>
              )}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {showSystemPicker && (
              <div className="agent-chat-system-dropdown">
                <button
                  className={`agent-chat-system-option ${!selectedSystemId ? 'active' : ''}`}
                  onClick={() => { setSelectedSystemId(null); setShowSystemPicker(false); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  自动选择（AI 自行判断）
                </button>
                {systems.map((sys) => (
                  <button
                    key={sys.id}
                    className={`agent-chat-system-option ${selectedSystemId === sys.id ? 'active' : ''}`}
                    onClick={() => { setSelectedSystemId(sys.id); setShowSystemPicker(false); }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <ellipse cx="12" cy="5" rx="9" ry="3" />
                      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                    </svg>
                    {sys.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="agent-chat-messages">
          {messages.length === 0 ? (
            <div className="agent-chat-welcome">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <p>输入自然语言问题，AI 将自动调用工具查询</p>
              <div className="agent-chat-examples">
                <button onClick={() => setInput('查询最近7天的产量统计')}>查询最近7天的产量统计</button>
                <button onClick={() => setInput('设备CNC-001的当前状态是什么？')}>设备CNC-001的当前状态是什么？</button>
                <button onClick={() => setInput('今天有哪些设备异常？')}>今天有哪些设备异常？</button>
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`agent-chat-message ${msg.role}`}>
                <div className="agent-chat-message-avatar">
                  {msg.role === 'user' ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                    </svg>
                  )}
                </div>
                <div className="agent-chat-message-body">
                  <div className="agent-chat-message-content">{msg.content}</div>
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="agent-chat-tool-calls">
                      {msg.toolCalls.map((tc, i) => (
                        <div key={i} className="agent-chat-tool-call">
                          <div className="agent-chat-tool-call-header">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="16 3 21 3 21 8" />
                              <line x1="4" y1="20" x2="21" y2="3" />
                              <polyline points="21 16 21 21 16 21" />
                              <line x1="15" y1="15" x2="21" y2="21" />
                              <line x1="4" y1="4" x2="9" y2="9" />
                            </svg>
                            调用工具：{tc.name}
                          </div>
                          <pre className="agent-chat-tool-call-result">{tc.result}</pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="agent-chat-input-area">
          <div className="agent-chat-input-row">
            <input
              className="agent-chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="输入你的问题，如：查询今天的产量..."
              disabled={sending}
            />
            <button
              className="agent-chat-send-btn"
              onClick={handleSend}
              disabled={sending || !input.trim()}
            >
              {sending ? (
                <div className="agent-chat-spinner" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}