import { useState, useRef, useEffect, useCallback, Fragment } from 'react';
import { flushSync } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fetchAgentChatStream, getSessionMessages, clearChatSession } from '@/api/agent';
import { quickConceptFeedback, listConcepts, listConceptFeedback } from '@/api/concept';
import { useToastStore } from '@/stores/toastStore';
import { useAuthStore } from '@/stores/authStore';
import { fixMarkdownTable } from '@/lib/markdown';
import ConceptTracePanel from '@/components/ConceptTracePanel';
import './AgentChatPage.css';

const HISTORY_KEY = 'wenShu_chat_history';

interface ConceptTraceItem {
  type?: string;
  conceptId?: number;
  conceptName?: string;
  domain?: string;
  confidence?: number;
  depth?: number;
  conceptCount?: number;
  sampleConcepts?: string;
  attributes?: {
    name: string;
    propertyName: string;
    tableName: string;
    columnName: string;
    value?: string;
  }[];
  mappings?: {
    tableName: string;
    columnName: string;
    mappingType: string;
  }[];
  joins?: {
    joinType: string;
    joinTable: string;
    joinCondition: string;
  }[];
  pipeline?: {
    faiss?: {
      matched: boolean;
      concepts?: { conceptId: number; conceptName: string; confidence?: number }[];
    };
    ontology?: {
      expanded: boolean;
      concepts?: { conceptId: number; conceptName: string; depth?: number }[];
    };
    submitted?: {
      conceptCount?: number;
      toolCount?: number;
      tools?: { name: string; description: string }[];
      tableMappingCount?: number;
      tableMappings?: { tableName: string; columnName: string; mappingType: string }[];
      joinMappingCount?: number;
      joinMappings?: { joinType: string; joinTable: string; joinCondition: string }[];
    };
  };
}

interface Nl2sqlInfo {
  sql: string;
  conceptIds: number[];
}

interface QueryResult {
  executed: boolean;
  data?: Record<string, unknown>[];
  rowCount?: number;
  truncated?: boolean;
  columnNames?: string[];
  error?: string;
}

interface DrillDimension {
  conceptId: number;
  dimension: string;
  round: number;
  sql?: string;
  status: 'pending' | 'executing' | 'done';
}

interface OntologyChangeItem {
  changeId: string;
  operation: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reasoning: string;
  impact: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

interface OntologyChangeEvent {
  changes: OntologyChangeItem[];
  reasoning: string;
  trigger: 'user_request' | 'auto_detect';
}

interface RootCauseEvidence {
  round: number;
  finding: string;
  sql?: string;
  anomaly?: boolean;
}

interface DatasourceInfo {
  id: number;
  name: string;
  type: string;
  slug: string;
  tables: { name: string; columns: string[] }[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  isStreaming?: boolean;
  toolCalls?: { name: string; result: string }[];
  conceptTrace?: ConceptTraceItem[];
  reasoning?: string;
  thinking?: string;
  nl2sql?: Nl2sqlInfo;
  queryResult?: QueryResult;
  usedConcepts?: { conceptId: number; conceptName: string }[];
  messageId?: string;
  drillDimensions?: DrillDimension[];
  ontologyChanges?: OntologyChangeEvent;
  rootCause?: {
    reasoning: string;
    root_cause: string;
    evidence: RootCauseEvidence[];
    suggestion: string;
  };
  selectDatasources?: DatasourceInfo[];
  timestamp: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
}

function parseRootCause(content: string | undefined): ChatMessage['rootCause'] {
  if (!content) return undefined;
  try {
    const jsonMatch = content.match(/\{[\s\S]*"answer_type"\s*:\s*"root_cause"[\s\S]*\}/);
    if (!jsonMatch) return undefined;
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.answer_type === 'root_cause' && parsed.root_cause) {
      return {
        reasoning: parsed.reasoning || '',
        root_cause: parsed.root_cause || '',
        evidence: parsed.evidence || [],
        suggestion: parsed.suggestion || '',
      };
    }
  } catch { /* ignore */ }
  return undefined;
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
  const [expandedSection, setExpandedSection] = useState<Record<string, string | null>>({});
  const [feedbackState, setFeedbackState] = useState<Record<string, 'idle' | 'like_dislike' | 'dislike_form' | 'submitted'>>({});
  const [dislikeComment, setDislikeComment] = useState('');
  const [dislikeConceptSearch, setDislikeConceptSearch] = useState('');
  const [dislikeSelectedConcept, setDislikeSelectedConcept] = useState<{ id: number; name: string } | null>(null);
  const [dislikeConcepts, setDislikeConcepts] = useState<{ id: number; name: string }[]>([]);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [selectedDatasources, setSelectedDatasources] = useState<Record<number, Set<string>>>({});
  const [expandedDatasources, setExpandedDatasources] = useState<Set<number>>(new Set());
  const [confirmedDatasources, setConfirmedDatasources] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const skipFetchRef = useRef(false);
  const toast = useToastStore((s) => s.show);
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.superAdmin === true;

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    if (skipFetchRef.current) {
      skipFetchRef.current = false;
      return;
    }
    getSessionMessages(activeSessionId).then(res => {
      const msgs = ((res as any).messages || []).map((item: any) => ({
        id: item.id || item.messageId || '',
        role: item.role,
        content: item.content,
        messageId: item.messageId,
        reasoning: item.reasoning,
        nl2sql: item.nl2sql,
        conceptTrace: item.conceptTrace,
        selectDatasources: item.selectDatasources,
        timestamp: item.timestamp,
      })) as ChatMessage[];
      setMessages(msgs);
    }).catch(() => {
      setMessages([]);
    });
  }, [activeSessionId]);

  useEffect(() => {
    const confirmed = new Set<string>();
    const restoredSelections: Record<number, Set<string>> = {};
    messages.forEach((msg, i) => {
      if (msg.role === 'assistant' && msg.selectDatasources?.length) {
        const nextMsg = messages[i + 1];
        if (nextMsg?.role === 'user' && nextMsg.content.startsWith('已选择数据源:')) {
          confirmed.add(msg.id);
          const lines = nextMsg.content.split('\n').slice(1);
          for (const line of lines) {
            const match = line.match(/^\s*-\s+(.+?)\s+\[表:\s*(.+?)\]$/);
            if (match) {
              const dsName = match[1].trim();
              const tablesStr = match[2].trim();
              const tables = tablesStr.split(/\s*,\s*/).map((t) => t.trim()).filter(Boolean);
              const dsInfo = msg.selectDatasources!.find((ds) => ds.name === dsName);
              if (dsInfo && tables.length > 0) {
                restoredSelections[dsInfo.id] = new Set(tables);
              }
            }
          }
        }
      }
    });
    if (confirmed.size > 0) {
      setConfirmedDatasources((prev) => {
        const merged = new Set(prev);
        let changed = false;
        confirmed.forEach((id) => {
          if (!merged.has(id)) { merged.add(id); changed = true; }
        });
        return changed ? merged : prev;
      });
    }
    if (Object.keys(restoredSelections).length > 0) {
      setSelectedDatasources((prev) => {
        const hasChanges = Object.entries(restoredSelections).some(([id, tables]) => {
          const existing = prev[Number(id)];
          if (!existing || existing.size !== tables.size) return true;
          return !Array.from(tables).every((t) => existing.has(t));
        });
        if (!hasChanges) return prev;
        return { ...prev, ...restoredSelections };
      });
    }
  }, [messages]);

  useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;
    listConceptFeedback(activeSessionId).then(res => {
      if (cancelled) return;
      setFeedbackState(prev => {
      const next = { ...prev };
      (res.data || []).forEach(fb => {
        if (fb.messageId && !next[fb.messageId]) next[fb.messageId] = 'submitted';
      });
      return next;
    });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeSessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
  }, []);

  const copyDebugInfo = useCallback(() => {
    const lines: string[] = [];
    lines.push('=== LLM 输入输出 ===');
    lines.push(`会话ID: ${activeSessionId}`);
    lines.push(`消息数: ${messages.length}`);
    lines.push('');

    messages.forEach((msg, idx) => {
      lines.push(`--- 第 ${idx + 1} 轮 [${msg.role}] ---`);

      if (msg.role === 'user') {
        lines.push(`[用户问题]`);
        lines.push(msg.content);
        lines.push('');
        return;
      }

      const pipeline = msg.conceptTrace?.find(t => t.type === 'pipeline')?.pipeline;
      if (pipeline?.submitted?.concepts && pipeline.submitted.concepts.length > 0) {
        lines.push(`[提交给 LLM 的概念]`);
        const conceptNames = pipeline.submitted.concepts.map((c: { conceptName: string }) => c.conceptName);
        lines.push(conceptNames.join(', '));
        lines.push(`表映射: ${pipeline.submitted.tableCount ?? '?'} 个`);
        lines.push('');
      }

      if (msg.reasoning) {
        lines.push(`[LLM 思考]`);
        lines.push(msg.reasoning);
        lines.push('');
      }

      if (msg.thinking) {
        lines.push(`[LLM 流式输出]`);
        lines.push(msg.thinking);
        lines.push('');
      }

      if (msg.nl2sql) {
        lines.push(`[SQL]`);
        lines.push(msg.nl2sql.sql);
        if (msg.queryResult) {
          lines.push(`查询结果: ${msg.queryResult.rowCount ?? 0} 行`);
          if (msg.queryResult.error) {
            lines.push(`错误: ${msg.queryResult.error}`);
          }
        }
        lines.push('');
      }

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        msg.toolCalls.forEach((tc, i) => {
          lines.push(`[工具调用 #${i + 1}: ${tc.name}]`);
          lines.push(tc.result);
          lines.push('');
        });
      }

      lines.push(`[LLM 回复]`);
      lines.push(msg.content);
      lines.push('');
    });

    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      toast('已复制到剪贴板', 'success');
    }).catch(() => {
      toast('复制失败', 'error');
    });
  }, [messages, activeSessionId, toast]);

  const deleteSession = useCallback((e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    clearChatSession(sessionId).catch(() => {});
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

  const handleSelectDatasourcesConfirm = (datasources: DatasourceInfo[], msgId: string) => {
    const selection = datasources
      .filter((ds) => {
        const sel = selectedDatasources[ds.id];
        return sel && sel.size > 0;
      })
      .map((ds) => ({
        id: ds.id,
        name: ds.name,
        tables: Array.from(selectedDatasources[ds.id]),
      }));
    if (selection.length === 0) {
      toast('请至少选择一个数据源', 'error');
      return;
    }
    setConfirmedDatasources((prev) => new Set(prev).add(msgId));
    const msg = '已选择数据源:\n' + selection.map((s) =>
      '  - ' + s.name + ' [表: ' + s.tables.join(', ') + ']'
    ).join('\n');
    handleSend(msg);
  };

  const handleSend = useCallback(async (message?: string) => {
    const text = (message ?? input).trim();
    if (!text || sending) return;
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setSending(true);

    const sessionId = activeSessionId || Date.now().toString();
    if (!activeSessionId) {
      skipFetchRef.current = true;
      setActiveSessionId(sessionId);
    }

    const assistantMsg: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '思考中...',
      isStreaming: true,
      timestamp: new Date().toISOString(),
    };
    const withAssistant = [...newMessages, assistantMsg];
    setMessages(withAssistant);
    syncSessions(withAssistant, sessionId);

    let streamContent = '';
    let streamToolCalls: ChatMessage['toolCalls'] = undefined;
    let streamConceptTrace: ChatMessage['conceptTrace'] = undefined;
    let streamReasoning: string | undefined;
    let streamThinking: string | undefined;
    let streamNl2sql: ChatMessage['nl2sql'] = undefined;
    let streamQueryResult: ChatMessage['queryResult'] = undefined;
    let streamUsedConcepts: ChatMessage['usedConcepts'] = undefined;
    let streamDrillDimensions: ChatMessage['drillDimensions'] = undefined;
    let streamOntologyChanges: ChatMessage['ontologyChanges'] = undefined;
    let streamSelectDatasources: ChatMessage['selectDatasources'] = undefined;
    let streamMessageId: string | undefined;
    let isFirstDelta = true;

    const updateAssistant = () => {
      flushSync(() => {
        setMessages((prev) => {
          const updated = prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  content: streamContent || '思考中...',
                  toolCalls: streamToolCalls,
                  conceptTrace: streamConceptTrace,
                  reasoning: streamReasoning,
                  thinking: streamThinking,
                  nl2sql: streamNl2sql,
                  queryResult: streamQueryResult,
                  usedConcepts: streamUsedConcepts,
                  messageId: streamMessageId,
                  selectDatasources: streamSelectDatasources,
                }
              : m,
          );
          return updated;
        });
      });
    };

    fetchAgentChatStream(
      {
        sessionId,
        message: userMsg.content,
        history: newMessages.slice(-10).map((m) => ({
          role: m.role,
          content: m.content,
        })),
      },
      (event, data) => {
        try {
          switch (event) {
            case 'concept_trace':
              streamConceptTrace = JSON.parse(data);
              break;
            case 'thinking':
              streamContent = '正在分析您的问题...';
              break;
            case 'progress':
              streamContent = data;
              isFirstDelta = true;
              break;
            case 'reasoning':
              streamReasoning = (streamReasoning || '') + data;
              break;
            case 'llm_chunk':
              streamThinking = (streamThinking || '') + data;
              break;
            case 'tool_calls':
              streamToolCalls = JSON.parse(data);
              break;
            case 'nl2sql':
              streamNl2sql = JSON.parse(data);
              break;
            case 'query_result':
              streamQueryResult = JSON.parse(data);
              break;
            case 'used_concepts':
              streamUsedConcepts = JSON.parse(data);
              break;
            case 'drill_dimension':
              try {
                const drill = JSON.parse(data);
                streamDrillDimensions = [...(streamDrillDimensions || []), drill];
              } catch { /* ignore */ }
              break;
            case 'ontology_change':
              try {
                streamOntologyChanges = JSON.parse(data);
              } catch { /* ignore */ }
              break;
            case 'select_datasources':
              try {
                streamSelectDatasources = JSON.parse(data);
              } catch { /* ignore */ }
              break;
            case 'delta':
              if (isFirstDelta) {
                streamContent = data;
                isFirstDelta = false;
              } else {
                streamContent += data;
              }
              break;
            case 'done': {
              const doneData = JSON.parse(data);
              streamMessageId = doneData.messageId;
              break;
            }
          }
          updateAssistant();
        } catch {
          // ignore parse errors for streaming chunks
        }
      },
      (error) => {
        setMessages((prev) => {
          const updated = prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: `抱歉，请求失败：${error}`, isStreaming: false }
              : m,
          );
          syncSessions(updated, sessionId);
          return updated;
        });
        setSending(false);
      },
      () => {
        setMessages((prev) => {
          const updated = prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  content: streamContent || '返回了空响应',
                  isStreaming: false,
                  toolCalls: streamToolCalls,
                  conceptTrace: streamConceptTrace,
                  reasoning: streamReasoning,
                  thinking: streamThinking,
                  nl2sql: streamNl2sql,
                  queryResult: streamQueryResult,
                  usedConcepts: streamUsedConcepts,
                  drillDimensions: streamDrillDimensions,
                  ontologyChanges: streamOntologyChanges,
                  rootCause: parseRootCause(streamContent),
                  messageId: streamMessageId,
                  selectDatasources: streamSelectDatasources,
                }
              : m,
          );
          syncSessions(updated, sessionId);
          return updated;
        });
        setSending(false);
      },
    );
  }, [input, sending, activeSessionId, messages, syncSessions]);

  const handleLike = useCallback(async (msg: ChatMessage) => {
    const msgId = msg.messageId || msg.id;
    setFeedbackState(prev => ({ ...prev, [msgId]: 'submitted' }));
    const msgIndex = messages.findIndex(m => m.id === msg.id);
    const userQuestion = msgIndex > 0 ? messages[msgIndex - 1].content : '';
    try {
      await quickConceptFeedback({
        sessionId: activeSessionId,
        messageId: msgId,
        feedbackType: 'like',
        userQuestion: userQuestion,
        answer: msg.content,
        faissConcepts: msg.conceptTrace?.find(t => t.type === 'pipeline')?.pipeline?.faiss?.concepts,
        ontologyConcepts: msg.conceptTrace?.find(t => t.type === 'pipeline')?.pipeline?.ontology?.concepts,
        usedConcepts: msg.usedConcepts,
      });
      toast('感谢反馈', 'success');
    } catch {
      toast('反馈提交失败', 'error');
      setFeedbackState(prev => ({ ...prev, [msgId]: 'idle' }));
    }
  }, [activeSessionId, messages, toast]);

  const handleDislike = useCallback(async (msg: ChatMessage) => {
    const msgId = msg.messageId || msg.id;
    if (!dislikeSelectedConcept) {
      toast('请选择一个概念', 'error');
      return;
    }
    setFeedbackSubmitting(true);
    try {
      await quickConceptFeedback({
        sessionId: activeSessionId,
        messageId: msgId,
        feedbackType: 'dislike',
        userQuestion: msg.content,
        answer: msg.content,
        faissConcepts: msg.conceptTrace?.find(t => t.type === 'pipeline')?.pipeline?.faiss?.concepts,
        ontologyConcepts: msg.conceptTrace?.find(t => t.type === 'pipeline')?.pipeline?.ontology?.concepts,
        usedConcepts: msg.usedConcepts,
        correctConceptId: dislikeSelectedConcept.id,
        correctConceptName: dislikeSelectedConcept.name,
        userDescription: dislikeComment,
      });
      toast('感谢反馈', 'success');
      setFeedbackState(prev => ({ ...prev, [msgId]: 'submitted' }));
      setDislikeSelectedConcept(null);
      setDislikeComment('');
      setDislikeConceptSearch('');
    } catch {
      toast('反馈提交失败', 'error');
    } finally {
      setFeedbackSubmitting(false);
    }
  }, [activeSessionId, dislikeSelectedConcept, dislikeComment, toast]);

  const openDislikeForm = useCallback(async (msgId: string) => {
    setFeedbackState(prev => ({ ...prev, [msgId]: 'dislike_form' }));
    setDislikeSelectedConcept(null);
    setDislikeComment('');
    setDislikeConceptSearch('');
    try {
      const res = await listConcepts();
      setDislikeConcepts((res.data || []).map(c => ({ id: c.id, name: c.name })));
    } catch {
      setDislikeConcepts([]);
    }
  }, []);

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
              <div
                key={s.id}
                className={`agent-chat-history-item ${activeSessionId === s.id ? 'active' : ''}`}
                onClick={() => setActiveSessionId(s.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') setActiveSessionId(s.id); }}
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
              </div>
            ))
          )}
        </div>
      </div>

      <div className="agent-chat-main">
        <div className="agent-chat-header">
          <h2 className="agent-chat-title">问数</h2>
          <div className="agent-chat-header-actions">
            <button
              className="agent-chat-copy-btn"
              onClick={copyDebugInfo}
              disabled={messages.length === 0}
              title="复制 LLM 输入输出"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </div>
        </div>

        <div className="agent-chat-messages">
          {messages.length === 0 ? (
              <div className="agent-chat-welcome">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <p>输入自然语言问题，AI 将自动调用工具查询</p>
              </div>
            ) : (
              <div style={{ display: 'contents' }}>
                {messages.map((msg) => (
                <div key={msg.id} className={'agent-chat-message ' + msg.role}>
                <div className="agent-chat-message-body">
                  <div className="agent-chat-message-header">
                    <span className="agent-chat-role-label">
                      {msg.role === 'user' ? '你' : 'AI 助手'}
                    </span>
                    <span className="agent-chat-timestamp">{msg.timestamp}</span>
                  </div>
                  <div className="agent-chat-bubble">
                    {msg.role === 'assistant' && msg.selectDatasources && msg.selectDatasources.length > 0 ? (
                      <>
                        <div className="agent-chat-message-content" style={{ color: '#666', fontSize: '13px' }}>请选择需要使用的数据源和表</div>
                        {!confirmedDatasources.has(msg.id) ? (
                          <div className="agent-chat-datasource-select">
                            {msg.selectDatasources.map((ds) => (
                              <div key={ds.id} className="agent-chat-datasource-group">
                                <label className="agent-chat-datasource-label">
                                  <input
                                    type="checkbox"
                                    checked={!!selectedDatasources[ds.id]?.size}
                                    onChange={() => {
                                      const isSelected = !!selectedDatasources[ds.id]?.size;
                                      setExpandedDatasources((prev) => {
                                        const next = new Set(prev);
                                        if (isSelected) {
                                          next.delete(ds.id);
                                        } else {
                                          next.add(ds.id);
                                        }
                                        return next;
                                      });
                                      setSelectedDatasources((prev) => {
                                        const next = { ...prev };
                                        if (isSelected) {
                                          delete next[ds.id];
                                        } else {
                                          next[ds.id] = new Set(ds.tables.map((t) => t.name));
                                        }
                                        return next;
                                      });
                                    }}
                                  />
                                  <strong>{ds.name}</strong>
                                  <span className="agent-chat-datasource-type">({ds.type})</span>
                                </label>
                                {expandedDatasources.has(ds.id) && (
                                  <div className="agent-chat-datasource-tables">
                                    {ds.tables.map((t) => (
                                      <label key={t.name} className="agent-chat-table-label">
                                        <input
                                          type="checkbox"
                                          checked={selectedDatasources[ds.id]?.has(t.name) ?? false}
                                          onChange={() => {
                                            setSelectedDatasources((prev) => {
                                              const next = { ...prev };
                                              const sel = new Set(next[ds.id] || []);
                                              if (sel.has(t.name)) {
                                                sel.delete(t.name);
                                              } else {
                                                sel.add(t.name);
                                              }
                                              if (sel.size > 0) {
                                                next[ds.id] = sel;
                                              } else {
                                                delete next[ds.id];
                                              }
                                              return next;
                                            });
                                          }}
                                        />
                                        <span>{t.name}</span>
                                        <span className="agent-chat-table-columns">
                                          ({t.columns.slice(0, 5).join(', ')}{t.columns.length > 5 ? '...' : ''})
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                            <button
                              className="agent-chat-datasource-confirm"
                              disabled={!Object.values(selectedDatasources).some((s) => s.size > 0)}
                              onClick={() => handleSelectDatasourcesConfirm(msg.selectDatasources!, msg.id)}
                            >
                              确认选择
                            </button>
                          </div>
                        ) : (
                          <div className="agent-chat-datasource-summary">
                            {msg.selectDatasources
                              .filter((ds) => selectedDatasources[ds.id]?.size)
                              .map((ds) => {
                                const tables = Array.from(selectedDatasources[ds.id] || []);
                                return (
                                  <div key={ds.id} className="agent-chat-datasource-summary-item">
                                    <div className="agent-chat-datasource-summary-header">
                                      <span className="agent-chat-datasource-summary-check">✓</span>
                                      <strong>{ds.name}</strong>
                                    </div>
                                    <div className="agent-chat-datasource-summary-tables">
                                      {tables.join(', ')}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        )}
                      </>
                    ) : msg.role === 'assistant' && !msg.isStreaming ? (
                      <div className="agent-chat-message-content md-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{fixMarkdownTable(msg.content)}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="agent-chat-message-content">{msg.content}</div>
                    )}
                  </div>
                  {msg.role === 'assistant' && (msg.messageId || msg.nl2sql || (msg.conceptTrace && msg.conceptTrace.length > 0 && msg.conceptTrace[0]?.type !== 'capability_summary') || (msg.toolCalls && msg.toolCalls.length > 0) || msg.thinking || msg.reasoning || (msg.drillDimensions && msg.drillDimensions.length > 0) || msg.ontologyChanges) && (
                    <>
                    <div className="agent-chat-actions">
                      <div className="agent-chat-actions-left">
                        {msg.nl2sql && (
                          <button
                            className={`agent-chat-action-btn ${expandedSection[msg.id] === 'nl2sql' ? 'active' : ''}`}
                            onClick={() => setExpandedSection(prev => ({ ...prev, [msg.id]: prev[msg.id] === 'nl2sql' ? null : 'nl2sql' }))}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <ellipse cx="12" cy="5" rx="9" ry="3" />
                              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                            </svg>
                            SQL
                          </button>
                        )}
                        {msg.conceptTrace && msg.conceptTrace.length > 0 && msg.conceptTrace[0]?.type !== 'capability_summary' && (
                          <button
                            className={`agent-chat-action-btn ${expandedSection[msg.id] === 'concept' ? 'active' : ''}`}
                            onClick={() => setExpandedSection(prev => ({ ...prev, [msg.id]: prev[msg.id] === 'concept' ? null : 'concept' }))}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="3" />
                              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                            </svg>
                            概念
                          </button>
                        )}
                        {msg.toolCalls && msg.toolCalls.length > 0 && (
                          <button
                            className={`agent-chat-action-btn ${expandedSection[msg.id] === 'tools' ? 'active' : ''}`}
                            onClick={() => setExpandedSection(prev => ({ ...prev, [msg.id]: prev[msg.id] === 'tools' ? null : 'tools' }))}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="16 3 21 3 21 8" />
                              <line x1="4" y1="20" x2="21" y2="3" />
                              <polyline points="21 16 21 21 16 21" />
                              <line x1="15" y1="15" x2="21" y2="21" />
                              <line x1="4" y1="4" x2="9" y2="9" />
                            </svg>
                            工具
                          </button>
                        )}
                        {msg.drillDimensions && msg.drillDimensions.length > 0 && (
                          <button
                            className={`agent-chat-action-btn ${expandedSection[msg.id] === 'drill' ? 'active' : ''}`}
                            onClick={() => setExpandedSection(prev => ({ ...prev, [msg.id]: prev[msg.id] === 'drill' ? null : 'drill' }))}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                            下钻
                          </button>
                        )}
                        {(msg.thinking || msg.reasoning) && (
                          <button
                            className={`agent-chat-action-btn ${expandedSection[msg.id] === 'thinking' || msg.isStreaming ? 'active' : ''}`}
                            onClick={() => setExpandedSection(prev => ({ ...prev, [msg.id]: prev[msg.id] === 'thinking' ? null : 'thinking' }))}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="4 17 10 11 4 5" />
                              <line x1="12" y1="19" x2="20" y2="19" />
                            </svg>
                            推理
                          </button>
                        )}
                      </div>
                      <div className="agent-chat-actions-right">
                        {msg.messageId && (
                          <>
                      <button
                        className="agent-chat-action-btn"
                        title="复制回答"
                        onClick={() => {
                          navigator.clipboard.writeText(msg.content).then(() => {
                            toast('已复制到剪贴板', 'success');
                          }).catch(() => {
                            toast('复制失败', 'error');
                          });
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        复制
                      </button>
                      {(() => {
                        const msgId = msg.messageId || msg.id;
                        const state = feedbackState[msgId] || 'idle';
                        if (state === 'submitted') {
                          return (
                            <span className="agent-chat-feedback-done">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              已反馈
                            </span>
                          );
                        }
                        if (state === 'like_dislike') {
                          return (
                            <div className="agent-chat-feedback-btns">
                              <button
                                className="agent-chat-feedback-btn like"
                                onClick={() => handleLike(msg)}
                                title="赞"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                                </svg>
                              </button>
                              <button
                                className="agent-chat-feedback-btn dislike"
                                onClick={() => openDislikeForm(msgId)}
                                title="踩"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
                                </svg>
                              </button>
                            </div>
                          );
                        }
                        if (state === 'dislike_form') {
                          const filteredConcepts = dislikeConcepts.filter(c =>
                            !dislikeConceptSearch || c.name.toLowerCase().includes(dislikeConceptSearch.toLowerCase())
                          );
                          return (
                            <div className="agent-chat-feedback-form">
                              <div className="agent-chat-feedback-label">选择正确的概念</div>
                              <div className="agent-chat-feedback-search">
                                <input
                                  type="text"
                                  value={dislikeConceptSearch}
                                  onChange={(e) => setDislikeConceptSearch(e.target.value)}
                                  placeholder="搜索概念..."
                                  className="agent-chat-feedback-search-input"
                                />
                              </div>
                              {dislikeSelectedConcept && (
                                <div className="agent-chat-feedback-selected">
                                  已选：<strong>{dislikeSelectedConcept.name}</strong>
                                  <button
                                    className="agent-chat-feedback-remove"
                                    onClick={() => setDislikeSelectedConcept(null)}
                                  >
                                    ×
                                  </button>
                                </div>
                              )}
                              {!dislikeSelectedConcept && (
                                <div className="agent-chat-feedback-concept-list">
                                  {filteredConcepts.slice(0, 20).map(c => (
                                    <span
                                      key={c.id}
                                      className="agent-chat-feedback-concept-item"
                                      onClick={() => setDislikeSelectedConcept(c)}
                                    >
                                      {c.name}
                                    </span>
                                  ))}
                                  {filteredConcepts.length === 0 && (
                                    <span className="agent-chat-feedback-empty">无匹配概念</span>
                                  )}
                                </div>
                              )}
                              <div className="agent-chat-feedback-label">补充描述（可选）</div>
                              <textarea
                                className="agent-chat-feedback-input"
                                value={dislikeComment}
                                onChange={(e) => setDislikeComment(e.target.value)}
                                placeholder="请描述哪里不对..."
                                rows={2}
                              />
                              <div className="agent-chat-feedback-actions">
                                <button
                                  className="agent-chat-feedback-cancel"
                                  onClick={() => {
                                    setFeedbackState(prev => ({ ...prev, [msgId]: 'idle' }));
                                    setDislikeSelectedConcept(null);
                                    setDislikeComment('');
                                  }}
                                >
                                  取消
                                </button>
                                <button
                                  className="agent-chat-feedback-submit"
                                  disabled={!dislikeSelectedConcept || feedbackSubmitting}
                                  onClick={() => handleDislike(msg)}
                                >
                                  {feedbackSubmitting ? '提交中...' : '提交反馈'}
                                </button>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <button
                            className="agent-chat-action-btn"
                            onClick={() => setFeedbackState(prev => ({ ...prev, [msgId]: 'like_dislike' }))}
                            title="反馈"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                            反馈
                          </button>
                        );
                      })()}
                          </>
                        )}
                      </div>
                    </div>
                    {/* 推理过程展开 */}
                    {(expandedSection[msg.id] === 'thinking' || msg.isStreaming) && (msg.thinking || msg.reasoning) && (
                      <div className="agent-chat-thinking-content">
                        {msg.reasoning || msg.thinking}
                      </div>
                    )}
                  </>  
                  )}

                    {/* 展开的详情内容 */}
                    {expandedSection[msg.id] === 'nl2sql' && msg.nl2sql && (
                      <div className="agent-chat-detail">
                        <pre className="agent-chat-nl2sql-code">{msg.nl2sql.sql}</pre>
                        {msg.queryResult && (
                          <div className="agent-chat-query-result">
                            {msg.queryResult.executed ? (
                              <Fragment>
                                <div className="agent-chat-query-result-header">
                                  <span>查询结果</span>
                                  <span className="agent-chat-query-result-count">
                                    {msg.queryResult.rowCount ?? 0} 行
                                    {msg.queryResult.truncated ? '（已截断）' : ''}
                                  </span>
                                </div>
                                <div className="agent-chat-query-result-table-wrap">
                                  <table className="agent-chat-query-result-table">
                                    <thead>
                                      <tr>
                                        {(msg.queryResult.columnNames ?? []).map((col, i) => (
                                          <th key={i}>{col}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(msg.queryResult.data ?? []).map((row, i) => (
                                        <tr key={i}>
                                          {(msg.queryResult.columnNames ?? []).map((col, j) => (
                                            <td key={j}>{String(row[col] ?? '')}</td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </Fragment>
                            ) : (
                              <div className="agent-chat-query-result-error">
                                {msg.queryResult.error ?? '查询执行失败'}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {expandedSection[msg.id] === 'concept' && msg.conceptTrace && msg.conceptTrace.length > 0 && msg.conceptTrace[0]?.type !== 'capability_summary' && (
                      <div className="agent-chat-detail">
                        <ConceptTracePanel
                          traces={msg.conceptTrace}
                          collapsed={false}
                          usedConcepts={msg.usedConcepts}
                        />
                      </div>
                    )}

                    {expandedSection[msg.id] === 'tools' && msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="agent-chat-detail">
                        {msg.toolCalls.map((tc, i) => (
                          <div key={i} className="agent-chat-tool-call">
                            <div className="agent-chat-tool-call-header">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

                    {/* 下钻维度展开 */}
                    {expandedSection[msg.id] === 'drill' && msg.drillDimensions && msg.drillDimensions.length > 0 && (
                      <div className="agent-chat-detail">
                        <div className="agent-chat-drill-timeline">
                          {msg.drillDimensions.map((d, i) => (
                            <div key={i} className={`agent-chat-drill-step ${d.status}`}>
                              <div className="agent-chat-drill-dot" />
                              <div className="agent-chat-drill-info">
                                <span className="agent-chat-drill-round">第 {d.round} 轮</span>
                                <span className="agent-chat-drill-dim">{d.dimension}</span>
                                {d.sql && <pre className="agent-chat-nl2sql-code">{d.sql}</pre>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 根因分析卡片 */}
                    {msg.rootCause && (
                      <div className="agent-chat-root-cause-card">
                        <div className="agent-chat-root-cause-header">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                          </svg>
                          根因分析
                        </div>
                        <div className="agent-chat-root-cause-body">
                          <div className="agent-chat-root-cause-finding">
                            <strong>根因：</strong>{msg.rootCause.root_cause}
                          </div>
                          {msg.rootCause.evidence.length > 0 && (
                            <div className="agent-chat-root-cause-evidence">
                              <strong>证据链：</strong>
                              {msg.rootCause.evidence.map((e, i) => (
                                <div key={i} className="agent-chat-root-cause-evidence-item">
                                  <span className="agent-chat-evidence-round">[{e.round}]</span>
                                  {e.anomaly && <span className="agent-chat-evidence-anomaly">异常</span>}
                                  <span>{e.finding}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {msg.rootCause.suggestion && (
                            <div className="agent-chat-root-cause-suggestion">
                              <strong>建议：</strong>{msg.rootCause.suggestion}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 本体变更建议卡片 - 仅超管可见 */}
                    {msg.ontologyChanges && isSuperAdmin && (
                      <div className="agent-chat-ontology-change-card">
                        <div className="agent-chat-ontology-change-header">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                          </svg>
                          本体变更建议
                          <span className="agent-chat-ontology-change-badge">
                            {msg.ontologyChanges.trigger === 'auto_detect' ? '自动检测' : '用户请求'}
                          </span>
                        </div>
                        <div className="agent-chat-ontology-change-reasoning">
                          {msg.ontologyChanges.reasoning}
                        </div>
                        <div className="agent-chat-ontology-change-list">
                          {msg.ontologyChanges.changes.map((c, i) => (
                            <div key={i} className={`agent-chat-ontology-change-item status-${c.status.toLowerCase()}`}>
                              <div className="agent-chat-ontology-change-op">
                                <span className="agent-chat-ontology-change-op-tag">{c.operation}</span>
                                <span className="agent-chat-ontology-change-status-tag">{c.status}</span>
                              </div>
                              <div className="agent-chat-ontology-change-diff">
                                {c.before && (
                                  <div className="agent-chat-ontology-change-before">
                                    <div className="agent-chat-ontology-change-label">变更前</div>
                                    <pre>{JSON.stringify(c.before, null, 2)}</pre>
                                  </div>
                                )}
                                {c.after && (
                                  <div className="agent-chat-ontology-change-after">
                                    <div className="agent-chat-ontology-change-label">变更后</div>
                                    <pre>{JSON.stringify(c.after, null, 2)}</pre>
                                  </div>
                                )}
                              </div>
                              <div className="agent-chat-ontology-change-reason">{c.reasoning}</div>
                              {c.impact && <div className="agent-chat-ontology-change-impact">影响：{c.impact}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              </div>
            ))}
          <div ref={messagesEndRef} />
            </div>
          )}
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
              placeholder="输入你的问题，如：你可以帮我做什么..."
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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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