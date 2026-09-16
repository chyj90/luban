import type { ToolDefinition, ToolContext } from '@/types/agent';
import { buildInteliSystemPrompt } from '../prompts/systemPrompt';
import { buildDataAssistantPrompt } from '../prompts/dbaPrompt';
import { buildWorkflowAgentPrompt } from '../prompts/workflowAgent';
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
      'code:component-spec', 'code:analysis-examples', 'code:dataquery-guide',
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
      '## DSL 契约（必须逐字段遵守；字段名写错会被静默忽略，导致节点变成空壳、校验莫名失败）',
      '顶层结构只允许两个字段：{ "nodes": [...], "edges": [...] }',
      '节点：{ "id": "唯一id", "nodeType": "start|query|http|python|transform|condition|parallel|workflow|subflow|output", "data": { "label": "可读名称", "config": { ...按类型填写 } } }',
      '⚠️ 字段名是 nodeType 不是 type；所有配置必须嵌套在 data.config 下，写在节点顶层会被忽略',
      '边：{ "source": "源节点id", "target": "目标节点id", "condition": "可选，条件表达式" }',
      '边条件表达式语法：直接引用上游 python 节点返回字段的裸变量名，不支持 $nodes 前缀。示例：上游 python 返回 {"is_approved": True}，则边条件写 is_approved == True。支持比较运算：== != < > <= >=，逻辑运算：&& ||，字面量：数字、单引号字符串、双引号字符串、True/False',
      'condition 节点：不需要在 data.config 中写 expression。分支条件写在从 condition 节点出发的边的 condition 字段上，变量名直接引用上游节点输出字段（裸变量名，同边条件语法）。示例：condition 节点 cond 的出边写 {"source":"cond","target":"node_a","condition":"is_approved == True"}',
      'data.config 按节点类型：',
      '- start：inputs: [{ "name": "参数名", "type": "string|number|boolean|object|array", "required": true, "defaultValue": 可选 }]',
      '- query：queryId: 数字（必须已存在的查询 ID）；paramsTemplate: { "查询参数名": "值或 $input.x / $nodes.节点id.路径" }',
      '- http：优先 toolId: 数字（平台已注册工具，用 list_apis 查询可用工具及其 ID）；url+method 直连仅限白名单地址，禁止编造内网 URL；写数据库必须用 query 节点（先让 DBA 创建写查询），禁止 http 直调数据库接口',
      '- python：source: 代码字符串（入口必须 def main(ctx)，ctx 为 {节点id: 输出} 字典）；packages 可选',
      '- transform：template: { "输出字段": "模板字符串" }',
      '- workflow：workflowAction: "start|get_status|approve|reject"；start 需 workflowDefinitionId（数字，流程必须已设计并发布，禁止按名称引用）+ formDataTemplate: { "表单字段": "值或 $input.x" }；get_status/approve/reject 需 instanceIdTemplate',
      '- subflow：subOrchestrationId: 数字（已发布的其他编排定义 ID，用 list_orchestrations 查询）。用于复用已有编排；⚠️ 含 subflow 的编排试运行会失败（开发态试运行不支持嵌套），lint 通过后直接发布，发布后正式执行才支持嵌套',
      '- output：无配置；编排返回值为各节点输出按节点 id 组成的字典，最终返回结构用 python 节点整形',
      '变量引用：$input.参数名（入口参数）、$nodes.节点id.字段路径（上游输出，数字段为数组下标）',
      '错误策略（所有节点可选）：data.config.strategy: "continue"（节点失败时置 __skipped__ 继续后续节点）| "fallback"（节点失败时以 data.config.template 作为该节点兜底输出继续）。不配置时任何节点失败即整体失败。需要容忍部分数据缺失的旁路查询（如可选的日志/统计查询）建议配 strategy',
      '校验硬规则：有且只有一个 start 和一个 output；节点 id 唯一；start 必须有出边、output 不能有出边；start 必须可达 output；python 只能 import 白名单模块（json/math/re/datetime/collections/itertools/statistics/decimal/typing/copy/textwrap/uuid/base64/hashlib/hmac/string）',
      '',
      '### 最小正确示例（查询 + python 汇总）',
      '```json',
      '{',
      '  "nodes": [',
      '    {"id": "start", "nodeType": "start", "data": {"label": "入参", "config": {"inputs": [{"name": "employeeNo", "type": "string", "required": true}]}}},',
      '    {"id": "q_leaves", "nodeType": "query", "data": {"label": "查请假记录", "config": {"queryId": 126, "paramsTemplate": {"employeeNo": "$input.employeeNo"}}}},',
      '    {"id": "py_sum", "nodeType": "python", "data": {"label": "汇总天数", "config": {"source": "def main(ctx):\\n    rows = ctx[\'q_leaves\'][\'rows\']\\n    return {\'total\': sum(r[\'days\'] for r in rows)}"}}},',
      '    {"id": "out", "nodeType": "output", "data": {"label": "输出", "config": {}}}',
      '  ],',
      '  "edges": [',
      '    {"source": "start", "target": "q_leaves"},',
      '    {"source": "q_leaves", "target": "py_sum"},',
      '    {"source": "py_sum", "target": "out"}',
      '  ]',
      '}',
      '```',
      '',
      '## 工作流（必须按序）',
      '1. 先用 list_queries / list_orchestrations / list_apis 探查可复用资源（禁止编造 queryId/toolId/workflowDefinitionId/subOrchestrationId）',
      '2. 需求或上下文带「编排资源契约：queryId 126=客户基础信息、…」时，DSL 引用的资源 ID 必须与契约一致，最终汇报必须原样复述该契约行',
      '2. 构造 DSL：严格按上方契约；若编排需要发起审批流程而流程尚未创建，直接说明"需先设计并发布流程，拿到流程定义 ID 后再建编排"，不要编造 workflowDefinitionId',
      '3. lint_orchestration 校验，未通过则按错误信息修正（未知字段错误必须把字段移到 data.config 下的正确位置，而不是换顶层结构重试）',
      '4. test_run_orchestration 试运行（构造样例输入），成功后向用户展示节点级结果',
      '5. 用户确认后再 publish_orchestration（发布需 MANAGE 权限）',
      '',
      '## 基础设施故障快速失败',
      '- 试运行返回 SANDBOX_POOL_DOWN（沙箱池不可用，可能附 reason：pool_empty/docker_down/image_missing/circuit_open）或 SANDBOX_HTTP_503 等基础设施错误时，**最多重试 1 次**；连续 2 次同类型基础设施错误即判定为服务不可用，停止重试',
      '- ⚠️ SANDBOX_POOL_DOWN 是基础设施告警，不是代码错误：必须在回复中**显式告知用户沙箱池不可用**（池状态可查 GET /v1/sandbox/health，池会自动重建），禁止静默换实现让故障无人知晓',
      '- 处理策略：移除依赖故障服务的节点（如 python 节点依赖沙箱），用替代方案（如由 output 节点直接返回上游查询结果），或向主智能体说明缺口等待恢复',
      '- 禁止对同一基础设施错误重试 3 次以上',
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
      'observation:list_queries', 'query:get', 'api:list',
    ],
  },
  {
    id: 'workflow-assistant',
    name: '流程设计助手',
    icon: '',
    description: '流程设计助手，负责设计表单、审批流程、查询组织、管理审批',
    isDefault: false,
    buildSystemPrompt: () => buildWorkflowAgentPrompt(),
    allowedSkills: [
      'workflow:design_form', 'workflow:design', 'workflow:update_definition', 'workflow:get_definition', 'workflow:bind',
      'workflow:list',
      'workflow:search_members', 'workflow:search_roles', 'workflow:search_departments',
      'workflow:list_instances', 'workflow:approve', 'workflow:reject',
      'workflow:freeze', 'workflow:unfreeze', 'workflow:cancel',
      'workflow:lint', 'workflow:copy', 'workflow:preview', 'workflow:publish',
      'orchestration:list', 'query:list', 'api:list'
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