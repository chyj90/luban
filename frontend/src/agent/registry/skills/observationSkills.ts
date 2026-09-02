import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { listPages } from '@/api';
import { listQueries as listAllQueries } from '@/api/query';
import { listApplicationTools } from '@/api/tool';

export const observationSkills: Record<string, SkillFactory> = {
  'observation:list_pages': (ctx) => ({
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

  'observation:list_queries': (ctx) => ({
    id: 'observation:list_queries',
    category: SkillCategory.OBSERVATION,
    name: 'list_queries',
    description: '列出当前应用中所有查询，返回查询名称和ID列表。',
    parameters: { type: 'object', properties: {} },
    async execute() {
      try {
        const res = await listAllQueries(ctx.applicationId);
        return {
          success: true,
          message: `共 ${res.data.length} 个查询`,
          data: { queries: (res.data as Array<{ id: number; name: string }>).map((q) => ({ id: q.id, name: q.name })) },
        };
      } catch {
        return { success: false, message: '获取查询列表失败' };
      }
    },
  }),

  'observation:list_apis': (ctx) => ({
    id: 'observation:list_apis',
    category: SkillCategory.OBSERVATION,
    name: 'list_apis',
    description: '列出当前应用中所有已连接的 API 工具，返回 API 名称和ID列表。',
    parameters: { type: 'object', properties: {} },
    async execute() {
      try {
        const res = await listApplicationTools(ctx.applicationId);
        const tools = (res.data as Array<{ id: number; displayName: string; name: string }>) || [];
        return { success: true, message: `共 ${tools.length} 个 API`, data: { apis: tools.map((t) => ({ id: t.id, name: t.displayName || t.name })) } };
      } catch {
        return { success: false, message: '获取 API 列表失败' };
      }
    },
  }),

  'observation:record': (ctx) => ({
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