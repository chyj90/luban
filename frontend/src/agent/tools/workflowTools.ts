import type { ToolDefinition, ToolContext } from '@/types/agent';
import { formApi, workflowApi, instanceApi, taskApi, adminApi, orgApi, bindingApi, lintApi } from '@/api/workflow';

export function createWorkflowTools(context: ToolContext): ToolDefinition[] {
  return [
    {
      name: 'design_workflow',
      description: `设计一个业务流程。指定流程名称、节点配置和连线关系。

## 节点类型
- start: 开始节点（发起人）— 每个流程必须有一个
- approval: 审批节点 — 设置审批人
- condition: 条件分支 — 按条件分流
- parallel: 并行分支 — 多路并行处理
- sub_process: 子流程 — 嵌套另一个流程
- end: 结束节点 — 每个流程必须有一个

## 审批人类型（approval 节点）
- member: 指定具体人员，memberIds: ["user_id_1", "user_id_2"]
- role: 指定角色，roleIds: ["role_slug_1"]
- department_head: 部门负责人，departmentSource: "initiator" | "specified" | "form_field"
- leader: 直属上级，leaderOf: "initiator" | "specified" | "form_field"
- form_field: 从表单字段获取，formFieldKey: "字段key"
- script: 动态脚本，script: "Groovy 代码"

## 审批模式（collaborationMode）
- all_pass: 会签（所有人都要同意）
- any_pass: 或签（任一人同意即可）
- ratio_pass: 按比例通过（需设置 approvalRatio）
- sequential: 依次审批（按顺序逐个审批）

## 示例
请假流程：发起人 → 直属上级审批(leader) → 部门负责人审批(department_head) → 结束
报销流程：发起人 → 条件分支(金额<1000→财务审批, 金额>=1000→财务审批+高管审批) → 结束`,
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '流程名称' },
          description: { type: 'string', description: '流程描述' },
          applicationId: { type: 'number', description: '应用 ID' },
          nodes: {
            type: 'array',
            description: '节点配置列表',
            items: {
              type: 'object',
              properties: {
                nodeId: { type: 'string', description: '节点唯一标识' },
                nodeType: { type: 'string', enum: ['start', 'approval', 'condition', 'parallel', 'sub_process', 'end'] },
                nodeName: { type: 'string', description: '节点显示名称' },
                position: {
                  type: 'object',
                  properties: {
                    x: { type: 'number' },
                    y: { type: 'number' },
                  },
                },
                config: {
                  type: 'object',
                  description: '节点配置',
                  properties: {
                    approverType: { type: 'string', enum: ['member', 'role', 'department_head', 'leader', 'form_field', 'script'] },
                    approverIds: { type: 'array', items: { type: 'string' } },
                    collaborationMode: { type: 'string', enum: ['all_pass', 'any_pass', 'ratio_pass', 'sequential'] },
                    priority: { type: 'number' },
                  },
                },
              },
            },
          },
          edges: {
            type: 'array',
            description: '连线列表',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                source: { type: 'string' },
                target: { type: 'string' },
                label: { type: 'string' },
                condition: { type: 'string' },
              },
            },
          },
        },
        required: ['name', 'applicationId'],
      },
      handler: async (params) => {
        const { name, description, applicationId, nodes, edges } = params;
        const result = await workflowApi.createDefinition({
          name,
          description,
          applicationId,
          nodes: JSON.stringify(nodes || []),
          edges: JSON.stringify(edges || []),
        });
        if (context.onWorkflowNavigate) {
          context.onWorkflowNavigate({ view: 'designer', processId: result.id });
        }
        return { success: true, data: result };
      },
    },
    {
      name: 'design_form',
      description: `设计一个表单。指定表单名称、字段列表。

## 字段类型
- text: 单行文本
- number: 数字
- textarea: 多行文本
- select: 下拉选择（需提供 options）
- date: 日期选择
- file: 附件上传
- excel: Excel 上传解析

## 示例
请假表单：[{ key: "leave_type", type: "select", label: "请假类型", required: true, options: [{value:"annual",label:"年假"},{value:"sick",label:"病假"}] }, { key: "start_date", type: "date", label: "开始日期", required: true }, { key: "end_date", type: "date", label: "结束日期", required: true }, { key: "reason", type: "textarea", label: "请假原因" }]`,
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '表单名称' },
          description: { type: 'string', description: '表单描述' },
          applicationId: { type: 'number', description: '应用 ID' },
          fields: {
            type: 'array',
            description: '字段列表',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string', description: '字段唯一标识' },
                type: { type: 'string', enum: ['text', 'number', 'textarea', 'select', 'date', 'file', 'excel'] },
                label: { type: 'string', description: '字段标签' },
                required: { type: 'boolean', description: '是否必填' },
                placeholder: { type: 'string', description: '占位提示' },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      value: { type: 'string' },
                      label: { type: 'string' },
                    },
                  },
                },
              },
              required: ['key', 'type', 'label'],
            },
          },
        },
        required: ['name', 'applicationId', 'fields'],
      },
      handler: async (params) => {
        const { name, description, applicationId, fields } = params;
        const result = await formApi.create({
          name,
          description,
          applicationId,
          fields: JSON.stringify(fields),
        });
        if (context.onWorkflowNavigate) {
          context.onWorkflowNavigate({ view: 'designer', formMode: true, formId: result.id });
        }
        return { success: true, data: result };
      },
    },
    {
      name: 'search_members',
      description: '搜索组织成员，可按部门或关键词搜索',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          departmentId: { type: 'number', description: '部门 ID' },
          keyword: { type: 'string', description: '搜索关键词' },
        },
      },
      handler: async (params) => {
        const { departmentId, keyword } = params;
        const members = await orgApi.getMembers({ departmentId, keyword });
        return { success: true, data: members };
      },
    },
    {
      name: 'search_departments',
      description: '搜索组织架构',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          parentId: { type: 'number', description: '父部门 ID' },
        },
      },
      handler: async (params) => {
        const { parentId } = params;
        const departments = await orgApi.getDepartments(parentId);
        return { success: true, data: departments };
      },
    },
    {
      name: 'search_roles',
      description: '搜索应用角色',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        const roles = await orgApi.getRoles(context.applicationId);
        return { success: true, data: roles };
      },
    },
    {
      name: 'list_pending_tasks',
      description: '查询当前用户的待审批任务',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      handler: async () => {
        const tasks = await taskApi.list({ status: 'PENDING' });
        return { success: true, data: tasks };
      },
    },
    {
      name: 'approve_task',
      description: '审批通过一个任务',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'number', description: '任务 ID' },
          comment: { type: 'string', description: '审批意见' },
        },
        required: ['taskId'],
      },
      handler: async (params) => {
        const { taskId, comment } = params;
        const result = await taskApi.approve(taskId, comment || '');
        return { success: true, data: result };
      },
    },
    {
      name: 'reject_task',
      description: '驳回一个任务',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'number', description: '任务 ID' },
          comment: { type: 'string', description: '驳回原因' },
        },
        required: ['taskId'],
      },
      handler: async (params) => {
        const { taskId, comment } = params;
        const result = await taskApi.reject(taskId, comment || '');
        return { success: true, data: result };
      },
    },
    {
      name: 'add_sign',
      description: '加签操作。前加签(BEFORE)：加签人先审批，原审批人最后审批。后加签(AFTER)：当前人处理完后，加签人再审批。',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'number', description: '任务 ID' },
          addUserId: { type: 'number', description: '加签人 ID' },
          addSignType: { type: 'string', enum: ['BEFORE', 'AFTER'], description: '加签类型' },
          comment: { type: 'string', description: '加签说明' },
        },
        required: ['taskId', 'addUserId', 'addSignType'],
      },
      handler: async (params) => {
        const { taskId, addUserId, addSignType, comment } = params;
        const result = await taskApi.addSign(taskId, addUserId, addSignType, comment || '');
        return { success: true, data: result };
      },
    },
    {
      name: 'delegate_task',
      description: '委派任务给其他人处理',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'number', description: '任务 ID' },
          delegateUserId: { type: 'number', description: '委派目标人 ID' },
          comment: { type: 'string', description: '委派说明' },
        },
        required: ['taskId', 'delegateUserId'],
      },
      handler: async (params) => {
        const { taskId, delegateUserId, comment } = params;
        const result = await taskApi.delegate(taskId, delegateUserId, comment || '');
        return { success: true, data: result };
      },
    },
    {
      name: 'reject_to_node',
      description: '驳回至指定历史节点',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          instanceId: { type: 'number', description: '流程实例 ID' },
          targetNodeId: { type: 'string', description: '目标节点 ID' },
          comment: { type: 'string', description: '驳回说明' },
        },
        required: ['instanceId', 'targetNodeId'],
      },
      handler: async (params) => {
        const { instanceId, targetNodeId, comment } = params;
        await instanceApi.rejectTo(instanceId, targetNodeId, comment || '');
        return { success: true };
      },
    },
    {
      name: 'reject_to_previous',
      description: '逐级驳回：只能退回上一级处理人，不能越级退回',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'number', description: '任务 ID' },
          comment: { type: 'string', description: '驳回说明' },
        },
        required: ['taskId'],
      },
      handler: async (params) => {
        const { taskId, comment } = params;
        const result = await taskApi.rejectToPrevious(taskId, comment || '');
        return { success: true, data: result };
      },
    },
    {
      name: 'resubmit_instance',
      description: '驳回后重新提交：修改表单数据后重新提交流程',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          instanceId: { type: 'number', description: '流程实例 ID' },
          formData: { type: 'string', description: '修改后的表单数据 JSON' },
        },
        required: ['instanceId', 'formData'],
      },
      handler: async (params) => {
        const { instanceId, formData } = params;
        const result = await instanceApi.resubmit(instanceId, formData);
        return { success: true, data: result };
      },
    },
    {
      name: 'force_jump',
      description: '管理员强制跳转流程到指定节点',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          instanceId: { type: 'number', description: '流程实例 ID' },
          targetNodeId: { type: 'string', description: '目标节点 ID' },
          comment: { type: 'string', description: '跳转说明' },
        },
        required: ['instanceId', 'targetNodeId'],
      },
      handler: async (params) => {
        const { instanceId, targetNodeId, comment } = params;
        await instanceApi.forceJump(instanceId, targetNodeId, comment || '');
        return { success: true };
      },
    },
    {
      name: 'bind_form_workflow',
      description: '绑定表单与工作流',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'number', description: '表单 ID' },
          workflowId: { type: 'number', description: '工作流定义 ID' },
          workflowVersion: { type: 'number', description: '工作流版本（选填）' },
          bindingType: { type: 'string', enum: ['ONE_TO_ONE', 'ONE_TO_MANY'], description: '绑定类型' },
          isDefault: { type: 'boolean', description: '是否设为默认' },
        },
        required: ['formId', 'workflowId'],
      },
      handler: async (params) => {
        const { formId, workflowId, workflowVersion, bindingType, isDefault } = params;
        const result = await bindingApi.bind({ formId, workflowId, workflowVersion, bindingType, isDefault });
        return { success: true, data: result };
      },
    },
    {
      name: 'get_sub_processes',
      description: '获取子流程实例列表',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          instanceId: { type: 'number', description: '父流程实例 ID' },
        },
        required: ['instanceId'],
      },
      handler: async (params) => {
        const { instanceId } = params;
        const result = await instanceApi.getSubProcesses(instanceId);
        return { success: true, data: result };
      },
    },
    {
      name: 'freeze_instance',
      description: '冻结流程实例',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          instanceId: { type: 'number', description: '流程实例 ID' },
        },
        required: ['instanceId'],
      },
      handler: async (params) => {
        const { instanceId } = params;
        await instanceApi.freeze(instanceId);
        return { success: true };
      },
    },
    {
      name: 'unfreeze_instance',
      description: '解冻流程实例',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          instanceId: { type: 'number', description: '流程实例 ID' },
        },
        required: ['instanceId'],
      },
      handler: async (params) => {
        const { instanceId } = params;
        await instanceApi.unfreeze(instanceId);
        return { success: true };
      },
    },
    {
      name: 'cancel_instance',
      description: '取消/撤回流程实例',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          instanceId: { type: 'number', description: '流程实例 ID' },
        },
        required: ['instanceId'],
      },
      handler: async (params) => {
        const { instanceId } = params;
        await instanceApi.cancel(instanceId);
        return { success: true };
      },
    },
    {
      name: 'force_stop',
      description: '管理员强制终止流程',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          instanceId: { type: 'number', description: '流程实例 ID' },
          comment: { type: 'string', description: '终止原因' },
        },
        required: ['instanceId'],
      },
      handler: async (params) => {
        const { instanceId, comment } = params;
        await adminApi.forceStop(instanceId, comment || '');
        return { success: true };
      },
    },
    {
      name: 'force_withdraw',
      description: '管理员强制撤回已完成的流程',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          instanceId: { type: 'number', description: '流程实例 ID' },
          comment: { type: 'string', description: '撤回原因' },
        },
        required: ['instanceId'],
      },
      handler: async (params) => {
        const { instanceId, comment } = params;
        await adminApi.forceWithdraw(instanceId, comment || '');
        return { success: true };
      },
    },
    {
      name: 'reassign_task',
      description: '管理员修改任务处理人',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'number', description: '任务 ID' },
          newAssigneeId: { type: 'number', description: '新处理人 ID' },
          comment: { type: 'string', description: '修改说明' },
        },
        required: ['taskId', 'newAssigneeId'],
      },
      handler: async (params) => {
        const { taskId, newAssigneeId, comment } = params;
        const result = await adminApi.reassignTask(taskId, newAssigneeId, comment || '');
        return { success: true, data: result };
      },
    },
    {
      name: 'copy_workflow',
      description: '复制流程定义',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'number', description: '流程定义 ID' },
        },
        required: ['workflowId'],
      },
      handler: async (params) => {
        const result = await workflowApi.copyDefinition(params.workflowId);
        return { success: true, data: result };
      },
    },
    {
      name: 'validate_workflow',
      description: '验证流程定义是否合法',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'number', description: '流程定义 ID' },
        },
        required: ['workflowId'],
      },
      handler: async (params) => {
        const result = await workflowApi.validateDefinition(params.workflowId);
        return { success: true, data: result };
      },
    },
    {
      name: 'get_workflow_versions',
      description: '获取流程定义的所有版本',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'number', description: '流程定义 ID' },
        },
        required: ['workflowId'],
      },
      handler: async (params) => {
        const result = await workflowApi.getVersions(params.workflowId);
        return { success: true, data: result };
      },
    },
    {
      name: 'copy_form',
      description: '复制表单定义',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'number', description: '表单 ID' },
        },
        required: ['formId'],
      },
      handler: async (params) => {
        const result = await formApi.copy(params.formId);
        return { success: true, data: result };
      },
    },
    {
      name: 'preview_form',
      description: '预览表单',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'number', description: '表单 ID' },
        },
        required: ['formId'],
      },
      handler: async (params) => {
        const result = await formApi.preview(params.formId);
        return { success: true, data: result };
      },
    },
    {
      name: 'lint_form_code',
      description: 'Lint 校验表单代码（HTML/CSS/JS），检查语法错误、规范违规等。大模型生成的代码必须经过此校验。',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          html: { type: 'string', description: 'HTML 代码' },
          css: { type: 'string', description: 'CSS 代码' },
          js: { type: 'string', description: 'JS 代码' },
        },
        required: [],
      },
      handler: async (params) => {
        const { html, css, js } = params;
        const result = await lintApi.lintFormCode(html || '', css || '', js || '');
        return { success: true, data: result };
      },
    },
    {
      name: 'lint_field_schema',
      description: 'Lint 校验表单字段 JSON Schema，检查格式正确性、字段 key 唯一性等。',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          fields: { type: 'string', description: '字段 JSON 字符串' },
        },
        required: ['fields'],
      },
      handler: async (params) => {
        const result = await lintApi.lintFieldSchema(params.fields);
        return { success: true, data: result };
      },
    },
    {
      name: 'lint_workflow',
      description: 'Lint 校验流程定义（nodes/edges JSON），检查节点合法性、连线完整性、孤立节点等。',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          nodes: { type: 'string', description: '节点 JSON 字符串' },
          edges: { type: 'string', description: '边 JSON 字符串' },
          fields: { type: 'string', description: '表单字段 JSON 字符串（用于条件表达式校验）' },
        },
        required: ['nodes', 'edges'],
      },
      handler: async (params) => {
        const { nodes, edges, fields } = params;
        const result = await lintApi.lintWorkflow(nodes, edges, fields || '[]');
        return { success: true, data: result };
      },
    },
    {
      name: 'lint_condition',
      description: 'Lint 校验条件表达式，检查语法正确性和引用字段存在性。',
      category: 'workflow',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: '条件表达式，如 "data.amount > 1000"' },
          fields: { type: 'string', description: '表单字段 JSON 字符串' },
        },
        required: ['expression', 'fields'],
      },
      handler: async (params) => {
        const { expression, fields } = params;
        const result = await lintApi.lintCondition(expression, fields);
        return { success: true, data: result };
      },
    },
  ];
}