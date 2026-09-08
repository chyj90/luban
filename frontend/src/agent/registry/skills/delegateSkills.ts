import { SkillCategory, type SkillFactory, resolveSkills } from '../skillRegistry';
import { buildDataAssistantPrompt } from '../../prompts/dbaPrompt';
import { getAgentMemory, setAgentMemory } from '../agentMemory';
import { formApi } from '@/api/workflow';
import { listQueries } from '@/api';
import type { DelegateQueryArgs, DelegateQueryResult } from '@/types/agent';

const activeDelegations = new Set<string>();

/** 流程引擎对驳回/加签的内置语义：这些能力由引擎和审批界面提供，节点 config 不支持相关配置项 */
const WORKFLOW_ENGINE_SEMANTICS = `## 驳回与加签（引擎内置能力，禁止配置到节点）
- **驳回退回发起人**：流程引擎默认行为，审批人执行"驳回"后流程自动退回发起人重新提交，无需在节点 config 中配置任何参数
- **加签**：审批人处理任务时的运行时操作（前加签/后加签），由审批界面提供，与流程设计无关，无需配置
- ⚠️ 节点 data.config 只允许包含本文档列出的字段（nodeName、approverType 及其对应的审批人参数），**禁止编造 allowReject、allowAddSign、rejectTo 等引擎不支持的配置项**——写了也不会生效`;

/** task_type=design_form：仅设计表单 */
const DESIGN_FORM_WORKFLOW = `## 工作流程（仅设计表单）
本任务只需要设计表单，**禁止创建流程（design_workflow）和绑定（bind_workflow）**：
1. 如需查看已有表单的字段定义，用 design_form 传入 formId 且不传 fields（只读，不会创建新表单）
2. 用 design_form 创建表单（name 必填，fields 为字段列表）。⚠️ 如果上面已列出可复用的表单且能满足需求，不要重复创建
3. 汇报时必须列出表单 ID 和每个字段的 key（后续流程条件判断依赖这些 key）`;

/** task_type=design_workflow：仅设计/修改流程 */
const DESIGN_WORKFLOW_ONLY_PROMPT = `## 工作流程（仅设计/修改流程，不创建表单）
1. **修改已有流程**（需求给出流程 ID 时）：先用 get_definition(processId) 读取现有节点和连线，再基于现有结构调用 update_workflow(processId, nodes, edges) 传入修改后的**完整**节点和连线。update_workflow 失败时才用 design_workflow 创建新流程，并说明新旧流程 ID 的对应关系
2. **新建流程**：用 design_workflow 创建（name 必填，applicationId 必填，nodes/edges 必填）
3. 上下文或对话记录中已有本次相关表单（含表单 ID）时，用 bind_workflow(processId, formId) 绑定；看不到字段 key 时，用 design_form 传入 formId 且不传 fields 查看
4. ⚠️ 条件分支连线的 condition 表达式必须使用表单的**真实字段 key**（通过 design_form(formId) 查询或上下文获得），禁止猜测字段名
5. 先用 search_members 或 search_roles 查询可用的审批人/角色，再设置审批人
6. 汇报时列出流程 ID、节点结构、每条条件分支的表达式及其引用的字段 key
7. 如果用户明确说不需要表单或页面通过自己的弹窗发起流程，汇报时附上发起代码示例：
   \`\`\`js
   window.__LUBAN__.startWorkflow(流程ID, { 字段1: '值1', 字段2: '值2' })
     .then(function(instance) { alert('流程已发起，实例ID：' + instance.id); })
     .catch(function(err) { alert('发起失败：' + err.message); });
   \`\`\``;

/** 未指定 task_type：表单 + 流程完整执行 */
const FULL_WORKFLOW_PROMPT = `## 工作流程

### 完整流程（用户描述了表单字段时）
1. 先用 search_members 或 search_roles 查询可用的审批人/角色
2. 用 design_form 创建表单（name 必填，fields 为字段列表）。⚠️ 如果上面已列出可复用的表单，跳过此步，直接用已有表单 ID
3. 用 design_workflow 创建流程（name 必填，applicationId 填上方「当前应用 ID」的值，nodes 和 edges 必填）
4. 用 bind_workflow 将表单绑定到流程（formId 为已有表单 ID 或步骤2返回的表单 ID，processId 为步骤3返回的流程 ID）

### 仅设计流程（用户明确说不需要表单，或页面通过自己的弹窗发起流程时）
1. 先用 search_members 或 search_roles 查询可用的审批人/角色
2. 如果已有可复用表单，用 bind_workflow 绑定到流程（可选）
3. 用 design_workflow 创建流程
4. 汇报结果时，必须包含以下信息：
   - 流程名称和 ID
   - 页面弹窗发起流程的 JS 代码示例：
   \`\`\`js
   window.__LUBAN__.startWorkflow(流程ID, { 字段1: '值1', 字段2: '值2' })
     .then(function(instance) { alert('流程已发起，实例ID：' + instance.id); })
     .catch(function(err) { alert('发起失败：' + err.message); });
   \`\`\`
   - 说明：startWorkflow 的 formData 参数应与页面弹窗表单的字段对应

### 修改已有流程（用户给出流程 ID 时）
1. 先用 get_definition(processId) 读取现有节点和连线
2. 用 update_workflow(processId, nodes, edges) 传入修改后的完整节点和连线，不要创建新流程
3. update_workflow 失败时才用 design_workflow 创建新流程，并说明新旧流程 ID 的对应关系
4. ⚠️ 条件表达式的字段 key 必须用 design_form 传入 formId 且不传 fields 查询真实字段，禁止猜测`;

async function validateFilterParamsCoverage(
  filterParams: string | undefined,
  queryName: string | undefined,
  applicationId: number
): Promise<string[]> {
  const warnings: string[] = [];
  if (!filterParams || !queryName) return warnings;

  const declaredParams = filterParams
    .split(',')
    .map(p => p.trim().split('(')[0].trim())
    .filter(p => p.length > 0);

  if (declaredParams.length === 0) return warnings;

  try {
    const res = await listQueries(applicationId);
    const query = res.data.find((q: any) => q.name === queryName);
    if (!query) {
      warnings.push(`未找到查询 ${queryName}，无法校验筛选参数覆盖`);
      return warnings;
    }

    const sql: string = query.body || query.sqlBody || '';
    if (!sql) {
      warnings.push(`查询 ${queryName} 无 SQL 内容，无法校验筛选参数覆盖`);
      return warnings;
    }

    for (const param of declaredParams) {
      const paramPattern = `this.params.${param}`;
      if (!sql.includes(paramPattern)) {
        warnings.push(`筛选参数 "${param}" 未在 SQL 中出现（缺少 this.params.${param}），DBA 可能遗漏了此筛选条件`);
      }
    }
  } catch (e) {
    console.warn(`[validateFilterParamsCoverage] 校验失败:`, e);
  }

  return warnings;
}

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
      description: `向数据辅助智能体委派数据相关任务，包括：
- 查询/列出数据源、查询、API、表结构
- 创建/修改/删除查询
- 连接/测试/删除数据源和外部 API
只需用自然语言描述需求，DBA 会自行判断该做什么。`,
      parameters: {
        type: 'object',
        properties: {
          requirement: { type: 'string', description: '自然语言描述的需求，如"列出所有数据源"、"为订单页创建查询，需要 id、订单号、金额、状态字段"、"删除查询 xxx"' },
          target_page: { type: 'string', description: '目标页面名称（可选）' },
          query_name: { type: 'string', description: '查询名称（可选，创建/修改时建议提供）' },
          filter_params: { type: 'string', description: '声明的筛选参数（可选），格式：paramName(类型,匹配方式)，逗号分隔。DBA 完成后会校验 SQL 是否覆盖所有参数' },
        },
        required: ['requirement'],
      },
      async execute(args) {
        const typedArgs = args as unknown as DelegateQueryArgs;
        const execStart = Date.now();
        const guardKey = `query:${typedArgs.query_name || 'general'}`;
        if (activeDelegations.has(guardKey)) {
          console.warn(`[delegate_query] 相同任务正在执行中，拒绝重复调用 | key=${guardKey}`);
          return { success: false, message: '相同的数据操作任务正在执行中，请等待其完成后再试', _noRetry: true };
        }
        activeDelegations.add(guardKey);

        console.log(`[delegate_query] 开始 | requirement=${typedArgs.requirement?.slice(0, 60)}`);

        ctx.dispatch?.({
          type: 'DELEGATE_QUERY_START',
          payload: { requirement: typedArgs.requirement, targetPage: typedArgs.target_page, queryName: typedArgs.query_name },
        } as unknown);

        try {
          const dbaPrompt = buildDataAssistantPrompt({
            applicationId: ctx.applicationId,
            targetPage: typedArgs.target_page,
            queryName: typedArgs.query_name,
            requirement: typedArgs.requirement,
          });

          const dbaTools = resolveSkills([
            'datasource:list', 'datasource:test', 'datasource:structure', 'datasource:connect',
            'query:list', 'query:create', 'query:update', 'query:delete', 'query:run', 'query:get', 'query:execute', 'query:references',
            'api:list', 'api:connect', 'api:test', 'api:delete',
          ], ctx, chatRouter);

          const userMessage = typedArgs.requirement;

          console.log(`[delegate_query] 委派 data-assistant | 消息长度: ${userMessage.length}`);
          const routeStart = Date.now();
          const memoryBefore = getAgentMemory(ctx.applicationId, 'data-assistant');
          const memoryFiltered = memoryBefore.filter((m: { role: string }) => m.role !== 'system');
          console.log(`[delegate_query] getAgentMemory 返回 ${memoryBefore.length} 条消息，过滤 system 后 ${memoryFiltered.length} 条 | appId=${ctx.applicationId}`);
          const executor = await chatRouter!.routeTo('data-assistant', userMessage, `dba-${Date.now()}`, {
            systemPrompt: dbaPrompt,
            tools: dbaTools,
            isDelegated: true,
            initialMessages: memoryFiltered,
            agentContext: {
              requirement: typedArgs.requirement,
              targetPage: typedArgs.target_page,
              queryName: typedArgs.query_name,
            },
          });
          const messagesAfter = executor.getMessages();
          console.log(`[delegate_query] executor.getMessages 返回 ${messagesAfter.length} 条消息 | roles: [${messagesAfter.map((m: unknown) => m.role).join(', ')}]`);
          setAgentMemory(ctx.applicationId, 'data-assistant', messagesAfter);
          console.log(`[delegate_query] setAgentMemory 已保存 ${messagesAfter.length} 条消息`);
          console.log(`[delegate_query] data-assistant 完成 | ${Date.now() - routeStart}ms`);

          const messages = executor.getMessages();
          const dbaResponse = messages
            .filter((m: unknown) => m.role === 'assistant')
            .map((m: unknown) => m.content)
            .join('\n\n')
            .trim();

          const result: DelegateQueryResult = {
            success: true,
            message: `数据辅助智能体完成任务`,
            details: dbaResponse || '任务完成',
            data: { messages },
          };

          // 校验筛选参数覆盖：检查 DBA 生成的 SQL 是否包含所有声明的筛选参数
          const filterWarnings = await validateFilterParamsCoverage(
            typedArgs.filter_params,
            typedArgs.query_name,
            ctx.applicationId
          );
          if (filterWarnings.length > 0) {
            const warningMsg = filterWarnings.join('\n');
            console.warn(`[delegate_query] 筛选参数校验警告:\n${warningMsg}`);
            result.details += `\n\n⚠️ 筛选参数校验:\n${warningMsg}`;
          }

          ctx.dispatch?.({
            type: 'DELEGATE_QUERY_END',
            payload: { requirement: typedArgs.requirement, success: true, details: dbaResponse },
          } as unknown);

          console.log(`[delegate_query] 完成 | 总耗时: ${Date.now() - execStart}ms`);
          return { success: true, message: result.message, data: result };
        } catch (e: unknown) {
          console.error(`[delegate_query] 失败:`, e);
          ctx.dispatch?.({
            type: 'DELEGATE_QUERY_END',
            payload: { requirement: typedArgs.requirement, success: false, error: (e as Error).message },
          } as unknown);
          return { success: false, message: `数据辅助智能体执行失败: ${e.message}`, _noRetry: true };
        } finally {
          activeDelegations.delete(guardKey);
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
流程设计智能体具备独立的流程设计能力，会自行分析需求、搜索成员/角色、设计流程，并输出结果。
task_type 用于限定子智能体只执行对应阶段的任务：design_form 仅设计表单，design_workflow 仅设计/修改流程，不传则表单+流程一起做。`,
      parameters: {
        type: 'object',
        properties: {
          requirement: { type: 'string', description: '流程设计需求描述' },
          task_type: { type: 'string', enum: ['design_form', 'design_workflow'], description: '任务类型（可选）：design_form=仅设计表单；design_workflow=仅设计/修改流程；不传则表单+流程完整执行' },
          context: { type: 'string', description: '相关上下文（页面名称、已有流程、表单 ID 及字段 key 等）' },
        },
        required: ['requirement'],
      },
      async execute(args) {
        const { requirement, context } = args as unknown;
        const taskType = (args as { task_type?: string }).task_type;
        const mode: 'design_form' | 'design_workflow' | 'full'
          = taskType === 'design_form' || taskType === 'design_workflow' ? taskType : 'full';

        if (activeDelegations.has('workflow')) {
          console.warn(`[delegate_workflow] 流程设计助手正在工作中，拒绝重复调用`);
          return { success: false, message: '流程设计助手正在工作中，请等待其完成后再试', _noRetry: true };
        }
        activeDelegations.add('workflow');

        const execStart = Date.now();
        console.log(`[delegate_workflow] 开始委派流程设计任务 | mode=${mode}`);

        ctx.dispatch?.({
          type: 'DELEGATE_WORKFLOW_START',
          payload: { requirement },
        } as unknown);

        try {
          let existingFormsInfo = '';
          try {
            const forms = await formApi.list({ applicationId: ctx.applicationId });
            if (forms && forms.length > 0) {
              existingFormsInfo = `\n## 当前应用已有表单\n${forms.map((f: { id: number; name: string }) => `- ${f.name} (ID: ${f.id})`).join('\n')}\n\n⚠️ 如果已有表单能满足需求，直接用已有表单 ID 绑定，不要重复创建！`;
            }
          } catch {
            // 查询失败不阻塞流程
          }

          const systemPrompt = `你是流程设计专家，负责设计和管理业务流程。你必须调用工具来实际创建表单和流程，禁止只输出文本方案而不调用工具。

当前应用 ID: ${ctx.applicationId}
${existingFormsInfo}
${context ? `上下文信息：${context}` : ''}
${WORKFLOW_ENGINE_SEMANTICS}

${mode === 'design_form' ? DESIGN_FORM_WORKFLOW : mode === 'design_workflow' ? DESIGN_WORKFLOW_ONLY_PROMPT : FULL_WORKFLOW_PROMPT}

## 表单字段类型（design_form 的 fields 中 type 必须使用以下值）
text（单行文本）、number（数字）、date（日期）、datetime（日期时间）、textarea（多行文本）、select（下拉选择）、multi_select（多选下拉）、radio（单选）、checkbox（复选框）、switch（开关）、file（文件上传）、excel（Excel导入）、member（人员选择）、department（部门选择）、detail_table（明细表/子表格）、computed（计算字段）

每个字段格式：{ "key": "字段标识", "label": "字段显示名", "type": "字段类型", "required": true/false }
select/radio 类型需额外提供 options: [{ "label": "选项名", "value": "选项值" }]
detail_table 类型需额外提供 columns 数组，每个子字段同上格式

## 流程节点类型（nodeType 用于后端校验，type 用于前端渲染，两者不同，**都必须传入**）
- start: nodeType: "start", type: "startNode"
- approval: nodeType: "approval", type: "approvalNode"，需设置 approverType（member/role/leader/department_head/form_field/script）
- condition: nodeType: "condition", type: "conditionNode"
- end: nodeType: "end", type: "endNode"

## 审批人类型
- member: 指定人员，需 memberIds 数组（数字ID，来自 search_members 结果）
- role: 指定角色，需 roleIds 数组（数字ID，来自 search_roles 结果）
- leader: 发起人的直属上级，需 leaderOf: "initiator"
- department_head: 发起人所在部门负责人，需 departmentSource: "initiator"
- form_field: 从表单字段获取审批人，需 formFieldKey: "字段key"
- script: 动态脚本，需 script: "代码"

## 每个节点必须包含 nodeId、id、type、nodeType、position: { x, y }、data
- start: nodeId: "start", id: "start", type: "startNode", nodeType: "start", position: { x: 300, y: 50 }
- 各审批节点 y 依次递增 120（如 170, 290, 410），nodeId 和 id 设为 "approval_1"、"approval_2" 等，type: "approvalNode", nodeType: "approval"
- condition: type: "conditionNode", nodeType: "condition"
- end: nodeId: "end", id: "end", type: "endNode", nodeType: "end", position: { x: 300, y: 最后一个节点 y + 120 }

## 每个节点必须包含 data
- start: data: { label: "发起人提交申请", nodeType: "start", config: { nodeName: "发起人提交申请" } }
- approval: data: { label: "直属上级审批", nodeType: "approval", config: { nodeName: "直属上级审批", approverType: "leader", leaderOf: "initiator" } }
- condition: data: { label: "判断预算", nodeType: "condition", config: { nodeName: "预算判断" } }
- end: data: { label: "结束", nodeType: "end", config: { nodeName: "结束" } }

## 连线（edges）
每条连线格式：{ id: "边ID", source: "源节点ID", target: "目标节点ID", type: "smoothstep", markerEnd: { type: "arrowclosed" } }
**条件分支连线必须包含 data 字段**：{ ..., data: { condition: "amount < 5000", label: "小于5000" } }

## 重要规则
- ⚠️ **禁止自行推断流程结构**：必须严格按照用户需求中描述的流程节点和路由逻辑来设计，不要用"常见的请假流程"之类的模板自行替换。用户说"≤3天→直属上级审批，>3天→直属上级→部门经理"，就必须设计条件分支，而不是串行审批。用户需求中没有描述流程结构时，不要自行创建流程，如实汇报缺少的信息
- 禁止只输出设计方案而不调用工具，必须实际创建
- 每个流程必须包含 start 和 end 节点
- 审批节点必须设置审批人
- 已有可复用表单时不要重复创建，直接使用已有表单 ID
- ⚠️ **如实汇报**：完成后汇报实际结果（表单 ID/流程 ID/节点结构）；任何工具调用失败时，必须如实说明失败原因和已尝试的方案，禁止谎报完成`;

          const memoryBefore = getAgentMemory(ctx.applicationId, 'workflow-assistant');
          const executor = await chatRouter!.routeTo('workflow-assistant', `请设计流程：${requirement}`, `wf-${Date.now()}`, {
            systemPrompt,
            isDelegated: true,
            initialMessages: memoryBefore.filter((m: { role: string }) => m.role !== 'system'),
            agentContext: { requirement, context, taskType: mode },
          });

          const messages = executor.getMessages();
          setAgentMemory(ctx.applicationId, 'workflow-assistant', messages);
          const response = messages
            .filter((m: unknown) => m.role === 'assistant')
            .map((m: unknown) => m.content)
            .join('\n\n')
            .trim();

          // 检测子智能体执行过程中的工具失败，失败时不能向主智能体返回成功
          const failedToolMessages = Array.from(new Set(
            messages
              .filter((m: unknown) => (m as { role?: string }).role === 'tool')
              .map((m: unknown) => (m as { content?: string }).content || '')
              .filter((content: string) => !content.includes('已暂停，等待用户确认后继续'))
              .map((content: string) => {
                try {
                  const parsed = JSON.parse(content) as { success?: boolean; message?: string };
                  return parsed.success === false ? (parsed.message || '未知错误') : null;
                } catch {
                  return null;
                }
              })
              .filter((msg): msg is string => !!msg),
          ));

          if (failedToolMessages.length > 0) {
            console.warn(`[delegate_workflow] 子智能体执行中有 ${failedToolMessages.length} 次工具失败 | ${failedToolMessages.join('；')}`);
            ctx.dispatch?.({
              type: 'DELEGATE_WORKFLOW_END',
              payload: { success: false, error: failedToolMessages.join('；'), details: response },
            } as unknown);
            return {
              success: false,
              message: `流程设计智能体执行过程中有工具调用失败，任务可能未完成，请将以下失败信息如实转达用户，禁止标记为已完成：\n${failedToolMessages.map((f) => `- ${f}`).join('\n')}\n\n子智能体最后回复：${response || '（无）'}`,
              data: { response, failures: failedToolMessages },
            };
          }

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
        } finally {
          activeDelegations.delete('workflow');
        }
      },
    };
  },

  'delegate:analysis': () => ({
    id: 'delegate:analysis',
    category: SkillCategory.DELEGATE,
    name: 'delegate_analysis',
    description: '【已废弃】需求分析已由主智能体自行完成，请直接调用 list_pages/list_queries/get_query 探查后输出分析报告，再调用 create_plan',
    parameters: {
      type: 'object',
      properties: {
        requirement: { type: 'string', description: '用户需求描述' },
      },
      required: ['requirement'],
    },
    async execute() {
      return {
        success: false,
        message: 'delegate_analysis 已废弃。需求分析由主智能体自行完成：请调用 list_pages → list_queries → get_query → 输出分析报告 → create_plan 创建计划。',
      };
    },
  }),
};