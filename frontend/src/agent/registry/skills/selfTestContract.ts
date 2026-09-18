/**
 * 应用测试契约提取器 + 规则默认 TestSpec 生成器（一键链路自检的核心）。
 *
 * 设计要点（doc/需求文档/需求文档-应用自检测试引擎设计.md §0-Q3）：
 *  - 不依赖 agent 的分析报告：只从平台元数据（页面 JS、查询、流程定义、表单绑定、平台组织）
 *    提取"应用测试契约"，手工制作的应用与 agent 生成的应用同样可测；
 *  - 规则生成器只产出链路级事实（发起 → 审批 → 触发器派发），语义断言（"余额必须减 2"）
 *    留给 agent 增强/用户手写——规则不说谎；
 *  - 无法推导的参与者/字段以 gap 显式进入报告，不做猜测。
 */
import { listPages, getCodePage, listQueries } from '@/api';
import { workflowApi, formApi, bindingApi } from '@/api/workflow';
import { getPlatformUsers } from '@/api/platform';
import type { Query } from '@/types/query';
import type { SelfTestSpec, SelfTestStep } from '@/types/selfTest';

export interface ContractExtraction {
  spec: SelfTestSpec;
  /** 可测性缺口：无法自动推导、需要 agent/用户补充的点 */
  gaps: string[];
  /** 提取摘要（报告展示用） */
  notes: string[];
}

interface FormField { key: string; label?: string; type?: string; required?: boolean; options?: Array<{ label: string; value: string }>; }

interface ApprovalNodeInfo {
  nodeId: string;
  approverType: string;
  memberIds?: number[];
  roleIds?: number[];
}

/** 从流程定义 nodes JSON 提取第一个审批节点的审批人配置 */
export function extractFirstApprovalNode(nodesJson: string): ApprovalNodeInfo | null {
  try {
    const nodes = JSON.parse(nodesJson);
    const list = Array.isArray(nodes) ? nodes : [];
    for (const n of list) {
      const nodeType = n?.nodeType ?? n?.data?.nodeType;
      if (nodeType !== 'approval') continue;
      const config = n?.data?.config || {};
      return {
        nodeId: n.nodeId || n.id || 'approval',
        approverType: String(config.approverType || ''),
        memberIds: Array.isArray(config.memberIds) ? config.memberIds.map(Number) : undefined,
        roleIds: Array.isArray(config.roleIds) ? config.roleIds.map(Number) : undefined,
      };
    }
  } catch { /* 定义 JSON 异常 → 视为无审批节点 */ }
  return null;
}

/** 从流程定义 nodes JSON 提取全部 QUERY 型触发器目标查询 ID */
export function extractTriggerQueryIds(nodesJson: string): number[] {
  try {
    const nodes = JSON.parse(nodesJson);
    const list = Array.isArray(nodes) ? nodes : [];
    const refs: number[] = [];
    for (const n of list) {
      const triggers = n?.data?.config?.triggers;
      if (!Array.isArray(triggers)) continue;
      for (const t of triggers) {
        const target = t?.target;
        if (target && String(target.type).toUpperCase() === 'QUERY') refs.push(Number(target.ref));
      }
    }
    return refs;
  } catch { return []; }
}

/** 从 INSERT SQL 解析目标表名 */
export function parseInsertTableName(body: string): string | null {
  const m = body && body.trim().match(/^INSERT\s+INTO\s+[`"']?([A-Za-z_][A-Za-z0-9_$]*)/i);
  return m ? m[1] : null;
}

/** 从页面 JS 提取"INSERT 查询 → startWorkflow"的发起链路（业务记录 id 注入点） */
export function extractStartChainFromPage(js: string): { insertQueryName: string | null; startWorkflowIds: number[] } {
  const insertMatch = js.match(/DataQuery\.(Insert[A-Za-z0-9_]*)\s*\(/);
  const startIds: number[] = [];
  const re = /startWorkflow\s*\(\s*(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(js)) !== null) startIds.push(Number(m[1]));
  return { insertQueryName: insertMatch ? insertMatch[1] : null, startWorkflowIds: startIds };
}

/** 表单字段按类型生成默认值（通用规则，与具体业务无关） */
export function formFieldDefault(field: FormField, initiatorId: number, firstDeptId: number | null): { value: unknown; skipReason?: string } {
  switch (field.type) {
    case 'select':
    case 'radio':
      return { value: field.options?.[0]?.value ?? '' };
    case 'multi_select':
      return { value: field.options?.[0] ? [field.options[0].value] : [] };
    case 'number':
      return { value: 1 };
    case 'date':
      return { value: new Date().toISOString().slice(0, 10) };
    case 'datetime':
      return { value: new Date().toISOString().slice(0, 16).replace('T', ' ') };
    case 'text':
      return { value: `测试-${field.label || field.key}` };
    case 'textarea':
      return { value: `测试内容-${field.label || field.key}` };
    case 'member':
      return { value: initiatorId };
    case 'department':
      return { value: firstDeptId ?? '' };
    case 'switch':
    case 'checkbox':
      return { value: true };
    case 'detail_table':
      return { value: [] };
    case 'file':
    case 'excel':
    case 'computed':
      return { value: '', skipReason: `字段 ${field.key} 类型为 ${field.type}，自动生成跳过` };
    default:
      return { value: `测试-${field.key}` };
  }
}

export interface ContractInputs {
  queries: Query[];
  pagesJs: string[];
  /** 被页面绑定的查询 ID 集合（codePage.queryIds）——INSERT 候选消歧的优先级依据 */
  referencedQueryIds: Set<number>;
  publishedWorkflowIds: number[];
  bindings: Array<{ workflowId: number; formId: number }>;
  formsById: Record<number, { id: number; name: string; fields: string }>;
  definitionsById: Record<number, { id: number; nodes: string }>;
  platformUsers: Array<{ id: number; name: string; leaderId: number | null; deptId: number | null }>;
}

/**
 * INSERT 候选消歧（纯函数）：同名/同表 INSERT 可能存在历史遗留的重复查询
 * （2026-09-17 请假案例：新旧两代 InsertLeaveRecord 同名，旧版用 employee_id 列，
 * 静默 first-match 选中旧版导致自检 INSERT 必然失败）。规则：页面绑定的查询优先；
 * 仍不唯一时返回全部候选 pool，由调用方显式记录进报告，禁止无提示地取第一个。
 */
export function pickInsertQuery(
  candidates: Query[],
  referencedQueryIds: Set<number>,
): { query: Query | null; pool: Query[] } {
  if (candidates.length === 0) return { query: null, pool: [] };
  const preferred = candidates.filter(q => referencedQueryIds.has(q.id));
  const pool = preferred.length > 0 ? preferred : candidates;
  return { query: pool[0], pool };
}

/** 纯函数：由契约输入生成默认 TestSpec——默认取第一条"已发布且绑定表单"的流程 */
export function buildDefaultTestSpec(inputs: ContractInputs, appId: number): ContractExtraction {
  const binding = inputs.bindings.find(b => inputs.publishedWorkflowIds.includes(b.workflowId));
  if (!binding) {
    // 无流程应用：仅支持查询步骤与页面冒烟，本生成器产出空 spec + 缺口说明
    return {
      spec: { testName: `应用 ${appId} 链路自检`, actors: {}, steps: [] },
      gaps: ['应用内没有"已发布且绑定表单"的流程——无法生成审批链路用例，可手写 TestSpec 测查询/页面'],
      notes: ['契约提取完成：未发现已发布流程'],
    };
  }
  return buildTestSpecForBindings(inputs, [binding]);
}

/**
 * 纯函数：为每条选中流程各生成一段"写库 → 发起 → 审批 → 触发器"子链路。
 * 多流程时步骤 id 加 w{n}_ 前缀（引擎要求步骤 id 唯一，变量引用随之前缀化）；
 * 参与者别名池跨流程共享，同一平台用户复用别名，总别名数不超过引擎上限 5。
 */
export function buildTestSpecForBindings(
  inputs: ContractInputs,
  bindings: Array<{ workflowId: number; formId: number }>,
): ContractExtraction {
  const gaps: string[] = [];
  const notes: string[] = [];
  const steps: SelfTestStep[] = [];
  const actors: Record<string, number> = {};
  const datasourceIds = new Set<number>();

  // 应用元数据健康度（历史脏数据会让契约提取产生歧义，提取前显式报告，不静默吞掉）
  const nameToIds = new Map<string, number[]>();
  for (const q of inputs.queries) {
    const ids = nameToIds.get(q.name) || [];
    ids.push(q.id);
    nameToIds.set(q.name, ids);
  }
  for (const [name, ids] of nameToIds) {
    if (ids.length > 1) {
      notes.push(`应用存在同名查询「${name}」(ID: ${ids.join(', ')})——INSERT 候选按页面绑定优先消歧，建议清理遗留重复查询`);
    }
  }
  if (inputs.referencedQueryIds.size > 0) {
    const orphans = inputs.queries.filter(q => !inputs.referencedQueryIds.has(q.id)).map(q => `${q.name}(${q.id})`);
    if (orphans.length > 0) {
      notes.push(`未被任何页面绑定的查询 ${orphans.length} 个（${orphans.slice(0, 8).join('、')}${orphans.length > 8 ? ' 等' : ''}）——契约提取不优先采用，建议清理`);
    }
  }

  const allocActor = (userId: number, base: string): string | null => {
    const hit = Object.entries(actors).find(([, uid]) => uid === userId);
    if (hit) return hit[0];
    if (Object.keys(actors).length >= 5) return null;
    let name = base;
    for (let n = 2; actors[name] != null; n++) name = `${base}${n}`;
    actors[name] = userId;
    return name;
  };

  let approvedAny = false;
  for (const [idx, binding] of bindings.entries()) {
    const wfLabel = `流程 ${binding.workflowId}`;
    // 多流程时步骤 id 加前缀保证唯一；单流程保持原 id（insert/start/…）不变
    const tag = bindings.length > 1 ? `w${idx + 1}_` : '';
    const stepsBefore = steps.length;
    const gapsBefore = gaps.length;
    const def = inputs.definitionsById[binding.workflowId];
    const form = inputs.formsById[binding.formId];
    if (!def || !form) {
      gaps.push(`${wfLabel} 定义或绑定表单详情获取失败，已跳过`);
      continue;
    }

    // 1. 审批人推导（按 approverType，Q4 通用性矩阵）
    const approval = extractFirstApprovalNode(def.nodes);
    let approverDerived = false;
    let initiatorId: number | null = null;
    let leaderId: number | null = null;
    if (approval) {
      if (approval.approverType === 'leader') {
        const u = inputs.platformUsers.find(p => p.leaderId != null);
        if (u) { initiatorId = u.id; leaderId = u.leaderId; approverDerived = true; }
      } else if (approval.approverType === 'member' && approval.memberIds?.length) {
        leaderId = approval.memberIds[0];
        const u = inputs.platformUsers.find(p => p.id !== leaderId);
        if (u) { initiatorId = u.id; approverDerived = true; }
      } else if (approval.approverType === 'department_head') {
        // 取第一个有部门且有部门负责人的用户近似推导
        const u = inputs.platformUsers.find(p => p.deptId != null);
        if (u) { initiatorId = u.id; approverDerived = true; leaderId = u.leaderId; }
      } else {
        gaps.push(`${wfLabel} 审批节点 approverType=${approval.approverType || '未知'} 无法自动推导参与者，请在 actors 中指定真实审批人并补充 task_complete 步骤`);
      }
    } else {
      notes.push(`${wfLabel} 无审批节点（如自动节点），仅验证发起与触发器派发`);
    }
    if (!approverDerived && approval) {
      gaps.push(`未能自动推导${wfLabel}的审批人，用例仅覆盖发起段`);
    }
    // actor 别名仅在成功分配后写入步骤——后端对未知别名会直接报错
    const initiatorAlias = initiatorId != null ? allocActor(initiatorId, 'employee') : null;
    const approverAlias = leaderId != null ? allocActor(leaderId, 'leader') : null;
    if (initiatorId != null && !initiatorAlias) {
      gaps.push(`${wfLabel} 发起人无法分配 actor 别名（上限 5 个），已跳过该流程`);
      continue;
    }
    if (approverDerived && leaderId != null && !approverAlias) {
      gaps.push(`${wfLabel} 审批人无法分配 actor 别名（上限 5 个），用例仅覆盖发起段`);
    }

    // 2. 业务记录链路：优先从页面 JS 找"INSERT 查询 → startWorkflow"注入点；
    // 纯流程应用（无页面）从触发器回写表反推——触发器 UPDATE 哪张表，就找 INSERT INTO 该表的查询。
    // 候选可能包含同名/同表的遗留重复查询：页面绑定优先，不唯一时全部列出（禁止静默 first-match）
    let insertQuery: Query | null = null;
    let chainNote = '';
    for (const js of inputs.pagesJs) {
      const chain = extractStartChainFromPage(js);
      if (chain.insertQueryName && chain.startWorkflowIds.includes(binding.workflowId)) {
        const sameName = inputs.queries.filter(c => c.name === chain.insertQueryName);
        const picked = pickInsertQuery(sameName, inputs.referencedQueryIds);
        if (picked.pool.length > 1) {
          gaps.push(`${wfLabel} 查询名「${chain.insertQueryName}」匹配到 ${picked.pool.length} 个同名查询 (ID: ${picked.pool.map(q => q.id).join(', ')})，已选用 id=${picked.query?.id}（页面绑定优先）——存在遗留重复资源，建议清理后重跑自检`);
        }
        if (picked.query) {
          insertQuery = picked.query;
          chainNote = `页面注入链 DataQuery.${chain.insertQueryName} → startWorkflow(${binding.workflowId})`;
          break;
        }
      }
    }
    let flowOnlyNote = '';
    if (!insertQuery) {
      const updateTables = new Set<string>();
      for (const qid of extractTriggerQueryIds(def.nodes)) {
        const q = inputs.queries.find(c => c.id === qid);
        const m = q?.body?.trim().match(/^UPDATE\s+[`"']?([A-Za-z_][A-Za-z0-9_$]*)/i);
        if (m) updateTables.add(m[1]);
      }
      if (updateTables.size > 0) {
        const candidates = inputs.queries.filter((q) => {
          const t = parseInsertTableName(q.body || '');
          return t != null && updateTables.has(t);
        });
        const picked = pickInsertQuery(candidates, inputs.referencedQueryIds);
        if (picked.query) {
          insertQuery = picked.query;
          if (picked.pool.length > 1) {
            gaps.push(`${wfLabel} 触发器回写表 ${[...updateTables].join('、')} 匹配到 ${picked.pool.length} 个 INSERT 查询 (ID: ${picked.pool.map(q => q.id).join(', ')})，已选用 id=${picked.query.id}（页面绑定优先）——建议清理遗留重复查询`);
          }
          flowOnlyNote = `业务记录链路（无页面，由触发器回写表反推）：INSERT 查询 ${insertQuery.name}`;
        }
      }
    }
    if (insertQuery) {
      datasourceIds.add(insertQuery.datasourceId);
      if (inputs.referencedQueryIds.size > 0 && !inputs.referencedQueryIds.has(insertQuery.id)) {
        gaps.push(`选用的 INSERT 查询「${insertQuery.name}」(ID: ${insertQuery.id}) 未被任何页面绑定，可能是遗留资源——若与本流程无关请清理后重跑自检`);
      }
      const params: Record<string, unknown> = {};
      const qp = (insertQuery.params || {}) as Record<string, { required?: boolean; type?: string }>;
      for (const [name, meta] of Object.entries(qp)) {
        params[name] = paramDefault(meta?.type, name);
      }
      steps.push({ id: `${tag}insert`, actor: initiatorAlias ?? undefined, type: 'query_run', queryId: insertQuery.id, params });
      notes.push(flowOnlyNote || chainNote || `${wfLabel} 业务记录：INSERT 查询 ${insertQuery.name}（id=${insertQuery.id}）`);
    } else {
      gaps.push(`${wfLabel} 未发现业务记录注入链（页面 JS 注入或触发器回写表反推均未命中）——触发器若引用 form.data.id 将命中 0 行；如流程不依赖业务记录可忽略`);
    }

    // 3. 发起步骤：表单字段按类型填默认值（覆盖表单契约）
    let formFields: FormField[] = [];
    try { formFields = JSON.parse(form.fields || '[]'); } catch { gaps.push(`${wfLabel} 表单字段 JSON 解析失败`); }
    const formData: Record<string, unknown> = {};
    const initiator = initiatorId ?? inputs.platformUsers[0]?.id ?? 0;
    const firstDept = inputs.platformUsers.find(p => p.deptId != null)?.deptId ?? null;
    for (const f of formFields) {
      const d = formFieldDefault(f, initiator, firstDept);
      if (d.skipReason) gaps.push(d.skipReason);
      else formData[f.key] = d.value;
    }
    if (insertQuery) formData['id'] = `\${${tag}insert.insertId}`;
    steps.push({ id: `${tag}start`, actor: initiatorAlias ?? undefined, type: 'workflow_start', definitionId: binding.workflowId, formData });

    // 4. 审批 + 触发器等待
    if (approverDerived && approverAlias) {
      steps.push({ id: `${tag}wait1`, type: 'wait_outbox', instanceRef: `${tag}start.instanceId` });
      steps.push({ id: `${tag}approve`, actor: approverAlias, type: 'task_complete', instanceRef: `${tag}start.instanceId`, action: 'APPROVE', comment: '自检测试审批' });
      steps.push({ id: `${tag}wait2`, type: 'wait_outbox', instanceRef: `${tag}start.instanceId` });
      approvedAny = true;
    }

    if (steps.length - stepsBefore <= 1 && gaps.length === gapsBefore) {
      gaps.push(`${wfLabel} 可提取信息不足，未能生成有效用例`);
    }
  }

  if (approvedAny) {
    notes.push('断言边界：规则用例只验证链路事实（发起/审批/触发器全部派发、无死信），语义断言（如余额扣减）请由 agent 或用户补充 assert_sql 步骤');
  }
  if (datasourceIds.size > 1) {
    gaps.push(`选中流程的业务记录分布在不同数据源（${[...datasourceIds].join('、')}），断言与自动清理仅使用第一个——其余数据源的清理会进入测试残留`);
  }

  const spec: SelfTestSpec = {
    testName: `链路自检：流程「${bindings.map(b => b.workflowId).join('、')}」主链路`,
    datasourceId: datasourceIds.values().next().value ?? undefined,
    actors,
    steps,
  };
  if (steps.length === 0 && gaps.length === 0) gaps.push('可提取信息不足，未能生成有效用例');
  return { spec, gaps, notes };
}

function paramDefault(type: string | undefined, name: string): unknown {
  switch ((type || 'string').toLowerCase()) {
    case 'number': return 1;
    case 'date': return new Date().toISOString().slice(0, 10);
    default: return `测试-${name}`;
  }
}

export interface ChainCandidate {
  workflowId: number;
  /** 流程定义名（勾选列表展示用） */
  name: string;
}

/** 业务链路候选流程：已发布且绑定表单（与规则用例的选取标准一致），供自检抽屉单/多选 */
export async function listChainCandidates(appId: number): Promise<ChainCandidate[]> {
  const [defs, bindings] = await Promise.all([
    workflowApi.listDefinitions({ applicationId: appId }).catch(() => []),
    bindingApi.list({ applicationId: appId }).catch(() => []),
  ]);
  const publishedNames = new Map<number, string>();
  for (const d of defs || []) {
    if (d.status === 'PUBLISHED') {
      publishedNames.set(d.id, String((d as { name?: string }).name || `流程 ${d.id}`));
    }
  }
  const seen = new Set<number>();
  const out: ChainCandidate[] = [];
  for (const b of bindings || []) {
    const name = publishedNames.get(b.workflowId);
    if (name == null || seen.has(b.workflowId)) continue;
    seen.add(b.workflowId);
    out.push({ workflowId: b.workflowId, name });
  }
  return out;
}

/** 拉取平台元数据（页面 JS、查询、流程定义、表单绑定、平台组织）——契约生成的全部输入 */
async function fetchContractInputs(appId: number): Promise<ContractInputs> {
  const [pagesRes, queriesRes, defs, bindings, forms, usersRes] = await Promise.all([
    listPages(appId),
    listQueries(appId).catch(() => null),
    workflowApi.listDefinitions({ applicationId: appId }).catch(() => []),
    bindingApi.list({ applicationId: appId }).catch(() => []),
    formApi.list({ applicationId: appId }).catch(() => []),
    getPlatformUsers({ page: 1, pageSize: 50 }).catch(() => null),
  ]);

  const pages = pagesRes.data || [];
  const queries = (queriesRes?.data || []) as Query[];
  const pagesJs: string[] = [];
  const referencedQueryIds = new Set<number>();
  for (const p of pages) {
    try {
      const code = await getCodePage(p.id);
      if (code.data.codePage?.js) pagesJs.push(code.data.codePage.js);
      for (const qid of (code.data.codePage?.queryIds as number[] | undefined) || []) {
        referencedQueryIds.add(Number(qid));
      }
    } catch { /* 页面可能没有代码页 */ }
  }

  const publishedIds = (defs || []).filter((d: { status: string }) => d.status === 'PUBLISHED').map((d: { id: number }) => d.id);
  const definitionsById: Record<number, { id: number; nodes: string }> = {};
  await Promise.all(publishedIds.map(async (id: number) => {
    try {
      const def = await workflowApi.getDefinition(id);
      definitionsById[id] = { id, nodes: typeof def.nodes === 'string' ? def.nodes : JSON.stringify(def.nodes) };
    } catch { /* 拉取失败按缺失处理 */ }
  }));

  const formsById: Record<number, { id: number; name: string; fields: string }> = {};
  for (const f of forms || []) {
    formsById[f.id] = { id: f.id, name: f.name, fields: String((f as { fields?: string }).fields || '[]') };
  }

  const users = ((usersRes?.data?.rows || []) as Array<{ id: number; name: string; leaderId: number | null; deptId: number | null }>);

  return {
    queries,
    pagesJs,
    referencedQueryIds,
    publishedWorkflowIds: publishedIds,
    bindings: (bindings || []).map((b: { workflowId: number; formId: number }) => ({ workflowId: b.workflowId, formId: b.formId })),
    formsById,
    definitionsById,
    platformUsers: users,
  };
}

/** 按勾选的流程构建用例（单/多选，每条各生成一段子链路）；一次至多 10 条（引擎步骤上限 50） */
export async function buildSpecForWorkflows(appId: number, workflowIds: number[]): Promise<ContractExtraction> {
  if (workflowIds.length === 0) {
    return {
      spec: { testName: `应用 ${appId} 链路自检`, actors: {}, steps: [] },
      gaps: [],
      notes: ['未勾选业务链路流程，跳过业务链路执行'],
    };
  }
  const inputs = await fetchContractInputs(appId);
  const truncated = workflowIds.length > 10;
  const preGaps: string[] = [];
  if (truncated) preGaps.push(`一次至多覆盖 10 条流程（引擎步骤上限 50），仅取前 10 条`);
  const bindings: Array<{ workflowId: number; formId: number }> = [];
  for (const id of workflowIds.slice(0, 10)) {
    const b = inputs.bindings.find((x) => x.workflowId === id);
    if (b) bindings.push(b);
    else preGaps.push(`流程 ${id} 没有可用的表单绑定关系，已跳过`);
  }
  const extraction = buildTestSpecForBindings(inputs, bindings);
  extraction.gaps.unshift(...preGaps);
  return extraction;
}

/** 异步编排：拉取平台元数据并生成默认主链路 TestSpec（默认第一条"已发布且绑定表单"的流程，供 agent 技能使用） */
export async function extractContractAndBuildSpec(appId: number): Promise<ContractExtraction> {
  const inputs = await fetchContractInputs(appId);
  return buildDefaultTestSpec(inputs, appId);
}
