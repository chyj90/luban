import { get, post } from './client';
import { useAuthStore } from '@/stores/authStore';

export interface MetricsOverview {
  totalRequests: number;
  sqlExecuted: number;
  sqlSuccess: number;
  sqlSuccessRate: number;
  permissionDenied: number;
  feedbackGiven: number;
  avgLlmLatencyMs: number;
  avgExecutionLatencyMs: number;
  avgTotalLatencyMs: number;
  decisionDistribution: Record<string, number>;
}

export interface ConceptHealth {
  conceptId: string;
  totalQueries: number;
  sqlSuccess: number;
  sqlTotal: number;
  sqlSuccessRate: number;
  feedbackCount: number;
}

export interface Anomaly {
  type: string;
  level: string;
  message: string;
  detail: string;
  time: string;
}

export interface FaissHealth {
  totalConcepts: number;
  embeddedCount: number;
  embeddingCoverage: number;
  indexes: number;
  isHealthy: boolean;
  lastRebuild: string;
}

export interface AgentChatParams {
  sessionId: string;
  message: string;
  systemId?: number;
  availableSystems?: { id: number; name: string; description: string }[];
  history?: { role: string; content: string }[];
}

export function getAgentMetricsOverview() {
  return get<MetricsOverview>('/agent-metrics/overview');
}

export function getAgentMetricsConceptHealth() {
  return get<ConceptHealth[]>('/agent-metrics/concept-health');
}

export function getAgentMetricsAnomalies() {
  return get<Anomaly[]>('/agent-metrics/recent-anomalies');
}

export function getFaissHealth() {
  return get<FaissHealth>('/agent-metrics/faiss-health');
}

export function agentChat(params: AgentChatParams) {
  return post<Record<string, unknown>>('/agent/chat', params);
}

export function agentChatStream(params: AgentChatParams): EventSource {
  const url = '/api/v1/agent/chat/stream';
  const body = JSON.stringify(params);
  // SSE 不支持 POST body，降级使用 fetch + ReadableStream
  // 返回一个 EventSource-like 对象的 URL 供外部使用
  throw new Error('Use fetchSSE for streaming');
}

export interface ChatMessageItem {
  id: string;
  role: string;
  content: string;
  messageId?: string;
  reasoning?: string;
  nl2sql?: string;
  conceptTrace?: unknown;
  selectDatasources?: unknown[];
  timestamp?: string;
}

export function getSessionMessages(sessionId: string) {
  return get<{ sessionId: string; messages: ChatMessageItem[] }>(`/agent/sessions/${sessionId}/messages`);
}

/**
 * 使用 XHR 实现 SSE 流式请求。
 * 必须用 XHR.onprogress（宏任务）而非 fetch ReadableStream（微任务），
 * 否则 React 18 自动批处理会将所有 setState 合并，导致流式输出失效。
 */
export function fetchAgentChatStream(
  params: AgentChatParams,
  onEvent: (event: string, data: string) => void,
  onError: (error: string) => void,
  onDone: () => void,
): { abort: () => void } {
  const xhr = new XMLHttpRequest();
  const token = useAuthStore.getState().token;

  xhr.open('POST', '/api/v1/agent/chat/stream');
  xhr.setRequestHeader('Content-Type', 'application/json');
  if (token) {
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
  }

  let lastProcessedIndex = 0;
  let eventName = '';
  let eventData = '';

  const flushEvent = () => {
    if (eventData !== '') {
      onEvent(eventName, eventData);
      eventName = '';
      eventData = '';
    }
  };

  const parseNewData = (fullText: string) => {
    const newText = fullText.slice(lastProcessedIndex);
    lastProcessedIndex = fullText.length;

    const lines = newText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        flushEvent();
      } else if (trimmed.startsWith('event:')) {
        flushEvent();
        eventName = trimmed.slice(6).trim();
      } else if (trimmed.startsWith('data:')) {
        const data = trimmed.slice(5).trim();
        eventData = eventData ? eventData + '\n' + data : data;
      }
    }
  };

  xhr.onreadystatechange = () => {
    if (xhr.readyState === 3) {
      parseNewData(xhr.responseText);
    } else if (xhr.readyState === 4) {
      if (xhr.status === 401) {
        useAuthStore.getState().logout();
        onError('登录已过期，请重新登录');
        return;
      }
      if (xhr.status >= 400) {
        const errorMsg = xhr.status === 403 ? '无权限访问'
          : xhr.status === 500 ? '服务器内部错误'
          : `请求失败 [${xhr.status}]`;
        onError(errorMsg);
        return;
      }
      parseNewData(xhr.responseText);
      flushEvent();
      onDone();
    }
  };

  xhr.onerror = () => {
    onError('网络请求失败');
  };

  xhr.send(JSON.stringify(params));

  return { abort: () => xhr.abort() };
}

export function clearChatSession(sessionId: string): Promise<{ data: { success: boolean } }> {
  return post('/agent/chat/clear', { sessionId });
}