/**
 * Kernel 策略接口（Phase 2.3）
 *
 * Runtime 只做编排；所有"何时等待用户 / 何时强制继续 / 此阶段允许什么工具"的
 * 业务决策都是可插拔的纯函数策略。策略接收只读的会话状态，返回决策——不解析
 * 自然语言（意图判断永远交给模型），只依据结构化事实（工具结果、计划状态）。
 */
import type { Plan } from '@/types/agent';
import type { ToolDefinition, ToolExecuteResult } from '@/types/agent';
import type { InputRequest, ResumeCommand } from './events';
import type { SessionState } from './session';

/** 策略所需的计划存储窄端口（P2.4 由 zustand store 适配） */
export interface PlanStorePort {
  getPlans(): Plan[];
  confirmPlan(planId: string): void;
  updatePlan(planId: string, updates: Partial<Plan>): void;
}

export interface KernelPolicy {
  /** 策略名（调试/事件溯源标注用） */
  name: string;
  /** LLM 回合开始前过滤本回合可用工具（迁移自旧 stateMachine.filterTools） */
  filterTools?(state: SessionState, tools: ToolDefinition[]): ToolDefinition[];
  /** 工具执行完成后；返回挂起请求则挂起回合（_pause 的通用处理之外的额外挂起源） */
  afterToolResult?(state: SessionState, call: { name: string; result: ToolExecuteResult }): InputRequest | null;
  /**
   * 工具执行成功后的系统级副作用（不挂起回合）：替换 system prompt / 注入 system 消息。
   * 用于聊天文本确认路径——模型自己调用 confirm_plan 时 onResume（按钮路径）不会触发，
   * 需要在此完成执行阶段 system prompt 的切换。
   */
  toolEffect?(state: SessionState, call: { name: string; args: Record<string, unknown>; result: ToolExecuteResult }):
    { replaceSystemPrompt?: string; systemMessage?: string } | null;
  /** 模型未调用工具、回合将完成前；返回注入指令则继续循环（迁移自旧 onShouldComplete） */
  beforeComplete?(state: SessionState, turn: { content: string }): { systemMessage: string } | null;
  /**
   * 挂起被显式命令解除时调用（confirm/cancel/complete）。
   * 返回的 systemMessage 由 Runtime 注入对话后继续循环；计划的确认/放弃等
   * 存储副作用由策略在此完成（策略持有 store）。
   * danger-confirm 的 confirm/cancel 由 Runtime 内置处理（精确重执行），不走此钩子。
   */
  onResume?(state: SessionState, command: ResumeCommand): { systemMessage?: string; replaceSystemPrompt?: string } | null;
}
