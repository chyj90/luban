import type { ToolDefinition, ToolContext } from '@/types/agent';
import { listPages, listDatasources, listQueries } from '@/api';

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
    {
      name: 'list_datasources',
      description: '列出当前工作区中所有数据源。',
      category: 'observation',
      parameters: {
        type: 'object',
        properties: {},
      },
      async execute() {
        try {
          const res = await listDatasources(context.applicationId);
          return {
            success: true,
            message: `共 ${res.data.length} 个数据源`,
            data: res.data,
          };
        } catch (e) {
          return { success: false, message: `获取数据源列表失败: ${(e as Error).message}` };
        }
      },
    },
    {
      name: 'list_queries',
      description: '列出当前应用中所有查询。',
      category: 'observation',
      parameters: {
        type: 'object',
        properties: {},
      },
      async execute() {
        try {
          const res = await listQueries(context.applicationId);
          return {
            success: true,
            message: `共 ${res.data.length} 个查询`,
            data: res.data,
          };
        } catch (e) {
          return { success: false, message: `获取查询列表失败: ${(e as Error).message}` };
        }
      },
    },
  ];
}