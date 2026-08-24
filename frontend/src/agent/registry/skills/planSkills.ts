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
      const store = useAgentStore.getState();
      const planId = generatePlanId();
      const plan = {
        id: planId,
        agentId: 'main-agent',
        agentName: '主智能体',
        agentIcon: '',
        steps: items.map((item: unknown, index: number) => ({
          id: item.id || generateItemId(),
          description: item.description,
          status: 'pending' as const,
          order: index,
          toolName: item.toolName,
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
      const statusMap: Record<string, string> = { pending: 'pending', in_progress: 'running', completed: 'done', skipped: 'done' };
      store.updateStep(plan_id, item_id, { status: statusMap[status] as unknown, result: result || undefined });
      upsertPlanMessage(plan_id);
      return { success: true, message: `步骤 ${item_id} 状态已更新为 ${status}` };
    },
  }),

  'plan:confirm': () => ({
    id: 'plan:confirm',
    category: SkillCategory.PLAN,
    name: 'confirm_plan',
    description: '确认或放弃计划。用户确认后调用此工具标记计划状态。',
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
    description: '验证计划是否完整，检查是否有遗漏的需求点。',
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
      return { success: true, message: `计划验证：共 ${plan.steps.length} 步骤，已完成 ${doneSteps.length}，待完成 ${pendingSteps.length}`, data: { pendingSteps, doneSteps } };
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
    description: '根据执行结果调整计划。',
    parameters: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: '计划 ID' },
        reason: { type: 'string', description: '调整原因' },
        changes: { type: 'string', description: '调整内容描述' },
      },
      required: ['plan_id', 'reason'],
    },
    async execute(args): Promise<ToolExecuteResult> {
      const { plan_id, reason, changes } = args as unknown;
      return { success: true, message: `计划 ${plan_id} 调整：${reason}${changes ? `，调整内容：${changes}` : ''}` };
    },
  }),
};