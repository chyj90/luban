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
    ...workflowSkills,
    ...delegateSkills,
  };

  Object.entries(allSkills).forEach(([id, factory]) => {
    registerSkill(id, factory);
  });

  console.log(`[SkillRegistry] 已注册 ${Object.keys(allSkills).length} 个技能`);
}