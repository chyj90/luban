import { useState, useRef, useEffect, useMemo, memo } from 'react';
import type { Message } from '@/types/agent';
import { useAgentStore } from '@/stores/agentStore';
import { toast } from '@/stores/toastStore';
import { ChatRouter } from '@/agent/core/chatRouter';
import type { RouterSessionOptions, RouterCallbacks } from '@/agent/core/chatRouter';
import { AGENTS } from '@/agent/registry/agentRegistry';
import { getSubPlans } from '@/agent/core/planContext';
import { upsertPlanMessage } from '@/agent/registry/skills/planSkills';
import { listPages } from '@/api';
import type { Plan } from '@/types/agent';
import ReactMarkdown from 'react-markdown';
import './AgentPanel.css';

function formatTableResult(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length > 6) {
        const headerCells = cells;
        const sepLine = lines[i + 1]?.trim();
        if (sepLine && sepLine.startsWith('|') && sepLine.includes('---')) {
          result.push(`**表格（${headerCells.length} 列）**`);
          i += 2;

          while (i < lines.length) {
            const rowLine = lines[i]?.trim();
            if (!rowLine || !rowLine.startsWith('|')) break;
            const rowCells = rowLine.split('|').map((c) => c.trim()).filter(Boolean);
            result.push('');
            for (let j = 0; j < headerCells.length; j++) {
              result.push(`- **${headerCells[j]}**：${rowCells[j] || '—'}`);
            }
            i++;
          }
          continue;
        }
      }
    }
    result.push(line);
    i++;
  }

  return result.join('\n');
}

/** 根据智能体名称生成一致的柔和颜色 */
function agentColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 35%, 45%)`;
}

interface AgentPanelProps {
  appId: string;
  currentPageId: number;
  currentPageName: string;
  onPagesChange?: () => void;
  onPageChange?: (pageId: number) => void;
  onQuerySelect?: (query: { id: number; name: string }) => void;
  onQueriesChange?: () => void;
  onDatasourceChange?: () => void;
  onWorkflowNavigate?: (view: import('@/types/agent').WorkflowNavigateView) => void;
}

type TabView = 'chat' | 'plan';

const MessageItem = memo(function MessageItem({ msg }: { msg: Message }) {
  const isPlanMsg = msg.role === 'plan';
  const roleLabel = (() => {
    if (msg.role === 'user') return '你';
    if (msg.role === 'tool') return '工具';
    if (msg.agentName) return `${msg.agentIcon || ''} ${msg.agentName}`;
    if (msg.role === 'assistant') return 'AI';
    return '系统';
  })();
  const roleClass = msg.role === 'user'
    ? 'ap-message-by-user'
    : msg.agentName || msg.role === 'assistant'
      ? 'ap-message-by-agent'
      : msg.role === 'tool'
        ? 'ap-message-by-tool'
        : 'ap-message-by-system';

  return (
    <div className={`ap-message ${isPlanMsg ? 'ap-message-plan' : ''} ${roleClass}`}>
      <div className="ap-message-header">
        <span className="ap-message-sender" style={msg.agentName ? { color: agentColor(msg.agentName) } : undefined}>
          {roleLabel}
          {msg.isStreaming && <span className="ap-streaming-dot" />}
        </span>
        <span className="ap-message-time">
          {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {msg.reasoningContent && (
        <details className="ap-reasoning">
          <summary className="ap-reasoning-summary">
            <svg className="ap-reasoning-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a4 4 0 0 1 4 4c0 1.1-.4 2.1-1.2 2.8l-.8.8V12a2 2 0 0 1-4 0V9.6l-.8-.8A4 4 0 0 1 12 2z"/>
              <path d="M12 16v.01"/>
              <path d="M9 20h6"/>
              <path d="M12 19v-3"/>
            </svg>
            思考过程
            <span className="ap-reasoning-hint">点击展开</span>
          </summary>
          <div className="ap-reasoning-content">
            <ReactMarkdown>{msg.reasoningContent}</ReactMarkdown>
          </div>
        </details>
      )}
      {msg.toolCalls?.map((tc) => {
        const statusIcon = <span className={`ap-tool-status-dot ${tc.status}`} />;
        return (
          <details key={tc.id} className="ap-tool-call">
            <summary className="ap-tool-call-summary">
              <span className="ap-tool-call-icon">{statusIcon}</span>
              <span className="ap-tool-call-name">{tc.name}</span>
              <span className={`ap-tool-call-status ${tc.status}`}>{tc.status}</span>
            </summary>
            <div className="ap-tool-call-detail">
              <div className="ap-tool-call-section">
                <div className="ap-tool-call-label">输入</div>
                <pre className="ap-tool-call-pre">{JSON.stringify(tc.arguments, null, 2)}</pre>
              </div>
              {tc.result && (
                <div className="ap-tool-call-section">
                  <div className="ap-tool-call-label">输出</div>
                  <pre className="ap-tool-call-pre">{formatTableResult(tc.result)}</pre>
                </div>
              )}
            </div>
          </details>
        );
      })}
      {(!msg.toolCalls || msg.toolCalls.length === 0) && msg.content && (
        <div className={`ap-message-body ${msg.role}${msg.isStreaming ? ' streaming' : ''}`}>
          {msg.role === 'assistant' || msg.role === 'plan' ? (
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          ) : (
            <div className="ap-message-text">{msg.content}</div>
          )}
        </div>
      )}
      {msg.toolCalls && msg.toolCalls.length > 0 && msg.content && (
        <div className={`ap-message-body ${msg.role}${msg.isStreaming ? ' streaming' : ''}`}>
          {msg.role === 'assistant' || msg.role === 'plan' ? (
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          ) : (
            <div className="ap-message-text">{msg.content}</div>
          )}
        </div>
      )}
    </div>
  );
}, (prev, next) => {
  return prev.msg.content === next.msg.content
    && prev.msg.isStreaming === next.msg.isStreaming
    && prev.msg.reasoningContent === next.msg.reasoningContent
    && JSON.stringify(prev.msg.toolCalls) === JSON.stringify(next.msg.toolCalls);
});

function formatExport(messages: import('@/types/agent').Message[]): string {
  const lines: string[] = [];
  lines.push(`# AI Agent 会话记录`);
  lines.push(`# 导出时间: ${new Date().toLocaleString()}`);
  lines.push(`# 消息总数: ${messages.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const time = new Date(msg.timestamp).toLocaleString();
    const roleLabel = msg.role === 'user' ? '👤 用户'
      : msg.agentName ? `🤖 ${msg.agentName}`
      : msg.role === 'assistant' ? '🤖 智能体'
      : msg.role === 'tool' ? '🔧 工具'
      : msg.role === 'system' ? '⚙️ 系统'
      : msg.role === 'plan' ? '📋 计划'
      : msg.role;

    lines.push(`### ${roleLabel}  [${time}]`);
    lines.push('');
    if (msg.reasoningContent) {
      lines.push('<details>');
      lines.push('<summary>💭 思考过程</summary>');
      lines.push('');
      lines.push(msg.reasoningContent);
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
    if (msg.content) {
      lines.push(msg.content);
      lines.push('');
    }

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        lines.push(`> 🔨 调用: ${tc.name}  [${tc.status}]`);
        if (tc.arguments && Object.keys(tc.arguments).length > 0) {
          lines.push('> 输入:');
          lines.push('> ```json');
          lines.push(`> ${JSON.stringify(tc.arguments, null, 2).replace(/\n/g, '\n> ')}`);
          lines.push('> ```');
        }
        if (tc.result) {
          lines.push('> 输出:');
          const formattedResult = tc.name === 'run_query' ? formatTableResult(tc.result) : tc.result;
          lines.push(`> ${formattedResult.replace(/\n/g, '\n> ')}`);
        }
        lines.push('');
      }
    }
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

export function AgentPanel({ appId, currentPageId, currentPageName, onPagesChange, onPageChange, onQuerySelect, onQueriesChange, onDatasourceChange, onWorkflowNavigate }: AgentPanelProps) {
  const [input, setInput] = useState('');
  const [allPages, setAllPages] = useState<Array<{ id: number; name: string }>>([]);
  const [activeTab, setActiveTab] = useState<TabView>('chat');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [tokenUsage, setTokenUsage] = useState<{ inputTokens: number; outputTokens: number; totalTokens: number } | null>(null);
  const [showDebugMenu, setShowDebugMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isUserAtBottomRef = useRef(true);
  const lastScrollTimeRef = useRef(0);
  const chatRouterRef = useRef<ChatRouter | null>(null);
  const lastApiMessagesRef = useRef<unknown[]>([]);

  const getDebugLogKey = () => `debug_chat_log_${appId}`;

  const saveDebugLog = (messages: unknown[]) => {
    lastApiMessagesRef.current = messages;
    try {
      localStorage.setItem(getDebugLogKey(), JSON.stringify(messages));
    } catch {
      // ignore storage full
    }
  };

  const {
    messages,
    plans,
    focusPlanId,
    status,
    isStreaming,
    error,
    generateSessionId,
    addMessage,
    updateMessage,
    addPlan,
    updatePlan,
    updateStep,
    removeMessage,
    setStatus,
    setStreaming,
    setError,
    confirmPlan,
    rejectPlan,
    stopPlan,
    reset,
  } = useAgentStore();

  useEffect(() => {
    listPages(Number(appId)).then((res) => {
      setAllPages(
        res.data
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          .map((p) => ({ id: p.id, name: p.name })),
      );
    });
  }, [appId]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`debug_chat_log_${appId}`);
      if (stored) {
        lastApiMessagesRef.current = JSON.parse(stored);
      }
    } catch {
      // ignore parse error
    }
  }, [appId]);

  // 切换应用时重置聊天路由，避免旧应用的执行器上下文被复用
  useEffect(() => {
    chatRouterRef.current?.cancel();
    chatRouterRef.current = null;
    lastApiMessagesRef.current = [];
  }, [appId]);

  // 打开面板时滚动到底部
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      setTimeout(() => {
        el.scrollTop = el.scrollHeight;
        (window as unknown).bug_trace_log('scroll-init', {
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        });
      }, 0);
    });
  }, []);

  useEffect(() => {
    if (isUserAtBottomRef.current) {
      const now = Date.now();
      const throttleMs = isStreaming ? 30 : 100;
      if (now - lastScrollTimeRef.current < throttleMs) return;
      lastScrollTimeRef.current = now;
      requestAnimationFrame(() => {
        const el = messagesContainerRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
        (window as unknown).bug_trace_log('scroll-auto', {
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          messagesCount: messages.length,
          isStreaming: isStreaming,
        });
      });
    }
  }, [messages]);

  const dispatchEvent = (event: { type: string; payload: unknown }) => {
    console.log(`[AgentPanel] dispatch 收到事件: ${event.type}`);
    switch (event.type) {
      case 'DELEGATE_QUERY_START': {
        const payload = event.payload as { taskType: string; targetPage: string; queryName: string; requirement: string };
        console.log(`[AgentPanel] DELEGATE_QUERY_START | queryName=${payload.queryName} | targetPage=${payload.targetPage}`);
        const _displayName = payload.queryName || '查询';
        addMessage({
          id: crypto.randomUUID(),
          role: 'system',
          content: payload.queryName ? `数据辅助智能体正在处理查询「${payload.queryName}」...` : '数据辅助智能体正在处理查询任务...',
          timestamp: Date.now(),
          agentId: 'data-assistant',
          agentName: '数据辅助智能体',
          agentIcon: '',
        });
        break;
      }
      case 'DELEGATE_QUERY_COMPLETE': {
        const payload = event.payload as { success: boolean; message: string; query?: { id: number; name: string } };
        console.log(`[AgentPanel] DELEGATE_QUERY_COMPLETE | success=${payload.success} | query=${payload.query?.name || 'none'}`);
        if (!payload.success) {
          addMessage({
            id: crypto.randomUUID(),
            role: 'system',
            content: payload.message,
            timestamp: Date.now(),
          });
        } else {
          onQueriesChange?.();
        }
        break;
      }
      case 'FIND_WORKFLOW_START': {
        const payload = event.payload as { taskType: string; requirements: string[] };
        console.log(`[AgentPanel] FIND_WORKFLOW_START | taskType=${payload.taskType} | requirements=${payload.requirements?.length}条`);
        addMessage({
          id: crypto.randomUUID(),
          role: 'system',
          content: `流程设计助手正在处理${payload.taskType === 'design_form' ? '表单' : payload.taskType === 'design_workflow' ? '流程' : ''}设计...`,
          timestamp: Date.now(),
          agentId: 'workflow-assistant',
          agentName: '流程设计助手',
          agentIcon: '',
        });
        break;
      }
      case 'FIND_WORKFLOW_COMPLETE': {
        const payload = event.payload as { success: boolean; message: string };
        console.log(`[AgentPanel] FIND_WORKFLOW_COMPLETE | success=${payload.success}`);
        if (!payload.success) {
          addMessage({
            id: crypto.randomUUID(),
            role: 'system',
            content: payload.message,
            timestamp: Date.now(),
          });
        }
        break;
      }
      case 'TOKEN_USAGE': {
        const payload = event.payload as { phase: string; inputTokens: number; outputTokens: number; totalTokens: number };
        setTokenUsage({
          inputTokens: payload.inputTokens,
          outputTokens: payload.outputTokens,
          totalTokens: payload.totalTokens,
        });
        break;
      }
      case 'DEBUG_CHAT_LOG': {
        saveDebugLog(event.payload as unknown[]);
        break;
      }
    }
  };

  const callbacks = useMemo<RouterCallbacks>(() => ({
    addMessage,
    updateMessage,
    removeMessage,
    addPlan,
    updatePlan,
    updateStep,
    setStatus,
    setStreaming,
    setError,
    dispatch: dispatchEvent,
    onPagesChange,
    onPageChange,
    onQuerySelect,
    onQueriesChange,
    onDatasourceChange,
    onWorkflowNavigate,
  }), [addMessage, updateMessage, removeMessage, addPlan, updatePlan, updateStep, setStatus, setStreaming, setError, onPagesChange, onPageChange, onQuerySelect, onQueriesChange, onDatasourceChange, onWorkflowNavigate]);

  const runAgent = async (userMessage: string) => {
    const sessionOptions: RouterSessionOptions = {
      model: 'default',
      currentPageId,
      currentPageName,
      allPages,
      applicationId: appId,
      onPagesChange,
      onPageChange,
      onQuerySelect,
      onQueriesChange,
      onDatasourceChange,
      onWorkflowNavigate,
    };

    if (!chatRouterRef.current) {
      generateSessionId();
      chatRouterRef.current = new ChatRouter(sessionOptions, callbacks);
    } else {
      chatRouterRef.current.updateSessionOptions(sessionOptions);
    }

    const sessionId = useAgentStore.getState().sessionId || `session_${Date.now()}`;

    try {
      const result = await chatRouterRef.current.route({
        userInput: userMessage,
        sessionId,
      });
      await result.executor.run(result.processedInput);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    setError(null);
    const userMsg = input;
    setInput('');

    isUserAtBottomRef.current = true;
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;

    await runAgent(userMsg);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);

    const cursorPos = e.target.selectionStart || 0;
    const textBeforeCursor = value.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\S*)$/);

    if (atMatch) {
      setShowMentions(true);
      setMentionFilter(atMatch[1]);
      setMentionIndex(0);
    } else {
      setShowMentions(false);
      setMentionFilter('');
    }
  };

  const handleMentionSelect = (agentName: string) => {
    const cursorPos = (document.querySelector('.ap-input') as HTMLTextAreaElement)?.selectionStart || input.length;
    const textBeforeCursor = input.slice(0, cursorPos);
    const textAfterCursor = input.slice(cursorPos);
    const atMatch = textBeforeCursor.match(/@(\S*)$/);

    if (atMatch) {
      const before = textBeforeCursor.slice(0, atMatch.index);
      setInput(`${before}@${agentName} ${textAfterCursor}`);
    }
    setShowMentions(false);
  };

  const filteredAgents = useMemo(
    () => AGENTS.filter((a) =>
      mentionFilter ? a.name.includes(mentionFilter) || a.id.includes(mentionFilter) : true,
    ),
    [mentionFilter],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMentions && filteredAgents.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        if (e.key === 'Escape') {
          setShowMentions(false);
        } else if (e.key === 'ArrowDown') {
          setMentionIndex((i) => Math.min(i + 1, filteredAgents.length - 1));
        } else if (e.key === 'ArrowUp') {
          setMentionIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
          handleMentionSelect(filteredAgents[mentionIndex].name);
        }
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCancel = () => {
    console.log('[AgentPanel] handleCancel 被调用');
    const draftPlan = draftPlans[0];
    const executingPlan = focusedPlans[0];
    if (draftPlan) {
      rejectPlan(draftPlan.id);
      upsertPlanMessage(draftPlan.id);
    } else if (executingPlan) {
      stopPlan(executingPlan.id);
      upsertPlanMessage(executingPlan.id);
    }
    chatRouterRef.current?.cancel();
    setStatus('cancelled');
  };

  const handleConfirmPlan = async (plan: Plan) => {
    confirmPlan(plan.id);
    upsertPlanMessage(plan.id);
    const planSteps = plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n');
    const confirmMsg = `确认计划，开始执行。\n计划步骤：\n${planSteps}`;
    setInput('');
    await runAgent(confirmMsg);
  };

  const handleRejectPlan = (planId: string) => {
    rejectPlan(planId);
    upsertPlanMessage(planId);
    addMessage({
      id: crypto.randomUUID(),
      role: 'system',
      content: '计划已拒绝',
      timestamp: Date.now(),
    });
  };

  const handleContinuePlan = async (plan: Plan) => {
    confirmPlan(plan.id);
    upsertPlanMessage(plan.id);
    const doneSteps = plan.steps.filter((s) => s.status === 'done');
    const pendingSteps = plan.steps.filter((s) => s.status !== 'done');
    const doneSummary = doneSteps.map((s) => `- ${s.description} [完成]`).join('\n');
    const pendingSummary = pendingSteps.map((s, i) => `${i + 1}. ${s.description}`).join('\n');
    const continueMsg = `继续执行计划。\n已完成：\n${doneSummary}\n剩余步骤：\n${pendingSummary}`;
    setInput('');
    await runAgent(continueMsg);
  };

  useEffect(() => {
    if (!showDebugMenu) return;
    const handler = () => setShowDebugMenu(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showDebugMenu]);

  const isRunning = status === 'streaming' || status === 'executing' || status === 'planning';

  const draftPlans = plans.filter((p) => p.status === 'draft');
  const focusedPlans = plans.filter((p) => p.id === focusPlanId && p.status !== 'completed' && p.status !== 'draft' && p.status !== 'stopped');
  const executingPlans = plans.filter((p) => p.id !== focusPlanId && (p.status === 'executing' || p.status === 'confirmed'));
  const stoppedPlans = plans.filter((p) => p.status === 'stopped');
  const completedPlans = plans.filter((p) => p.status === 'completed');

  const toggleStep = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  const renderPlanCard = (plan: Plan, isFocused: boolean) => {
    const subPlans = getSubPlans(plan.id);
    const statusLabel =
      plan.status === 'draft' ? '待确认' :
      plan.status === 'executing' ? '执行中' :
      plan.status === 'completed' ? '已完成' :
      plan.status === 'stopped' ? '已停止' :
      plan.status === 'rejected' ? '已拒绝' : '等待中';
    return (
      <div key={plan.id} className={`ap-plan-card ${isFocused ? 'focused' : ''} ${plan.status}`}>
        <div className="ap-plan-card-header">
          <span className="ap-plan-card-agent">{plan.agentIcon} {plan.agentName}</span>
          <span className={`ap-plan-card-status ${plan.status}`}>
            {statusLabel}
          </span>
        </div>
        <div className="ap-plan-steps">
          {plan.steps.map((step) => {
            const hasSubPlan = !!step.subPlanId;
            const isExpanded = expandedSteps.has(step.id);
            const stepSubPlans = subPlans.filter((sp) => sp.parentStepId === step.id);
            return (
              <div key={step.id} className="ap-plan-step-wrapper">
                <div
                  className={`ap-plan-step ${step.status} ${hasSubPlan ? 'expandable' : ''}`}
                  onClick={() => hasSubPlan && toggleStep(step.id)}
                >
                  <span className="ap-plan-step-icon">
                    {hasSubPlan ? (isExpanded ? '▼' : '▶') : ''}
                    <span className={`ap-step-status-dot ${step.status}`} />
                  </span>
                  <span className="ap-plan-step-desc">{step.description}</span>
                </div>
                {isExpanded && hasSubPlan && stepSubPlans.length > 0 && (
                  <div className="ap-plan-sub-plans">
                    {stepSubPlans.map((sp) => renderPlanCard(sp, false))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {plan.status === 'draft' && (
          <div className="ap-plan-actions">
            <button className="ap-btn-confirm" onClick={() => handleConfirmPlan(plan)}>确认计划</button>
            <button className="ap-btn-reject" onClick={() => handleRejectPlan(plan.id)}>拒绝</button>
          </div>
        )}
        {plan.status === 'stopped' && (
          <div className="ap-plan-actions">
            <button className="ap-btn-continue" onClick={() => handleContinuePlan(plan)}>继续执行</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ap-panel">
      <div className="ap-header">
        <div className="ap-header-left">
          <div className="ap-logo">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <span className="ap-title">AI Agent</span>
        </div>
        <div className="ap-header-right">
          <button className="ap-clear-btn" onClick={() => { reset(); setTokenUsage(null); chatRouterRef.current = null; lastApiMessagesRef.current = []; try { localStorage.removeItem(getDebugLogKey()); } catch { /* ignore */ } }} title="清空对话和计划">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8c9cab" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
            </svg>
          </button>
          <div className="ap-debug-wrap">
            <button
              className="ap-clear-btn"
              onClick={(e) => { e.stopPropagation(); setShowDebugMenu(!showDebugMenu); }}
              title="调试工具"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8c9cab" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </button>
            {showDebugMenu && (
              <div className="ap-debug-menu" onClick={(e) => e.stopPropagation()}>
                <button className="ap-debug-item" onClick={() => {
                  setShowDebugMenu(false);
                  const text = formatExport(messages);
                  navigator.clipboard.writeText(text).then(() => {
                    toast.success('会话记录已复制到剪贴板');
                  }).catch(() => {
                    const blob = new Blob([text], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `agent-session-${Date.now()}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  });
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
                    <rect x="8" y="2" width="8" height="4" rx="1" />
                  </svg>
                  复制会话记录 (Markdown)
                </button>
                <button className="ap-debug-item" onClick={() => {
                  setShowDebugMenu(false);
                  const apiMessages = lastApiMessagesRef.current;
                  if (!apiMessages || apiMessages.length === 0) {
                    toast.error('暂无可复制的调试日志，请先发送消息');
                    return;
                  }
                  const text = JSON.stringify(apiMessages, null, 2);
                  navigator.clipboard.writeText(text).then(() => {
                    toast.success('API 调试日志已复制到剪贴板');
                  }).catch(() => {
                    const blob = new Blob([text], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `api-debug-${Date.now()}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  });
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
                    <line x1="13" y1="19" x2="19" y2="13" />
                    <line x1="16" y1="16" x2="20" y2="20" />
                    <line x1="19" y1="21" x2="21" y2="19" />
                    <polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
                    <line x1="5" y1="14" x2="9" y2="18" />
                  </svg>
                  复制 API 调试日志 (JSON)
                </button>
                <button className="ap-debug-item" onClick={() => {
                  setShowDebugMenu(false);
                  const md = formatExport(messages);
                  const apiMessages = lastApiMessagesRef.current;
                  const parts: string[] = [];
                  parts.push(`# AI Agent 调试日志`);
                  parts.push(`# 导出时间: ${new Date().toLocaleString()}`);
                  parts.push('');
                  parts.push('## 一、会话记录 (Markdown)');
                  parts.push('');
                  parts.push(md);
                  if (apiMessages && apiMessages.length > 0) {
                    parts.push('');
                    parts.push('---');
                    parts.push('');
                    parts.push('## 二、API 请求消息 (JSON)');
                    parts.push('');
                    parts.push('```json');
                    parts.push(JSON.stringify(apiMessages, null, 2));
                    parts.push('```');
                  }
                  const text = parts.join('\n');
                  navigator.clipboard.writeText(text).then(() => {
                    toast.success('全部调试信息已复制到剪贴板');
                  }).catch(() => {
                    const blob = new Blob([text], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `debug-all-${Date.now()}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  });
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  复制全部 (会话记录 + API 日志)
                </button>
              </div>
            )}
          </div>
          <div className="ap-tabs">
            <button
              className={`ap-tab ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              对话
            </button>
            <button
              className={`ap-tab ${activeTab === 'plan' ? 'active' : ''}`}
              onClick={() => setActiveTab('plan')}
            >
              计划
            </button>
          </div>
        </div>
      </div>

      <div className="ap-body">
        {activeTab === 'plan' && (
          <div className="ap-plan">
            {plans.length === 0 ? (
              <div className="ap-plan-empty">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
                <p>暂无计划</p>
                <span>在对话中描述需求后，AI 将自动生成执行计划</span>
              </div>
            ) : (
              <div className="ap-plan-content">
                {draftPlans.length > 0 && (
                  <div className="ap-plan-section">
                    <div className="ap-plan-section-title">待确认</div>
                    {draftPlans.map((p) => renderPlanCard(p, true))}
                  </div>
                )}
                {focusedPlans.length > 0 && (
                  <div className="ap-plan-section">
                    <div className="ap-plan-section-title">当前焦点</div>
                    {focusedPlans.map((p) => renderPlanCard(p, true))}
                  </div>
                )}
                {executingPlans.length > 0 && (
                  <div className="ap-plan-section">
                    <div className="ap-plan-section-title">进行中</div>
                    {executingPlans.map((p) => renderPlanCard(p, false))}
                  </div>
                )}
                {stoppedPlans.length > 0 && (
                  <div className="ap-plan-section">
                    <div className="ap-plan-section-title">已停止</div>
                    {stoppedPlans.map((p) => renderPlanCard(p, false))}
                  </div>
                )}
                {completedPlans.length > 0 && (
                  <div className="ap-plan-section">
                    <div className="ap-plan-section-title">已完成</div>
                    {completedPlans.map((p) => renderPlanCard(p, false))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'chat' && (
          <>
            <div className="ap-messages" ref={messagesContainerRef}
                onScroll={() => {
                  const el = messagesContainerRef.current;
                  if (!el) return;
                  const threshold = 50;
                  isUserAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
                  (window as unknown).bug_trace_log('scroll-user', {
                    scrollTop: el.scrollTop,
                    scrollHeight: el.scrollHeight,
                    clientHeight: el.clientHeight,
                    isAtBottom: isUserAtBottomRef.current,
                  });
                }}>
              {messages.map((msg) => (
                <MessageItem key={msg.id} msg={msg} />
              ))}

              

              {isStreaming && !messages.some((m) => m.isStreaming) && (
                <div className="ap-thinking">
                  <svg className="ap-thinking-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                  </svg>
                  AI 正在思考
                  {tokenUsage && (
                    <span className="ap-token-count">
                      {tokenUsage.totalTokens} tokens
                    </span>
                  )}
                </div>
              )}

              {error && (
                <div className="ap-error">{error}</div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="ap-input-area">
              <textarea
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="描述你想要创建的应用... 输入 @ 可以指定智能体"
                rows={2}
                className="ap-input"
              />
              {showMentions && filteredAgents.length > 0 && (
                <div className="ap-mention-dropdown">
                  {filteredAgents.map((agent, idx) => (
                    <div
                      key={agent.id}
                      className={`ap-mention-item ${idx === mentionIndex ? 'active' : ''}`}
                      onClick={() => handleMentionSelect(agent.name)}
                    >
                      <span className="ap-mention-icon">{agent.icon}</span>
                      <span className="ap-mention-name">{agent.name}</span>
                      <span className="ap-mention-desc">{agent.description}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="ap-input-actions">
                {isRunning ? (
                  <button className="ap-btn-stop" onClick={handleCancel}>停止</button>
                ) : (
                  <button className="ap-btn-send" onClick={handleSend}>发送</button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}