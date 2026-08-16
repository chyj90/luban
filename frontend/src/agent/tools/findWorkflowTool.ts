import type { ToolDefinition, ToolContext } from '@/types/agent';
import { WORKFLOW_AGENT_PROMPT } from '../prompts/workflowAgent';
import { createWorkflowTools } from './workflowTools';
import type { ChatRouter } from '../core/chatRouter';
import { getAgentMemory, setAgentMemory } from './agentMemory';

export interface FindWorkflowArgs {
  task_type: string;
  target_page: string;
  requirements: string[];
  applicationId: number;
}

export interface FindWorkflowResult {
  success: boolean;
  message: string;
  data?: {
    formId?: number;
    workflowId?: number;
  };
  _noRetry?: boolean;
}

export function createFindWorkflowTool(context: ToolContext, chatRouter: ChatRouter): ToolDefinition {
  return {
    name: 'find_workflow',
    description: `向流程设计助手委派流程设计任务。
使用时机：用户需要创建表单、设计审批流程、查询组织成员/角色、管理审批任务等。
主智能体不直接操作流程，将流程相关需求委派给流程设计助手处理。`,
    category: 'workflow',
    parameters: {
      type: 'object',
      properties: {
        task_type: {
          type: 'string',
          enum: ['design_form', 'design_workflow', 'query_org', 'approval_task', 'process_ops', 'lint', 'copy_preview', 'general'],
          description: '任务类型：design_form=设计表单，design_workflow=设计流程，query_org=查询组织/成员/角色，approval_task=审批任务处理（通过/驳回/加签/委派/驳回至节点/逐级驳回），process_ops=流程运维（冻结/解冻/取消/强制终止/强制撤回/修改处理人），lint=代码校验（表单代码/字段Schema/流程定义/条件表达式），copy_preview=复制/预览/验证/版本，general=通用流程问题',
        },
        target_page: {
          type: 'string',
          description: '当前页面名称',
        },
        requirements: {
          type: 'array',
          items: { type: 'string' },
          description: '流程需求列表，用自然语言描述',
        },
        applicationId: {
          type: 'number',
          description: '应用 ID',
        },
      },
      required: ['task_type', 'requirements'],
    },
    async execute(args) {
      const typedArgs = args as unknown as FindWorkflowArgs;
      const execStart = Date.now();

      console.log(`[find_workflow] 开始执行 | taskType=${typedArgs.task_type} | requirements=${typedArgs.requirements?.length || 0}条`);

      context.dispatch({
        type: 'FIND_WORKFLOW_START',
        payload: {
          taskType: typedArgs.task_type,
          requirements: typedArgs.requirements,
        },
      });

      try {
        const workflowTools = createWorkflowTools(context);

        const userMessage = `请处理以下流程需求：\n${typedArgs.requirements.map((r: string, i: number) => `${i + 1}. ${r}`).join('\n')}`;

        console.log(`[find_workflow] 即将委派 workflow-assistant | 消息长度: ${userMessage.length}`);
        const routeStart = Date.now();
        const executor = await chatRouter.routeTo('workflow-assistant', userMessage, `workflow-${Date.now()}`, {
          systemPrompt: WORKFLOW_AGENT_PROMPT,
          tools: workflowTools,
          isDelegated: true,
          initialMessages: getAgentMemory(context.applicationId, 'workflow-assistant'),
          agentContext: {
            taskType: typedArgs.task_type,
            requirements: typedArgs.requirements,
            applicationId: typedArgs.applicationId || context.applicationId,
          },
        });
        setAgentMemory(context.applicationId, 'workflow-assistant', executor.getMessages());
        console.log(`[find_workflow] workflow-assistant 委派完成 | ${Date.now() - routeStart}ms`);

        const result: FindWorkflowResult = {
          success: true,
          message: '流程设计助手已完成任务',
        };

        context.dispatch({
          type: 'FIND_WORKFLOW_COMPLETE',
          payload: result,
        });
        console.log(`[find_workflow] 已 dispatch FIND_WORKFLOW_COMPLETE | 总耗时 ${Date.now() - execStart}ms`);

        return result;
      } catch (e) {
        const errorResult: FindWorkflowResult = {
          success: false,
          message: `流程设计助手执行失败: ${(e as Error).message}`,
          _noRetry: true,
        };

        console.log(`[find_workflow] 执行失败 | ${(e as Error).message}`);
        context.dispatch({
          type: 'FIND_WORKFLOW_COMPLETE',
          payload: errorResult,
        });

        return errorResult;
      }
    },
  };
}

export function getFindWorkflowSkillSummary(): string {
  return `## 流程管理
- 你**不直接**操作流程、表单、组织架构，全部委派给流程设计助手
- 任何流程相关的需求，调用 find_workflow 工具，用自然语言描述需求
- 支持的任务类型：
  - design_form：设计表单
  - design_workflow：设计审批流程
  - query_org：查询成员/部门/角色
  - approval_task：处理审批（通过/驳回/加签/委派/驳回至节点/逐级驳回）
  - process_ops：流程运维（冻结/解冻/取消/强制终止/强制撤回/修改处理人）
  - lint：代码校验（表单代码/字段Schema/流程定义/条件表达式）
  - copy_preview：复制/预览/验证/版本
  - general：通用流程问题`;
}