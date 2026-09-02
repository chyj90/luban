import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { listApplicationTools, createAppTool, deleteAppTool, runAppTool } from '@/api/tool';

export const apiSkills: Record<string, SkillFactory> = {
  'api:list': (ctx) => ({
    id: 'api:list',
    category: SkillCategory.API,
    name: 'list_apis',
    description: '列出当前应用中所有已连接的 API 工具。',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const res = await listApplicationTools(ctx.applicationId);
      const tools = (res.data as unknown[]) || [];
      return { success: true, message: `共 ${tools.length} 个 API`, data: tools };
    },
  }),

  'api:connect': (ctx) => ({
    id: 'api:connect',
    category: SkillCategory.API,
    name: 'connect_api',
    description: `连接一个新的外部 API。API 连接后可用于页面中调用。

## 参数说明
- name: API 名称
- method: HTTP 方法（GET/POST/PUT/DELETE/PATCH）
- url: 请求地址（如 https://api.example.com/users）
- description: 描述（可选）
- headers: 请求头列表（可选），每项包含 key/value
- queryParams: Query 参数列表（可选），每项包含 key/value
- body: 请求体（可选，JSON 字符串）
- contentType: Content-Type（可选，默认 application/json）`,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'API 名称' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], description: 'HTTP 方法' },
        url: { type: 'string', description: '请求地址' },
        description: { type: 'string', description: '描述（可选）' },
        headers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: { type: 'string' },
            },
          },
          description: '请求头列表',
        },
        queryParams: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: { type: 'string' },
            },
          },
          description: 'Query 参数列表',
        },
        body: { type: 'string', description: '请求体（JSON 字符串）' },
        contentType: { type: 'string', description: 'Content-Type，默认 application/json' },
      },
      required: ['name', 'method', 'url'],
    },
    async execute(args) {
      try {
        const payload: Record<string, unknown> = {
          name: args.name as string,
          displayName: args.name as string,
          method: (args.method as string) || 'GET',
          url: args.url as string,
          description: (args.description as string) || '',
          headers: (args.headers as Array<{ key: string; value: string }>) || [],
          queryParams: (args.queryParams as Array<{ key: string; value: string }>) || [],
          body: (args.body as string) || '',
          contentType: (args.contentType as string) || 'application/json',
        };
        const res = await createAppTool(ctx.applicationId, payload);
        const newApiId = (res.data as Record<string, unknown>)?.id as number;
        ctx.onToolsChange?.(newApiId);
        return { success: true, message: `API "${args.name}" 连接成功`, data: res.data };
      } catch (e: unknown) {
        return { success: false, message: `连接 API 失败: ${(e as Error).message}` };
      }
    },
  }),

  'api:test': (ctx) => ({
    id: 'api:test',
    category: SkillCategory.API,
    name: 'test_api',
    description: '测试一个已连接的 API 工具，发送请求并返回响应结果。',
    parameters: {
      type: 'object',
      properties: {
        apiId: { type: 'number', description: 'API 工具 ID' },
        params: { type: 'object', description: '调用参数（可选）' },
      },
      required: ['apiId'],
    },
    async execute(args) {
      try {
        const params = (args.params as Record<string, unknown>) || {};
        const res = await runAppTool(ctx.applicationId, args.apiId as number, params);
        return {
          success: true,
          message: `API 调用成功，状态码 ${res.data.status}`,
          data: res.data,
        };
      } catch (e: unknown) {
        return { success: false, message: `API 测试失败: ${(e as Error).message}` };
      }
    },
  }),

  'api:delete': (ctx) => ({
    id: 'api:delete',
    category: SkillCategory.API,
    name: 'delete_api',
    description: '删除一个已连接的 API 工具。',
    parameters: {
      type: 'object',
      properties: {
        apiId: { type: 'number', description: 'API 工具 ID' },
      },
      required: ['apiId'],
    },
    requiresConfirmation: true,
    async execute(args) {
      try {
        await deleteAppTool(ctx.applicationId, args.apiId as number);
        ctx.onToolsChange?.();
        return { success: true, message: 'API 已删除' };
      } catch (e: unknown) {
        return { success: false, message: `删除 API 失败: ${(e as Error).message}` };
      }
    },
  }),
};