/**
 * 步骤完成核验（需求 R2：计划步骤完成的 grounding 校验）
 *
 * 背景：2026-09-08 事故中，子智能体工具失败后主智能体仍把步骤标记为 completed 并
 * 幻觉汇报。本模块在 update_plan_item 标记 completed 时做副作用核验：
 *   - delegate_workflow：从步骤 result 中解析表单/流程 ID，调用 API 验证资源真实存在；
 *     若步骤描述包含"条件/分支"，还须验证流程定义中真的有 condition 节点（事故杀手锏）；
 *   - delegate_query：验证查询存在；
 *   - create_code_page / update_code_page：验证页面存在。
 *
 * 设计原则：
 * - 核验依赖通过 injectableDeps 注入（eval 可替换为桩，运行时用真实 API）；
 * - API 调用异常时核验"跳过"而非"失败"——网络问题不应阻塞任务，只拦确定的造假；
 * - result 文本中解析不到资源 ID 时判"失败"并在返回信息中指导模型补 ID 后重标。
 */
import { formApi, workflowApi } from '@/api/workflow';
import { getOrchestration } from '@/api/orchestration';
import { listQueries } from '@/api';
import type { WorkflowDefinition } from '@/types/workflow';

export interface StepVerifyResult {
  /** true=核验通过或跳过；false=确定的未完成（阻止 completed） */
  verified: boolean;
  reason?: string;
  /** skipped=true 表示因信息不足/网络原因未核验，不阻塞 */
  skipped?: boolean;
}

interface VerifyDeps {
  getForm: (id: number) => Promise<{ id: number; name?: string; fields?: string }>;
  getWorkflow: (id: number) => Promise<WorkflowDefinition>;
  getOrchestration: (id: number) => Promise<{ data: { id: number; name?: string } }>;
  listQueries: (applicationId: number) => Promise<{ data: Array<{ id: number; name: string }> }>;
  listPages?: (applicationId: number) => Promise<Array<{ id: number; name: string }>>;
}

const injectableDeps: VerifyDeps = {
  getForm: (id) => formApi.get(id),
  getWorkflow: (id) => workflowApi.getDefinition(id),
  getOrchestration: (id) => getOrchestration(id),
  listQueries: (applicationId) => listQueries(applicationId),
};

/** eval 注入桩依赖；传 undefined 恢复真实 API */
export function setStepVerifierDeps(overrides?: Partial<VerifyDeps>): void {
  if (overrides) Object.assign(injectableDeps, overrides);
}

/** 从 result 文本解析资源 ID。兼容全角括号/冒号、"流程(id: 211)"、"流程ID为211"、"表单ID=64" 等模型常见变体 */
function parseId(result: string, patterns: RegExp[]): number | null {
  for (const p of patterns) {
    const m = result.match(p);
    if (m?.[1]) {
      const id = Number(m[1]);
      if (Number.isFinite(id) && id > 0) return id;
    }
  }
  return null;
}

const FORM_ID_PATTERNS = [
  /表单\s*ID\s*[:：为=＝]?\s*(\d+)/i,
  /[（(]\s*表单\s*ID\s*[:：为=＝]?\s*(\d+)\s*[)）]/i,
  /form\s*ID\s*[:：为=＝]?\s*(\d+)/i,
];
const PROCESS_ID_PATTERNS = [
  /流程\s*ID\s*[:：为=＝]?\s*(\d+)/i,
  /[（(]\s*(?:审批)?流程\s*ID\s*[:：为=＝]?\s*(\d+)\s*[)）]/i,
  /[（(]\s*id\s*[:：]\s*(\d+)\s*[)）]/i,
  /流程\s*[（(]\s*ID\s*[:：]?\s*(\d+)\s*[)）]/i,
  /流程.*?ID\s*[:：为=＝]?\s*(\d+)/i,
];
const ORCH_ID_PATTERNS = [
  /编排\s*ID\s*[:：为=＝]?\s*(\d+)/i,
  /[（(]\s*编排\s*ID\s*[:：为=＝]?\s*(\d+)\s*[)）]/i,
  /编排.*?ID\s*[:：为=＝]?\s*(\d+)/i,
];

/**
 * 严格正则不中时的宽松兜底：提取 result 中所有"ID N"形态的裸数字候选（如"（ID 66）"、
 * "表单已创建（ID 66）"——关键词与 ID 被其它文字隔开时严格正则会漏），再用真实 API
 * 存在性校验筛掉误匹配（候选查不到资源即丢弃，不会产生假阳性）。
 */
async function resolveIdsLoosely(description: string, result: string): Promise<{ formId: number | null; processId: number | null }> {
  const candidates = new Set<number>();
  for (const m of result.matchAll(/(?:^|[^A-Za-z\d])ID\s*[:：为=＝]?\s*(\d{1,9})/gi)) {
    const id = Number(m[1]);
    if (Number.isFinite(id) && id > 0) candidates.add(id);
  }
  if (candidates.size === 0 || candidates.size > 5) return { formId: null, processId: null };
  // 描述提到表单优先按表单验证，提到流程优先按流程验证；都没提则先表单
  const formFirst = /表单|form/i.test(description) || !/流程|审批|workflow/i.test(description);
  let formId: number | null = null;
  let processId: number | null = null;
  const probeForm = async (id: number): Promise<boolean> => {
    try {
      // API 404 会抛错进 catch；调用成功即资源存在（不依赖返回体里是否带 id 字段）
      const form = await injectableDeps.getForm(id);
      if (form) { formId = id; return true; }
    } catch { /* 不是表单 */ }
    return false;
  };
  const probeProcess = async (id: number): Promise<boolean> => {
    try {
      const def = await injectableDeps.getWorkflow(id);
      if (def) { processId = id; return true; }
    } catch { /* 不是流程 */ }
    return false;
  };
  for (const id of candidates) {
    if (formFirst) {
      if (formId === null && (await probeForm(id))) continue;
      if (processId === null) await probeProcess(id);
    } else {
      if (processId === null && (await probeProcess(id))) continue;
      if (formId === null) await probeForm(id);
    }
  }
  return { formId, processId };
}

async function parseJsonSafe(v: unknown): Promise<unknown> {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
}

/** 核验 delegate_workflow 步骤：资源存在 + 条件分支结构与描述一致 + 闭环承诺不被草稿状态糊弄 */
async function verifyWorkflowStep(description: string, result: string): Promise<StepVerifyResult> {
  let formId = parseId(result, FORM_ID_PATTERNS);
  let processId = parseId(result, PROCESS_ID_PATTERNS);

  if (!formId && !processId) {
    // 严格正则不中时走宽松兜底（候选 ID 经真实 API 验证，不会误判）
    const loose = await resolveIdsLoosely(description, result);
    formId = loose.formId;
    processId = loose.processId;
  }

  if (!formId && !processId) {
    return {
      verified: false,
      reason: `result 中未找到可核验的真实资源 ID（推荐写"表单ID: N"/"流程ID: N"，也接受真实存在的"（ID N）"）。请用委派返回的真实 ID 重新标记；若该步骤确实未产生任何资源，说明执行失败，不应标记为 completed`,
    };
  }

  // 业务闭环：只有当步骤本身承诺"发布/挂接/接入/联动"时，草稿或待接入状态才算未完成
  // （纯设计步骤以草稿结束是正常的，发布由后续闭环步骤负责）
  const promisesClosure = /发布|挂接|接入|联动|发起链路/.test(description);
  if (promisesClosure && /草稿|待发布|未发布|待接入|待挂接|待确认/.test(result)) {
    return {
      verified: false,
      reason: `步骤承诺了流程闭环（发布/挂接/联动），但 result 显示仍有未完成项（草稿/待接入/待确认等）。请先完成发布与发起链路接入再标记 completed；确因平台能力无法闭环的，请将该步骤标记 error 并向用户如实说明缺口`,
    };
  }

  if (formId) {
    try {
      const form = await injectableDeps.getForm(formId);
      const fields = await parseJsonSafe(form.fields);
      if (!Array.isArray(fields) || fields.length === 0) {
        return { verified: false, reason: `表单 ${formId} 存在但没有任何字段，可能创建不完整` };
      }
    } catch {
      return {
        verified: false,
        reason: `表单 ID ${formId} 不存在或查询失败。若委派实际创建了新表单，请改用其返回的真实 ID 重新标记；若该表单确实已不存在（被删除或未建成）且本步骤需要它，请重新委派流程设计助手补建，再用新 ID 标记 completed；若本步骤并不依赖该表单（如页面自带弹窗发起），请修正 result 移除该表单 ID 后重新标记`,
      };
    }
  }

  if (processId) {
    let def: WorkflowDefinition;
    try {
      def = await injectableDeps.getWorkflow(processId);
    } catch {
      return {
        verified: false,
        reason: `流程 ID ${processId} 不存在或查询失败。若委派实际创建了新流程，请改用其返回的真实 ID 重新标记；若该流程确实已不存在（被删除或未建成），请重新委派补建并发布后再用新 ID 标记 completed`,
      };
    }
    const nodes = (await parseJsonSafe(def.nodes)) as
      | Array<{ nodeType?: string; data?: { config?: { triggers?: Array<{ on?: string }> } } }>
      | null;
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return { verified: false, reason: `流程 ${processId} 存在但节点为空，可能创建不完整` };
    }
    const mentionsBranch = /条件|分支|≤|>=|大于|小于/i.test(description);
    if (mentionsBranch && !nodes.some((n) => n.nodeType === 'condition')) {
      const nodeSummary = nodes.map((n) => n.nodeType || '?').join(' → ');
      return {
        verified: false,
        reason: `步骤要求条件分支，但流程 ${processId} 的实际节点中没有 condition 节点（当前节点：${nodeSummary}）。这正是"汇报与实际不符"的典型场景，请勿标记完成`,
      };
    }
    // 触发器核验：步骤承诺配置审批结果触发器（联动/回调/扣减）时，定义里必须真的有 triggers，
    // 且 description 中 on=XXX 声明的事件都必须已配置（2026-09-15 请假案例：联动承诺无人配置成断链）
    const mentionsTrigger = /触发器|回调|联动|扣减|回写|置为/.test(description);
    if (mentionsTrigger) {
      const configuredTriggers = nodes.flatMap((n) => n?.data?.config?.triggers || []);
      if (configuredTriggers.length === 0) {
        return {
          verified: false,
          reason: `步骤要求配置审批结果触发器，但流程 ${processId} 的所有节点 data.config 中都没有 triggers 数组。请先在审批节点配置触发器再标记完成`,
        };
      }
      const declaredEvents = [...description.matchAll(/on\s*=\s*(APPROVED|REJECTED|NODE_ENTERED|INSTANCE_COMPLETED|INSTANCE_REJECTED)/gi)]
        .map((m) => m[1].toUpperCase());
      const configuredEvents = new Set(configuredTriggers.map((t) => String(t?.on || '').toUpperCase()));
      const missing = [...new Set(declaredEvents)].filter((e) => !configuredEvents.has(e));
      if (missing.length > 0) {
        const present = [...configuredEvents].join('、') || '无';
        return {
          verified: false,
          reason: `触发器事件缺失：声明了 ${missing.join('、')}，但流程 ${processId} 实际只配置了 ${present}。请补配缺失事件后重新发布流程再标记完成`,
        };
      }
    }
  }

  return { verified: true };
}

/** 核验 delegate_query 步骤：从描述/结果中解析查询名并验证存在 */
async function verifyQueryStep(applicationId: number, description: string, result: string): Promise<StepVerifyResult> {
  const nameMatch = (result + ' ' + description).match(/查询名[:：]?\s*([A-Za-z_]\w*)/) || (result + ' ' + description).match(/创建查询\s+([A-Za-z_]\w*)/);
  if (!nameMatch?.[1]) {
    return { verified: true, skipped: true };
  }
  try {
    const res = await injectableDeps.listQueries(applicationId);
    const exists = (res.data || []).some((q) => q.name === nameMatch[1]);
    if (!exists) {
      return { verified: false, reason: `查询 "${nameMatch[1]}" 不存在，请核实 DBA 是否真的创建了该查询` };
    }
    return { verified: true };
  } catch {
    return { verified: true, skipped: true };
  }
}

/** 核验 delegate_orchestration 步骤：编排真实存在，且名称与步骤声明一致（防跨步骤贴结果） */
async function verifyOrchestrationStep(description: string, result: string): Promise<StepVerifyResult> {
  const orchId = parseId(result, ORCH_ID_PATTERNS);
  if (!orchId) {
    return {
      verified: false,
      reason: `result 中未找到真实的编排 ID（需包含"编排ID: N"），无法核验。请用委派返回的真实 ID 重新标记；若该步骤确实未创建编排，说明执行失败，不应标记为 completed`,
    };
  }
  let orch: { data: { id: number; name?: string } };
  try {
    orch = await injectableDeps.getOrchestration(orchId);
  } catch {
    return { verified: false, reason: `编排 ID ${orchId} 不存在或查询失败。若委派实际创建了新编排，请改用其返回的真实 ID 重新标记；若确实已不存在（被删除或未建成），请重新委派补建后再标记 completed` };
  }
  const nameMatch = description.match(/创建编排\s+([A-Za-z_]\w*)/);
  const actualName = orch.data?.name;
  if (nameMatch?.[1] && actualName && actualName !== nameMatch[1]) {
    return {
      verified: false,
      reason: `编排 ID ${orchId} 的实际名称是「${actualName}」，与步骤要创建的编排「${nameMatch[1]}」不符——result 可能贴自其他步骤，请核实后重新标记`,
    };
  }
  return { verified: true };
}

/**
 * 核验步骤是否真的完成。返回 verified=false 时 update_plan_item 应拒绝 completed。
 */
export async function verifyStepCompletion(
  toolName: string,
  applicationId: number,
  description: string,
  result: string,
): Promise<StepVerifyResult> {
  try {
    switch (toolName) {
      case 'delegate_workflow':
        return await verifyWorkflowStep(description, result);
      case 'delegate_orchestration':
        return await verifyOrchestrationStep(description, result);
      case 'delegate_query':
        return await verifyQueryStep(applicationId, description, result);
      default:
        // create_code_page / update_code_page 等暂由 validate_plan 层覆盖，此处跳过
        return { verified: true, skipped: true };
    }
  } catch (e) {
    console.warn('[StepVerifier] 核验异常，跳过（不阻塞任务）:', e);
    return { verified: true, skipped: true };
  }
}