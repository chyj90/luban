import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { useAgentStore } from '@/stores/agentStore';
import { verifyStepCompletion } from './stepVerifier';
import type { ToolExecuteResult, StepStatus } from '@/types/agent';

function generatePlanId(): string {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function generateItemId(): string {
  return `pi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

interface AnalysisPage {
  name: string;
  action: 'create' | 'update';
  queries: Array<{ queryName: string; purpose: string; needsNewTable?: boolean; fields?: string; filterParams?: string; queryId?: number }>;
  apis: Array<{ apiName: string; purpose: string }>;
  orchestrations: Array<{ orchName: string; purpose: string }>;
  noDataNeeded?: boolean;
  libraries?: string[];
}

interface AnalysisWorkflow {
  description: string;
  hasForm: boolean;
  formDescription?: string;
  hasWorkflow: boolean;
  workflowDescription?: string;
}

interface AnalysisData {
  title: string;
  summary: string;
  pages: AnalysisPage[];
  workflows: AnalysisWorkflow[];
  interactions?: string[];
  analysisReport?: string;
  score?: {
    moduleDetail: number;
    interactionComplexity: number;
    dataCoverage: number;
    fieldSpecificity: number;
    deductions?: Array<{ rule?: string; reason: string; points: number }>;
  };
}

interface ScoreDeduction {
  rule: string;
  points: number;
  reason: string;
}

interface AnalysisScore {
  total: number;
  dimensions: {
    moduleDetail: number;
    interactionComplexity: number;
    dataCoverage: number;
    fieldSpecificity: number;
  };
  deductions: ScoreDeduction[];
}

function validateAnalysisBasics(analysis: AnalysisData): ScoreDeduction[] {
  const deductions: ScoreDeduction[] = [];
  const allPages = analysis.pages || [];

  const report = analysis.analysisReport || '';
  const hasFilterFields = /筛选字段[：:]/.test(report) && !/筛选字段[：:]\s*无/.test(report);

  for (const page of allPages) {
    for (const q of page.queries) {
      if (q.needsNewTable && !q.fields) {
        deductions.push({ rule: 'missing_fields', points: -8, reason: `查询 ${q.queryName} needsNewTable=true 但未填写 fields，请填写字段列表或改为 false` });
      }
      if (hasFilterFields && !q.filterParams) {
        deductions.push({ rule: 'missing_filter_params', points: -10, reason: `查询 ${q.queryName} 未提供 filterParams，但分析报告中存在筛选字段。请声明筛选参数，DBA 会据此生成参数化 SQL` });
      }
    }
  }

  return deductions;
}

export interface PlanItem {
  id: string;
  category: string;
  description: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  dependencies: string[];
}

/** 由分析数据自动推导计划步骤（导出供 agentSelfCheck 回归校验） */
export function derivePlanFromAnalysis(analysis: AnalysisData): PlanItem[] {
  const items: PlanItem[] = [];
  let idCounter = 1;
  const nextId = () => String(idCounter++);

  // 同一页面的多个查询合并为一次 delegate_query 委派：DBA 在同一轮对话中连续创建，
  // 只需一次重名探查与表结构加载（chat.log 实测 4 次独立委派串行耗时近 2 分钟）。
  // 注意：查询与页面在分析格式中是一一声明绑定的，页面步骤只依赖自己页面的查询批次；
  // 极少数跨页面复用同名查询的场景由 DBA 的重名检查兜底。
  const pageQueryStep = new Map<string, string>();

  for (const page of analysis.pages) {
    // 已有查询（queryId 已填）只做页面绑定，不生成创建步骤——避免 DBA 重复创建的空转委派
    const creatableQueries = page.queries.filter((q) => !q.queryId);
    if (page.noDataNeeded || creatableQueries.length === 0) continue;
    const stepId = nextId();
    pageQueryStep.set(page.name, stepId);

    const parts: string[] = [];
    const queryNames: string[] = [];
    let primaryFilterParams: string | undefined;
    for (const q of creatableQueries) {
      queryNames.push(q.queryName);
      let part = `创建查询 ${q.queryName}（用途：${q.purpose}）`;
      if (q.needsNewTable && q.fields) {
        part += `，需要新表（DBA 建表 + 插入测试数据），字段：${q.fields}`;
      }
      if (q.filterParams) {
        part += `，筛选参数：${q.filterParams}`;
        if (!primaryFilterParams) primaryFilterParams = q.filterParams;
      }
      parts.push(part);
    }
    const desc = parts.join('；');

    items.push({
      id: stepId,
      category: 'datasource',
      description: desc,
      toolName: 'delegate_query',
      toolInput: {
        requirement: `为页面「${page.name}」创建以下查询，请在本轮对话中连续完成全部查询（仅在最开始做一次重名探查和表结构确认）：${desc}`,
        // 结构化多查询声明：校验器按查询逐一校验筛选参数覆盖。
        // 保留 query_name/filter_params（主查询）以兼容旧校验逻辑
        queries: page.queries.map((q) => ({
          query_name: q.queryName,
          ...(q.filterParams ? { filter_params: q.filterParams } : {}),
        })),
        query_name: queryNames[0],
        filter_params: primaryFilterParams,
      },
      dependencies: [],
    });
  }

  // pages[].orchestrations → delegate_orchestration 步骤，依赖对应页面的查询步骤
  const pageOrchStep = new Map<string, string>();
  for (const page of analysis.pages) {
    if (!page.orchestrations || page.orchestrations.length === 0) continue;
    const stepId = nextId();
    pageOrchStep.set(page.name, stepId);
    const ownQueryStep = pageQueryStep.get(page.name);
    const queryNames = page.queries.map(q => q.queryName);
    const orchDescriptions = page.orchestrations.map(o => `${o.orchName}（${o.purpose}）`).join('；');

    items.push({
      id: stepId,
      category: 'datasource',
      description: `创建编排 ${orchDescriptions}`,
      toolName: 'delegate_orchestration',
      toolInput: {
        requirement: `为页面「${page.name}」创建以下编排，引用的查询为 ${queryNames.join('、')}：${orchDescriptions}。编排创建后需发布，发布的 ToolDefinition id 需回传给页面绑定`,
        context: `页面: ${page.name}，查询: ${queryNames.join('、')}`,
      },
      dependencies: ownQueryStep ? [ownQueryStep] : [],
    });
  }

  for (const page of analysis.pages) {
    const stepId = nextId();
    const isCreate = page.action === 'create';
    const toolName = isCreate ? 'create_code_page' : 'update_code_page';
    const ownQueryStep = pageQueryStep.get(page.name);
    const ownOrchStep = pageOrchStep.get(page.name);
    const deps: string[] = [];
    if (!page.noDataNeeded && ownQueryStep) deps.push(ownQueryStep);
    if (ownOrchStep) deps.push(ownOrchStep);

    const queryNames = page.queries.map(q => q.queryName);
    const existingQueryIds = page.queries.map(q => q.queryId).filter((id): id is number => typeof id === 'number');
    const apiNames = (page.apis || []).map(a => a.apiName);
    let desc = isCreate ? `创建页面「${page.name}」` : `更新页面「${page.name}」`;
    if (queryNames.length > 0) {
      desc += `，绑定查询 ${queryNames.join('、')}`;
    }
    if (apiNames.length > 0) {
      desc += `，绑定 API ${apiNames.join('、')}`;
    }
    if (page.libraries && page.libraries.length > 0) {
      desc += `，引入外部库 ${page.libraries.join('、')}`;
    }
    if (isCreate) {
      desc += `（大屏/多模块页面推荐用 create_page_scaffold + update_code_page 完成本步骤）`;
    }

    items.push({
      id: stepId,
      category: 'code_page',
      description: desc,
      toolName,
      toolInput: {
        name: page.name,
        ...(existingQueryIds.length > 0 ? { queryIds: existingQueryIds } : {}),
      },
      dependencies: deps,
    });
  }

  for (const wf of analysis.workflows) {
    if (wf.hasForm) {
      const stepId = nextId();
      items.push({
        id: stepId,
        category: 'datasource',
        description: wf.formDescription || `设计表单：${wf.description}`,
        toolName: 'delegate_workflow',
        toolInput: {
          task_type: 'design_form',
          requirement: wf.formDescription || wf.description,
        },
        dependencies: [],
      });

      if (wf.hasWorkflow) {
        const wfStepId = nextId();
        items.push({
          id: wfStepId,
          category: 'datasource',
          description: wf.workflowDescription || `设计流程：${wf.description}`,
          toolName: 'delegate_workflow',
          toolInput: {
            task_type: 'design_workflow',
            requirement: wf.workflowDescription || wf.description,
          },
          dependencies: [stepId],
        });
      }
    } else if (wf.hasWorkflow) {
      const stepId = nextId();
      items.push({
        id: stepId,
        category: 'datasource',
        description: wf.workflowDescription || `设计流程：${wf.description}`,
        toolName: 'delegate_workflow',
        toolInput: {
          task_type: 'design_workflow',
          requirement: wf.workflowDescription || wf.description,
        },
        dependencies: [],
      });
    }
  }

  return items;
}

function buildPlanSummary(plan: {
  agentIcon?: string;
  agentName?: string;
  steps: Array<{ description: string; status: string; result?: string }>;
  status: string;
}): string {
  const statusLabel = (() => {
    switch (plan.status) {
      case 'draft': return '[待确认]';
      case 'confirmed': return '[执行中]';
      case 'executing': return '[执行中]';
      case 'completed': return '[已完成]';
      case 'rejected': return '[已拒绝]';
      case 'stopped': return '[已停止]';
      default: return '';
    }
  })();
  const agentHeader = `**${plan.agentName || '计划'}** ${statusLabel}`;
  const steps = plan.steps.map((s) => {
    const statusIcon = s.status === 'done' ? '[完成]' : s.status === 'running' ? '[执行中]' : s.status === 'error' ? '[失败]' : '[待定]';
    const result = s.result ? ` - ${s.result}` : '';
    return `${statusIcon} ${s.description}${result}`;
  }).join('\n\n');
  return `${agentHeader}\n\n${steps}`;
}

export function upsertPlanMessage(planId: string) {
  const store = useAgentStore.getState();
  const plan = store.plans.find((p) => p.id === planId);
  if (!plan) return;
  const content = buildPlanSummary(plan);
  const existingMsg = store.messages.find((m) => m.role === 'plan' && m.planId === planId);
  if (existingMsg) {
    store.updateMessage(existingMsg.id, { content, timestamp: Date.now() });
  } else {
    store.addMessage({
      id: `plan-msg-${planId}`,
      role: 'plan',
      content,
      timestamp: Date.now(),
      agentId: plan.agentId,
      agentName: plan.agentName,
      agentIcon: plan.agentIcon,
      planId,
    });
  }
}

const VALID_PLAN_TOOL_NAMES = new Set([
  'create_code_page',
  'update_code_page',
  'delegate_query',
  'delegate_workflow',
]);

export function createPlanInternal(
  title: string,
  _summary: string,
  items: PlanItem[],
  score?: AnalysisScore,
  analysisReport?: string,
): { planId: string; message: string } {
  const store = useAgentStore.getState();
  const planId = generatePlanId();
  const plan = {
    id: planId,
    agentId: 'main-agent',
    agentName: '主智能体',
    agentIcon: '',
    steps: items.map((item, index) => ({
      id: item.id || generateItemId(),
      description: item.description || '',
      status: 'pending' as const,
      order: index,
      toolName: item.toolName,
    })),
    createdAt: Date.now(),
    status: 'draft' as const,
    score,
    analysisReport,
  };
  store.addPlan(plan);
  store.setStatus('idle');
  upsertPlanMessage(planId);

  let message = `计划「${title}」已创建，计划 ID: ${planId}，共 ${items.length} 个步骤，等待用户确认。`;
  const activePlans = store.plans.filter((p) => p.status === 'confirmed' || p.status === 'executing');
  if (activePlans.length > 0) {
    const activeList = activePlans.map((p) => {
      const doneCount = p.steps.filter((s) => s.status === 'done').length;
      return `  - ${p.id}「${p.agentName}」${doneCount}/${p.steps.length} 已完成`;
    }).join('\n');
    message += `\n\n⚠️ 当前存在 ${activePlans.length} 个活跃计划，新计划创建后将覆盖旧计划：\n${activeList}\n\n如本次创建是用户明确要求的新需求，请忽略此提醒。`;
  }
  return { planId, message };
}

export const planSkills: Record<string, SkillFactory> = {
  'plan:submit_analysis': () => ({
    id: 'plan:submit_analysis',
    category: SkillCategory.PLAN,
    name: 'submit_analysis',
    description: `提交需求分析结果并自评打分。系统会自动从分析数据推导出执行计划，无需手动构造步骤。

⚠️ 必须在输出分析报告文本的同一个 assistant message 中调用此工具。
⚠️ interactions 必须从分析报告第 8 章逐条提取。
⚠️ analysisReport 为必填，将完整分析报告文本传入，执行阶段会注入此报告作为上下文。
⚠️ score 为必填，按评分标准自评（评分标准见系统提示词「分析评分标准」章节）。`,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '需求标题' },
        summary: { type: 'string', description: '需求概要，一句话描述目标' },
        pages: {
          type: 'array',
          description: '页面列表（来自分析报告第 3 章 + 第 7 章）',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '页面名称' },
              action: { type: 'string', enum: ['create', 'update'], description: 'create=新建页面，update=修改已有页面' },
              queries: {
                type: 'array',
                description: '该页面需要的查询列表（包括读查询和写查询）。⚠️ 如果页面有新增/编辑/删除等写操作，必须声明对应的写查询（INSERT/UPDATE/DELETE），否则代码只能写 TODO 假成功，数据不会持久化。例如：客户管理页面需要 getCustomerList(读)、insertCustomer(新增)、updateCustomer(编辑)、deleteCustomer(删除) 四个查询。监控大屏等纯展示页面只需读查询即可。',
                items: {
                  type: 'object',
                  properties: {
                    queryName: { type: 'string', description: '查询名称（英文驼峰，如 GetAlertsWide / InsertCustomer / UpdateCustomer / DeleteCustomer）' },
                    queryId: { type: 'number', description: '查询已存在时填写其 ID——系统只绑定到页面、不会生成创建步骤。探查发现同名查询已存在时必须填写，禁止把已有查询放到 apis（apis 仅用于平台 API/工具）' },
                    purpose: { type: 'string', description: '用途描述（如：查询客户列表 / 新增客户 / 编辑客户 / 删除客户）' },
                    needsNewTable: { type: 'boolean', description: '是否需要新表（Agent 禁止 DDL，建表需人工操作）' },
                    fields: { type: 'string', description: '宽表字段（needsNewTable=true 时必填，逗号分隔，如 id,name,status）' },
                    filterParams: { type: 'string', description: '筛选参数描述（来自第5章筛选字段），格式：参数名(类型,匹配方式)，逗号分隔，如 keyword(文本,模糊搜索name), level(选项,精确匹配)。仅读查询需要，写查询不需要' },
                  },
                  required: ['queryName', 'purpose'],
                },
              },
              apis: {
                type: 'array',
                description: '该页面需要引用的**已有**平台 API/工具（无需新建，如已有的查询工具、HTTP 端点）',
                items: {
                  type: 'object',
                  properties: {
                    apiName: { type: 'string', description: '平台 API 名称' },
                    purpose: { type: 'string', description: '用途' },
                  },
                  required: ['apiName'],
                },
              },
              orchestrations: {
                type: 'array',
                description: '该页面需要**新建**的编排（Orchestration），系统会自动生成 delegate_orchestration 步骤',
                items: {
                  type: 'object',
                  properties: {
                    orchName: { type: 'string', description: '编排名称（如 OrcLeaveApply）' },
                    purpose: { type: 'string', description: '编排用途（如：先查请假记录再发起审批）' },
                  },
                  required: ['orchName'],
                },
              },
              noDataNeeded: { type: 'boolean', description: '是否不需要数据（纯展示/样式调整）' },
              libraries: { type: 'array', items: { type: 'string' }, description: '需要引入的外部库 CDN URL（ECharts 已内置无需添加，禁止使用 Leaflet）' },
            },
            required: ['name', 'action'],
          },
        },
        workflows: {
          type: 'array',
          description: '流程列表（来自分析报告第 2 章流程模块）',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string', description: '流程描述' },
              hasForm: { type: 'boolean', description: '是否需要设计表单' },
              formDescription: { type: 'string', description: '表单设计描述（hasForm=true 时填写）' },
              hasWorkflow: { type: 'boolean', description: '是否需要设计审批流程' },
              workflowDescription: { type: 'string', description: '流程设计描述（hasWorkflow=true 时填写）' },
            },
            required: ['description', 'hasForm', 'hasWorkflow'],
          },
        },
        interactions: {
          type: 'array',
          description: '交互联动列表（来自分析报告第 8 章），每条为触发→响应描述',
          items: { type: 'string' },
        },
        analysisReport: {
          type: 'string',
          description: '完整分析报告文本（必填），执行阶段会注入此报告作为上下文，确保每步执行能获取完整分析内容',
        },
        score: {
          type: 'object',
          description: '自评打分（必填），按评分标准逐维度评分',
          properties: {
            moduleDetail: { type: 'number', description: '模块展开深度（0-25）' },
            interactionComplexity: { type: 'number', description: '交互复杂度（0-25）' },
            dataCoverage: { type: 'number', description: '数据需求覆盖度（0-25）' },
            fieldSpecificity: { type: 'number', description: '字段具体性（0-25）' },
            deductions: {
              type: 'array',
              description: '扣分项列表',
              items: {
                type: 'object',
                properties: {
                  reason: { type: 'string', description: '扣分原因' },
                  points: { type: 'number', description: '扣分值（负数）' },
                },
                required: ['reason', 'points'],
              },
            },
          },
          required: ['moduleDetail', 'interactionComplexity', 'dataCoverage', 'fieldSpecificity'],
        },
      },
      required: ['title', 'summary', 'pages', 'workflows', 'interactions', 'analysisReport', 'score'],
    },
    async execute(args): Promise<ToolExecuteResult> {
      const analysis = args as unknown as AnalysisData;

      if ((!analysis.pages || analysis.pages.length === 0) && (!analysis.workflows || analysis.workflows.length === 0)) {
        return { success: false, message: 'pages 和 workflows 不能同时为空，请至少提供一个页面或流程' };
      }

      const basicErrors = validateAnalysisBasics(analysis);
      if (basicErrors.length > 0) {
        const errorLines = basicErrors.map(d => `  - ${d.reason}`).join('\n');
        return { success: false, message: `分析数据存在基础错误，请修正后重新提交：\n${errorLines}` };
      }

      const llmScore = analysis.score;
      if (!llmScore || llmScore.moduleDetail === undefined || llmScore.interactionComplexity === undefined || llmScore.dataCoverage === undefined || llmScore.fieldSpecificity === undefined) {
        return { success: false, message: 'score 为必填，请按评分标准（模块展开深度、交互复杂度、数据覆盖度、字段具体性，各 0-25 分）自评打分后重新提交' };
      }

      if (!analysis.analysisReport || analysis.analysisReport.trim().length < 50) {
        return { success: false, message: 'analysisReport 为必填，请将完整分析报告文本传入，执行阶段需要此报告作为上下文' };
      }

      const score: AnalysisScore = {
        total: llmScore.moduleDetail + llmScore.interactionComplexity + llmScore.dataCoverage + llmScore.fieldSpecificity,
        dimensions: {
          moduleDetail: llmScore.moduleDetail,
          interactionComplexity: llmScore.interactionComplexity,
          dataCoverage: llmScore.dataCoverage,
          fieldSpecificity: llmScore.fieldSpecificity,
        },
        deductions: (llmScore.deductions || []).map(d => ({ rule: d.rule || 'unknown', points: d.points, reason: d.reason })),
      };

      // 平台已内置 ECharts/中国地图，libraries 里的相关 CDN（china.js/geoJSON 等）
      // 会被当 <script> 注入且必然失败——直接剥离并在返回消息中说明，免去模型自我纠偏
      const BUILTIN_LIB_PATTERN = /echarts|china\.js|geo\.datav\.aliyun\.com|\.json(\?|$)/i;
      const removedLibs: string[] = [];
      analysis.pages = analysis.pages.map((p) => {
        if (!p.libraries || p.libraries.length === 0) return p;
        const kept = p.libraries.filter((u) => {
          if (BUILTIN_LIB_PATTERN.test(u)) { removedLibs.push(u); return false; }
          return true;
        });
        return { ...p, libraries: kept };
      });

      const items = derivePlanFromAnalysis(analysis);

      if (items.length === 0) {
        return { success: false, message: '从分析数据推导出的计划步骤为空，请检查 pages 和 workflows 数据' };
      }

      const { planId, message } = createPlanInternal(analysis.title, analysis.summary, items, score, analysis.analysisReport);

      const stepSummary = items.map((item, i) => `  ${i + 1}. [${item.toolName}] ${item.description}`).join('\n');

      let scoreMsg = `\n\n分析评分：${score.total}/100`;
      if (score.deductions.length > 0) {
        const deductionLines = score.deductions.map(d => `  - ${d.reason}（${d.points}分）`).join('\n');
        scoreMsg += `\n扣分项：\n${deductionLines}`;
      }
      if (score.total < 70) {
        scoreMsg += '\n\n⚠️ 评分低于 70 分阈值，建议补充以上内容后重新分析，或回复"继续"跳过评分直接执行。';
      }
      if (removedLibs.length > 0) {
        scoreMsg += `\n\nℹ️ 已自动移除 libraries 中的内置能力 CDN（平台已内置 ECharts 与中国地图，无需也不应引入）：${[...new Set(removedLibs)].join('、')}`;
      }

      return {
        success: true,
        message: `${message}\n\n系统自动推导的执行步骤：\n${stepSummary}${scoreMsg}`,
        data: { planId, title: analysis.title, summary: analysis.summary, items, score },
        _pause: true,
      };
    },
  }),

  'plan:update': () => ({
    id: 'plan:update',
    category: SkillCategory.PLAN,
    name: 'update_plan',
    description: '更新计划。追加、删除或替换步骤。',
    parameters: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: '目标计划 ID' },
        action: { type: 'string', enum: ['append', 'remove', 'replace'], description: '操作类型' },
        step_index: { type: 'number', description: '步骤索引（从0开始）' },
        new_description: { type: 'string', description: '新步骤描述' },
        new_tool_name: { type: 'string', description: '新步骤工具名称' },
      },
      required: ['plan_id', 'action'],
    },
    async execute(args): Promise<ToolExecuteResult> {
      const typedArgs = args as { plan_id: string; action: string; step_index?: number; new_description?: string; new_tool_name?: string };
      const store = useAgentStore.getState();
      const plan = store.plans.find((p) => p.id === typedArgs.plan_id);
      if (!plan) return { success: false, message: `未找到计划 ${typedArgs.plan_id}` };

      const newToolName = typedArgs.new_tool_name;
      if (newToolName && !VALID_PLAN_TOOL_NAMES.has(newToolName)) {
        return { success: false, message: `toolName "${newToolName}" 无效，只能使用：${[...VALID_PLAN_TOOL_NAMES].join('、')}` };
      }

      switch (typedArgs.action) {
        case 'append': {
          if (!typedArgs.new_description) return { success: false, message: 'append 操作需要 new_description' };
          const newStep = { id: `step_${Date.now()}`, description: typedArgs.new_description, status: 'pending' as const, order: plan.steps.length, toolName: typedArgs.new_tool_name };
          store.updatePlan(typedArgs.plan_id, { steps: [...plan.steps, newStep] });
          upsertPlanMessage(typedArgs.plan_id);
          return { success: true, message: `已追加步骤：${typedArgs.new_description}` };
        }
        case 'remove': {
          if (typedArgs.step_index === undefined) return { success: false, message: 'remove 操作需要 step_index' };
          const filtered = plan.steps.filter((_, i) => i !== typedArgs.step_index).map((s, i) => ({ ...s, order: i }));
          store.updatePlan(typedArgs.plan_id, { steps: filtered });
          upsertPlanMessage(typedArgs.plan_id);
          return { success: true, message: `已删除步骤 ${typedArgs.step_index}` };
        }
        case 'replace': {
          if (typedArgs.step_index === undefined || !typedArgs.new_description) return { success: false, message: 'replace 操作需要 step_index 和 new_description' };
          const updated = plan.steps.map((s, i) => i === typedArgs.step_index ? { ...s, description: typedArgs.new_description!, toolName: typedArgs.new_tool_name } : s);
          store.updatePlan(typedArgs.plan_id, { steps: updated });
          upsertPlanMessage(typedArgs.plan_id);
          return { success: true, message: `已替换步骤 ${typedArgs.step_index}` };
        }
        default: return { success: false, message: `未知操作：${typedArgs.action}` };
      }
    },
  }),

  'plan:update_item': (ctx) => ({
    id: 'plan:update_item',
    category: SkillCategory.PLAN,
    name: 'update_plan_item',
    description: '更新计划中某个步骤的状态。每完成一个步骤后必须调用此工具标记状态。',
    parameters: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: '计划 ID' },
        item_id: { type: 'string', description: '步骤 ID' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'skipped'], description: '新状态' },
        result: { type: 'string', description: '执行结果摘要' },
      },
      required: ['plan_id', 'item_id', 'status'],
    },
    async execute(args): Promise<ToolExecuteResult> {
      const { plan_id, item_id, status, result } = args as { plan_id: string; item_id: string; status: string; result?: string };
      const store = useAgentStore.getState();
      const plan = store.plans.find((p) => p.id === plan_id);
      if (!plan) {
        const activeIds = store.plans.filter((p) => p.status === 'confirmed' || p.status === 'executing').map((p) => p.id);
        const hint = activeIds.length > 0 ? `，当前活跃计划 ID: ${activeIds.join(', ')}` : '，当前无活跃计划';
        return { success: false, message: `未找到计划 "${plan_id}"${hint}。请使用 submit_analysis 返回的正确 planId 重试 update_plan_item，不要重新创建计划。` };
      }
      const step = plan.steps.find((s) => String(s.id) === String(item_id));
      if (!step) return { success: false, message: `未找到步骤 ${item_id}，当前计划步骤 ID 为：${plan.steps.map((s) => s.id).join(', ')}` };

      // R2 步骤完成核验：标记 completed 前验证副作用真实存在，杜绝"工具失败但谎报完成"
      if (status === 'completed' && step.toolName) {
        const verify = await verifyStepCompletion(
          step.toolName!,
          Number(ctx.applicationId),
          step.description || '',
          result || '',
        );
        if (!verify.verified) {
          store.updateStep(plan_id, String(item_id), { status: 'error', result: result || undefined });
          upsertPlanMessage(plan_id);
          return {
            success: false,
            message: `⚠️ 步骤完成核验未通过，已将该步骤标记为 error：\n${verify.reason}\n\n请修复实际执行结果后重试；若实际已完成但核验失败，请在 result 中补充真实资源 ID（如"表单ID: 21"、"流程ID: 17"）后重新标记 completed。`,
          };
        }
      }

      const statusMap: Record<string, string> = { pending: 'pending', in_progress: 'running', completed: 'done', skipped: 'done' };
      store.updateStep(plan_id, String(item_id), { status: statusMap[status] as StepStatus, result: result || undefined });

      let autoNextMsg = '';
      if (status === 'completed') {
        const currentIdx = plan.steps.findIndex((s) => String(s.id) === String(item_id));
        const nextStep = plan.steps[currentIdx + 1];
        if (nextStep && nextStep.status === 'pending') {
          store.updateStep(plan_id, String(nextStep.id), { status: 'running' });
          autoNextMsg = `\n步骤 ${nextStep.id} 已自动标记为 in_progress，无需手动调用 update_plan_item。`;
        }
      }

      upsertPlanMessage(plan_id);
      return { success: true, message: `步骤 ${item_id} 状态已更新为 ${status}${autoNextMsg}` };
    },
  }),

  'plan:confirm': () => ({
    id: 'plan:confirm',
    category: SkillCategory.PLAN,
    name: 'confirm_plan',
    description: '确认或放弃计划。⚠️ 只有用户明确回复确认（如"确认"、"开始"、"没问题"）后才能调用此工具。禁止在分析完成时自行调用。',
    parameters: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: '计划 ID' },
        action: { type: 'string', enum: ['confirm', 'abandon'], description: 'confirm=确认计划，abandon=放弃计划' },
      },
      required: ['plan_id', 'action'],
    },
    async execute(args): Promise<ToolExecuteResult> {
      const { plan_id, action } = args as { plan_id: string; action: string };
      const store = useAgentStore.getState();
      const plan = store.plans.find((p) => p.id === plan_id);
      if (!plan) return { success: false, message: `未找到计划 ${plan_id}，当前计划列表：${store.plans.map((p) => p.id).join(', ') || '无'}` };
      if (action === 'confirm') {
        const lastUserMsg = [...store.messages].reverse().find((m: { role: string }) => m.role === 'user');
        const confirmKeywords = /确认|开始|没问题|好的|执行|同意|可以|继续|ok|yes|确认了/;
        if (!lastUserMsg || !confirmKeywords.test(lastUserMsg.content)) {
          return { success: false, message: 'confirm_plan 必须在用户明确确认后才能调用。请先向用户展示计划并等待确认回复。' };
        }
        store.updatePlan(plan_id, { status: 'confirmed' }); upsertPlanMessage(plan_id); return { success: true, message: '计划已确认，开始执行' };
      }
      store.updatePlan(plan_id, { status: 'rejected' }); upsertPlanMessage(plan_id);
      return { success: true, message: '计划已放弃' };
    },
  }),

  'plan:validate': () => ({
    id: 'plan:validate',
    category: SkillCategory.PLAN,
    name: 'validate_plan',
    description: '验证计划是否完整，检查是否有遗漏的需求点。验证完成后，必须向用户汇报最终执行结果。',
    parameters: {
      type: 'object',
      properties: { plan_id: { type: 'string', description: '计划 ID' } },
      required: ['plan_id'],
    },
    async execute(args): Promise<ToolExecuteResult> {
      const { plan_id } = args as { plan_id: string };
      const store = useAgentStore.getState();
      const plan = store.plans.find((p) => p.id === plan_id);
      if (!plan) return { success: false, message: `未找到计划 ${plan_id}` };
      const pendingSteps = plan.steps.filter((s) => s.status === 'pending');
      const doneSteps = plan.steps.filter((s) => s.status === 'done');
      const runningSteps = plan.steps.filter((s) => s.status === 'running');

      if (pendingSteps.length === 0 && runningSteps.length === 0) {
        store.updatePlan(plan_id, { status: 'completed' });
        upsertPlanMessage(plan_id);
        const resultSummary = plan.steps
          .map((s) => {
            return s.result ? `- ${s.result}` : `- [无 result 摘要] ${s.description || ''}`;
          })
          .join('\n');
        return {
          success: true,
          message: `计划验证通过！共 ${plan.steps.length} 个步骤，全部已完成。\n\n各步骤实际执行结果（汇报时以此为准，禁止编造或夸大）：\n${resultSummary}\n\n请立即向用户汇报最终执行结果，列出每个步骤的完成情况，并告知用户任务已全部完成。禁止在此消息后直接结束对话，必须先生成汇报文本。`,
          data: { totalSteps: plan.steps.length, doneSteps: doneSteps.length, pendingSteps: 0 },
        };
      }

      return {
        success: true,
        message: `计划验证：共 ${plan.steps.length} 步骤，已完成 ${doneSteps.length}，待完成 ${pendingSteps.length}，执行中 ${runningSteps.length}。请继续执行未完成的步骤。`,
        data: { pendingSteps, doneSteps, runningSteps },
      };
    },
  }),

  'plan:list_unfinished': () => ({
    id: 'plan:list_unfinished',
    category: SkillCategory.PLAN,
    name: 'list_unfinished_plans',
    description: '列出所有未完成的计划。',
    parameters: { type: 'object', properties: {} },
    async execute(): Promise<ToolExecuteResult> {
      const store = useAgentStore.getState();
      const plans = store.plans.filter(
        (p) => p.status === 'draft' || p.status === 'confirmed' || p.status === 'executing' || p.status === 'stopped',
      );
      return { success: true, message: plans.length > 0 ? `共 ${plans.length} 个未完成的计划` : '没有未完成的计划', data: { plans } };
    },
  }),

  'plan:set_focus': () => ({
    id: 'plan:set_focus',
    category: SkillCategory.PLAN,
    name: 'set_focus_plan',
    description: '设置当前聚焦的计划。',
    parameters: {
      type: 'object',
      properties: { plan_id: { type: 'string', description: '计划 ID' } },
      required: ['plan_id'],
    },
    async execute(args): Promise<ToolExecuteResult> {
      const { plan_id } = args as { plan_id: string };
      const store = useAgentStore.getState();
      const plan = store.plans.find((p) => p.id === plan_id);
      if (!plan) return { success: false, message: `未找到计划 ${plan_id}` };
      return { success: true, message: `已聚焦计划「${plan_id}」` };
    },
  }),

  'plan:adjust': () => ({
    id: 'plan:adjust',
    category: SkillCategory.PLAN,
    name: 'adjust_plan',
    description: `根据执行结果调整计划。支持追加、删除或替换步骤。

调整后会自动重新汇报完整计划到聊天面板。

注意：调用此工具后，计划变更已生效，无需再调用 update_plan。`,
    parameters: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: '计划 ID' },
        reason: { type: 'string', description: '调整原因' },
        changes: { type: 'string', description: '调整内容描述' },
        action: { type: 'string', enum: ['append', 'remove', 'replace'], description: '操作类型：append=追加步骤，remove=删除步骤，replace=替换步骤（支持单个 step_index 或批量 step_indices 数组）' },
        step_index: { type: 'number', description: '步骤索引（从0开始，remove/replace 单个步骤时必填）' },
        step_indices: { type: 'array', items: { type: 'number' }, description: '批量替换的步骤索引数组（从0开始，replace 批量操作时与 new_descriptions 配合使用）' },
        new_description: { type: 'string', description: '新步骤描述（append 或 replace 单个步骤时必填）' },
        new_descriptions: { type: 'array', items: { type: 'string' }, description: '批量替换的新步骤描述数组（与 step_indices 一一对应）' },
        new_tool_name: { type: 'string', description: '新步骤工具名称（append/replace 时可选）' },
        new_id: { type: 'string', description: '新步骤 ID（append 时可选，不提供则自动生成）。⚠️ 重要：后续 update_plan_item 需要用此 ID 来更新步骤状态，请务必记录此 ID。' },
      },
      required: ['plan_id', 'reason'],
    },
    async execute(args): Promise<ToolExecuteResult> {
      const typedArgs = args as {
        plan_id: string; reason: string; changes?: string; action?: string;
        step_index?: number; step_indices?: number[];
        new_description?: string; new_descriptions?: string[];
        new_tool_name?: string; new_id?: string;
      };
      const store = useAgentStore.getState();
      const plan = store.plans.find((p) => p.id === typedArgs.plan_id);
      if (!plan) return { success: false, message: `未找到计划 ${typedArgs.plan_id}` };

      const newToolName = typedArgs.new_tool_name;
      if (newToolName && !VALID_PLAN_TOOL_NAMES.has(newToolName)) {
        return { success: false, message: `toolName "${newToolName}" 无效，只能使用：${[...VALID_PLAN_TOOL_NAMES].join('、')}` };
      }

      let actionMessage = '';
      let newItemId = '';

      switch (typedArgs.action) {
        case 'append': {
          if (!typedArgs.new_description) return { success: false, message: 'append 操作需要 new_description' };
          newItemId = typedArgs.new_id || generateItemId();
          const newStep = {
            id: newItemId,
            description: typedArgs.new_description,
            status: 'pending' as const,
            order: plan.steps.length,
            toolName: typedArgs.new_tool_name,
          };
          store.updatePlan(typedArgs.plan_id, { steps: [...plan.steps, newStep] });
          actionMessage = `已追加步骤 ${plan.steps.length + 1}：${typedArgs.new_description}（步骤 ID: ${newItemId}）`;
          break;
        }
        case 'remove': {
          if (typedArgs.step_index === undefined) return { success: false, message: 'remove 操作需要 step_index' };
          const removed = plan.steps[typedArgs.step_index];
          if (!removed) return { success: false, message: `步骤索引 ${typedArgs.step_index} 不存在` };
          const filtered = plan.steps.filter((_, i) => i !== typedArgs.step_index).map((s, i) => ({ ...s, order: i }));
          store.updatePlan(typedArgs.plan_id, { steps: filtered });
          actionMessage = `已删除步骤 ${typedArgs.step_index + 1}：${removed.description}`;
          break;
        }
        case 'replace': {
          const stepArray = typedArgs.step_indices;
          if (stepArray && Array.isArray(stepArray) && stepArray.length > 0) {
            const descArray = typedArgs.new_descriptions;
            if (!descArray || !Array.isArray(descArray) || descArray.length !== stepArray.length) {
              return { success: false, message: `批量替换需要 new_descriptions 数组与 step_indices 长度一致（step_indices: ${stepArray.length}，new_descriptions: ${descArray?.length || 0}）` };
            }
            const updated = plan.steps.map((s, i) => {
              const idx = stepArray.indexOf(i);
              if (idx >= 0) {
                return { ...s, description: descArray[idx], toolName: typedArgs.new_tool_name || s.toolName };
              }
              return s;
            });
            store.updatePlan(typedArgs.plan_id, { steps: updated });
            const replacedLabels = stepArray.map((si) => si + 1).join('、');
            actionMessage = `已批量替换步骤 ${replacedLabels}`;
          } else {
            if (typedArgs.step_index === undefined || !typedArgs.new_description) {
              return { success: false, message: 'replace 操作需要 step_index + new_description（单个替换）或 step_indices + new_descriptions（批量替换）' };
            }
            if (!plan.steps[typedArgs.step_index]) return { success: false, message: `步骤索引 ${typedArgs.step_index} 不存在` };
            const updated = plan.steps.map((s, i) =>
              i === typedArgs.step_index
                ? { ...s, description: typedArgs.new_description!, toolName: typedArgs.new_tool_name || s.toolName }
                : s,
            );
            store.updatePlan(typedArgs.plan_id, { steps: updated });
            actionMessage = `已替换步骤 ${typedArgs.step_index + 1} 为：${typedArgs.new_description}`;
          }
          break;
        }
        default: {
          actionMessage = `已记录调整原因：${typedArgs.reason}`;
        }
      }

      upsertPlanMessage(typedArgs.plan_id);

      const summary = buildPlanSummary(store.plans.find((p) => p.id === typedArgs.plan_id)!);
      return {
        success: true,
        message: `计划 ${typedArgs.plan_id} 调整完成。${actionMessage}${typedArgs.changes ? `\n调整内容：${typedArgs.changes}` : ''}\n\n当前完整计划：\n${summary}`,
        data: { planId: typedArgs.plan_id, newItemId: newItemId || undefined },
      };
    },
  }),

  'plan:report_user_action_done': () => ({
    id: 'plan:report_user_action_done',
    category: SkillCategory.PLAN,
    name: 'report_user_action_done',
    description: '报告用户的手动操作已完成，恢复执行流程。当用户表示已建好表、已完成配置等手动操作时调用。note 字段可填用户附带的补充信息（如"加了字段xxx"或"遇到了报错"）。',
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: '用户附带的补充信息，如新增字段、遇到的问题等' },
      },
      required: [],
    },
    async execute(args): Promise<ToolExecuteResult> {
      const { note } = args as { note?: string };
      return {
        success: true,
        message: `用户手动操作已报告完成${note ? `，补充信息：${note}` : ''}，将恢复执行后续步骤。`,
        data: { note: note || '' },
      };
    },
  }),
};