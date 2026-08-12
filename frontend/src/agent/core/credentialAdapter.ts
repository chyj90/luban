import type { CredentialStore } from '@dudko.dev/agent-web';
import { vaultManager } from './vaultManager';
import type { ProviderType } from '@/types/agent';

/**
 * 将 luban 的 vaultManager 包装为 @dudko.dev/agent-web 的 CredentialStore 接口。
 * credentialRef 直接使用 provider 类型字符串（如 'deepseek', 'openai'）。
 */
export function createCredentialStore(): CredentialStore {
  return {
    async getApiKey(ref: string): Promise<string | undefined> {
      const key = await vaultManager.getApiKey(ref as ProviderType);
      return key || undefined;
    },

    async setApiKey(ref: string, key: string): Promise<void> {
      await vaultManager.setApiKey(ref as ProviderType, key);
    },

    async deleteApiKey(ref: string): Promise<void> {
      await vaultManager.deleteApiKey(ref as ProviderType);
    },
  };
}