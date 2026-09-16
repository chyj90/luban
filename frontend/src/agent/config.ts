import type { ProviderType } from '@/types/agent';

export const AGENT_CONFIG = {
  maxIterations: 100,
  temperature: 0.3,
  timeout: 300000,
} as const;

export const PROVIDER_CONFIGS: Record<ProviderType, { label: string; defaultModel: string; defaultBaseUrl: string }> = {
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  anthropic: {
    label: 'Anthropic',
    defaultModel: 'claude-3-5-sonnet-20241022',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
  },
  google: {
    label: 'Google Gemini',
    defaultModel: 'gemini-2.0-flash',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  deepseek: {
    label: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
  },
  custom: {
    label: 'OpenAI 兼容接口',
    defaultModel: '',
    defaultBaseUrl: '',
  },
} as const;

export const DANGEROUS_TOOL_NAMES = ['delete_page', 'delete_query'] as const;