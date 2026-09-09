import type { Message } from '@/types/agent';

const memoryCache = new Map<string, Map<string, Message[]>>();

export function getAgentMemory(applicationId: number, agentId: string): Message[] {
  const appKey = String(applicationId);
  const appCache = memoryCache.get(appKey);
  const result = appCache?.get(agentId) || [];
  console.log(`[agentMemory] GET ${agentId} | appId=${applicationId} | 返回 ${result.length} 条消息`);
  return result;
}

export function setAgentMemory(applicationId: number, agentId: string, messages: Message[]): void {
  console.log(`[agentMemory] SET ${agentId} | appId=${applicationId} | 保存 ${messages.length} 条消息`);
  const appKey = String(applicationId);
  if (!memoryCache.has(appKey)) {
    memoryCache.set(appKey, new Map());
  }
  memoryCache.get(appKey)!.set(agentId, messages);
}

export function clearAppMemory(applicationId: number): void {
  memoryCache.delete(String(applicationId));
}

// ============================================================================
// 委派记忆统一入口（需求 R5）：delegate:query 与 delegate:workflow 共用，
// 定义子智能体委派记忆的生命周期——随应用会话存活、条数有上限、大体积工具结果截断
// ============================================================================

const MAX_DELEGATION_MEMORY = 200;
const MAX_MEMORY_TOOL_CHARS = 8000;

/** 读取子智能体委派记忆（过滤 system 消息） */
export function loadDelegationMemory(applicationId: number, agentId: string): Message[] {
  return getAgentMemory(applicationId, agentId).filter((m) => m.role !== 'system');
}

/** 保存子智能体委派记忆：最多保留最近 200 条，超过 8000 字符的 tool 内容截断，防止无限膨胀 */
export function saveDelegationMemory(applicationId: number, agentId: string, messages: Message[]): void {
  const bounded = messages.slice(-MAX_DELEGATION_MEMORY).map((m) => {
    if (m.role === 'tool' && m.content.length > MAX_MEMORY_TOOL_CHARS) {
      return { ...m, content: `${m.content.slice(0, MAX_MEMORY_TOOL_CHARS)}…[历史工具结果已截断，原 ${m.content.length} 字符]` };
    }
    return m;
  });
  setAgentMemory(applicationId, agentId, bounded);
}
