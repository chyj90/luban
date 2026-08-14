import type { ToolDefinition, ToolContext } from '@/types/agent';
import { listQueries } from '@/api';
import { buildDataAssistantPrompt } from '../prompts/dbaPrompt';
import { createDataAssistantTools } from './dbaTools';
import type { ChatRouter } from '../core/chatRouter';

export interface FindQueryArgs {
  task_type: string;
  target_page: string;
  requirements: string[];
  existing_queries?: Array<{ id: number; name: string; description: string }>;
  modify_instructions?: string[];
}

export interface FindQueryResult {
  success: boolean;
  message: string;
  queries?: Array<{ id: number; name: string; description: string }>;
}

export function createFindQueryTool(context: ToolContext, chatRouter: ChatRouter): ToolDefinition {
  return {
    name: 'find_query',
    description: `向数据辅助智能体请求创建或修改查询。
使用时机：任何需要查询数据的需求（用户列表、搜索、筛选、统计等）。
主智能体不知道数据库结构，调用此工具让 DBA 自行建好查询并调试通过。
返回的 queries 列表可直接用于页面绑定（如 {{ QueryName.data }}）。`,
    category: 'query',
    parameters: {
      type: 'object',
      properties: {
        task_type: {
          type: 'string',
          enum: ['A应用', 'B单页面', 'C2数据调整', 'C3模块调整'],
          description: '任务类型：A应用=完整应用多页面，B单页面=单个页面，C2数据调整=修改查询条件，C3模块调整=UI+数据联动',
        },
        target_page: {
          type: 'string',
          description: '目标页面名称',
        },
        requirements: {
          type: 'array',
          items: { type: 'string' },
          description: '数据需求列表，用业务语言描述，不要写 SQL 或表名',
        },
        existing_queries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              description: { type: 'string' },
            },
          },
          description: '当前应用已有的查询列表（C2/C3 时必填，用于 DBA 判断是修改还是新增）',
        },
        modify_instructions: {
          type: 'array',
          items: { type: 'string' },
          description: '需要修改哪些查询、怎么改（C2 时必填）',
        },
      },
      required: ['task_type', 'target_page', 'requirements'],
    },
    async execute(args) {
      const typedArgs = args as unknown as FindQueryArgs;
      const execStart = Date.now();

      console.log(`[find_query] 开始执行 | taskType=${typedArgs.task_type} | targetPage=${typedArgs.target_page} | requirements=${typedArgs.requirements.length}条`);

      context.dispatch({
        type: 'FIND_QUERY_START',
        payload: {
          taskType: typedArgs.task_type,
          targetPage: typedArgs.target_page,
          requirements: typedArgs.requirements,
        },
      });
      console.log('[find_query] 已 dispatch FIND_QUERY_START');

      try {
        const dbaPrompt = buildDataAssistantPrompt({
          applicationId: context.applicationId,
          taskType: typedArgs.task_type,
          targetPage: typedArgs.target_page,
          requirements: typedArgs.requirements,
          existingQueries: typedArgs.existing_queries,
          modifyInstructions: typedArgs.modify_instructions,
        });

        const dbaTools = createDataAssistantTools(context);

        const userMessage = `请为「${typedArgs.target_page}」创建以下查询：\n${typedArgs.requirements.map((r: string, i: number) => `${i + 1}. ${r}`).join('\n')}${typedArgs.modify_instructions?.length ? `\n\n需要修改的查询：\n${typedArgs.modify_instructions.map((m: string, i: number) => `${i + 1}. ${m}`).join('\n')}` : ''}`;

        console.log(`[find_query] 即将委派 data-assistant | 消息长度: ${userMessage.length}`);
        const routeStart = Date.now();
        await chatRouter.routeTo('data-assistant', userMessage, `dba-${Date.now()}`, {
          systemPrompt: dbaPrompt,
          tools: dbaTools,
          agentContext: {
            taskType: typedArgs.task_type,
            targetPage: typedArgs.target_page,
            requirements: typedArgs.requirements,
            existingQueries: typedArgs.existing_queries,
            modifyInstructions: typedArgs.modify_instructions,
          },
        });
        console.log(`[find_query] data-assistant 委派完成 | ${Date.now() - routeStart}ms`);

        const allQueries = await listQueries(context.applicationId);
        const queries = allQueries.data.map((q) => ({
          id: q.id,
          name: q.name,
          description: q.body?.substring(0, 50) || '',
        }));

        if (queries.length > 0) {
          context.onQuerySelect?.(queries[0]);
        }

        const result: FindQueryResult = {
          success: true,
          message: `数据辅助智能体已创建 ${queries.length} 个查询`,
          queries,
        };

        context.dispatch({
          type: 'FIND_QUERY_COMPLETE',
          payload: result,
        });
        console.log(`[find_query] 已 dispatch FIND_QUERY_COMPLETE | queries=${queries.length} | 总耗时 ${Date.now() - execStart}ms`);

        return result;
      } catch (e) {
        const errorResult: FindQueryResult = {
          success: false,
          message: `数据辅助智能体执行失败: ${(e as Error).message}`,
        };

        console.log(`[find_query] 执行失败 | ${(e as Error).message}`);
        context.dispatch({
          type: 'FIND_QUERY_COMPLETE',
          payload: errorResult,
        });

        return errorResult;
      }
    },
  };
}

export function getFindQuerySkillSummary(): string {
  return `## 查询管理
- 你**不知道**数据库结构和表名，**不能**创建查询
- 任何需要数据的需求，调用 find_query 工具，用业务语言描述需求
- 样式调整不需要调用 find_query
- 创建查询前先 list_queries 了解当前查询`;
}