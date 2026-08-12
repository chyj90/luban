import type { ToolDefinition, ToolContext } from '@/types/agent';
import { createCodePage, deletePage, renamePage } from '@/api';
import { listPages } from '@/api';

export function createPageTools(context: ToolContext): ToolDefinition[] {
  return [
    {
      name: 'create_page',
      description: '创建一个新的代码页面。需要提供页面名称。',
      category: 'page',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '页面名称' },
        },
        required: ['name'],
      },
      isDangerous: false,
      requiresConfirmation: true,
      async execute(args) {
        try {
          const res = await createCodePage({
            applicationId: context.applicationId,
            name: args.name as string,
          });
          context.onPagesChange?.();
          context.onPageChange?.(res.data.id);
          return {
            success: true,
            message: `页面 "${args.name}" 创建成功 (id: ${res.data.id})`,
            data: res.data,
          };
        } catch (e) {
          return { success: false, message: `创建页面失败: ${(e as Error).message}` };
        }
      },
    },
    {
      name: 'delete_page',
      description: '删除一个页面。需要提供页面 ID。注意：此操作不可撤销。',
      category: 'page',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'number', description: '要删除的页面 ID' },
        },
        required: ['pageId'],
      },
      isDangerous: true,
      requiresConfirmation: true,
      async execute(args) {
        try {
          await deletePage(args.pageId as number);
          context.onPagesChange?.();
          return { success: true, message: `页面删除成功` };
        } catch (e) {
          return { success: false, message: `删除页面失败: ${(e as Error).message}` };
        }
      },
    },
    {
      name: 'rename_page',
      description: '重命名一个页面。需要提供页面 ID 和新名称。',
      category: 'page',
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
          context.onPagesChange?.();
          return { success: true, message: `页面已重命名为 "${args.name}"`, data: res.data };
        } catch (e) {
          return { success: false, message: `重命名页面失败: ${(e as Error).message}` };
        }
      },
    },
  ];
}

export function getPageSkillSummary(): string {
  return `## 页面管理
- 创建/删除/重命名页面
- 通过 list_pages 查看所有页面
- 不确定目标页面时主动向用户确认`;
}