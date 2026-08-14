import type { ToolDefinition, ToolContext } from '@/types/agent';
import { buildInteliSystemPrompt } from '../prompts/systemPrompt';
import { buildDataAssistantPrompt } from '../prompts/dbaPrompt';
import { createInteliTools } from '../tools';
import { createDataAssistantTools } from '../tools/dbaTools';

export interface AgentContext {
  applicationId: number;
  pageId: number;
  pageName: string;
  allPages: Array<{ id: number; name: string }>;
  workspaceId: number;
  taskType?: string;
  targetPage?: string;
  requirements?: string[];
  existingQueries?: Array<{ id: number; name: string; description: string }>;
  modifyInstructions?: string[];
}

export interface AgentDefinition {
  id: string;
  name: string;
  icon: string;
  description: string;
  isDefault: boolean;
  buildSystemPrompt: (ctx: AgentContext) => string;
  buildTools: (ctx: ToolContext) => ToolDefinition[];
}

export const AGENTS: AgentDefinition[] = [
  {
    id: 'main-agent',
    name: '主智能体',
    icon: '',
    description: '主智能体，负责设计页面、选择查询和API、生成代码',
    isDefault: true,
    buildSystemPrompt: (ctx) =>
      buildInteliSystemPrompt(ctx.applicationId, ctx.pageId, ctx.pageName, ctx.allPages),
    buildTools: (ctx) => createInteliTools(ctx),
  },
  {
    id: 'data-assistant',
    name: '数据辅助智能体',
    icon: '',
    description: '数据辅助智能体，负责连接数据源、创建查询、执行调试',
    isDefault: false,
    buildSystemPrompt: (ctx) =>
      buildDataAssistantPrompt({
        applicationId: ctx.applicationId,
        taskType: ctx.taskType || 'B单页面',
        targetPage: ctx.targetPage || ctx.pageName,
        requirements: ctx.requirements || [],
        existingQueries: ctx.existingQueries,
        modifyInstructions: ctx.modifyInstructions,
      }),
    buildTools: (ctx) => createDataAssistantTools(ctx),
  },
];

export function getAgentById(id: string): AgentDefinition | undefined {
  return AGENTS.find((a) => a.id === id);
}

export function getDefaultAgent(): AgentDefinition {
  return AGENTS.find((a) => a.isDefault) || AGENTS[0];
}

export function getAgentByName(name: string): AgentDefinition | undefined {
  return AGENTS.find((a) => a.name === name);
}

export function parseMentions(text: string): string[] {
  const matches = text.match(/@(\S+)/g);
  if (!matches) return [];
  return matches
    .map((m) => m.slice(1))
    .filter((name) => getAgentByName(name));
}

export function stripMentions(text: string): string {
  return text.replace(/@\S+/g, '').trim();
}