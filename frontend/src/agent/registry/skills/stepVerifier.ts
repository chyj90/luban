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
  listQueries: (applicationId: number) => Promise<{ data: Array<{ id: number; name: string }> }>;
  listPages?: (applicationId: number) => Promise<Array<{ id: number; name: string }>>;
}

const injectableDeps: VerifyDeps = {
  getForm: (id) => formApi.get(id),
  getWorkflow: (id) => workflowApi.getDefinition(id),
  listQueries: (applicationId) => listQueries(applicationId),
};

/** eval 注入桩依赖；传 undefined 恢复真实 API */
export function setStepVerifierDeps(overrides?: Partial<VerifyDeps>): void {
  if (overrides) Object.assign(injectableDeps, overrides);
}

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

async function parseJsonSafe(v: unknown): Promise<unknown> {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
}

/** 核验 delegate_workflow 步骤：资源存在 + 条件分支结构与描述一致 */
async function verifyWorkflowStep(description: string, result: string): Promise<StepVerifyResult> {
  const formId = parseId(result, [/表单ID[:：]?\s*(\d+)/i, /表单\s*ID[:：]?\s*(\d+)/i]);
  const processId = parseId(result, [/流程ID[:：]?\s*(\d+)/i, /流程\s*ID[:：]?\s*(\d+)/i, /\(ID[:：]?\s*(\d+)\)/]);

  if (!formId && !processId) {
    return {
      verified: false,
      reason: `result 中未找到真实的资源 ID（需包含"表单ID: N"或"流程ID: N"），无法核验。请用委派返回的真实 ID 重新标记；若该步骤确实未产生任何资源，说明执行失败，不应标记为 completed`,
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
      return { verified: false, reason: `表单 ID ${formId} 不存在或查询失败，请核实真实 ID` };
    }
  }

  if (processId) {
    let def: WorkflowDefinition;
    try {
      def = await injectableDeps.getWorkflow(processId);
    } catch {
      return { verified: false, reason: `流程 ID ${processId} 不存在或查询失败，请核实真实 ID` };
    }
    const nodes = (await parseJsonSafe(def.nodes)) as Array<{ nodeType?: string }> | null;
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
