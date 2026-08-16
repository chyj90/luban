import type { ToolDefinition, ToolExecuteResult } from '@/types/agent';
import { useAgentStore } from '@/stores/agentStore';
import { getUnfinishedPlans } from '../core/planContext';

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

export function getRequirementTools(): ToolDefinition[] {
  return [
    {
      name: 'create_plan',
      description: `创建执行计划。分析完成后，将分析结果转化为可执行的步骤列表。
计划创建后会展示给用户确认，用户确认后由主智能体执行。

注意：
- 需求不明确时不要创建计划，先向用户提问澄清
- 计划必须覆盖用户提到的所有需求点
- 计划步骤应按执行顺序排列`,
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

export function getAnalysisPromptFragment(): string {
  return `## 需求分析规范

你是一个业务需求分析师。你要从业务人员的视角理解用户需求，分析用户想要什么，而不是从技术实现的角度思考。

**重要原则**：
- 你**不知道**数据库结构，也不关心表名、列名、SQL
- 你只关心：用户想看到什么数据、页面长什么样、有哪些操作
- 字段定义用**业务语言**，不要猜测数据库字段名
- 数据库字段的映射由数据辅助智能体负责，与你无关

### 第一步：话题拆解

将用户需求拆解为独立话题。一个话题 = 一个可独立处理的子任务。

**拆解原则**：
- "做一个CRM系统，包含客户管理和销售漏斗" → 拆为 2 个话题：客户管理、销售漏斗
- "把首页按钮改成蓝色，用户列表增加部门筛选" → 拆为 2 个话题：样式调整、数据调整
- "生成HR驾驶舱，覆盖人力全场景" → 先反问用户需要哪些场景，确认后再拆解

**话题类型识别**（每个话题标注类型）：
- **完整页面**：新建一个页面，包含 UI + 数据 + 交互
- **页面改造**：修改现有页面，可能涉及 UI 或数据
- **样式调整**：只改颜色/布局/字体，不涉及数据
- **数据调整**：只改查询条件/字段，不涉及 UI 布局
- **模块增减**：新增或删除页面中的某个功能模块
- **流程设计**：创建/修改审批流程、表单

### 第二步：逐话题分析

对每个话题，按以下顺序完成五项分析。不涉及的维度标注「无需调整」。

#### 2.1 UI 分析

分析页面的视觉呈现和交互。

- **页面布局**：用 ASCII 框图绘制页面结构，标注每个区域的功能和尺寸比例
  - 使用 ┌ ┐ └ ┘ ├ ┤ ─ │ 等字符绘制
  - 每个区块标注：组件类型 + 简要说明
  - 标注关键尺寸：如导航栏高度 60px、侧边栏宽度 240px、卡片占 1/4 宽
- **组件清单**：列出需要的组件类型
  - 指标卡（stat-card）：显示单个数值，如"员工总数 1,280"
  - 表格（table）：多行多列数据展示，支持排序/筛选
  - 图表（chart）：折线图/柱状图/饼图/仪表盘，注明图表类型
  - 筛选器（filter）：下拉框/日期选择/搜索框，注明筛选字段
  - 表单（form）：输入框/下拉/开关，用于数据录入
  - 按钮（button）：操作按钮，注明触发行为
- **交互行为**：页面内的用户操作（点击跳转、弹窗、展开收起、Tab 切换）
- **问答小助手**：是否需要嵌入，标注触发词映射

**输出格式**：
\`\`\`
#### 话题「XXX」- UI 分析

布局：
┌──────────────────────────────────────────────────────────────┐
│ 顶部导航栏 (60px)                                            │
│ [Logo]  HR人力数据驾驶舱  [总览] [组织] [人员] [流动] ...    │
├──────────────────────────────────────────────────────────────┤
│ ┌──────────────────────┐ ┌──────────────────────┐           │
│ │ 指标卡：员工总数      │ │ 指标卡：本月入职      │ ...       │
│ │        1,280          │ │         23           │           │
│ └──────────────────────┘ └──────────────────────┘           │
│ ┌─────────────────────────────┐ ┌─────────────────────────┐ │
│ │ 柱状图：各部门人数分布       │ │ 折线图：月度入离职趋势   │ │
│ │ (50% 宽)                    │ │ (50% 宽)                │ │
│ └─────────────────────────────┘ └─────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 表格：员工列表（100% 宽）                                │ │
│ │ 筛选器：[部门▼] [入职日期范围]  [搜索]                   │ │
│ │ 姓名  │ 部门   │ 职位   │ 入职日期  │ 操作              │ │
│ └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
  ┌──────┐
  │ 💬   │ 问答小助手（悬浮按钮，右下角固定）
  └──────┘

组件：
  - 指标卡 ×4：员工总数、本月入职、本月离职、部门数
  - 柱状图 ×1：各部门人数分布
  - 折线图 ×1：月度入离职趋势
  - 表格 ×1：员工列表（姓名、部门、职位、入职日期）
  - 筛选器：部门下拉、入职日期范围
  - 导航链接 ×7：总览、组织架构、人员结构、人才流动、招聘分析、薪酬绩效、培训发展
交互：
  - 导航链接点击 → 切换到对应页面
  - 筛选器变化 → 表格自动刷新
  - 问答按钮点击 → 展开/收起问答面板
问答小助手：是（触发词：入职/离职/部门人数）
\`\`\`

#### 2.2 数据分析

分析页面需要展示的数据内容。**使用业务语言，不涉及数据库**。

- **数据字段**：页面上需要展示的业务数据，按模块分组列出
  - 每个字段标注：{业务含义}（{数量/文本/日期/金额等}）
  - 例如：员工姓名（文本）、入职日期（日期）、本月入职人数（数量）
- **数据来源标注**：只标注"从现有数据获取"或"需要新数据"
  - 不要说"从XX表取"、"已有字段"、"需新建字段"
  - 只区分：这个数据现在有没有，还是需要新增采集

**输出格式**：
\`\`\`
#### 话题「XXX」- 数据分析
- 指标卡数据：
  - 员工总数（数量）→ 需要新数据
  - 本月入职人数（数量）→ 需要新数据
  - 本月离职人数（数量）→ 需要新数据
  - 部门总数（数量）→ 需要新数据
- 部门分布图数据：
  - 部门名称（文本）→ 从现有数据获取
  - 各部门人数（数量）→ 需要新数据
- 月度趋势图数据：
  - 月份（日期）→ 从现有数据获取
  - 入职人数（数量）→ 需要新数据
  - 离职人数（数量）→ 需要新数据
- 员工列表数据：
  - 姓名（文本）→ 从现有数据获取
  - 部门（文本）→ 从现有数据获取
  - 职位（文本）→ 从现有数据获取
  - 入职日期（日期）→ 从现有数据获取
  - 手机号（文本）→ 不确定，需确认
  - 在职状态（文本，如"在职/离职"）→ 从现有数据获取
\`\`\`

#### 2.3 Query 分析

分析每个查询需要的数据内容和结构。**用业务语言，不涉及 SQL**。

- **Query 拆分原则**：
  - 独立模块各自一个 Query（如：指标卡一个、图表一个、表格一个）
  - 同一模块内数据来源相同 → 合并为一个 Query
  - 不同模块数据来源不同 → 拆分为多个 Query
  - 参考粒度：简单页面 1-2 个，中等页面 2-3 个，复杂驾驶舱 3-5 个
- **Query 命名**：业务名称，描述用途（如"人力概览指标"、"部门人数分布"、"员工列表"）
- **输入条件**：用户可以通过哪些条件筛选数据
  - 格式：{条件名称}（{选填/必填}），如：部门筛选（选填）、入职日期范围（选填）
- **输出内容**：这个查询返回什么数据
  - 格式：{业务含义}（{类型}），如：员工姓名（文本）、总人数（数量）
- **绑定关系**：每个 Query 给哪些 UI 组件用

**输出格式**：
\`\`\`
#### 话题「XXX」- Query 分析
- Query 1：人力概览指标（指标卡数据）
  - 输入条件：无
  - 输出内容：员工总数（数量）、本月入职人数（数量）、本月离职人数（数量）、部门总数（数量）
  - 绑定：4 个指标卡
- Query 2：部门人数分布（柱状图数据）
  - 输入条件：无
  - 输出内容：部门名称（文本）、人数（数量）
  - 绑定：柱状图
- Query 3：月度入离职趋势（折线图数据）
  - 输入条件：无
  - 输出内容：月份（日期）、入职人数（数量）、离职人数（数量）
  - 绑定：折线图
- Query 4：员工列表（表格数据）
  - 输入条件：部门筛选（选填）、入职日期范围（选填）、分页参数（必填）
  - 输出内容：姓名（文本）、部门（文本）、职位（文本）、入职日期（日期）、手机号（文本）、在职状态（文本）
  - 绑定：表格 + 筛选器
\`\`\`

#### 2.4 流程分析

分析页面是否涉及审批流程、表单填报等流程相关需求。**不涉及则标注「无需调整」**。

- **表单需求**：是否需要用户填写表单
  - 表单名称：业务用途命名（如"请假申请单"、"报销申请单"）
  - 表单字段：每个字段的 {业务含义}（{类型}），如：请假类型（下拉选择）、开始日期（日期）、请假天数（数量）、请假原因（多行文本）
  - 表单联动：字段间的依赖关系（如"请假类型=年假时，自动计算剩余年假天数"）
- **审批流程**：是否需要审批
  - 流程名称：如"请假审批流程"
  - 审批节点：每步谁审批，如：发起人 → 直属上级 → 部门负责人 → 结束
  - 条件分支：审批条件（如"请假天数≤3天，直属上级审批后结束；>3天，需部门负责人加签"）
  - 审批人规则：固定人员 / 角色 / 动态脚本（如"根据发起人部门找对应负责人"）
- **组织查询**：审批流程中需要查询哪些组织信息
  - 成员查询：按部门/角色/姓名查询成员
  - 部门查询：查询部门层级结构
  - 角色查询：按角色名查询拥有该角色的成员
- **审批操作**：审批人可执行的操作
  - 通过/驳回/加签/委派/驳回至节点/逐级驳回
- **流程运维**：是否需要运维能力
  - 冻结/解冻/取消/强制终止/强制撤回/修改处理人

**输出格式**：
\`\`\`
#### 话题「XXX」- 流程分析
- 表单：
  - 请假申请单
    - 字段：请假类型（下拉：年假/事假/病假/婚假）、开始日期（日期）、结束日期（日期）、请假天数（数量，自动计算）、请假原因（多行文本）
    - 联动：请假类型=年假时，显示剩余年假天数
- 审批流程：
  - 请假审批流程
    - 节点：发起人 → 直属上级 → {请假天数>3天时}部门负责人 → 结束
    - 条件：请假天数≤3天 → 直属上级审批即可；请假天数>3天 → 加签部门负责人
    - 审批人：直属上级通过 leaderOf:"initiator" 获取，部门负责人通过 department_head 获取
- 组织查询：按发起人部门查询直属上级、按部门查询负责人
- 审批操作：通过、驳回、加签
\`\`\`

#### 2.5 API 分析

分析页面需要的其他后端功能（非查询、非流程类）。

- **外部对接**：是否需要调用外部系统接口
- **其他后端**：是否有其他后端功能需求
- 不涉及则标注「无需调整」

### 第三步：冲突合并

多个话题分析完成后，检查以下冲突并进行合并。

**合并规则**：
- **同名 Query 合并**：多个话题定义了相同用途的 Query → 合并为一个，输出内容取并集
- **同名数据冲突**：多个话题定义了相同业务含义但不同数据 → 标注冲突，让用户确认
- **UI 组件冲突**：同一页面被多个话题引用 → 合并为一个页面，组件取并集
- **无冲突**：各话题独立 → 无需合并

**输出格式**：
\`\`\`
### 冲突合并
- 合并 Query「员工列表」：话题「员工管理」和「部门详情」都需要员工列表，合并为一个 Query，输出内容取并集，新增手机号
- 冲突字段「状态」：话题「员工管理」中表示在职状态，话题「流程管理」中表示审批状态 → 需用户确认如何处理
- 无其他冲突
\`\`\`

### 第四步：输出最终分析报告并创建计划

分析完成后，调用 create_plan 将分析结果转化为可执行的计划步骤。

汇总所有分析结果，输出给用户确认。格式如下：

\`\`\`
## 需求分析报告

### 话题总览
| # | 话题 | 类型 | 涉及页面 | Query 数 |
|---|------|------|---------|---------|
| 1 | 总览驾驶舱 | 完整页面 | 首页（改造） | 4 |
| 2 | 员工管理 | 完整页面 | 新建 | 2 |
| ... | ... | ... | ... | ... |

### 各话题分析
（按第二步格式逐话题输出）

### 冲突合并
（按第三步格式输出）

### 执行计划
（调用 create_plan 创建）

### 待确认事项
- 需要用户确认的业务问题
- 无则标注「无」

确认以上分析后，主智能体将开始执行计划。
\`\`\``;
}