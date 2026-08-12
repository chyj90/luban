import { useState, useRef, useEffect, useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useLLMStore } from '@/stores/llmStore';
import { vaultManager } from '@/agent/core/vaultManager';
import { ChatRouter } from '@/agent/core/chatRouter';
import type { RouterSessionOptions, RouterCallbacks } from '@/agent/core/chatRouter';
import { AGENTS } from '@/agent/registry/agentRegistry';
import { getSubPlans } from '@/agent/core/planContext';
import { upsertPlanMessage } from '@/agent/skills/planSkill';
import { listPages } from '@/api';
import type { ProviderType, Plan } from '@/types/agent';
import ReactMarkdown from 'react-markdown';
import './AgentPanel.css';

interface AgentPanelProps {
  appId: string;
  currentPageId: number;
  currentPageName: string;
  onPagesChange?: () => void;
  onPageChange?: (pageId: number) => void;
  onQuerySelect?: (query: { id: number; name: string }) => void;
  onQueriesChange?: () => void;
}

type TabView = 'chat' | 'plan' | 'settings';

const PROVIDERS: { key: ProviderType; label: string }[] = [
  { key: 'openai', label: 'OpenAI' },
  { key: 'anthropic', label: 'Anthropic' },
  { key: 'deepseek', label: 'DeepSeek' },
];

export function AgentPanel({ appId, currentPageId, currentPageName, workspaceId, onPagesChange, onPageChange, onQuerySelect, onQueriesChange }: AgentPanelProps) {
  const [input, setInput] = useState('');
  const [allPages, setAllPages] = useState<Array<{ id: number; name: string }>>([]);
  const [activeTab, setActiveTab] = useState<TabView>('chat');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [savedProvider, setSavedProvider] = useState<ProviderType | null>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [tokenUsage, setTokenUsage] = useState<{ inputTokens: number; outputTokens: number; totalTokens: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatRouterRef = useRef<ChatRouter | null>(null);

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

  const activeConfig = useLLMStore((s) => s.getActiveConfig());
  const configs = useLLMStore((s) => s.configs);
  const setActiveConfig = useLLMStore((s) => s.setActiveConfig);
  const llmActiveId = useLLMStore((s) => s.activeConfigId);

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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const dispatchEvent = (event: { type: string; payload: unknown }) => {
    console.log(`[AgentPanel] 📩 dispatch 收到事件: ${event.type}`);
    switch (event.type) {
      case 'FIND_QUERY_START': {
        const payload = event.payload as { taskType: string; targetPage: string; requirements: string[] };
        console.log(`[AgentPanel] 📊 FIND_QUERY_START | targetPage=${payload.targetPage} | requirements=${payload.requirements?.length}条`);
        addMessage({
          id: crypto.randomUUID(),
          role: 'system',
          content: `📊 数据辅助智能体正在为「${payload.targetPage}」创建查询...`,
          timestamp: Date.now(),
          agentId: 'data-assistant',
          agentName: '数据辅助智能体',
          agentIcon: '📊',
        });
        break;
      }
      case 'FIND_QUERY_COMPLETE': {
        const payload = event.payload as { success: boolean; message: string; queries?: Array<{ id: number; name: string }> };
        console.log(`[AgentPanel] 📊 FIND_QUERY_COMPLETE | success=${payload.success} | queries=${payload.queries?.length || 0}`);
        if (payload.success && payload.queries) {
          const queryList = payload.queries.map((q) => `  - ${q.name} (ID:${q.id})`).join('\n');
          addMessage({
            id: crypto.randomUUID(),
            role: 'system',
            content: `📊 数据辅助智能体已完成：\n${queryList}`,
            timestamp: Date.now(),
            agentId: 'data-assistant',
            agentName: '数据辅助智能体',
            agentIcon: '📊',
          });
        } else {
          addMessage({
            id: crypto.randomUUID(),
            role: 'system',
            content: `⚠️ ${payload.message}`,
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
  }), [addMessage, updateMessage, removeMessage, addPlan, updatePlan, updateStep, setStatus, setStreaming, setError, onPagesChange, onPageChange, onQuerySelect, onQueriesChange]);

  const runAgent = async (userMessage: string) => {
    const config = activeConfig || configs[0];
    if (!config || !config.model) {
      setError('请先在设置中配置 API Key 并选择模型');
      setActiveTab('settings');
      return;
    }

    const hasKey = await useLLMStore.getState().hasApiKey(config.provider);
    if (!hasKey) {
      setError('请先在设置中配置 API Key');
      setActiveTab('settings');
      return;
    }

    const sessionOptions: RouterSessionOptions = {
      providerType: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
      currentPageId,
      currentPageName,
      allPages,
      applicationId: appId,
      workspaceId: 0,
      onPagesChange,
      onPageChange,
      onQuerySelect,
      onQueriesChange,
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

    const userMsg = input;
    setInput('');

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
    console.log('[AgentPanel] ⏹ handleCancel 被调用');
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
      content: '❌ 计划已拒绝',
      timestamp: Date.now(),
    });
  };

  const handleContinuePlan = async (plan: Plan) => {
    confirmPlan(plan.id);
    upsertPlanMessage(plan.id);
    const doneSteps = plan.steps.filter((s) => s.status === 'done');
    const pendingSteps = plan.steps.filter((s) => s.status !== 'done');
    const doneSummary = doneSteps.map((s) => `- ${s.description} ✓`).join('\n');
    const pendingSummary = pendingSteps.map((s, i) => `${i + 1}. ${s.description}`).join('\n');
    const continueMsg = `继续执行计划。\n已完成：\n${doneSummary}\n剩余步骤：\n${pendingSummary}`;
    setInput('');
    await runAgent(continueMsg);
  };

  const handleTest = async (provider: ProviderType, baseUrl: string, apiKey: string) => {
    setTesting(true);
    setTestResult(null);
    setAvailableModels([]);
    try {
      const url = baseUrl.replace(/\/+$/, '') + '/models';
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const models: string[] = (data.data || [])
        .map((m: any) => m.id)
        .filter(Boolean)
        .sort();
      setAvailableModels(models);
      setTestResult('success');
      await useLLMStore.getState().setApiKey(provider, apiKey);
      useLLMStore.setState((s) => ({
        configs: s.configs.map((c) =>
          c.provider === provider ? { ...c, model: models[0] || '' } : c,
        ),
      }));
    } catch {
      setTestResult('fail');
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    (async () => {
      const store = useLLMStore.getState();
      for (const cfg of store.configs) {
        const key = await store.getApiKey(cfg.provider);
        if (key) {
          useLLMStore.setState((s) => ({
            configs: s.configs.map((c) =>
              c.provider === cfg.provider ? { ...c, apiKey: key } : c,
            ),
          }));
          if (!store.activeConfigId || store.activeConfigId === cfg.provider) {
            setSavedProvider(cfg.provider);
          }
        }
      }
    })();
  }, []);

  const handleSaveConfig = async (provider: ProviderType, baseUrl: string, model: string, apiKey: string) => {
    const store = useLLMStore.getState();
    await store.setApiKey(provider, apiKey);
    await vaultManager.setConfig(provider, { model, baseUrl });
    setSavedProvider(provider);
  };

  const handleClearConfig = async (provider: ProviderType) => {
    await vaultManager.deleteApiKey(provider);
    await vaultManager.deleteConfig(provider);
    useLLMStore.setState((s) => ({
      configs: s.configs.map((c) =>
        c.provider === provider ? { ...c, apiKey: '', model: '', baseUrl: c.baseUrl } : c,
      ),
    }));
    setTestResult(null);
    setAvailableModels([]);
    setSavedProvider(null);
  };

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
                    {step.status === 'done' ? '✅' : step.status === 'running' ? '⏳' : step.status === 'error' ? '❌' : '⬜'}
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
          <button className="ap-clear-btn" onClick={() => { reset(); setTokenUsage(null); chatRouterRef.current = null; }} title="清空对话和计划">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
            </svg>
          </button>
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
            <button
              className={`ap-tab ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              设置
            </button>
          </div>
        </div>
      </div>

      <div className="ap-body">
        {activeTab === 'settings' && (
          <div className="ap-settings">
            <div className="ap-settings-title">大模型配置</div>
            <p className="ap-settings-desc">选择一个模型并填写 API Key 以启用 AI 助手</p>

            <div className="ap-settings-providers">
              {PROVIDERS.map((p) => (
                <label
                  key={p.key}
                  className={`ap-provider-card ${(llmActiveId || configs[0]?.provider) === p.key ? 'active' : ''}`}
                >
                  <input
                    type="radio"
                    name="provider"
                    checked={(llmActiveId || configs[0]?.provider) === p.key}
                    onChange={async () => {
                      setActiveConfig(p.key);
                      setTestResult(null);
                      setAvailableModels([]);
                      const hasKey = await useLLMStore.getState().hasApiKey(p.key);
                      setSavedProvider(hasKey ? p.key : null);
                    }}
                  />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>

            {configs.map((cfg) => {
              const isActive = (llmActiveId || configs[0]?.provider) === cfg.provider;
              if (!isActive) return null;
              return (
                <div key={cfg.provider} className="ap-config-form">
                  <div className="ap-field">
                    <label>Base URL</label>
                    <input
                      type="text"
                      value={cfg.baseUrl}
                      onChange={(e) => {
                        useLLMStore.setState((s) => ({
                          configs: s.configs.map((c) =>
                            c.provider === cfg.provider ? { ...c, baseUrl: e.target.value } : c
                          ),
                        }));
                      }}
                    />
                  </div>
                  <div className="ap-field">
                    <label>API Key</label>
                    <div className="ap-field-row">
                      <input
                        type="password"
                        value={cfg.apiKey}
                        placeholder="sk-..."
                        onChange={(e) => {
                          setTestResult(null);
                          setAvailableModels([]);
                          setSavedProvider(null);
                          useLLMStore.setState((s) => ({
                            configs: s.configs.map((c) =>
                              c.provider === cfg.provider ? { ...c, apiKey: e.target.value } : c
                            ),
                          }));
                        }}
                      />
                      <button
                        className="ap-test-btn"
                        onClick={() => handleTest(cfg.provider, cfg.baseUrl, cfg.apiKey)}
                        disabled={testing || !cfg.apiKey.trim()}
                      >
                        {testing ? '测试中...' : '测试'}
                      </button>
                    </div>
                    {testResult === 'success' && (
                      <span className="ap-test-ok">连接成功 ✓</span>
                    )}
                    {testResult === 'fail' && (
                      <span className="ap-test-fail">连接失败，请检查 API Key 和 Base URL</span>
                    )}
                  </div>
                  <div className="ap-field">
                    <label>Model</label>
                    {testResult === 'success' && availableModels.length > 0 ? (
                      <select
                        value={cfg.model}
                        onChange={(e) => {
                          useLLMStore.setState((s) => ({
                            configs: s.configs.map((c) =>
                              c.provider === cfg.provider ? { ...c, model: e.target.value } : c
                            ),
                          }));
                        }}
                      >
                        {availableModels.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={cfg.model}
                        disabled
                        placeholder={testResult === 'fail' ? '测试失败，请检查配置' : '请先点击测试按钮'}
                      />
                    )}
                  </div>
                  <div className="ap-config-actions">
                    {savedProvider === cfg.provider ? (
                      <button
                        className="ap-btn-clear"
                        onClick={() => handleClearConfig(cfg.provider)}
                      >
                        清除配置
                      </button>
                    ) : (
                      <button
                        className="ap-btn-save-config"
                        disabled={!cfg.apiKey || !cfg.model}
                        onClick={() => handleSaveConfig(cfg.provider, cfg.baseUrl, cfg.model, cfg.apiKey)}
                      >
                        保存配置
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

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
            <div className="ap-messages">
              {messages.map((msg) => {
                const isPlanMsg = msg.role === 'plan';
                const roleLabel = (() => {
                  if (msg.role === 'user') return '你';
                  if (msg.role === 'tool') return '工具';
                  if (msg.agentName) return `${msg.agentIcon || ''} ${msg.agentName}`;
                  if (msg.role === 'assistant') return 'AI';
                  return '系统';
                })();
                return (
                  <div key={msg.id} className={`ap-message ${isPlanMsg ? 'ap-message-plan' : ''}`}>
                    <div className="ap-message-role">
                      {roleLabel}
                      {msg.isStreaming && <span className="ap-streaming-dot" />}
                    </div>
                    <div className={`ap-message-body ${msg.role}${msg.isStreaming ? ' streaming' : ''}`}>
                      {msg.role === 'assistant' || msg.role === 'plan' ? (
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      ) : (
                        <div className="ap-message-text">{msg.content}</div>
                      )}
                      {msg.toolCalls?.map((tc) => {
                        const statusIcon = tc.status === 'done' ? '✅' : tc.status === 'running' ? '⏳' : tc.status === 'error' ? '❌' : '⬜';
                        return (
                          <details key={tc.id} className="ap-tool-call">
                            <summary className="ap-tool-call-summary">
                              <span className="ap-tool-call-icon">{statusIcon}</span>
                              <span className="ap-tool-call-name">{tc.name}</span>
                              <span className={`ap-tool-call-status ${tc.status}`}>{tc.status}</span>
                            </summary>
                            <div className="ap-tool-call-detail">
                              <div className="ap-tool-call-section">
                                <div className="ap-tool-call-label">📥 输入</div>
                                <pre className="ap-tool-call-pre">{JSON.stringify(tc.arguments, null, 2)}</pre>
                              </div>
                              {tc.result && (
                                <div className="ap-tool-call-section">
                                  <div className="ap-tool-call-label">📤 输出</div>
                                  <pre className="ap-tool-call-pre">{tc.result}</pre>
                                </div>
                              )}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              

              {isStreaming && !messages.some((m) => m.isStreaming) && (
                <div className="ap-thinking">
                  <span className="ap-thinking-dot" />
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