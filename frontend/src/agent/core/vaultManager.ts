import type { ProviderType } from '@/types/agent';

const DB_NAME = 'luban-agent-vault';
const STORE_NAME = 'credentials';
const DB_VERSION = 1;

export interface CredentialConfig {
  model: string;
  baseUrl: string;
}

class VaultManager {
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
            db.createObjectStore(STORE_NAME);
          }
        };

        request.onsuccess = () => {
          this.db = request.result;
          resolve(this.db);
        };

        request.onerror = () => {
          reject(new Error(`Failed to open Vault database: ${request.error?.message}`));
        };
      });
    }

    return this.initPromise;
  }

  async setApiKey(provider: ProviderType, apiKey: string): Promise<void> {
    const db = await this.getDB();
    const encrypted = await this.encrypt(apiKey);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(encrypted, `key_${provider}`);

      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(new Error(`Failed to store API key: ${request.error?.message}`));
    });
  }

  async getApiKey(provider: ProviderType): Promise<string | null> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(`key_${provider}`);

      request.onsuccess = async () => {
        const encrypted = request.result;
        if (!encrypted) {
          resolve(null);
          return;
        }
        try {
          const decrypted = await this.decrypt(encrypted);
          resolve(decrypted);
        } catch {
          resolve(null);
        }
      };

      request.onerror = () =>
        reject(new Error(`Failed to retrieve API key: ${request.error?.message}`));
    });
  }

  async hasApiKey(provider: ProviderType): Promise<boolean> {
    const key = await this.getApiKey(provider);
    return key !== null && key.length > 0;
  }

  async setConfig(provider: ProviderType, config: CredentialConfig): Promise<void> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(JSON.stringify(config), `config_${provider}`);

      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(new Error(`Failed to store config: ${request.error?.message}`));
    });
  }

  async getConfig(provider: ProviderType): Promise<CredentialConfig | null> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(`config_${provider}`);

      request.onsuccess = () => {
        const raw = request.result;
        if (!raw) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(raw) as CredentialConfig);
        } catch {
          resolve(null);
        }
      };

      request.onerror = () =>
        reject(new Error(`Failed to retrieve config: ${request.error?.message}`));
    });
  }

  async deleteConfig(provider: ProviderType): Promise<void> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(`config_${provider}`);

      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(new Error(`Failed to delete config: ${request.error?.message}`));
    });
  }

  async deleteApiKey(provider: ProviderType): Promise<void> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(`key_${provider}`);

      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(new Error(`Failed to delete API key: ${request.error?.message}`));
    });
  }

  async clearAll(): Promise<void> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(new Error(`Failed to clear Vault: ${request.error?.message}`));
    });
  }

  private async encrypt(plaintext: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    const key = await this.getOrCreateKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      data,
    );

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    return combined.buffer;
  }

  private async decrypt(encryptedData: ArrayBuffer): Promise<string> {
    const combined = new Uint8Array(encryptedData);
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);

    const key = await this.getOrCreateKey();

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data,
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }

  private async getOrCreateKey(): Promise<CryptoKey> {
    const keyUsage: KeyUsage[] = ['encrypt', 'decrypt'];
    const algorithm: AesKeyGenParams = { name: 'AES-GCM', length: 256 };

    const storedKey = await this.getStoredKey();
    if (storedKey) return storedKey;

    const key = await crypto.subtle.generateKey(algorithm, true, keyUsage);
    const exported = await crypto.subtle.exportKey('raw', key);

    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(exported, 'vault_master_key');

      request.onsuccess = () => resolve(key);
      request.onerror = () =>
        reject(new Error(`Failed to store master key: ${request.error?.message}`));
    });
  }

  private async getStoredKey(): Promise<CryptoKey | null> {
    const db = await this.getDB();

    return new Promise((resolve, _reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get('vault_master_key');

      request.onsuccess = async () => {
        const rawKey = request.result;
        if (!rawKey) {
          resolve(null);
          return;
        }
        try {
          const key = await crypto.subtle.importKey(
            'raw',
            rawKey,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt'],
          );
          resolve(key);
        } catch {
          resolve(null);
        }
      };

      request.onerror = () => resolve(null);
    });
  }
}

export const vaultManager = new VaultManager();