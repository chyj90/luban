/**
 * 计划策略（Phase 2.3，迁移自旧 agentStateMachine + planCompletionChecker）
 *
 * 语义对照：
 * - 旧 SM 的 AWAITING_CONFIRM（submit_analysis 后等用户确认计划）
 *   → afterToolResult 返回 plan-confirm 挂起请求；
 * - 旧 SM 的 TOOLS_BLOCKED_WHILE_AWAITING_CONFIRM
 *   → filterTools 在 plan-confirm 挂起期间屏蔽相应工具；
 * - 旧 planCompletionChecker.checkShouldContinue（计划有未完成步骤时拦截退出）
 *   → beforeComplete 注入强制继续指令；
 * - 旧 SM 的正则意图识别（CONFIRM_PATTERNS/DONE_PATTERNS）**不再迁移**：
 *   挂起中的用户自由文本由模型结合 system 转述自行判断（Runtime 通用逻辑）。
 */
import type { InputRequest } from './events';
import type { KernelPolicy, PlanStorePort } from './policy';

/** plan-confirm 挂起期间禁止调用的工具（迁移自 TOOLS_BLOCKED_WHILE_AWAITING_CONFIRM）
 *  ⚠️ submit_analysis 不在屏蔽列表：挂起期间用户修改需求时，模型必须能重新提交分析
 *  生成新计划并重新等待确认——屏蔽它会导致需求变更后只能退化成聊天文字确认 */
const BLOCKED_WHILE_PLAN_CONFIRM = new Set(['validate_plan', 'report_user_action_done']);

/** 触发计划确认挂起的工具（提交分析/创建计划成功即视为"计划待确认"） */
const PLAN_SUBMITTING_TOOLS = new Set(['submit_analysis', 'create_plan']);

/** 未完成步骤强制继续的最大注入次数（迁移自 MAX_LOOP_EXTENSIONS） */
export const MAX_COMPLETION_EXTENSIONS = 5;

export function createPlanPolicy(store: PlanStorePort, options?: {
  /** 确认计划后构建执行阶段 system prompt（迁移自旧 AgentFactory 的 buildExecutionPrompt 切换） */
  buildExecutionPrompt?: (planId: string) => string;
}): KernelPolicy {
  let completionExtensions = 0;

  return {
    name: 'plan',

    filterTools(state, tools) {
      if (state.pendingInput?.kind !== 'plan-confirm') return tools;
      return tools.filter((t) => !BLOCKED_WHILE_PLAN_CONFIRM.has(t.name));
    },

    afterToolResult(_state, call): InputRequest | null {
      if (!PLAN_SUBMITTING_TOOLS.has(call.name) || !call.result.success) return null;
      // 取最新的 draft：挂起期间用户修改需求会再次 submit_analysis，旧 draft 计划
      // 不会被自动作废，find 第一个可能选中过期的那个
      const drafts = store.getPlans().filter((p) => p.status === 'draft');
      const draft = drafts.length > 0 ? drafts[drafts.length - 1] : null;
      if (!draft) return null;
      return {
        kind: 'plan-confirm',
        planId: draft.id,
        message: `计划「${draft.agentName}」已创建（ID: ${draft.id}，共 ${draft.steps.length} 个步骤），等待用户确认执行。`,
      };
    },

    onResume(state, command) {
      if (state.pendingInput?.kind !== 'plan-confirm') return null;
      const planId = state.pendingInput.planId;
      if (command.kind === 'confirm') {
        store.confirmPlan(planId);
        return {
          systemMessage: '计划已确认，已切换到执行阶段。请按步骤顺序执行，每完成一步调用 update_plan_item 标记状态，所有步骤完成后调用 validate_plan 验证。',
          replaceSystemPrompt: options?.buildExecutionPrompt?.(planId),
        };
      }
      if (command.kind === 'cancel') {
        store.updatePlan(planId, { status: 'rejected' });
        return { systemMessage: '用户已放弃该计划。请与用户确认下一步。' };
      }
      return null;
    },

    beforeComplete(_state, turn) {
      // 拦截退出：有进行中计划且步骤未完成 → 注入强制继续
      const activePlans = store.getPlans().filter(
        (p) => p.status === 'confirmed' || p.status === 'executing' || p.status === 'stopped',
      );
      for (const plan of activePlans) {
        const pending = plan.steps.filter((s) => s.status === 'pending');
        const running = plan.steps.filter((s) => s.status === 'running');
        if (pending.length === 0 && running.length === 0) continue;

        if (completionExtensions >= MAX_COMPLETION_EXTENSIONS) {
          return null; // 达到上限，放行完成（旧语义：强制结束）
        }
        completionExtensions++;
        const lines = [...running, ...pending]
          .map((s) => `  - [${s.status === 'running' ? '执行中' : '待完成'}] ${s.description}`)
          .join('\n');
        return {
          systemMessage: `[系统提醒] 计划「${plan.agentName}」还有未完成的步骤：\n\n${lines}\n\n请继续执行这些未完成的步骤，每完成一步调用 update_plan_item 标记（completed 需通过系统核验，result 中应包含真实资源 ID）。若某步骤确实无法完成，请如实说明原因并将该步骤标记为 error 后继续其余步骤——禁止将未实际完成的步骤标记为 completed。`,
        };
      }
      completionExtensions = 0;

      // 兜底：模型输出了完整分析报告但未调用 submit_analysis（迁移自 planCompletionChecker
      // 的 markdown 章节嗅探。这是对 prompt 协议不可靠的补偿，prompt 重构后应删除）
      if (
        store.getPlans().length === 0 &&
        _state.pendingInput === null &&
        turn.content
      ) {
        const hasReportTitle = /#+\s*需求分析报告/.test(turn.content);
        const chapterMatches = turn.content.match(/##\s*\d+\./g) || [];
        const chapterCount = new Set(chapterMatches.map((m) => m.trim())).size;
        if (hasReportTitle && chapterCount >= 4) {
          return {
            systemMessage: '【系统强制指令】你已输出需求分析报告但未调用 submit_analysis。你必须且只能执行以下操作：立即调用 submit_analysis 工具提交结构化分析数据。不要输出任何文本，只输出工具调用。这是强制要求，不可忽略。',
          };
        }
      }
      return null;
    },
  };
}
