import type { ToolDefinition, ToolContext } from '@/types/agent';
import { listPages } from '@/api';

export function createObservationTools(context: ToolContext): ToolDefinition[] {
  return [
    {
      name: 'list_pages',
      description: '列出当前应用中所有页面。',
      category: 'observation',
      parameters: {
        type: 'object',
        properties: {},
      },
      async execute() {
        try {
          const res = await listPages(context.applicationId);
          return {
            success: true,
            message: `共 ${res.data.length} 个页面，当前页面 ID 为 ${context.pageId}`,
            data: {
              pages: res.data,
              currentPageId: context.pageId,
            },
          };
        } catch (e) {
          return { success: false, message: `获取页面列表失败: ${(e as Error).message}` };
        }
      },
    },
  ];
}