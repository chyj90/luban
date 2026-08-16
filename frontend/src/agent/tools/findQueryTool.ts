import type { ToolDefinition, ToolContext } from '@/types/agent';
import { buildDataAssistantPrompt } from '../prompts/dbaPrompt';
import { createDataAssistantTools } from './dbaTools';
import type { ChatRouter } from '../core/chatRouter';
import { getAgentMemory, setAgentMemory } from './agentMemory';

export interface DelegateQueryArgs {
  task_type: string;
  target_page: string;
  query_name: string;
  requirement: string;
  existing_queries?: Array<{ id: number; name: string; description: string }>;
  modify_instructions?: string[];
}

export interface DelegateQueryResult {
  success: boolean;
  message: string;
  _noRetry?: boolean;
}

export function createDelegateQueryTool(context: ToolContext, chatRouter: ChatRouter): ToolDefinition {
  return {
    name: 'delegate_query',
    description: `向数据辅助智能体委派单个查询的创建、修改或删除任务。
每次调用只处理一个查询，不要批量传入。
数据辅助智能体会自行验证结果并汇报。`,
    category: 'query',
    parameters: {
      type: 'object',
      properties: {
        task_type: {
          type: 'string',
          enum: ['CREATE', 'MODIFY', 'DELETE'],
          description: '任务类型',
        },
        target_page: {
          type: 'string',
          description: '目标页面名称（DELETE 时可为空字符串）',
        },
        query_name: {
          type: 'string',
          description: '查询名称，英文驼峰命名（DELETE 时不填）',
        },
        requirement: {
          type: 'string',
          description: 'CREATE：需要的字段列表。MODIFY：修改说明。DELETE：删除需求描述，如"删除所有查询"或"删除查询 xxx"',
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
          description: '当前应用已有的查询列表（MODIFY 时使用）',
        },
        modify_instructions: {
          type: 'array',
          items: { type: 'string' },
          description: '修改查询的具体说明（MODIFY 时使用）',
        },
      },
      required: ['task_type', 'requirement'],
    },
    async execute(args) {
      const typedArgs = args as unknown as DelegateQueryArgs;
      const execStart = Date.now();

      console.log(`[delegate_query] 开始 | taskType=${typedArgs.task_type} | queryName=${typedArgs.query_name}`);

      context.dispatch({
        type: 'DELEGATE_QUERY_START',
        payload: {
          taskType: typedArgs.task_type,
          targetPage: typedArgs.target_page,
          queryName: typedArgs.query_name,
          requirement: typedArgs.requirement,
        },
      });

      try {
        const dbaPrompt = buildDataAssistantPrompt({
          applicationId: context.applicationId,
          taskType: typedArgs.task_type,
          targetPage: typedArgs.target_page,
          queryName: typedArgs.query_name,
          requirement: typedArgs.requirement,
          existingQueries: typedArgs.existing_queries,
          modifyInstructions: typedArgs.modify_instructions,
        });

        const dbaTools = createDataAssistantTools(context);

        let userMessage: string;
        if (typedArgs.task_type === 'DELETE') {
          userMessage = typedArgs.requirement;
        } else if (typedArgs.task_type === 'MODIFY') {
          userMessage = `请修改查询「${typedArgs.query_name}」：\n${typedArgs.requirement}${typedArgs.modify_instructions?.length ? `\n\n具体修改说明：\n${typedArgs.modify_instructions.map((m: string, i: number) => `${i + 1}. ${m}`).join('\n')}` : ''}`;
        } else {
          userMessage = `请为「${typedArgs.target_page}」创建查询「${typedArgs.query_name}」：\n${typedArgs.requirement}`;
        }

        console.log(`[delegate_query] 委派 data-assistant | 消息长度: ${userMessage.length}`);
        const routeStart = Date.now();
        const executor = await chatRouter.routeTo('data-assistant', userMessage, `dba-${Date.now()}`, {
          systemPrompt: dbaPrompt,
          tools: dbaTools,
          isDelegated: true,
          initialMessages: getAgentMemory(context.applicationId, 'data-assistant'),
          agentContext: {
            taskType: typedArgs.task_type,
            targetPage: typedArgs.target_page,
            queryName: typedArgs.query_name,
            requirement: typedArgs.requirement,
            existingQueries: typedArgs.existing_queries,
            modifyInstructions: typedArgs.modify_instructions,
          },
        });
        setAgentMemory(context.applicationId, 'data-assistant', executor.getMessages());
        console.log(`[delegate_query] data-assistant 完成 | ${Date.now() - routeStart}ms`);

        const messages = executor.getMessages();
        const dbaResponse = messages
          .filter((m) => m.role === 'assistant')
          .map((m) => m.content)
          .join('\n\n')
          .trim();

        const result: DelegateQueryResult = {
          success: true,
          message: dbaResponse,
        };

        context.dispatch({
          type: 'DELEGATE_QUERY_COMPLETE',
          payload: result,
        });
        console.log(`[delegate_query] 完成 | 总耗时 ${Date.now() - execStart}ms`);

        return result;
      } catch (e) {
        const errorResult: DelegateQueryResult = {
          success: false,
          message: `数据辅助智能体执行失败: ${(e as Error).message}`,
          _noRetry: true,
        };

        console.log(`[delegate_query] 失败 | ${(e as Error).message}`);
        context.dispatch({
          type: 'DELEGATE_QUERY_COMPLETE',
          payload: errorResult,
        });

        return errorResult;
      }
    },
  };
}

export function getDelegateQuerySkillSummary(): string {
  return `## 数据操作
- 你**不知道**数据库结构，**不能**直接操作查询
- 所有数据相关操作委派给数据辅助智能体（DBA）
- 仔细阅读 DBA 的回复：如果 DBA 请求确认，转达给用户；如果 DBA 汇报完成，继续下一步
- DELETE 时：query_name 不填，只用 requirement 描述删除需求，如"删除所有查询"或"删除查询 xxx"`;
}