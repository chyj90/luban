import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { useAgentStore } from '@/stores/agentStore';
import { getUnfinishedPlans } from '../../core/planContext';
import { verifyStepCompletion } from './stepVerifier';
import type { ToolExecuteResult } from '@/types/agent';

function generatePlanId(): string {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function generateItemId(): string {
  return `pi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

interface AnalysisPage {
  name: string;
  action: 'create' | 'update';
  queries: Array<{ queryName: string; purpose: string; needsNewTable?: boolean; fields?: string; filterParams?: string }>;
  apis: Array<{ apiName: string; purpose: string }>;
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
    if (page.noDataNeeded || page.queries.length === 0) continue;
    const stepId = nextId();
    pageQueryStep.set(page.name, stepId);

    const parts: string[] = [];
    const queryNames: string[] = [];
    let primaryFilterParams: string | undefined;
    for (const q of page.queries) {
      queryNames.push(q.queryName);
      let part = `创建查询 ${q.queryName}（用途：${q.purpose}）`;
      if (q.needsNewTable && q.fields) {
        part += `，需要新表（请人工建表），字段：${q.fields}`;
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
        query_name: queryNames[0],
        filter_params: primaryFilterParams,
      },
      dependencies: [],
    });
  }

  for (const page of analysis.pages) {
    const stepId = nextId();
    const isCreate = page.action === 'create';
    const toolName = isCreate ? 'create_code_page' : 'update_code_page';
    const ownQueryStep = pageQueryStep.get(page.name);
    const deps = page.noDataNeeded ? [] : ownQueryStep ? [ownQueryStep] : [];

    const queryNames = page.queries.map(q => q.queryName);
    const apiNames = page.apis.map(a => a.apiName);
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

    items.push({
      id: stepId,
      category: 'code_page',
      description: desc,
      toolName,
      toolInput: { name: page.name },
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

function validatePlanItems(items: unknown[], dataRequirements?: unknown[]): string | null {
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Record<string, unknown>;
    const toolName = item?.toolName as string | undefined;
    if (toolName && !VALID_PLAN_TOOL_NAMES.has(toolName)) {
      return `步骤 ${i + 1} 的 toolName "${toolName}" 无效，只能使用：${[...VALID_PLAN_TOOL_NAMES].join('、')}`;
    }
  }

  if (!dataRequirements || !Array.isArray(dataRequirements) || dataRequirements.length === 0) {
    const hasPageStep = items.some((item) => {
      const tn = (item as Record<string, unknown>)?.toolName as string;
      return tn === 'create_code_page' || tn === 'update_code_page';
    });
    if (hasPageStep) {
      return '计划中包含页面步骤但未提供 dataRequirements。' +
        '请根据分析报告第 8 章「数据需求」补充 dataRequirements 参数，' +
        '或确认所有页面均不需要数据加载（传入 noDataNeeded: true）。';
    }
    return null;
  }

  const hasPageStep = items.some((item) => {
    const tn = (item as Record<string, unknown>)?.toolName as string;
    return tn === 'create_code_page' || tn === 'update_code_page';
  });

  const pagesNeedingData = (dataRequirements as Record<string, unknown>[]).filter((r) => !r.noDataNeeded);
  if (pagesNeedingData.length > 0 && !hasPageStep) {
    const pageNames = pagesNeedingData.map((r) => r.pageName).join('、');
    return `dataRequirements 声明了页面（${pageNames}）需要数据，但计划中没有 create_code_page 或 update_code_page 步骤。` +
      '请添加页面创建/更新步骤。计划必须同时包含数据准备步骤和页面步骤。';
  }

  const hasDelegateQuery = items.some((item) => {
    return (item as Record<string, unknown>)?.toolName === 'delegate_query';
  });

  for (const req of dataRequirements) {
    const r = req as Record<string, unknown>;
    const pageName = r.pageName as string;
    const queries = (r.queries as unknown[]) || [];
    const apis = (r.apis as unknown[]) || [];
    const noDataNeeded = r.noDataNeeded as boolean;

    if (noDataNeeded) continue;

    if (queries.length > 0 && !hasDelegateQuery) {
      const queryNames = queries.map((q) => (q as Record<string, unknown>).queryName).join('、');
      return `页面「${pageName}」需要查询（${queryNames}），但计划中没有 delegate_query 步骤。` +
        '请在页面步骤之前添加 delegate_query 步骤来准备数据。';
    }

    if (queries.length > 0 && hasDelegateQuery) {
      const delegateQuerySteps = items.filter((item) => {
        return (item as Record<string, unknown>)?.toolName === 'delegate_query';
      });
      for (const query of queries) {
        const q = query as Record<string, unknown>;
        const queryName = q.queryName as string;
        const hasMatchingStep = delegateQuerySteps.some((step) => {
          const desc = ((step as Record<string, unknown>)?.description as string) || '';
          const toolInput = ((step as Record<string, unknown>)?.toolInput as Record<string, unknown>) || {};
          const requirement = (toolInput.requirement as string) || '';
          return desc.includes(queryName) || requirement.includes(queryName);
        });
        if (!hasMatchingStep) {
          const needsNewTable = q.needsNewTable as boolean;
          return `页面「${pageName}」需要查询「${queryName}」，但计划中没有对应的 delegate_query 步骤。` +
            `请添加一个 delegate_query 步骤，requirement 中包含创建查询「${queryName}」${needsNewTable ? '（需新表，请提示用户先在数据源面板建表）' : ''}。`;
        }
      }
    }
  }

  return null;
}

export function createPlanInternal(
  title: string,
  summary: string,
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
  const activePlans = store.plans.filter((p: unknown) => p.status === 'confirmed' || p.status === 'executing');
  if (activePlans.length > 0) {
    const activeList = activePlans.map((p: unknown) => {
      const doneCount = p.steps.filter((s: unknown) => s.status === 'done').length;
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
                description: '该页面需要的平台 API 列表',
                items: {
                  type: 'object',
                  properties: {
                    apiName: { type: 'string', description: '平台 API 名称' },
                    purpose: { type: 'string', description: '用途' },
                  },
                  required: ['apiName'],
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

      const llmScore = analysis.score as { moduleDetail: number; interactionComplexity: number; dataCoverage: number; fieldSpecificity: number; deductions?: Array<{ reason: string; points: number }> } | undefined;
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
        deductions: llmScore.deductions || [],
      };

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
      const typedArgs = args as unknown;
      const store = useAgentStore.getState();
      const plan = store.plans.find((p: unknown) => p.id === typedArgs.plan_id);
      if (!plan) return { success: false, message: `未找到计划 ${typedArgs.plan_id}` };

      const newToolName = typedArgs.new_tool_name as string | undefined;
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
          const filtered = plan.steps.filter((_: unknown, i: number) => i !== typedArgs.step_index).map((s: unknown, i: number) => ({ ...s, order: i }));
          store.updatePlan(typedArgs.plan_id, { steps: filtered });
          upsertPlanMessage(typedArgs.plan_id);
          return { success: true, message: `已删除步骤 ${typedArgs.step_index}` };
        }
        case 'replace': {
          if (typedArgs.step_index === undefined || !typedArgs.new_description) return { success: false, message: 'replace 操作需要 step_index 和 new_description' };
          const updated = plan.steps.map((s: unknown, i: number) => i === typedArgs.step_index ? { ...s, description: typedArgs.new_description!, toolName: typedArgs.new_tool_name } : s);
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
      const { plan_id, item_id, status, result } = args as unknown;
      const store = useAgentStore.getState();
      const plan = store.plans.find((p: unknown) => p.id === plan_id);
      if (!plan) {
        const activeIds = store.plans.filter((p: unknown) => p.status === 'confirmed' || p.status === 'executing').map((p: unknown) => p.id);
        const hint = activeIds.length > 0 ? `，当前活跃计划 ID: ${activeIds.join(', ')}` : '，当前无活跃计划';
        return { success: false, message: `未找到计划 "${plan_id}"${hint}。请使用 submit_analysis 返回的正确 planId 重试 update_plan_item，不要重新创建计划。` };
      }
      const step = plan.steps.find((s: unknown) => String(s.id) === String(item_id));
      if (!step) return { success: false, message: `未找到步骤 ${item_id}，当前计划步骤 ID 为：${plan.steps.map((s: unknown) => s.id).join(', ')}` };

      // R2 步骤完成核验：标记 completed 前验证副作用真实存在，杜绝"工具失败但谎报完成"
      if (status === 'completed' && (step as { toolName?: string }).toolName) {
        const verify = await verifyStepCompletion(
          (step as { toolName?: string }).toolName!,
          Number(ctx.applicationId),
          (step as { description?: string }).description || '',
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
      store.updateStep(plan_id, String(item_id), { status: statusMap[status] as unknown, result: result || undefined });

      let autoNextMsg = '';
      if (status === 'completed') {
        const currentIdx = plan.steps.findIndex((s: unknown) => String((s as any).id) === String(item_id));
        const nextStep = plan.steps[currentIdx + 1];
        if (nextStep && (nextStep as any).status === 'pending') {
          store.updateStep(plan_id, String((nextStep as any).id), { status: 'running' });
          autoNextMsg = `\n步骤 ${(nextStep as any).id} 已自动标记为 in_progress，无需手动调用 update_plan_item。`;
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
      const { plan_id, action } = args as unknown;
      const store = useAgentStore.getState();
      const plan = store.plans.find((p: unknown) => p.id === plan_id);
      if (!plan) return { success: false, message: `未找到计划 ${plan_id}，当前计划列表：${store.plans.map((p: unknown) => p.id).join(', ') || '无'}` };
      if (action === 'confirm') { store.updatePlan(plan_id, { status: 'confirmed' }); upsertPlanMessage(plan_id); return { success: true, message: '计划已确认，开始执行' }; }
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
      const { plan_id } = args as unknown;
      const store = useAgentStore.getState();
      const plan = store.plans.find((p: unknown) => p.id === plan_id);
      if (!plan) return { success: false, message: `未找到计划 ${plan_id}` };
      const pendingSteps = plan.steps.filter((s: unknown) => s.status === 'pending');
      const doneSteps = plan.steps.filter((s: unknown) => s.status === 'done');
      const runningSteps = plan.steps.filter((s: unknown) => s.status === 'running');

      if (pendingSteps.length === 0 && runningSteps.length === 0) {
        store.updatePlan(plan_id, { status: 'completed' });
        upsertPlanMessage(plan_id);
        // R2：输出各步骤 result 摘要，供主智能体汇报时对照真实资源，禁止编造
        const resultSummary = plan.steps
          .map((s: unknown) => {
            const st = s as { status?: string; result?: string; description?: string };
            return st.result ? `- ${st.result}` : `- [无 result 摘要] ${st.description || ''}`;
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
      const plans = getUnfinishedPlans();
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
      const { plan_id } = args as unknown;
      const store = useAgentStore.getState();
      const plan = store.plans.find((p: unknown) => p.id === plan_id);
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
      const typedArgs = args as unknown;
      const store = useAgentStore.getState();
      const plan = store.plans.find((p: unknown) => p.id === typedArgs.plan_id);
      if (!plan) return { success: false, message: `未找到计划 ${typedArgs.plan_id}` };

      const newToolName = typedArgs.new_tool_name as string | undefined;
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
          const filtered = plan.steps.filter((_: unknown, i: number) => i !== typedArgs.step_index).map((s: unknown, i: number) => ({ ...s, order: i }));
          store.updatePlan(typedArgs.plan_id, { steps: filtered });
          actionMessage = `已删除步骤 ${typedArgs.step_index + 1}：${removed.description}`;
          break;
        }
        case 'replace': {
          const stepArray = typedArgs.step_indices as number[] | undefined;
          if (stepArray && Array.isArray(stepArray) && stepArray.length > 0) {
            const descArray = typedArgs.new_descriptions as string[] | undefined;
            if (!descArray || !Array.isArray(descArray) || descArray.length !== stepArray.length) {
              return { success: false, message: `批量替换需要 new_descriptions 数组与 step_indices 长度一致（step_indices: ${stepArray.length}，new_descriptions: ${descArray?.length || 0}）` };
            }
            const updated = plan.steps.map((s: unknown, i: number) => {
              const idx = stepArray.indexOf(i);
              if (idx >= 0) {
                return { ...s, description: descArray[idx], toolName: typedArgs.new_tool_name || s.toolName };
              }
              return s;
            });
            store.updatePlan(typedArgs.plan_id, { steps: updated });
            const replacedLabels = stepArray.map((si: number) => si + 1).join('、');
            actionMessage = `已批量替换步骤 ${replacedLabels}`;
          } else {
            if (typedArgs.step_index === undefined || !typedArgs.new_description) {
              return { success: false, message: 'replace 操作需要 step_index + new_description（单个替换）或 step_indices + new_descriptions（批量替换）' };
            }
            if (!plan.steps[typedArgs.step_index]) return { success: false, message: `步骤索引 ${typedArgs.step_index} 不存在` };
            const updated = plan.steps.map((s: unknown, i: number) =>
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

      const summary = buildPlanSummary(store.plans.find((p: unknown) => p.id === typedArgs.plan_id)!);
      return {
        success: true,
        message: `计划 ${typedArgs.plan_id} 调整完成。${actionMessage}${typedArgs.changes ? `\n调整内容：${typedArgs.changes}` : ''}\n\n当前完整计划：\n${summary}`,
        data: { planId: typedArgs.plan_id, newItemId: newItemId || undefined },
      };
    },
  }),
};