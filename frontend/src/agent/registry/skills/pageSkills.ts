import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { createCodePage, deletePage, renamePage } from '@/api';

export const pageSkills: Record<string, SkillFactory> = {
  'page:create': (_ctx) => ({
    id: 'page:create',
    category: SkillCategory.PAGE,
    name: 'create_page',
    description: '创建一个新的代码页面。需要提供页面名称。',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: '页面名称' } },
      required: ['name'],
    },
    requiresConfirmation: true,
    async execute(args) {
      try {
        const res = await createCodePage({ applicationId: ctx.applicationId, name: args.name as string });
        ctx.onPagesChange?.();
        ctx.onPageChange?.(res.data.id);
        return { success: true, message: `页面 "${args.name}" 创建成功 (id: ${res.data.id})`, data: res.data };
      } catch {
        return { success: false, message: `创建页面失败: ${(e as Error).message}` };
      }
    },
  }),

  'page:delete': (_ctx) => ({
    id: 'page:delete',
    category: SkillCategory.PAGE,
    name: 'delete_page',
    description: '删除一个页面。需要提供页面 ID。注意：此操作不可撤销。',
    parameters: {
      type: 'object',
      properties: { pageId: { type: 'number', description: '要删除的页面 ID' } },
      required: ['pageId'],
    },
    isDangerous: true,
    requiresConfirmation: true,
    async execute(args) {
      try {
        await deletePage(args.pageId as number);
        ctx.onPagesChange?.();
        return { success: true, message: '页面删除成功' };
      } catch {
        return { success: false, message: `删除页面失败: ${(e as Error).message}` };
      }
    },
  }),

  'page:rename': (_ctx) => ({
    id: 'page:rename',
    category: SkillCategory.PAGE,
    name: 'rename_page',
    description: '重命名一个页面。需要提供页面 ID 和新名称。',
    parameters: {
      type: 'object',
      properties: {
        pageId: { type: 'number', description: '页面 ID' },
        name: { type: 'string', description: '新名称' },
      },
      required: ['pageId', 'name'],
    },
    async execute(args) {
      try {
        const res = await renamePage(args.pageId as number, args.name as string);
        ctx.onPagesChange?.();
        return { success: true, message: `页面已重命名为 "${args.name}"`, data: res.data };
      } catch {
        return { success: false, message: `重命名页面失败: ${(e as Error).message}` };
      }
    },
  }),
};