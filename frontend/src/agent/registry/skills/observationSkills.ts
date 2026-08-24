import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { listPages } from '@/api';

export const observationSkills: Record<string, SkillFactory> = {
  'observation:list_pages': (_ctx) => ({
    id: 'observation:list_pages',
    category: SkillCategory.OBSERVATION,
    name: 'list_pages',
    description: '列出当前应用中所有页面。',
    parameters: { type: 'object', properties: {} },
    async execute() {
      try {
        const res = await listPages(ctx.applicationId);
        return {
          success: true,
          message: `共 ${res.data.length} 个页面，当前页面 ID 为 ${ctx.pageId}`,
          data: { pages: res.data, currentPageId: ctx.pageId },
        };
      } catch {
        return { success: false, message: `获取页面列表失败: ${(e as Error).message}` };
      }
    },
  }),

  'observation:record': (_ctx) => ({
    id: 'observation:record',
    category: SkillCategory.OBSERVATION,
    name: 'record_observation',
    description: '记录观察结果，用于告知用户当前状态。',
    parameters: {
      type: 'object',
      properties: { message: { type: 'string', description: '观察内容' } },
      required: ['message'],
    },
    async execute(args) {
      return { success: true, message: args.message as string };
    },
  }),
};