/**
 * Skill Registry（技能注册表）
 *
 * 所有工具能力从 Agent 中解耦，注册为独立 Skill。
 * Agent 通过 Skill ID 引用技能，不再硬编码绑定工具实现。
 *
 * 设计原则：
 * - Skill 定义"能做什么"，Agent 定义"谁来做"
 * - 每个 Skill 有唯一 ID，格式为 "category:name"
 * - Skill 支持跨 Agent 复用
 */

import type { ToolDefinition, ToolContext, ToolExecuteResult } from '@/types/agent';
import type { ChatRouter } from '../core/chatRouter';

// ============================================================================
// Types
// ============================================================================

export enum SkillCategory {
  PAGE = 'page',
  CODE = 'code',
  OBSERVATION = 'observation',
  PLAN = 'plan',
  DATASOURCE = 'datasource',
  QUERY = 'query',
  API = 'api',
  WORKFLOW = 'workflow',
  DELEGATE = 'delegate',
}

export interface SkillDefinition {
  id: string;
  category: SkillCategory;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, _ctx: ToolContext) => Promise<ToolExecuteResult>;
  requiresConfirmation?: boolean;
  isDangerous?: boolean;
}

export type SkillFactory = (_ctx: ToolContext, chatRouter?: ChatRouter) => SkillDefinition;

// ============================================================================
// Registry
// ============================================================================

const registry = new Map<string, SkillFactory>();

export function registerSkill(id: string, factory: SkillFactory): void {
  if (registry.has(id)) {
    console.warn(`[SkillRegistry] Skill "${id}" 已注册，将被覆盖`);
  }
  registry.set(id, factory);
}

export function registerSkills(skills: Record<string, SkillFactory>): void {
  Object.entries(skills).forEach(([id, factory]) => registerSkill(id, factory));
}

export function getSkillFactory(id: string): SkillFactory | undefined {
  return registry.get(id);
}

export function getAllSkillIds(): string[] {
  return Array.from(registry.keys());
}

export function getSkillIdsByCategory(category: SkillCategory): string[] {
  return Array.from(registry.entries())
    .filter(([id]) => id.startsWith(`${category}:`))
    .map(([id]) => id);
}

/**
 * 将 Skill ID 列表解析为 ToolDefinition 列表。
 * 这是 Agent 获取工具的主要入口。
 */
export function resolveSkills(
  skillIds: string[],
  ctx: ToolContext,
  chatRouter?: ChatRouter,
): ToolDefinition[] {
  return skillIds
    .map((id) => {
      const factory = registry.get(id);
      if (!factory) {
        console.warn(`[SkillRegistry] Skill "${id}" 未注册，跳过`);
        return null;
      }
      return factory(ctx, chatRouter);
    })
    .filter((s): s is SkillDefinition => s !== null)
    .map((s) => toToolDefinition(s));
}

function toToolDefinition(skill: SkillDefinition): ToolDefinition {
  return {
    name: skill.name,
    description: skill.description,
    category: skill.category as ToolDefinition['category'],
    parameters: skill.parameters,
    execute: skill.execute,
    isDangerous: skill.isDangerous,
    requiresConfirmation: skill.requiresConfirmation,
  };
}

// ============================================================================
// Bootstrap — register all skills on import
// 在模块加载时自动注册所有技能
// ============================================================================

import { registerAllSkills } from './skills';
registerAllSkills();