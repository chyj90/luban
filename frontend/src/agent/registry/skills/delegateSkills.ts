import { SkillCategory, type SkillFactory, resolveSkills } from '../skillRegistry';
import { buildDataAssistantPrompt } from '../../prompts/dbaPrompt';
import { ANALYSIS_AGENT_PROMPT } from '../../prompts/analysisAgent';
import { getAgentMemory, setAgentMemory } from '../agentMemory';
import type { DelegateQueryArgs, DelegateQueryResult } from '@/types/agent';

export const delegateSkills: Record<string, SkillFactory> = {
  'delegate:query': (ctx, chatRouter) => {
    if (!chatRouter) {
      return {
        id: 'delegate:query',
        category: SkillCategory.DELEGATE,
        name: 'delegate_query',
        description: '向数据辅助智能体委派查询任务（不可用：缺少 ChatRouter）',
        parameters: { type: 'object', properties: {} },
        async execute() { return { success: false, message: 'ChatRouter 不可用' }; },
      };
    }

    return {
      id: 'delegate:query',
      category: SkillCategory.DELEGATE,
      name: 'delegate_query',
      description: `向数据辅助智能体委派单个查询的创建、修改或删除任务。
每次调用只处理一个查询，不要批量传入。
数据辅助智能体会自行验证结果并汇报。`,
      parameters: {
        type: 'object',
        properties: {
          task_type: { type: 'string', enum: ['CREATE', 'MODIFY', 'DELETE'], description: '任务类型' },
          target_page: { type: 'string', description: '目标页面名称（DELETE 时可为空字符串）' },
          query_name: { type: 'string', description: '查询名称，英文驼峰命名（DELETE 时不填）' },
          requirement: { type: 'string', description: 'CREATE：需要的字段列表。MODIFY：修改说明。DELETE：删除需求描述' },
          existing_queries: { type: 'array', items: { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' }, description: { type: 'string' } } }, description: '当前应用已有的查询列表（MODIFY 时使用）' },
          modify_instructions: { type: 'array', items: { type: 'string' }, description: '修改查询的具体说明（MODIFY 时使用）' },
        },
        required: ['task_type', 'requirement'],
      },
      async execute(args) {
        const typedArgs = args as unknown as DelegateQueryArgs;
        const execStart = Date.now();
        console.log(`[delegate_query] 开始 | taskType=${typedArgs.task_type} | queryName=${typedArgs.query_name}`);

        ctx.dispatch?.({
          type: 'DELEGATE_QUERY_START',
          payload: { taskType: typedArgs.task_type, targetPage: typedArgs.target_page, queryName: typedArgs.query_name, requirement: typedArgs.requirement },
        } as unknown);

        try {
          const dbaPrompt = buildDataAssistantPrompt({
            applicationId: ctx.applicationId,
            taskType: typedArgs.task_type,
            targetPage: typedArgs.target_page,
            queryName: typedArgs.query_name,
            requirement: typedArgs.requirement,
            existingQueries: typedArgs.existing_queries,
            modifyInstructions: typedArgs.modify_instructions,
          });

          const dbaTools = resolveSkills([
            'datasource:list', 'datasource:test', 'datasource:structure', 'datasource:connect',
            'query:list', 'query:create', 'query:update', 'query:delete', 'query:run', 'query:get', 'query:execute',
          ], ctx, chatRouter);

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
          const executor = await chatRouter!.routeTo('data-assistant', userMessage, `dba-${Date.now()}`, {
            systemPrompt: dbaPrompt,
            tools: dbaTools,
            isDelegated: true,
            initialMessages: getAgentMemory(ctx.applicationId, 'data-assistant'),
            agentContext: {
              taskType: typedArgs.task_type,
              targetPage: typedArgs.target_page,
              queryName: typedArgs.query_name,
              requirement: typedArgs.requirement,
              existingQueries: typedArgs.existing_queries,
              modifyInstructions: typedArgs.modify_instructions,
            },
          });
          setAgentMemory(ctx.applicationId, 'data-assistant', executor.getMessages());
          console.log(`[delegate_query] data-assistant 完成 | ${Date.now() - routeStart}ms`);

          const messages = executor.getMessages();
          const dbaResponse = messages
            .filter((m: unknown) => m.role === 'assistant')
            .map((m: unknown) => m.content)
            .join('\n\n')
            .trim();

          const result: DelegateQueryResult = {
            success: true,
            message: `数据辅助智能体完成「${typedArgs.task_type}」任务`,
            details: dbaResponse || '任务完成',
            data: { messages },
          };

          ctx.dispatch?.({
            type: 'DELEGATE_QUERY_END',
            payload: { taskType: typedArgs.task_type, queryName: typedArgs.query_name, success: true, details: dbaResponse },
          } as unknown);
          ctx.onQueriesChange?.();

          console.log(`[delegate_query] 完成 | 总耗时: ${Date.now() - execStart}ms`);
          return { success: true, message: result.message, data: result };
        } catch (e: unknown) {
          console.error(`[delegate_query] 失败:`, e);
          ctx.dispatch?.({
            type: 'DELEGATE_QUERY_END',
            payload: { taskType: typedArgs.task_type, queryName: typedArgs.query_name, success: false, error: e.message },
          } as unknown);
          return { success: false, message: `数据辅助智能体执行失败: ${e.message}`, _noRetry: true };
        }
      },
    };
  },

  'delegate:workflow': (ctx, chatRouter) => {
    if (!chatRouter) {
      return {
        id: 'delegate:workflow',
        category: SkillCategory.DELEGATE,
        name: 'delegate_workflow',
        description: '向流程设计智能体委派任务（不可用：缺少 ChatRouter）',
        parameters: { type: 'object', properties: {} },
        async execute() { return { success: false, message: 'ChatRouter 不可用' }; },
      };
    }

    return {
      id: 'delegate:workflow',
      category: SkillCategory.DELEGATE,
      name: 'delegate_workflow',
      description: `向流程设计智能体委派流程设计任务。
流程设计智能体具备独立的流程设计能力，会自行分析需求、搜索成员/角色、设计流程，并输出结果。`,
      parameters: {
        type: 'object',
        properties: {
          requirement: { type: 'string', description: '流程设计需求描述' },
          context: { type: 'string', description: '相关上下文（页面名称、已有流程等）' },
        },
        required: ['requirement'],
      },
      async execute(args) {
        const { requirement, context } = args as unknown;
        const execStart = Date.now();
        console.log(`[delegate_workflow] 开始委派流程设计任务`);

        ctx.dispatch?.({
          type: 'DELEGATE_WORKFLOW_START',
          payload: { requirement },
        } as unknown);

        try {
          const systemPrompt = `你是流程设计专家，负责设计和管理业务流程。你必须调用工具来实际创建表单和流程，禁止只输出文本方案而不调用工具。

当前应用 ID: ${ctx.applicationId}
页面 ID: ${ctx.pageId}

${context ? `上下文信息：${context}` : ''}

## 工作流程（必须按顺序执行）
1. 先用 search_members 或 search_roles 查询可用的审批人/角色
2. 用 design_form 创建表单（name 必填，fields 为字段列表）
3. 用 design_workflow 创建流程（name 必填，applicationId=${ctx.applicationId}，nodes 和 edges 必填）
4. 用 bind_workflow 将表单绑定到流程（formId 为步骤2返回的表单 ID，processId 为步骤3返回的流程 ID）

## 流程节点类型（nodeType 用于后端校验，type 用于前端渲染，两者不同）
- start: nodeType: "start", type: "startNode"
- approval: nodeType: "approval", type: "approvalNode"，需设置 approverType（member/role/leader/department_head）
- end: nodeType: "end", type: "endNode"

## 审批人类型
- member: 指定人员，需 memberIds 数组
- role: 指定角色，需 roleIds 数组
- leader: 发起人的直属上级
- department_head: 发起人所在部门负责人

## 每个节点必须包含 nodeId、id、nodeType、position: { x, y }、data
- start: nodeId: "start", id: "start", nodeType: "start", position: { x: 300, y: 50 }
- 各审批节点 y 依次递增 120（如 170, 290, 410），nodeId 和 id 设为 "approval_1"、"approval_2" 等，nodeType: "approval"
- end: nodeId: "end", id: "end", nodeType: "end", position: { x: 300, y: 最后一个节点 y + 120 }

## 每个节点必须包含 data
- start: data: { label: "发起人提交申请", nodeType: "start", config: { nodeName: "发起人提交申请" } }
- approval: data: { label: "直属上级审批", nodeType: "approval", config: { nodeName: "直属上级审批", approverType: "leader" } }
- end: data: { label: "结束", nodeType: "end", config: { nodeName: "结束" } }

## 连线（edges）
每条连线格式：{ id: "边ID", source: "源节点ID", target: "目标节点ID", type: "smoothstep", markerEnd: { type: "arrowclosed" } }

## 重要规则
- 禁止只输出设计方案而不调用工具，必须实际创建
- 每个流程必须包含 start 和 end 节点
- 审批节点必须设置审批人
- 创建完成后汇报实际结果`;

          const executor = await chatRouter!.routeTo('workflow-assistant', `请设计流程：${requirement}`, `wf-${Date.now()}`, {
            systemPrompt,
            isDelegated: true,
            agentContext: { requirement, context },
          });

          const messages = executor.getMessages();
          const response = messages
            .filter((m: unknown) => m.role === 'assistant')
            .map((m: unknown) => m.content)
            .join('\n\n')
            .trim();

          ctx.dispatch?.({
            type: 'DELEGATE_WORKFLOW_END',
            payload: { success: true, details: response },
          } as unknown);

          console.log(`[delegate_workflow] 完成 | 总耗时: ${Date.now() - execStart}ms`);
          return { success: true, message: '流程设计任务完成', data: { response } };
        } catch (e: unknown) {
          console.error(`[delegate_workflow] 失败:`, e);
          ctx.dispatch?.({
            type: 'DELEGATE_WORKFLOW_END',
            payload: { success: false, error: e.message },
          } as unknown);
          return { success: false, message: `流程设计智能体执行失败: ${e.message}`, _noRetry: true };
        }
      },
    };
  },

  'delegate:analysis': (ctx, chatRouter) => {
    if (!chatRouter) {
      return {
        id: 'delegate:analysis',
        category: SkillCategory.DELEGATE,
        name: 'delegate_analysis',
        description: '向需求分析智能体委派任务（不可用：缺少 ChatRouter）',
        parameters: { type: 'object', properties: {} },
        async execute() { return { success: false, message: 'ChatRouter 不可用' }; },
      };
    }

    return {
      id: 'delegate:analysis',
      category: SkillCategory.DELEGATE,
      name: 'delegate_analysis',
      description: `向需求分析智能体委派需求分析任务。
需求分析智能体会分析用户需求，拆解为结构化任务，输出分析报告。`,
      parameters: {
        type: 'object',
        properties: {
          requirement: { type: 'string', description: '用户需求描述' },
          context: { type: 'string', description: '当前应用上下文' },
        },
        required: ['requirement'],
      },
      async execute(args) {
        const { requirement, context } = args as unknown;
        const execStart = Date.now();
        console.log(`[delegate_analysis] 开始委派需求分析任务`);

        ctx.dispatch?.({
          type: 'DELEGATE_ANALYSIS_START',
          payload: { requirement },
        } as unknown);

        try {
          const systemPrompt = `${ANALYSIS_AGENT_PROMPT}
当前应用 ID: ${ctx.applicationId}
${context ? `上下文信息：${context}` : ''}`;

          const executor = await chatRouter!.routeTo('analysis-assistant', `请分析需求：${requirement}`, `analysis-${Date.now()}`, {
            systemPrompt,
            isDelegated: true,
            agentContext: { requirement, context },
          });

          const messages = executor.getMessages();
          const response = messages
            .filter((m: unknown) => m.role === 'assistant')
            .map((m: unknown) => m.content)
            .join('\n\n')
            .trim();

          // 从分析助手的回复中提取 plan_id
          const planIdMatch = response.match(/plan[_-]?id[：:]\s*(\d+)/i)
            || response.match(/计划[_-]?id[：:]\s*(\d+)/i)
            || response.match(/planId[：:]\s*(\d+)/i);
          const planId = planIdMatch ? parseInt(planIdMatch[1], 10) : null;

          console.log(`[delegate_analysis] 完成 | 总耗时: ${Date.now() - execStart}ms | planId: ${planId}`);

          ctx.dispatch?.({
            type: 'DELEGATE_ANALYSIS_END',
            payload: { success: true, details: response, planId },
          } as unknown);

          return {
            success: true,
            message: '需求分析完成',
            data: { analysis: response, planId, messages },
          };
        } catch (e: unknown) {
          console.error(`[delegate_analysis] 失败:`, e);
          ctx.dispatch?.({
            type: 'DELEGATE_ANALYSIS_END',
            payload: { success: false, error: e.message },
          } as unknown);
          return { success: false, message: `需求分析智能体执行失败: ${e.message}`, _noRetry: true };
        }
      },
    };
  },
};