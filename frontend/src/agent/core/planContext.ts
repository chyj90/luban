import { useAgentStore } from '@/stores/agentStore';
import type { Plan, Step } from '@/types/agent';

export function getUnfinishedPlans(): Plan[] {
  const state = useAgentStore.getState();
  return state.plans.filter(
    (p) => p.status === 'draft' || p.status === 'confirmed' || p.status === 'executing' || p.status === 'stopped',
  );
}

export function formatUnfinishedPlansForPrompt(): string {
  const state = useAgentStore.getState();
  const unfinished = state.plans.filter(
    (p) => p.status === 'draft' || p.status === 'confirmed' || p.status === 'executing' || p.status === 'stopped',
  );
  if (unfinished.length === 0) return '';

  const lines: string[] = [
    '## 未完成的计划',
    '',
    '以下是当前所有未完成的计划，请根据用户消息判断应该继续哪个计划：',
    '',
  ];

  unfinished.forEach((plan) => {
    const isFocused = plan.id === state.focusPlanId;
    const statusLabel = plan.status === 'draft' ? '[待确认]' : plan.status === 'confirmed' ? '[已确认]' : plan.status === 'executing' ? '[执行中]' : '[异常中断]';
    lines.push(
      `### ${isFocused ? '【当前焦点】' : ''}${plan.agentName} [${statusLabel}]: ${plan.steps.map((s) => s.description).join(' → ')}`,
    );
    lines.push('- 步骤:');
    plan.steps.forEach((s) => {
      const statusIcon =
        s.status === 'done' ? '[完成]' : s.status === 'running' ? '[执行中]' : '[待定]';
      lines.push(`  ${s.order + 1}. ${statusIcon} ${s.description}`);
    });
    lines.push('');
  });

  lines.push('## 决策规则', '');
  lines.push('收到用户消息后，你必须判断：');
  lines.push('1. 如果用户消息与某个未完成计划的目标相关 → 继续该计划');
  lines.push(
    '2. 如果用户消息是全新需求，与所有未完成计划都不相关 → 创建新计划',
  );
  lines.push(
    '3. 如果用户消息是简单问答、闲聊、或不需要多步骤执行的指令 → 直接回复，不使用计划',
  );

  return lines.join('\n');
}

export function getFocusPlanId(): string | null {
  return useAgentStore.getState().focusPlanId;
}

export function setFocusPlan(planId: string | null): void {
  useAgentStore.getState().setFocusPlan(planId);
}

export function findPlanByDescription(description: string): Plan | undefined {
  const plans = useAgentStore.getState().plans;
  return plans.find((p) =>
    p.steps.some((s) => s.description.includes(description)),
  );
}

export function getPlanWithSubPlans(planId: string): Plan | undefined {
  const plans = useAgentStore.getState().plans;
  return plans.find((p) => p.id === planId);
}

export function getSubPlans(parentPlanId: string): Plan[] {
  const plans = useAgentStore.getState().plans;
  return plans.filter((p) => p.parentPlanId === parentPlanId);
}

export function getStepWithSubPlan(stepId: string): { step: Step; plan: Plan } | null {
  const plans = useAgentStore.getState().plans;
  for (const plan of plans) {
    const step = plan.steps.find((s) => s.id === stepId);
    if (step?.subPlanId) {
      const subPlan = plans.find((p) => p.id === step.subPlanId);
      if (subPlan) return { step, plan: subPlan };
    }
  }
  return null;
}