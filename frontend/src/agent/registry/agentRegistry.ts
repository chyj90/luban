import type { ToolDefinition, ToolContext } from '@/types/agent';
import { buildInteliSystemPrompt } from '../prompts/systemPrompt';
import { buildDataAssistantPrompt } from '../prompts/dbaPrompt';
import { WORKFLOW_AGENT_PROMPT } from '../prompts/workflowAgent';
import { createInteliTools } from '../tools';
import { createDataAssistantTools } from '../tools/dbaTools';
import { createWorkflowTools } from '../tools/workflowTools';

export interface AgentContext {
  applicationId: number;
  pageId: number;
  pageName: string;
  allPages: Array<{ id: number; name: string }>;
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
  {
    id: 'workflow-assistant',
    name: '流程设计助手',
    icon: '',
    description: '流程设计助手，负责设计表单、审批流程、查询组织、管理审批',
    isDefault: false,
    buildSystemPrompt: () => WORKFLOW_AGENT_PROMPT,
    buildTools: (ctx) => createWorkflowTools(ctx),
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