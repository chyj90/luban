import type { Message } from '@/types/agent';

const memoryCache = new Map<string, Map<string, Message[]>>();

export function getAgentMemory(applicationId: number, agentId: string): Message[] {
  const appKey = String(applicationId);
  const appCache = memoryCache.get(appKey);
  if (!appCache) return [];
  return appCache.get(agentId) || [];
}

export function setAgentMemory(applicationId: number, agentId: string, messages: Message[]): void {
  const appKey = String(applicationId);
  if (!memoryCache.has(appKey)) {
    memoryCache.set(appKey, new Map());
  }
  memoryCache.get(appKey)!.set(agentId, messages);
}

export function clearAppMemory(applicationId: number): void {
  memoryCache.delete(String(applicationId));
}