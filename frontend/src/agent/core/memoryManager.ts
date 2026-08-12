import type { Message } from '@/types/agent';

const DB_NAME = 'luban-agent-memory';
const STORE_NAME = 'messages';
const DB_VERSION = 1;

interface StoredConversation {
  id: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

class MemoryManager {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    if (!this.initPromise) {
      this.initPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('updatedAt', 'updatedAt', { unique: false });
          }
        };

        request.onsuccess = () => {
          this.db = request.result;
          resolve(this.db);
        };

        request.onerror = () => {
          reject(new Error(`Failed to open Memory database: ${request.error?.message}`));
        };
      });
    }

    return this.initPromise;
  }

  private getScopedId(applicationId: string, sessionId: string): string {
    return `${applicationId}_${sessionId}`;
  }

  async saveConversation(
    applicationId: string,
    sessionId: string,
    messages: Message[],
  ): Promise<void> {
    const db = await this.getDB();
    const now = Date.now();
    const scopedId = this.getScopedId(applicationId, sessionId);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const getRequest = store.get(scopedId);
      getRequest.onsuccess = () => {
        const existing = getRequest.result as StoredConversation | undefined;
        const stored: StoredConversation = {
          id: scopedId,
          messages,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        const putRequest = store.put(stored);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () =>
          reject(new Error(`Failed to save conversation: ${putRequest.error?.message}`));
      };
      getRequest.onerror = () =>
        reject(new Error(`Failed to read conversation: ${getRequest.error?.message}`));
    });
  }

  async loadConversation(
    applicationId: string,
    sessionId: string,
  ): Promise<Message[]> {
    const db = await this.getDB();
    const scopedId = this.getScopedId(applicationId, sessionId);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(scopedId);

      request.onsuccess = () => {
        const stored = request.result as StoredConversation | undefined;
        resolve(stored?.messages ?? []);
      };

      request.onerror = () =>
        reject(new Error(`Failed to load conversation: ${request.error?.message}`));
    });
  }

  async deleteConversation(
    applicationId: string,
    sessionId: string,
  ): Promise<void> {
    const db = await this.getDB();
    const scopedId = this.getScopedId(applicationId, sessionId);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(scopedId);

      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(new Error(`Failed to delete conversation: ${request.error?.message}`));
    });
  }

  async listConversations(
    applicationId: string,
  ): Promise<Array<{ id: string; messageCount: number; updatedAt: number }>> {
    const db = await this.getDB();
    const prefix = `${applicationId}_`;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const conversations = request.result as StoredConversation[];
        resolve(
          conversations
            .filter((c) => c.id.startsWith(prefix))
            .map((c) => ({
              id: c.id,
              messageCount: c.messages.length,
              updatedAt: c.updatedAt,
            })),
        );
      };

      request.onerror = () =>
        reject(new Error(`Failed to list conversations: ${request.error?.message}`));
    });
  }

  async loadMessages(applicationId: string): Promise<Message[]> {
    const conversations = await this.listConversations(applicationId);
    if (conversations.length === 0) return [];
    const latest = conversations.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const parts = latest.id.split('_');
    const sessionId = parts.slice(1).join('_');
    return this.loadConversation(applicationId, sessionId);
  }

  async saveMessages(applicationId: string, messages: Message[]): Promise<void> {
    const sessionId = `session_${Date.now()}`;
    const conversations = await this.listConversations(applicationId);
    if (conversations.length > 0) {
      const latest = conversations.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const parts = latest.id.split('_');
      const existingSessionId = parts.slice(1).join('_');
      return this.saveConversation(applicationId, existingSessionId, messages);
    }
    return this.saveConversation(applicationId, sessionId, messages);
  }
}

export const memoryManager = new MemoryManager();