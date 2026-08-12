import { create } from 'zustand';
import type { LLMConfig, ProviderType } from '@/types/agent';
import { persist } from 'zustand/middleware';
import { vaultManager } from '@/agent/core/vaultManager';

interface LLMState {
  configs: LLMConfig[];
  activeConfigId: string | null;
  addConfig: (config: LLMConfig) => void;
  removeConfig: (id: string) => void;
  setActiveConfig: (id: string) => void;
  getActiveConfig: () => LLMConfig | undefined;
  setApiKey: (provider: ProviderType, apiKey: string) => Promise<void>;
  getApiKey: (provider: ProviderType) => Promise<string | null>;
  hasApiKey: (provider: ProviderType) => Promise<boolean>;
  clearAllConfigs: () => Promise<void>;
}

const defaultConfigs: LLMConfig[] = [
  {
    provider: 'openai',
    model: '',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    temperature: 0.7,
    maxTokens: 4096,
  },
  {
    provider: 'anthropic',
    model: '',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: '',
    temperature: 0.7,
    maxTokens: 4096,
  },
  {
    provider: 'deepseek',
    model: '',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    temperature: 0.7,
    maxTokens: 4096,
  },
];

export const useLLMStore = create<LLMState>()(
  persist(
    (set, get) => ({
      configs: defaultConfigs,
      activeConfigId: null,
      addConfig: (config) =>
        set((state) => ({ configs: [...state.configs, config] })),
      removeConfig: (id) =>
        set((state) => ({
          configs: state.configs.filter((c) => c.provider !== id),
          activeConfigId: state.activeConfigId === id ? null : state.activeConfigId,
        })),
      setActiveConfig: (id) => set({ activeConfigId: id }),
      getActiveConfig: () => {
        const { configs, activeConfigId } = get();
        return configs.find((c) => c.provider === activeConfigId);
      },
      setApiKey: async (provider, apiKey) => {
        await vaultManager.setApiKey(provider, apiKey);
        set((state) => ({
          configs: state.configs.map((c) =>
            c.provider === provider ? { ...c, apiKey } : c,
          ),
        }));
      },
      getApiKey: async (provider) => {
        return vaultManager.getApiKey(provider);
      },
      hasApiKey: async (provider) => {
        return vaultManager.hasApiKey(provider);
      },
      clearAllConfigs: async () => {
        await vaultManager.clearAll();
        set({ configs: defaultConfigs, activeConfigId: null });
      },
    }),
    {
      name: 'luban-llm-config',
      partialize: (state) => ({
        configs: state.configs.map((c) => ({ ...c, apiKey: '' })),
        activeConfigId: state.activeConfigId,
      }),
    },
  ),
);