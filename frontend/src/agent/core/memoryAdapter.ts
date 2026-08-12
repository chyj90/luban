import type { ContextStore, StoredMessage } from '@dudko.dev/agent-web';
import { memoryManager } from './memoryManager';

/**
 * 将 luban 的 memoryManager 包装为 @dudko.dev/agent-web 的 ContextStore 接口。
 * @param applicationId 应用 ID
 * @param agentId 智能体 ID（用于记忆隔离，不同 Agent 的上下文独立存储）
 */
export function createContextStore(applicationId: string, agentId: string = 'default'): ContextStore {
  const namespace = `${applicationId}::${agentId}`;

  return {
    async load(sessionId: string): Promise<StoredMessage[]> {
      const messages = await memoryManager.loadConversation(namespace, sessionId);
      return messages.map((m) => ({
        role: m.role as StoredMessage['role'],
        content: m.content,
        ts: m.timestamp,
      }));
    },

    async append(sessionId: string, message: StoredMessage): Promise<void> {
      const existing = await memoryManager.loadConversation(namespace, sessionId);
      existing.push({
        id: crypto.randomUUID(),
        role: message.role as 'user' | 'assistant' | 'system',
        content: message.content,
        timestamp: message.ts || Date.now(),
      });
      await memoryManager.saveConversation(namespace, sessionId, existing);
    },

    async replace(sessionId: string, messages: StoredMessage[]): Promise<void> {
      const converted = messages.map((m) => ({
        id: crypto.randomUUID(),
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        timestamp: m.ts || Date.now(),
      }));
      await memoryManager.saveConversation(namespace, sessionId, converted);
    },

    async clear(sessionId: string): Promise<void> {
      await memoryManager.saveConversation(namespace, sessionId, []);
    },
  };
}