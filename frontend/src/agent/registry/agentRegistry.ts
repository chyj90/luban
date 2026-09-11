import type { ToolDefinition, ToolContext } from '@/types/agent';
import { buildInteliSystemPrompt } from '../prompts/systemPrompt';
import { buildDataAssistantPrompt } from '../prompts/dbaPrompt';
import { WORKFLOW_AGENT_PROMPT } from '../prompts/workflowAgent';
import { resolveSkills } from './skillRegistry';
import type { ChatRouter } from '../core/chatRouter';

export interface AgentContext {
  applicationId: number;
  pageId: number;
  pageName: string;
  allPages: Array<{ id: number; name: string }>;
  targetPage?: string;
  queryName?: string;
  requirement?: string;
  requirements?: string[];
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
  ctx: ToolContext,
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
    buildSystemPrompt: (ctx) =>
      buildInteliSystemPrompt(ctx.applicationId, ctx.pageId, ctx.pageName, ctx.allPages),
    allowedSkills: [
      'page:delete', 'page:rename',
      'code:create', 'code:get', 'code:update', 'code:scaffold',
      'observation:list_pages', 'observation:list_queries', 'observation:record',
      'query:get',
      'plan:submit_analysis', 'plan:update', 'plan:update_item', 'plan:confirm',
      'plan:validate', 'plan:list_unfinished', 'plan:set_focus', 'plan:adjust',
      'delegate:query', 'delegate:workflow', 'delegate:orchestration',
    ],
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
        targetPage: ctx.targetPage || ctx.pageName,
        queryName: ctx.queryName || '',
        requirement: ctx.requirement || ctx.requirements?.join(', ') || '',
      }),
    allowedSkills: [
      'datasource:list', 'datasource:test', 'datasource:structure', 'datasource:connect',
      'query:list', 'query:create', 'query:update', 'query:delete', 'query:run', 'query:get', 'query:execute', 'query:references',
      'api:list', 'api:connect', 'api:test', 'api:delete',
    ],
  },
  {
    id: 'orchestration-assistant',
    name: '编排设计助手',
    icon: '',
    description: 'API 编排设计助手：根据需求生成 DSL（query/http/python/workflow 节点）、校验、试运行、发布',
    isDefault: false,
    buildSystemPrompt: () => [
      '你是 API 编排设计专家。用户用自然语言描述数据聚合/调用链需求，你产出编排 DSL 并完成校验、试运行、发布。',
      '',
      '## 设计哲学（必须遵守）',
      '编排 = 平台资源备菜 + Python 烹饪：query/http/workflow 节点负责经平台基础设施取数与调能力（权限/审计/凭据由平台保证），python 节点负责纯逻辑处理（沙箱无网络，不能直连任何外部数据）。禁止在 python 中尝试 import os/socket/requests 等模块。',
      '',
      '## 工作流（必须按序）',
      '1. 先用 list_queries / list_orchestrations 探查可复用资源（禁止编造 queryId/toolId）',
      '2. 构造 DSL：节点类型 start/query/http/workflow/python/transform/condition/parallel/output；变量引用 $input.x（入口参数）与 $nodes.节点id.路径（上游输出）',
      '3. lint_orchestration 校验，未通过则修正',
      '4. test_run_orchestration 试运行（构造样例输入），成功后向用户展示节点级结果',
      '5. 用户确认后再 publish_orchestration（发布需 MANAGE 权限）',
      '',
      '## python 节点约束',
      '- 入口必须 def main(ctx)：ctx 为上游输出字典',
      '- 只可 import 白名单模块（json/math/re/datetime/collections/itertools/statistics/decimal/typing/uuid/base64/hashlib）',
      '- 禁止 open/eval/exec/__import__/os/socket/subprocess/requests',
      '- 返回值必须是可 JSON 序列化的对象',
    ].join('\n'),
    allowedSkills: [
      'orchestration:create', 'orchestration:get', 'orchestration:save', 'orchestration:lint',
      'orchestration:testRun', 'orchestration:publish', 'orchestration:list', 'orchestration:executions',
      'observation:list_queries', 'query:get',
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
      'workflow:design_form', 'workflow:design', 'workflow:update_definition', 'workflow:get_definition', 'workflow:bind',
      'workflow:search_members', 'workflow:search_roles', 'workflow:search_departments',
      'workflow:list_instances', 'workflow:approve', 'workflow:reject',
      'workflow:freeze', 'workflow:unfreeze', 'workflow:cancel',
      'workflow:lint', 'workflow:copy', 'workflow:preview', 'workflow:publish',
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