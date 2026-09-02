import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { useAgentStore } from '@/stores/agentStore';
import { getUnfinishedPlans } from '../../core/planContext';
import type { ToolExecuteResult } from '@/types/agent';

function generatePlanId(): string {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function generateItemId(): string {
  return `pi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
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

function validatePlanItems(items: unknown[]): string | null {
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Record<string, unknown>;
    const toolName = item?.toolName as string | undefined;
    if (toolName && !VALID_PLAN_TOOL_NAMES.has(toolName)) {
      return `步骤 ${i + 1} 的 toolName "${toolName}" 无效，只能使用：${[...VALID_PLAN_TOOL_NAMES].join('、')}`;
    }
  }
  return null;
}

export const planSkills: Record<string, SkillFactory> = {
  'plan:create': () => ({
    id: 'plan:create',
    category: SkillCategory.PLAN,
    name: 'create_plan',
    description: `创建执行计划。分析完成后，将分析结果转化为可执行的步骤列表。
计划创建后会展示给用户确认，用户确认后由主智能体执行。

注意：
- 需求不明确时不要创建计划，先向用户提问澄清
- 计划必须覆盖用户提到的所有需求点
- 计划步骤应按执行顺序排列`,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '计划标题' },
        summary: { type: 'string', description: '计划概要，一句话描述目标' },
        items: {
          type: 'array',
          description: '计划步骤列表',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '步骤唯一ID' },
              category: { type: 'string', enum: ['code_page', 'page', 'datasource', 'query', 'style', 'observation'], description: '步骤类别' },
              description: { type: 'string', description: '步骤描述' },
              toolName: { type: 'string', description: '要调用的工具名称' },
              toolInput: { type: 'object', description: '工具参数（可选）' },
              dependencies: { type: 'array', items: { type: 'string' }, description: '依赖的步骤ID列表' },
            },
            required: ['id', 'category', 'description'],
          },
        },
      },
      required: ['title', 'summary', 'items'],
    },
    async execute(args): Promise<ToolExecuteResult> {
      const { title, summary, items } = args as unknown;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return { success: false, message: '计划步骤列表 items 为空，请提供至少一个步骤' };
      }
      const invalidMsg = validatePlanItems(items);
      if (invalidMsg) {
        return { success: false, message: invalidMsg };
      }
      const store = useAgentStore.getState();
      const planId = generatePlanId();
      const plan = {
        id: planId,
        agentId: 'main-agent',
        agentName: '主智能体',
        agentIcon: '',
        steps: items.map((item: unknown, index: number) => ({
          id: item?.id || generateItemId(),
          description: item?.description || '',
          status: 'pending' as const,
          order: index,
          toolName: item?.toolName,
        })),
        createdAt: Date.now(),
        status: 'draft' as const,
      };
      store.addPlan(plan);
      store.setStatus('idle');
      upsertPlanMessage(planId);
      return { success: true, message: `计划「${title}」已创建，共 ${items.length} 个步骤，等待用户确认。`, data: { planId, title, summary, items }, _pause: true };
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

  'plan:update_item': () => ({
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
      if (!plan) return { success: false, message: `未找到计划 ${plan_id}` };
      const step = plan.steps.find((s: unknown) => String(s.id) === String(item_id));
      if (!step) return { success: false, message: `未找到步骤 ${item_id}，当前计划步骤 ID 为：${plan.steps.map((s: unknown) => s.id).join(', ')}` };
      const statusMap: Record<string, string> = { pending: 'pending', in_progress: 'running', completed: 'done', skipped: 'done' };
      store.updateStep(plan_id, String(item_id), { status: statusMap[status] as unknown, result: result || undefined });
      upsertPlanMessage(plan_id);
      return { success: true, message: `步骤 ${item_id} 状态已更新为 ${status}` };
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
        return {
          success: true,
          message: `计划验证通过！共 ${plan.steps.length} 个步骤，全部已完成。\n\n请立即向用户汇报最终执行结果，列出每个步骤的完成情况，并告知用户任务已全部完成。禁止在此消息后直接结束对话，必须先生成汇报文本。`,
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
        action: { type: 'string', enum: ['append', 'remove', 'replace'], description: '操作类型：append=追加步骤，remove=删除步骤，replace=替换步骤' },
        step_index: { type: 'number', description: '步骤索引（从0开始，remove/replace 时必填）' },
        new_description: { type: 'string', description: '新步骤描述（append/replace 时必填）' },
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
          if (typedArgs.step_index === undefined || !typedArgs.new_description) return { success: false, message: 'replace 操作需要 step_index 和 new_description' };
          if (!plan.steps[typedArgs.step_index]) return { success: false, message: `步骤索引 ${typedArgs.step_index} 不存在` };
          const updated = plan.steps.map((s: unknown, i: number) =>
            i === typedArgs.step_index
              ? { ...s, description: typedArgs.new_description!, toolName: typedArgs.new_tool_name || s.toolName }
              : s,
          );
          store.updatePlan(typedArgs.plan_id, { steps: updated });
          actionMessage = `已替换步骤 ${typedArgs.step_index + 1} 为：${typedArgs.new_description}`;
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