import type { ToolDefinition, ToolExecuteResult } from '@/types/agent';
import { useAgentStore } from '@/stores/agentStore';
import { getUnfinishedPlans } from '../core/planContext';

export interface Skill {
  id: string;
  name: string;
  icon: string;
  description: string;
  getTools: () => ToolDefinition[];
  getPromptFragment: () => string;
}

function generatePlanId(): string {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function generateItemId(): string {
  return `pi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function buildPlanSummary(plan: { agentIcon?: string; agentName?: string; steps: Array<{ description: string; status: string; result?: string }>; status: string }): string {
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

function createPlanTools(): ToolDefinition[] {
  return [
    {
      name: 'create_plan',
      description: `创建执行计划。当用户需求明确且需要多步骤执行时调用此工具。
计划创建后会展示给用户确认，用户确认后开始执行。

使用场景：
- 用户需求明确，可以拆解为多个步骤
- 需要创建新页面、修改现有页面等操作
- 需要数据查询和页面创建配合

注意：
- 需求不明确时不要创建计划，直接向用户提问澄清
- 计划必须覆盖用户提到的所有需求点
- 用户补充需求后，重新调用此工具创建完整计划`,
      category: 'plan',
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
                category: {
                  type: 'string',
                  enum: ['code_page', 'page', 'datasource', 'query', 'style', 'observation'],
                  description: '步骤类别',
                },
                description: { type: 'string', description: '步骤描述' },
                toolName: { type: 'string', description: '要调用的工具名称' },
                toolInput: { type: 'object', description: '工具参数（可选，执行时再确定）' },
                dependencies: { type: 'array', items: { type: 'string' }, description: '依赖的步骤ID列表' },
              },
              required: ['id', 'category', 'description'],
            },
          },
        },
        required: ['title', 'summary', 'items'],
      },
      async execute(args): Promise<ToolExecuteResult> {
        const { title, summary, items } = args as {
          title: string;
          summary: string;
          items: Array<{
            id: string;
            category: string;
            description: string;
            toolName?: string;
            toolInput?: Record<string, unknown>;
            dependencies?: string[];
          }>;
        };

        const store = useAgentStore.getState();
        const planId = generatePlanId();

        const plan = {
          id: planId,
          agentId: 'main-agent',
          agentName: '主智能体',
          agentIcon: '',
          steps: items.map((item, index) => ({
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

        return {
          success: true,
          message: `计划「${title}」已创建，共 ${items.length} 个步骤，等待用户确认。`,
          data: { planId, title, summary, items },
          _pause: true,
        };
      },
    },
    {
      name: 'update_plan',
      description: '更新计划。追加、删除或替换步骤。',
      category: 'plan',
      parameters: {
        type: 'object',
        properties: {
          plan_id: { type: 'string', description: '目标计划 ID' },
          action: {
            type: 'string',
            enum: ['append', 'remove', 'replace'],
            description: '操作类型',
          },
          step_index: { type: 'number', description: '步骤索引（从0开始），remove/replace 时必填' },
          new_description: { type: 'string', description: '新步骤描述（append/replace 时必填）' },
          new_tool_name: { type: 'string', description: '新步骤工具名称（append/replace 时可选）' },
        },
        required: ['plan_id', 'action'],
      },
      async execute(args): Promise<ToolExecuteResult> {
        const typedArgs = args as {
          plan_id: string;
          action: string;
          step_index?: number;
          new_description?: string;
          new_tool_name?: string;
        };

        const store = useAgentStore.getState();
        const plan = store.plans.find((p) => p.id === typedArgs.plan_id);
        if (!plan) {
          return { success: false, message: `未找到计划 ${typedArgs.plan_id}` };
        }

        switch (typedArgs.action) {
          case 'append': {
            if (!typedArgs.new_description) {
              return { success: false, message: 'append 操作需要 new_description' };
            }
            const newStep = {
              id: `step_${Date.now()}`,
              description: typedArgs.new_description,
              status: 'pending' as const,
              order: plan.steps.length,
              toolName: typedArgs.new_tool_name,
            };
            store.updatePlan(typedArgs.plan_id, { steps: [...plan.steps, newStep] });
            upsertPlanMessage(typedArgs.plan_id);
            return { success: true, message: `已追加步骤：${typedArgs.new_description}` };
          }
          case 'remove': {
            if (typedArgs.step_index === undefined) {
              return { success: false, message: 'remove 操作需要 step_index' };
            }
            const filtered = plan.steps
              .filter((_, i) => i !== typedArgs.step_index)
              .map((s, i) => ({ ...s, order: i }));
            store.updatePlan(typedArgs.plan_id, { steps: filtered });
            upsertPlanMessage(typedArgs.plan_id);
            return { success: true, message: `已删除步骤 ${typedArgs.step_index}` };
          }
          case 'replace': {
            if (typedArgs.step_index === undefined || !typedArgs.new_description) {
              return { success: false, message: 'replace 操作需要 step_index 和 new_description' };
            }
            const updated = plan.steps.map((s, i) =>
              i === typedArgs.step_index
                ? { ...s, description: typedArgs.new_description!, toolName: typedArgs.new_tool_name }
                : s,
            );
            store.updatePlan(typedArgs.plan_id, { steps: updated });
            upsertPlanMessage(typedArgs.plan_id);
            return { success: true, message: `已替换步骤 ${typedArgs.step_index} 为：${typedArgs.new_description}` };
          }
          default:
            return { success: false, message: `未知操作：${typedArgs.action}` };
        }
      },
    },
    {
      name: 'update_plan_item',
      description: '更新计划中某个步骤的状态。每完成一个步骤后必须调用此工具标记状态。',
      category: 'plan',
      parameters: {
        type: 'object',
        properties: {
          plan_id: { type: 'string', description: '计划 ID' },
          item_id: { type: 'string', description: '步骤 ID' },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed', 'skipped'],
            description: '新状态',
          },
          result: { type: 'string', description: '执行结果摘要' },
        },
        required: ['plan_id', 'item_id', 'status'],
      },
      async execute(args): Promise<ToolExecuteResult> {
        const { plan_id, item_id, status, result } = args as {
          plan_id: string;
          item_id: string;
          status: string;
          result?: string;
        };

        const store = useAgentStore.getState();
        const plan = store.plans.find((p) => p.id === plan_id);
        if (!plan) {
          return { success: false, message: `未找到计划 ${plan_id}` };
        }

        const statusMap: Record<string, string> = {
          pending: 'pending',
          in_progress: 'running',
          completed: 'done',
          skipped: 'done',
        };

        store.updateStep(plan_id, item_id, {
          status: statusMap[status] as any,
          result: result || undefined,
        });

        upsertPlanMessage(plan_id);

        return { success: true, message: `步骤 ${item_id} 状态已更新为 ${status}` };
      },
    },
    {
      name: 'confirm_plan',
      description: '确认或放弃计划。用户确认后调用此工具标记计划状态。',
      category: 'plan',
      parameters: {
        type: 'object',
        properties: {
          plan_id: { type: 'string', description: '计划 ID' },
          action: {
            type: 'string',
            enum: ['confirm', 'abandon'],
            description: 'confirm=确认计划开始执行，abandon=放弃计划',
          },
        },
        required: ['plan_id', 'action'],
      },
      async execute(args): Promise<ToolExecuteResult> {
        const { plan_id, action } = args as { plan_id: string; action: string };
        const store = useAgentStore.getState();

        if (action === 'confirm') {
          store.updatePlan(plan_id, { status: 'confirmed' });
          upsertPlanMessage(plan_id);
          return { success: true, message: '计划已确认，开始执行' };
        }
        store.updatePlan(plan_id, { status: 'rejected' });
        upsertPlanMessage(plan_id);
        return { success: true, message: '计划已放弃' };
      },
    },
    {
      name: 'validate_plan',
      description: '检查计划是否全部完成。所有步骤执行完毕后调用。',
      category: 'plan',
      parameters: {
        type: 'object',
        properties: {
          plan_id: { type: 'string', description: '计划 ID' },
        },
        required: ['plan_id'],
      },
      async execute(args): Promise<ToolExecuteResult> {
        const { plan_id } = args as { plan_id: string };
        const store = useAgentStore.getState();
        const plan = store.plans.find((p) => p.id === plan_id);
        if (!plan) {
          return { success: false, message: `未找到计划 ${plan_id}` };
        }

        const allDone = plan.steps.every((s) => s.status === 'done');
        if (allDone) {
          store.updatePlan(plan_id, { status: 'completed' });
          upsertPlanMessage(plan_id);
          return { success: true, message: '计划已全部完成', data: { status: 'completed' } };
        }
        return {
          success: true,
          message: '计划尚未完成',
          data: {
            status: 'executing',
            pending: plan.steps.filter((s) => s.status !== 'done').map((s) => s.description),
          },
        };
      },
    },
    {
      name: 'list_unfinished_plans',
      description: '列出所有未完成的计划（draft、confirmed 或 executing 状态），每个计划包含所属 Agent、步骤和进度。',
      category: 'plan',
      parameters: {
        type: 'object',
        properties: {},
      },
      async execute(): Promise<ToolExecuteResult> {
        const plans = getUnfinishedPlans();
        if (plans.length === 0) {
          return { success: true, message: '当前没有未完成的计划' };
        }

        const summary = plans
          .map((p) => {
            const doneCount = p.steps.filter((s) => s.status === 'done').length;
            const statusLabel = p.status === 'draft' ? '待确认' : p.status === 'confirmed' ? '已确认' : '执行中';
            return `- ${p.agentIcon} ${p.agentName} [${statusLabel}]：「${p.steps.map((s) => s.description).join(' → ')}」（${doneCount}/${p.steps.length} 已完成）`;
          })
          .join('\n');

        return { success: true, message: `未完成的计划共 ${plans.length} 个：\n${summary}`, data: plans };
      },
    },
    {
      name: 'set_focus_plan',
      description: '切换当前关注的计划。用户说"先不管这个"、"先做XXX"、"切到XXX"时调用。',
      category: 'plan',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['focus', 'unfocus'],
            description: 'focus=切换到指定计划，unfocus=取消焦点',
          },
          plan_id: { type: 'string', description: '目标计划 ID（从 list_unfinished_plans 获取）' },
        },
        required: ['action'],
      },
      async execute(args): Promise<ToolExecuteResult> {
        const typedArgs = args as { action: string; plan_id?: string };
        if (typedArgs.action === 'focus' && typedArgs.plan_id) {
          useAgentStore.getState().setFocusPlan(typedArgs.plan_id);
          return { success: true, message: `已切换到计划 ${typedArgs.plan_id}` };
        }
        useAgentStore.getState().setFocusPlan(null);
        return { success: true, message: '已取消焦点计划' };
      },
    },
    {
      name: 'adjust_plan',
      description: '调整计划的步骤。用户澄清需求、变更需求、补充细节时调用。可以追加或删除步骤。',
      category: 'plan',
      parameters: {
        type: 'object',
        properties: {
          plan_id: { type: 'string', description: '目标计划 ID' },
          action: {
            type: 'string',
            enum: ['append', 'remove', 'replace'],
            description: '操作类型',
          },
          step_index: { type: 'number', description: '步骤索引（从0开始），remove/replace 时必填' },
          new_description: { type: 'string', description: '新步骤描述（append/replace 时必填）' },
        },
        required: ['plan_id', 'action'],
      },
      async execute(args): Promise<ToolExecuteResult> {
        const typedArgs = args as {
          plan_id: string;
          action: string;
          step_index?: number;
          new_description?: string;
        };
        const store = useAgentStore.getState();
        const plan = store.plans.find((p) => p.id === typedArgs.plan_id);
        if (!plan) {
          return { success: false, message: `未找到计划 ${typedArgs.plan_id}` };
        }

        switch (typedArgs.action) {
          case 'append': {
            if (!typedArgs.new_description) {
              return { success: false, message: 'append 操作需要 new_description' };
            }
            const newStep = {
              id: `step_${Date.now()}`,
              description: typedArgs.new_description,
              status: 'pending' as const,
              order: plan.steps.length,
            };
            store.updatePlan(typedArgs.plan_id, { steps: [...plan.steps, newStep] });
            upsertPlanMessage(typedArgs.plan_id);
            return { success: true, message: `已追加步骤：${typedArgs.new_description}` };
          }
          case 'remove': {
            if (typedArgs.step_index === undefined) {
              return { success: false, message: 'remove 操作需要 step_index' };
            }
            const filtered = plan.steps
              .filter((_, i) => i !== typedArgs.step_index)
              .map((s, i) => ({ ...s, order: i }));
            store.updatePlan(typedArgs.plan_id, { steps: filtered });
            upsertPlanMessage(typedArgs.plan_id);
            return { success: true, message: `已删除步骤 ${typedArgs.step_index}` };
          }
          case 'replace': {
            if (typedArgs.step_index === undefined || !typedArgs.new_description) {
              return { success: false, message: 'replace 操作需要 step_index 和 new_description' };
            }
            const updated = plan.steps.map((s, i) =>
              i === typedArgs.step_index
                ? { ...s, description: typedArgs.new_description! }
                : s,
            );
            store.updatePlan(typedArgs.plan_id, { steps: updated });
            upsertPlanMessage(typedArgs.plan_id);
            return { success: true, message: `已替换步骤 ${typedArgs.step_index} 为：${typedArgs.new_description}` };
          }
          default:
            return { success: false, message: `未知操作：${typedArgs.action}` };
        }
      },
    },
  ];
}

export function getPlanPromptFragment(): string {
  return `## 计划管理能力

你可以使用以下计划管理工具来组织复杂任务：

### 何时使用计划
- 用户需求明确，需要多个步骤才能完成
- 涉及创建页面、修改代码、配置数据源等多个操作
- 用户明确说"开始执行"、"确认"、"没问题"等确认信号

### 何时不用计划
- 需求不明确，需要先向用户提问澄清
- 简单问答、闲聊、单个操作
- 用户只是询问信息，不需要执行操作

### 计划工作流
1. **需求澄清** → 需求不明确时直接提问，不创建计划
2. **创建计划** → 调用 create_plan，覆盖用户所有需求点
3. **用户确认** → 计划展示给用户，等待确认
4. **执行步骤** → 按顺序调用工具，每步用 update_plan_item 标记状态
5. **完成验证** → 调用 validate_plan 检查是否全部完成

### 计划灵活性
- 执行中用户补充需求 → 调用 adjust_plan 追加步骤
- 用户说"先做别的" → 调用 list_unfinished_plans 查看，set_focus_plan 切换
- 步骤失败 → 自动标记为 error，继续执行后续步骤`;
}

export const planSkill: Skill = {
  id: 'plan',
  name: '计划管理',
  icon: '',
  description: '提供计划创建、更新、确认和状态跟踪能力，支持多步骤任务编排',
  enabled: true,
  getTools: createPlanTools,
  getPromptFragment: getPlanPromptFragment,
};