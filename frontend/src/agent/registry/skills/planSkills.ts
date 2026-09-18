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
  /**
   * 审批结果触发器声明（2026-09-15 请假案例）：分析期显式声明"审批通过/驳回后改哪些表、
   * 靠什么字段定位记录"，系统据此自动生成"回写查询 + 触发器配置"步骤，
   * 联动需求在计划第一帧就可见，不再依赖 wire 步骤执行中途兜底发现。
   * 机制默认走审批节点触发器 + QUERY 目标（事件→固定动作，改业务库）；
   * 外部 API 调用用 TOOL 目标（已有工具，与后端 TargetType.TOOL / UI"API 工具"同层）；
   * 编排仅用于多步依赖。
   */
  callbacks?: WorkflowCallback[];
}

export interface WorkflowCallback {
  /** 触发事件：APPROVED / REJECTED / NODE_ENTERED / INSTANCE_COMPLETED / INSTANCE_REJECTED */
  on: string;
  /** QUERY=执行已保存查询（推荐，状态写死在 SQL 里）；TOOL=调用已有 API 工具（外部 HTTP/通知，无需新建）；ORCHESTRATION=调用编排（须发布） */
  targetType: 'QUERY' | 'ORCHESTRATION' | 'TOOL';
  /** QUERY 时为查询名；ORCHESTRATION 时为编排名；TOOL 时为 API 工具名 */
  targetRef: string;
  /** 参数映射描述，如 "id←form.data.id, days←form.data.days" */
  params?: string;
  purpose?: string;
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

function validateAnalysisBasics(analysis: AnalysisData, report: string): ScoreDeduction[] {
  const deductions: ScoreDeduction[] = [];
  const allPages = analysis.pages || [];

  const hasFilterFields = /筛选字段[：:]/.test(report) && !/筛选字段[：:]\s*无/.test(report);

  for (const page of allPages) {
    // 同页面多个查询共用新表时，字段只在第一个查询声明即可（减少模型重复生成）——
    // 只有整页完全没声明过 fields 的 needsNewTable 查询才算缺字段
    let pageFieldsDeclared = false;
    for (const q of page.queries) {
      if (q.needsNewTable && !q.fields && !pageFieldsDeclared) {
        deductions.push({ rule: 'missing_fields', points: -8, reason: `查询 ${q.queryName} needsNewTable=true 但未填写 fields，请填写字段列表或改为 false` });
      }
      if (q.fields) pageFieldsDeclared = true;
      // 写查询（INSERT/UPDATE/DELETE 类）本就不需要筛选参数，与 schema 描述保持一致
      const isWriteQuery = /^(insert|update|delete|deduct)/i.test(q.queryName);
      if (hasFilterFields && !q.filterParams && !isWriteQuery) {
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

  // 流程设计+发布步骤必须先于编排步骤：workflow 节点要填 workflowDefinitionId（数字），
  // 且后端 lint 强制校验流程定义已存在。2026-09-14 请假管理案例中编排排在流程之前，
  // 即使 DSL 写对也必然报"引用的流程定义不存在"。发布步骤 ID 收集后注入编排步骤依赖。
  const publishStepIds: string[] = [];
  const wireStepBuilders: Array<{ publishStepId: string; wf: AnalysisData['workflows'][number] }> = [];
  // 所有页面声明过的查询名：callbacks 引用的回写查询若已在页面声明，不重复生成创建步骤
  const declaredQueryNames = new Set<string>(
    analysis.pages.flatMap((p) => p.queries.map((q) => q.queryName)),
  );
  // QUERY 型 callbacks 的查询步骤先行创建——流程助手在 design 阶段就要把触发器 ref 指向真实查询
  const callbackQueryStepIdsByWf = new Map<AnalysisData['workflows'][number], string[]>();
  for (const wf of analysis.workflows) {
    if (!wf.callbacks || wf.callbacks.length === 0) continue;
    const pending = wf.callbacks
      .filter((cb) => cb.targetType === 'QUERY' && !declaredQueryNames.has(cb.targetRef));
    const uniqueQueries = [...new Map(pending.map((cb) => [cb.targetRef, cb])).values()];
    if (uniqueQueries.length === 0) continue;
    const stepId = nextId();
    const desc = uniqueQueries
      .map((cb) => `创建查询 ${cb.targetRef}${cb.purpose ? `（${cb.purpose}）` : ''}`)
      .join('；');
    items.push({
      id: stepId,
      category: 'datasource',
      description: `${desc}（供流程「${wf.description}」审批结果触发器调用）`,
      toolName: 'delegate_query',
      toolInput: {
        requirement: `为流程「${wf.description}」的审批结果触发器创建以下写查询：${uniqueQueries
          .map((cb) => `${cb.targetRef}${cb.purpose ? `（${cb.purpose}）` : ''}${cb.params ? `，参数映射：${cb.params}` : ''}`)
          .join('；')}。⚠️ 写 SQL 必须带状态守卫条件（如 AND status='待审批'）——触发器为异步 at-least-once 派发，状态守卫让重复派发命中 0 行，防止重复扣减/重复更新`,
        query_name: uniqueQueries[0].targetRef,
      },
      dependencies: [],
    });
    callbackQueryStepIdsByWf.set(wf, [stepId]);
    uniqueQueries.forEach((cb) => declaredQueryNames.add(cb.targetRef));
  }
  for (const wf of analysis.workflows) {
    const callbackQueryStepIds = callbackQueryStepIdsByWf.get(wf) || [];
    if (wf.hasForm) {
      const formStepId = nextId();
      items.push({
        id: formStepId,
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
        const publishStepId = appendWorkflowDesignSteps(wf, nextId(), [formStepId, ...callbackQueryStepIds], items, nextId);
        publishStepIds.push(publishStepId);
        wireStepBuilders.push({ publishStepId, wf });
      }
    } else if (wf.hasWorkflow) {
      const publishStepId = appendWorkflowDesignSteps(wf, nextId(), callbackQueryStepIds, items, nextId);
      publishStepIds.push(publishStepId);
      wireStepBuilders.push({ publishStepId, wf });
    }
  }

  // pages[].orchestrations → delegate_orchestration 步骤，依赖对应页面的查询步骤；
  // 若分析中声明了流程，编排还依赖全部流程发布步骤（编排可能经 workflow 节点发起流程，
  // 分析数据未声明编排与流程的对应关系，保守取全量依赖）
  const pageOrchStep = new Map<string, string>();
  const allOrchStepIds: string[] = [];
  for (const page of analysis.pages) {
    if (!page.orchestrations || page.orchestrations.length === 0) continue;
    const stepId = nextId();
    pageOrchStep.set(page.name, stepId);
    allOrchStepIds.push(stepId);
    const ownQueryStep = pageQueryStep.get(page.name);
    const queryNames = page.queries.map(q => q.queryName);
    const orchDescriptions = page.orchestrations.map(o => `${o.orchName}（${o.purpose}）`).join('；');

    items.push({
      id: stepId,
      category: 'datasource',
      description: `创建编排 ${orchDescriptions}`,
      toolName: 'delegate_orchestration',
      toolInput: {
        requirement: `为页面「${page.name}」创建以下编排，引用的查询为 ${queryNames.join('、')}：${orchDescriptions}。编排创建后需发布，发布的 ToolDefinition id 需回传给页面绑定。若编排需要发起审批流程，引用已发布流程的 workflowDefinitionId（数字），禁止编造`,
        context: `页面: ${page.name}，查询: ${queryNames.join('、')}`,
      },
      dependencies: [...(ownQueryStep ? [ownQueryStep] : []), ...publishStepIds],
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

  // ORCHESTRATION 型 callbacks：编排必须在触发器 ref 引用前创建并发布（触发器按发布版本执行），
  // 因此触发器配置独立成步，排在流程发布 + 编排步骤之后，并要求重新发布流程使触发器随版本固化
  for (const { publishStepId, wf } of wireStepBuilders) {
    const orchCallbacks = (wf.callbacks || []).filter((cb) => cb.targetType === 'ORCHESTRATION');
    if (orchCallbacks.length === 0) continue;
    items.push({
      id: nextId(),
      category: 'datasource',
      description: `配置审批结果触发器（${wf.description}）→ 编排 ${orchCallbacks.map((cb) => cb.targetRef).join('、')}，完成后重新发布流程使触发器生效`,
      toolName: 'delegate_workflow',
      toolInput: {
        task_type: 'design_workflow',
        requirement: `为流程「${wf.description}」配置审批结果触发器并重新发布。回调声明：${orchCallbacks
          .map((cb) => `on=${cb.on} → 编排「${cb.targetRef}」（须已 PUBLISHED，用 list_orchestrations 查真实 ID）${cb.params ? `，paramsMapping：${cb.params}` : ''}${cb.purpose ? `（${cb.purpose}）` : ''}`)
          .join('；')}。在对应审批节点的 data.config.triggers 中写入触发器数组，随后重新发布流程（触发器随发布版本固化，改完不发布不生效）`,
      },
      dependencies: [publishStepId, ...allOrchStepIds],
    });
  }

  // 流程发起链路接入放在最后：wire 是 update_code_page，必须等页面步骤执行完；
  // 每条流程在 wire 后强制追加"链路验证（触发器预演）"收尾步骤——"完成"的定义是
  // 预演通过而非资源创建成功，断链/审批人缺失/参数 NULL 在收尾步骤暴露（stepVerifier 拦无证据的完成）
  for (const { publishStepId, wf } of wireStepBuilders) {
    const wireStepId = nextId();
    items.push({
      id: wireStepId,
      category: 'code_page',
      description: `流程发起链路接入：在业务发起入口（表单提交/按钮）挂接 window.__LUBAN__.startWorkflow(流程ID, formData)。formData 必须携带业务记录标识（写查询返回的 insertId，或发起侧生成的业务主键）——审批结果触发器靠它定位业务记录，缺失即断链；字段名与流程设计的发起字段契约及触发器 paramsMapping 所需的 form.data.* 逐字一致。⚠️ 服务端会按流程绑定表单的 schema 校验 formData（必填字段/类型，key 与表单逐字一致），缺字段发起即报错——发起 UI 不在页面重做：首选 create_page_scaffold 传 launchWorkflow={workflowId, formId, insertQueryName?, insertQueryId?}，页面生成 startWorkflowWithForm 调用代码，表单 UI 由平台按绑定表单真实渲染（支持 excel 上传解析/detail_table 等全部控件，页面零表单代码）。审批结果数据联动默认由审批节点触发器（APPROVED/REJECTED → QUERY 目标）实现，计划中未覆盖的联动缺口用 adjust_plan 补配触发器，禁止留下无人处理的断链`,
      toolName: 'update_code_page',
      toolInput: {},
      dependencies: [publishStepId],
    });
    items.push({
      id: nextId(),
      category: 'datasource',
      description: `链路验证（触发器预演）：对流程「${wf.description}」执行 rehearse_triggers —— 用贴近真实的样例表单数据（字段与绑定表单逐字一致、含业务记录 id，主分支与驳回分支各准备一份样例）+ 审批链可解析的真实平台用户作为样例发起人（发起人须有部门归属和直属上级、或其部门配置了 manager_id，先用 search_platform_users / get_platform_departments 核对；禁止用 root 这类无组织数据的账号——解析为空是用例选错不是流程缺陷），预演路径、审批人解析、触发器 paramsMapping 解析与渲染 SQL。预演报出"审批人解析为空/断链/必填参数缺失"时必须先修复（补平台组织数据或换可解析的发起人重预演）再标完成；完成时 result 必须粘贴预演摘要（路径、触发器、errors/warnings），禁止无证据标完成`,
      toolName: 'rehearse_triggers',
      toolInput: {},
      dependencies: [publishStepId, wireStepId],
    });
  }

  // 应用链路自检（运行时验证）作为计划最终收尾：与 system prompt「最后一步必须执行
  // app_selfcheck」对齐。2026-09-18 请假案例：计划止步于 rehearse_triggers，自检只能在
  // 计划外自跑，报告进不了任何步骤 result 也无人核验。依赖此前全部步骤（查询/表单/流程/
  // 发布/页面/挂接/预演）；纯页面无流程的应用不生成（L2 链路自检以流程为载体）。
  if (analysis.workflows.length > 0) {
    const selfcheckDeps = items.map((item) => item.id);
    items.push({
      id: nextId(),
      category: 'datasource',
      description: `应用链路自检（运行时验证，最终收尾）：执行 app_selfcheck，自构造 TestSpec 语义断言用例——主分支（发起→审批通过→状态按业务语义变化，如置"已通过"+余额扣减）与驳回分支（驳回→置"已驳回"且余额不变）各一份；capture_sql 捕获初值、assert_sql 断言期望；actors 用真实平台用户且与测试数据绑定一致（先用 search_platform_users 核对）；发起步骤 formData 携带业务记录 id（\${insert.insertId}）。字段契约按工具描述逐字构造（queryId/definitionId 用数字、expect 是对象、actors 平铺）。执行为异步运行记录：工具内部轮询至终态返回报告，完成时 result 必须粘贴报告摘要（通过与否+关键步骤+触发器派发+清理/残留）与 runId；未通过先修复再重跑（同一用例最多 2 轮）。报告持久化在应用编辑器「链路自检」抽屉，可回看历史`,
      toolName: 'app_selfcheck',
      toolInput: {},
      dependencies: selfcheckDeps,
    });
  }

  return items;
}

/**
 * 流程设计之后自动追加"发布流程"步骤，返回发布步骤 ID。
 * 背景（2026-09-14 请假管理案例）：流程设计完是草稿、页面提交也没挂 startWorkflow，
 * 审批流成了死流程，但计划照样验证通过并汇报"全部完成"。推导层直接把闭环纳入步骤。
 * "流程发起链路接入"（wire）由调用方在页面步骤之后追加——它是 update_code_page，
 * 依赖页面已存在，不能和设计/发布步骤连在一起。
 *
 * 发布/wire 步骤的 id 必须也走 nextId()（数字连续），不能使用 `publish-3` 这类组合 id：
 * submit_analysis 返回的步骤清单按位置编号，主智能体天然拿清单序号当 item_id 用——
 * 同一案例中模型标"步骤 4"（发布），实际命中了 id 为 "4" 的编排步骤，发布步骤永远停在
 * in_progress、编排步骤带着发布结果被误标完成。id 与展示序号恒等后此错位不可能发生。
 */
function appendWorkflowDesignSteps(
  wf: AnalysisData['workflows'][number],
  wfStepId: string,
  extraDeps: string[],
  items: PlanItem[],
  nextId: () => string,
): string {
  // QUERY/TOOL 型 callbacks 的触发器配置折叠进设计步骤：两者的目标在设计时均已存在
  // （回写查询已在 design 前置步骤创建、API 工具本就要求已接入），流程助手设计时直接把
  // ref 指向真实 ID，发布一次即固化，避免"先发布再补触发器再重发布"的往返。
  // （2026-09-15 请假案例：设计→发布→事后配触发器→被迫重发布，多两轮委派且中途处于断链状态）
  // ORCHESTRATION 目标由计划创建且须先发布才能被引用，不能折叠，走 derivePlanFromAnalysis 的独立 wire 步骤。
  const queryCallbacks = (wf.callbacks || []).filter((cb) => cb.targetType === 'QUERY');
  const toolCallbacks = (wf.callbacks || []).filter((cb) => cb.targetType === 'TOOL');
  const triggerSpec = (queryCallbacks.length > 0 || toolCallbacks.length > 0)
    ? `\n完成后在对应审批节点的 data.config.triggers 中配置以下结果触发器（契约：{ triggerId: "tg_前缀加短随机串", on, target: { type: "QUERY"|"TOOL", ref: 目标ID }, paramsMapping: [{ to, from?, value? }], retry: { maxAttempts: 3, backoffSeconds: [30, 120, 600] }, minAffectedRows?: 仅QUERY目标且"必命中"回写时声明（如按 id 置状态声明 1），守卫型可 0 行的查询禁止声明；同组触发器按配置顺序派发，先回写状态、后扣减余额 }）：\n${[...queryCallbacks, ...toolCallbacks]
        .map((cb, i) => cb.targetType === 'TOOL'
          ? `${i + 1}. on=${cb.on} → API 工具「${cb.targetRef}」（type 填 "TOOL"，ref 为工具 ID，用 list_apis 核对；该工具未接入时在结果中明确说明缺口，禁止编造 ID）${cb.params ? `，paramsMapping：${cb.params}` : ''}${cb.purpose ? `（${cb.purpose}）` : ''}`
          : `${i + 1}. on=${cb.on} → 查询「${cb.targetRef}」（type 填 "QUERY"，ref 为查询 ID，用 list_queries 核对）${cb.params ? `，paramsMapping：${cb.params}` : ''}${cb.purpose ? `（${cb.purpose}）` : ''}`)
        .join('\n')}\n范式：改业务库状态用 QUERY 目标——不同事件绑定不同查询（状态写死在 SQL 里），写 SQL 自带状态守卫；调用已有 API 工具（外部 HTTP/通知类）用 TOOL 目标；仅多步依赖才用 ORCHESTRATION 目标（独立步骤配置）。禁止设计"一次回调 + approved 布尔参数"的编排契约。paramsMapping.from 支持 form.data.字段 / instance.id / instance.initiatorId / instance.status / trigger.event / task.comment / node.id，需要传固定值时直接填 value（不同事件传不同常量用"每个事件一条触发器 + 常量"表达）。⚠️ 若配置了"置已驳回"类触发器（INSTANCE_REJECTED），必须同时在首个审批节点配 NODE_ENTERED 触发器 + 常量把业务状态重置回"待审批"——否则驳回后重新提交的申请再通过时状态守卫命中 0 行，不回写不扣减且无报错`
    : '';

  items.push({
    id: wfStepId,
    category: 'datasource',
    description:
      (wf.workflowDescription || `设计流程：${wf.description}`) +
      (queryCallbacks.length + toolCallbacks.length > 0 ? `；并在审批节点配置结果触发器（on→QUERY/TOOL）` : ''),
    toolName: 'delegate_workflow',
    toolInput: {
      task_type: 'design_workflow',
      requirement: (wf.workflowDescription || wf.description) + triggerSpec,
    },
    dependencies: extraDeps,
  });

  const publishStepId = nextId();
  items.push({
    id: publishStepId,
    category: 'datasource',
    description: `发布流程（${wf.description}）：将设计好的流程从草稿发布为可用状态。完成后 result 必须包含"流程ID: N"且状态为已发布，禁止以草稿状态结束本步骤`,
    toolName: 'delegate_workflow',
    toolInput: {
      task_type: 'design_workflow',
      requirement: `发布此前已设计的流程：${wf.description}。不要重新设计，仅将草稿流程发布为可用状态，并在结果中明确返回"流程ID: N"与已发布状态`,
    },
    dependencies: [wfStepId],
  });

  return publishStepId;
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
  // 与 derivePlanFromAnalysis 生成的编排步骤工具名一致：system prompt 要求
  // "计划缺少 delegate_orchestration 步骤时用 adjust_plan 补上"，校验名单必须放行，
  // 否则出现 2026-09-15 请假案例中 adjust_plan 被拒、编排只能在步骤 5 内裸执行的自相矛盾
  'delegate_orchestration',
  // 链路验证步骤（触发器预演）：主智能体自查工具，计划强制收尾步骤用
  'rehearse_triggers',
  // 应用链路自检（运行时验证）：计划最终收尾步骤，报告持久化于链路自检抽屉
  'app_selfcheck',
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

/**
 * 业务闭环核验（2026-09-14 请假管理案例）：分析报告承诺"审批通过后扣减对应假期额度"
 * 这类状态变迁，但没有任何步骤实现联动（流程引擎不能写业务库、页面也没挂接发起），
 * 计划却验证通过并汇报全部完成。验证通过前在这里强制对账。
 */
function checkBusinessClosure(plan: {
  analysisReport?: string;
  steps: Array<{ description?: string; result?: string }>;
}): { blocked: string[]; reminders: string[] } {
  const report = plan.analysisReport || '';
  if (!report) return { blocked: [], reminders: [] };

  const transitions = (report.match(/[^\n。]*?(?:通过|驳回|批准)后[^\n。]*?(?:扣减|增加|更新|修改|写入|回写|置为|变为|联动|清空|调用|发送|通知)[^\n。]*/g) || [])
    .map((s) => s.trim())
    .filter((s) => s.length > 6);

  const linkageText = plan.steps
    .map((s) => `${s.description || ''} ${s.result || ''}`)
    .join('\n');
  const hasLinkage = /联动|回调|扣减|回写|状态更新|编排|触发器|startWorkflow|挂接|接入/.test(linkageText);

  if (transitions.length > 0 && !hasLinkage) {
    return {
      blocked: [
        `分析报告承诺了审批后的数据联动（如"${transitions[0].slice(0, 90)}"），但所有步骤的描述与结果中都没有联动/回调/触发器/页面挂接相关实现。` +
        `请用 adjust_plan 追加联动实现步骤（默认审批节点触发器：改业务库用 QUERY 目标、调用已有 API 工具用 TOOL 目标，另加页面挂接 startWorkflow；仅多步依赖才用编排）并执行后再验证；若平台确实无法实现该联动，必须先向用户说明缺口并获确认`,
      ],
      reminders: [],
    };
  }

  return {
    blocked: [],
    reminders: transitions.map((t) => `汇报时必须对承诺"${t.slice(0, 60)}"逐条说明实现情况（已实现 / 明确缺口），禁止笼统汇报"全部完成"`),
  };
}

export const planSkills: Record<string, SkillFactory> = {
  'plan:submit_analysis': () => ({
    id: 'plan:submit_analysis',
    category: SkillCategory.PLAN,
    name: 'submit_analysis',
    description: `提交需求分析结果并自评打分。系统会自动从分析数据推导出执行计划，无需手动构造步骤。

⚠️ 必须在输出分析报告文本的同一个 assistant message 中调用此工具。
⚠️ 禁止在参数中传 analysisReport——报告全文写在回复正文里即可，系统自动取当轮正文作为报告。在参数里把报告重复转义一遍会成倍拖慢提交速度（数千 token 的重复生成）。
⚠️ interactions 可省略：分析报告第 8 章已包含交互联动，无需在参数里重复。
⚠️ 同一页面多个查询共用同一张新表时，fields 只在第一个查询填写，其余查询省略。
⚠️ score 为必填，按评分标准自评（评分标准见系统提示词「分析评分标准」章节）。
⚠️ 参数必须是完整、合法的 JSON。参数解析失败会导致整份分析重做：宁可精简文字也要保证 JSON 闭合，不要为塞入更多细节而冒解析失败的风险。`,
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
                    needsNewTable: { type: 'boolean', description: '是否需要新表（DBA 用 execute_sql 发起建表，用户在确认卡片批准后自动执行；确认被取消才转人工）' },
                    fields: { type: 'string', description: '宽表字段（needsNewTable=true 时必填，逗号分隔，如 id,name,status）。⚠️ 同一页面多个查询共用同一张新表时，只在第一个查询填写，其余查询省略' },
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
              callbacks: {
                type: 'array',
                description: '⚠️ 审批结果触发器声明（审批通过/驳回后需要写业务库或调用外部服务时必填，如"通过后扣减休假余额"）。系统自动生成回写查询创建步骤 + 触发器配置。默认 QUERY 目标（事件→固定查询，状态写死在 SQL 里）；调用已有 API 工具（外部 HTTP/通知接口）用 TOOL；仅多步依赖才用 ORCHESTRATION（须先在 pages[].orchestrations 声明）',
                items: {
                  type: 'object',
                  properties: {
                    on: { type: 'string', enum: ['APPROVED', 'REJECTED', 'NODE_ENTERED', 'INSTANCE_COMPLETED', 'INSTANCE_REJECTED'], description: '触发事件。置"已通过"类状态用 APPROVED（挂在最终审批节点）；置"已驳回"用 INSTANCE_REJECTED（任意节点驳回退回发起人都触发）' },
                    targetType: { type: 'string', enum: ['QUERY', 'ORCHESTRATION', 'TOOL'], description: '目标类型。QUERY=执行已保存查询（推荐，改业务库状态）；TOOL=调用已有 API 工具（外部 HTTP 调用/通知接口，无需新建）；ORCHESTRATION=调用已发布编排（须先在 pages[].orchestrations 声明，仅多步依赖场景）' },
                    targetRef: { type: 'string', description: 'QUERY 时为查询名（如 UpdateLeaveApproved，状态写在 SQL 里）；TOOL 时为 API 工具名（须为已接入工具，流程助手会用 list_apis 核对）；ORCHESTRATION 时为编排名' },
                    params: { type: 'string', description: '参数映射描述，如 "id←form.data.id, days←form.data.days"。⚠️ form.data 里必须真的有该字段——业务记录 id 必须由发起页在 startWorkflow 的 formData 中携带' },
                    purpose: { type: 'string', description: '用途描述，如 "置请假记录为已通过"' },
                  },
                  required: ['on', 'targetType', 'targetRef'],
                },
              },
            },
            required: ['description', 'hasForm', 'hasWorkflow'],
          },
        },
        interactions: {
          type: 'array',
          description: '交互联动列表（可选，来自分析报告第 8 章）。报告正文已包含交互联动时建议省略，避免重复生成拖慢提交',
          items: { type: 'string' },
        },
        analysisReport: {
          type: 'string',
          description: '可选，推荐省略。缺省时系统自动取本轮回复正文作为分析报告（报告全文写在回复文本里即可）。禁止把报告全文重复传入——会成倍拖慢提交速度',
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
      required: ['title', 'summary', 'pages', 'workflows', 'score'],
    },
    async execute(args, ctx): Promise<ToolExecuteResult> {
      const analysis = args as unknown as AnalysisData;

      if ((!analysis.pages || analysis.pages.length === 0) && (!analysis.workflows || analysis.workflows.length === 0)) {
        return { success: false, message: 'pages 和 workflows 不能同时为空，请至少提供一个页面或流程' };
      }

      // 报告取值优先级：显式 analysisReport > 当轮回复正文（runtime 经 context 注入）。
      // 正文即报告是推荐路径——模型不再把几千字报告在参数里转义复述一遍，
      // 这段重复生成是"提交分析 → 计划 banner 弹出"之间等待时长的大头
      const turnContent = ctx?.turnContent || '';
      const effectiveReport = analysis.analysisReport?.trim() ? analysis.analysisReport : turnContent;

      if (!effectiveReport || effectiveReport.trim().length < 50) {
        return { success: false, message: '未获取到分析报告：请先在本轮回复中输出完整分析报告正文，再在同一个回复里调用 submit_analysis（推荐，系统自动取正文）；或将报告文本放入 analysisReport 字段' };
      }

      const basicErrors = validateAnalysisBasics(analysis, effectiveReport);
      if (basicErrors.length > 0) {
        const errorLines = basicErrors.map(d => `  - ${d.reason}`).join('\n');
        return { success: false, message: `分析数据存在基础错误，请修正后重新提交：\n${errorLines}` };
      }

      const llmScore = analysis.score;
      if (!llmScore || llmScore.moduleDetail === undefined || llmScore.interactionComplexity === undefined || llmScore.dataCoverage === undefined || llmScore.fieldSpecificity === undefined) {
        return { success: false, message: 'score 为必填，请按评分标准（模块展开深度、交互复杂度、数据覆盖度、字段具体性，各 0-25 分）自评打分后重新提交' };
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

      const { planId, message } = createPlanInternal(analysis.title, analysis.summary, items, score, effectiveReport);

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
        // 业务闭环对账：分析报告承诺的状态变迁必须有实现路径，否则拒绝验证通过
        const closure = checkBusinessClosure(plan);
        if (closure.blocked.length > 0) {
          return {
            success: false,
            message: `计划验证未通过（业务闭环缺失）：\n${closure.blocked.map((i) => `- ${i}`).join('\n')}`,
            data: { closureIssues: closure.blocked },
          };
        }
        store.updatePlan(plan_id, { status: 'completed' });
        upsertPlanMessage(plan_id);
        const resultSummary = plan.steps
          .map((s) => {
            return s.result ? `- ${s.result}` : `- [无 result 摘要] ${s.description || ''}`;
          })
          .join('\n');
        const closureReminder = closure.reminders.length > 0
          ? `\n\n⚠️ 业务闭环汇报要求：\n${closure.reminders.map((r) => `- ${r}`).join('\n')}`
          : '';
        return {
          success: true,
          message: `计划验证通过！共 ${plan.steps.length} 个步骤，全部已完成。\n\n各步骤实际执行结果（汇报时以此为准，禁止编造或夸大）：\n${resultSummary}${closureReminder}\n\n请立即向用户汇报最终执行结果，列出每个步骤的完成情况，并告知用户任务已全部完成。禁止在此消息后直接结束对话，必须先生成汇报文本。`,
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

      let actionMessage: string;
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

  'plan:resume': () => ({
    id: 'plan:resume',
    category: SkillCategory.PLAN,
    name: 'resume_plan',
    description: `恢复一个此前被用户停止（stopped）的计划。仅当用户明确要求继续该计划（如"继续""接着做"）时调用，禁止在其他情况下自行恢复。恢复后返回各步骤当前状态——处于"执行中"的步骤此前可能被中止、实际产出不完整，必须先核实再继续。`,
    parameters: {
      type: 'object',
      properties: { plan_id: { type: 'string', description: '计划 ID' } },
      required: ['plan_id'],
    },
    async execute(args): Promise<ToolExecuteResult> {
      const { plan_id } = args as { plan_id: string };
      const store = useAgentStore.getState();
      const plan = store.plans.find((p) => p.id === plan_id);
      if (!plan) {
        const stoppedIds = store.plans.filter((p) => p.status === 'stopped').map((p) => p.id);
        return { success: false, message: `未找到计划 "${plan_id}"${stoppedIds.length > 0 ? `，已停止的计划有：${stoppedIds.join(', ')}` : '，当前没有已停止的计划'}` };
      }
      if (plan.status === 'completed') return { success: true, message: `计划「${plan.agentName}」已全部完成，无需恢复。` };
      if (plan.status === 'draft') return { success: false, message: `计划「${plan.agentName}」尚未经用户确认，请先展示计划等待确认（confirm_plan），而不是恢复。` };
      if (plan.status === 'rejected') return { success: false, message: `计划「${plan.agentName}」已被用户放弃。如需重新执行请重新分析并创建新计划。` };

      const allDone = plan.steps.length > 0 && plan.steps.every((s) => s.status === 'done');
      if (allDone) {
        store.updatePlan(plan_id, { status: 'completed' });
        upsertPlanMessage(plan_id);
        return { success: true, message: `计划「${plan.agentName}」的所有步骤均已完成，已标记为 completed。请调用 validate_plan 验证后向用户汇报。` };
      }

      store.updatePlan(plan_id, { status: 'executing' });
      upsertPlanMessage(plan_id);
      const steps = plan.steps
        .map((s) => {
          const icon = s.status === 'done' ? '[完成]' : s.status === 'running' ? '[执行中·可能被中止，产出未核实]' : s.status === 'error' ? '[失败]' : '[待定]';
          return `${icon} (id=${s.id}) ${s.description}${s.result ? ` - ${s.result}` : ''}`;
        })
        .join('\n');
      return {
        success: true,
        message: `计划「${plan.agentName}」已恢复为执行中。当前步骤状态：\n${steps}\n\n⚠️ 「执行中」步骤此前可能被中止，实际产出不完整：先用相应查询/列表工具核实资源是否真实存在，再决定继续或重做，禁止默认其已完成。之后按顺序推进剩余步骤，每完成一步调用 update_plan_item 标记。`,
        data: { planId: plan_id, steps: plan.steps.map((s) => ({ id: s.id, status: s.status })) },
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