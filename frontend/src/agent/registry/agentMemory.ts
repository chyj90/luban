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