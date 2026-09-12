import type { Message } from '@/types/agent';

const MAX_DELEGATION_MEMORY = 200;
const MAX_MEMORY_TOOL_CHARS = 8000;

export class AgentMemoryCache {
  private memoryCache = new Map<string, Map<string, Message[]>>();

  getAgentMemory(applicationId: number, agentId: string): Message[] {
    const appKey = String(applicationId);
    const appCache = this.memoryCache.get(appKey);
    const result = appCache?.get(agentId) || [];
    console.log(`[agentMemory] GET ${agentId} | appId=${applicationId} | 返回 ${result.length} 条消息`);
    return result;
  }

  setAgentMemory(applicationId: number, agentId: string, messages: Message[]): void {
    console.log(`[agentMemory] SET ${agentId} | appId=${applicationId} | 保存 ${messages.length} 条消息`);
    const appKey = String(applicationId);
    if (!this.memoryCache.has(appKey)) {
      this.memoryCache.set(appKey, new Map());
    }
    this.memoryCache.get(appKey)!.set(agentId, messages);
  }

  clearAppMemory(applicationId: number): void {
    this.memoryCache.delete(String(applicationId));
  }

  loadDelegationMemory(applicationId: number, agentId: string): Message[] {
    return this.getAgentMemory(applicationId, agentId).filter((m) => m.role !== 'system');
  }

  saveDelegationMemory(applicationId: number, agentId: string, messages: Message[]): void {
    const bounded = messages.slice(-MAX_DELEGATION_MEMORY).map((m) => {
      if (m.role === 'tool' && m.content.length > MAX_MEMORY_TOOL_CHARS) {
        return { ...m, content: `${m.content.slice(0, MAX_MEMORY_TOOL_CHARS)}…[历史工具结果已截断，原 ${m.content.length} 字符]` };
      }
      return m;
    });
    this.setAgentMemory(applicationId, agentId, bounded);
  }
}

const defaultCache = new AgentMemoryCache();

export function getAgentMemory(applicationId: number, agentId: string): Message[] {
  return defaultCache.getAgentMemory(applicationId, agentId);
}

export function setAgentMemory(applicationId: number, agentId: string, messages: Message[]): void {
  defaultCache.setAgentMemory(applicationId, agentId, messages);
}

export function clearAppMemory(applicationId: number): void {
  defaultCache.clearAppMemory(applicationId);
}

export function loadDelegationMemory(applicationId: number, agentId: string): Message[] {
  return defaultCache.loadDelegationMemory(applicationId, agentId);
}

export function saveDelegationMemory(applicationId: number, agentId: string, messages: Message[]): void {
  defaultCache.saveDelegationMemory(applicationId, agentId, messages);
}