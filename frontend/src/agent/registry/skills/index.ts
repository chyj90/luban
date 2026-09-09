/**
 * Skills Index
 * 统一注册所有技能到 Skill Registry
 */

import { registerSkill, type SkillFactory } from '../skillRegistry';
import { pageSkills } from './pageSkills';
import { codeSkills } from './codeSkills';
import { observationSkills } from './observationSkills';
import { planSkills } from './planSkills';
import { datasourceSkills } from './datasourceSkills';
import { querySkills } from './querySkills';
import { apiSkills } from './apiSkills';
import { workflowSkills } from './workflowSkills';
import { delegateSkills } from './delegateSkills';

export function registerAllSkills(): void {
  const allSkills: Record<string, SkillFactory> = {
    ...pageSkills,
    ...codeSkills,
    ...observationSkills,
    ...planSkills,
    ...datasourceSkills,
    ...querySkills,
    ...apiSkills,
    ...workflowSkills,
    ...delegateSkills,
  };

  Object.entries(allSkills).forEach(([id, factory]) => {
    registerSkill(id, factory);
  });

  console.log(`[SkillRegistry] 已注册 ${Object.keys(allSkills).length} 个技能`);

  // dev 启动时异步执行提示词-工具一致性自检（动态 import 避免模块加载期循环依赖）
  const isDev = typeof import.meta.env !== 'undefined' && import.meta.env.DEV;
  if (isDev) {
    queueMicrotask(() => {
      import('../agentSelfCheck')
        .then((m) => m.runDevSelfCheck())
        .catch((e) => console.warn('[SkillRegistry] 自检加载失败:', e));
    });
  }
}