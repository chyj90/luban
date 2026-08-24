import type { ToolDefinition, ToolContext } from '@/types/agent';
import { buildInteliSystemPrompt } from '../prompts/systemPrompt';
import { buildDataAssistantPrompt } from '../prompts/dbaPrompt';
import { WORKFLOW_AGENT_PROMPT } from '../prompts/workflowAgent';
import { ANALYSIS_AGENT_PROMPT } from '../prompts/analysisAgent';
import { resolveSkills } from './skillRegistry';
import type { ChatRouter } from '../core/chatRouter';

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
  buildSystemPrompt: (_ctx: AgentContext) => string;
  /** 该 Agent 允许使用的技能 ID 列表，通过 Skill Registry 解析为工具 */
  allowedSkills: string[];
  /** @deprecated 使用 allowedSkills 替代，保留用于向后兼容 */
  buildTools?: (_ctx: ToolContext) => ToolDefinition[];
}

/**
 * 通过 Skill 注册表解析 Agent 的工具列表。
 * 这是 Agent 获取工具的新入口，替代硬编码的 buildTools。
 */
export function resolveAgentTools(
  agentDef: AgentDefinition,
  _ctx: ToolContext,
  chatRouter?: ChatRouter,
): ToolDefinition[] {
  // 优先使用 allowedSkills（新方式）
  if (agentDef.allowedSkills && agentDef.allowedSkills.length > 0) {
    return resolveSkills(agentDef.allowedSkills, ctx, chatRouter);
  }
  // 向后兼容：使用旧的 buildTools
  if (agentDef.buildTools) {
    return agentDef.buildTools(ctx);
  }
  return [];
}

export const AGENTS: AgentDefinition[] = [
  {
    id: 'main-agent',
    name: '主智能体',
    icon: '',
    description: '主智能体，负责设计页面、选择查询和API、生成代码',
    isDefault: true,
    buildSystemPrompt: (_ctx) =>
      buildInteliSystemPrompt(ctx.applicationId, ctx.pageId, ctx.pageName, ctx.allPages),
    allowedSkills: [
      'page:create', 'page:delete', 'page:rename',
      'code:create', 'code:get', 'code:update',
      'observation:list_pages', 'observation:record',
      'plan:create', 'plan:update', 'plan:update_item', 'plan:confirm',
      'plan:validate', 'plan:list_unfinished', 'plan:set_focus', 'plan:adjust',
      'delegate:query', 'delegate:workflow', 'delegate:analysis',
    ],
  },
  {
    id: 'data-assistant',
    name: '数据辅助智能体',
    icon: '',
    description: '数据辅助智能体，负责连接数据源、创建查询、执行调试',
    isDefault: false,
    buildSystemPrompt: (_ctx) =>
      buildDataAssistantPrompt({
        applicationId: ctx.applicationId,
        taskType: ctx.taskType || 'B单页面',
        targetPage: ctx.targetPage || ctx.pageName,
        requirements: ctx.requirements || [],
        existingQueries: ctx.existingQueries,
        modifyInstructions: ctx.modifyInstructions,
      }),
    allowedSkills: [
      'datasource:list', 'datasource:test', 'datasource:structure', 'datasource:connect',
      'query:list', 'query:create', 'query:update', 'query:delete', 'query:run', 'query:get',
    ],
  },
  {
    id: 'workflow-assistant',
    name: '流程设计助手',
    icon: '',
    description: '流程设计助手，负责设计表单、审批流程、查询组织、管理审批',
    isDefault: false,
    buildSystemPrompt: () => WORKFLOW_AGENT_PROMPT,
    allowedSkills: [
      'workflow:design_form', 'workflow:design', 'workflow:bind',
      'workflow:search_members', 'workflow:search_roles', 'workflow:search_departments',
      'workflow:list_instances', 'workflow:approve', 'workflow:reject',
      'workflow:freeze', 'workflow:unfreeze', 'workflow:cancel',
      'workflow:lint', 'workflow:copy', 'workflow:preview',
    ],
  },
  {
    id: 'analysis-assistant',
    name: '需求分析助手',
    icon: '',
    description: '需求分析助手，负责从业务视角分析用户需求，不涉及技术实现',
    isDefault: false,
    buildSystemPrompt: () => ANALYSIS_AGENT_PROMPT,
    allowedSkills: [
      'plan:create', 'plan:update', 'plan:update_item', 'plan:confirm',
      'plan:validate', 'plan:list_unfinished', 'plan:set_focus', 'plan:adjust',
    ],
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