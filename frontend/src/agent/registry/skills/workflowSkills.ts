import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { formApi, workflowApi, instanceApi, taskApi, orgApi, bindingApi, lintApi } from '@/api/workflow';

export const workflowSkills: Record<string, SkillFactory> = {
  'workflow:design_form': (ctx) => ({
    id: 'workflow:design_form',
    category: SkillCategory.WORKFLOW,
    name: 'design_form',
    description: '设计流程表单。创建或修改表单字段配置。',
    parameters: {
      type: 'object',
      properties: {
        formId: { type: 'number', description: '表单 ID（修改时提供）' },
        name: { type: 'string', description: '表单名称' },
        fields: { type: 'array', description: '表单字段列表' },
      },
      required: ['name'],
    },
    async execute(args) {
      try {
        const result = await formApi.create({
          name: args.name as string,
          applicationId: (args.applicationId as number) || ctx.applicationId,
          fields: JSON.stringify((args.fields as unknown[]) || []),
        });
        if (ctx.onWorkflowNavigate) ctx.onWorkflowNavigate({ view: 'designer', formMode: true, formId: result.id });
        return { success: true, message: '表单创建成功', data: result };
      } catch {
        return { success: false, message: `表单创建失败: ${(e as Error).message}` };
      }
    },
  }),

  'workflow:design': (ctx) => ({
    id: 'workflow:design',
    category: SkillCategory.WORKFLOW,
    name: 'design_workflow',
    description: `设计一个业务流程。指定流程名称、节点配置和连线关系。

## 每个节点（nodes[i]）必须包含的字段
- nodeId: 节点唯一标识（如 start、approval_1、end）
- id: 节点唯一标识（与 nodeId 相同，如 start、approval_1、end）
- nodeType: 节点类型（start/approval/condition/parallel/sub_process/end，不加 "Node" 后缀，用于后端校验）
- type: 节点类型（startNode/approvalNode/conditionNode/parallelNode/sub_processNode/endNode，加 "Node" 后缀，用于前端渲染）
- position: { x: number, y: number } 节点在画布上的位置（必填）
- data: { label: 显示名称, nodeType: 节点类型（同 nodeType 字段值）, config: 配置对象 }

## 节点类型
start（开始）、approval（审批）、condition（条件分支）、parallel（并行）、sub_process（子流程）、end（结束）

## 审批人类型
member（指定人员）、role（指定角色）、department_head（部门负责人）、leader（直属上级）

## 审批模式
all_pass（会签）、any_pass（或签）、ratio_pass（按比例）、sequential（依次审批）`,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '流程名称' },
        description: { type: 'string', description: '流程描述' },
        applicationId: { type: 'number', description: '应用 ID' },
        nodes: { type: 'array', description: '节点配置列表' },
        edges: { type: 'array', description: '连线列表' },
      },
      required: ['name', 'applicationId'],
    },
    async execute(args) {
      const { name, description, applicationId, nodes, edges } = args as unknown;
      const result = await workflowApi.createDefinition({
        name, description, applicationId,
        nodes: JSON.stringify(nodes || []), edges: JSON.stringify(edges || []),
      });
      if (ctx.onWorkflowNavigate) ctx.onWorkflowNavigate({ view: 'designer', processId: result.id });
      return { success: true, data: result, message: `流程「${name}」创建成功` };
    },
  }),

  'workflow:bind': (ctx) => ({
    id: 'workflow:bind',
    category: SkillCategory.WORKFLOW,
    name: 'bind_workflow',
    description: '将流程绑定到页面。',
    parameters: {
      type: 'object',
      properties: { processId: { type: 'number', description: '流程 ID' }, formId: { type: 'number', description: '表单 ID' } },
      required: ['processId', 'formId'],
    },
    async execute(args) {
      try {
        await bindingApi.bind({ formId: args.formId as number, workflowId: args.processId as number });
        return { success: true, message: '流程绑定成功' };
      } catch {
        return { success: false, message: `流程绑定失败: ${(e as Error).message}` };
      }
    },
  }),

  'workflow:search_members': (ctx) => ({
    id: 'workflow:search_members',
    category: SkillCategory.WORKFLOW,
    name: 'search_members',
    description: '搜索组织成员。',
    parameters: {
      type: 'object',
      properties: { keyword: { type: 'string', description: '搜索关键词' }, appId: { type: 'number', description: '应用 ID' } },
      required: ['keyword'],
    },
    async execute(args) {
      try {
        const result = await orgApi.getMembers({ keyword: args.keyword as string });
        return { success: true, message: `找到 ${result.length} 个成员`, data: result };
      } catch {
        return { success: false, message: `搜索成员失败: ${(e as Error).message}` };
      }
    },
  }),

  'workflow:search_roles': (ctx) => ({
    id: 'workflow:search_roles',
    category: SkillCategory.WORKFLOW,
    name: 'search_roles',
    description: '搜索组织角色。',
    parameters: {
      type: 'object',
      properties: { keyword: { type: 'string', description: '搜索关键词' }, appId: { type: 'number', description: '应用 ID' } },
      required: ['keyword'],
    },
    async execute(args) {
      try {
        const result = await orgApi.getRoles((args.appId as number) || ctx.applicationId);
        return { success: true, message: `找到 ${result.length} 个角色`, data: result };
      } catch {
        return { success: false, message: `搜索角色失败: ${(e as Error).message}` };
      }
    },
  }),

  'workflow:search_departments': (ctx) => ({
    id: 'workflow:search_departments',
    category: SkillCategory.WORKFLOW,
    name: 'search_departments',
    description: '搜索组织部门。',
    parameters: {
      type: 'object',
      properties: { keyword: { type: 'string', description: '搜索关键词' }, appId: { type: 'number', description: '应用 ID' } },
      required: ['keyword'],
    },
    async execute(_args) {
      try {
        const result = await orgApi.getDepartments();
        return { success: true, message: `找到 ${result.length} 个部门`, data: result };
      } catch {
        return { success: false, message: `搜索部门失败: ${(e as Error).message}` };
      }
    },
  }),

  'workflow:list_instances': (ctx) => ({
    id: 'workflow:list_instances',
    category: SkillCategory.WORKFLOW,
    name: 'list_workflow_instances',
    description: '列出当前应用的流程实例。',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string', description: '按状态筛选' } },
    },
    async execute(args) {
      try {
        const result = await instanceApi.list({ status: args.status as string | undefined });
        return { success: true, message: `共 ${result.length} 个流程实例`, data: result };
      } catch {
        return { success: false, message: `获取流程实例失败: ${(e as Error).message}` };
      }
    },
  }),

  'workflow:approve': (ctx) => ({
    id: 'workflow:approve',
    category: SkillCategory.WORKFLOW,
    name: 'approve_workflow',
    description: '审批通过。',
    parameters: {
      type: 'object',
      properties: { taskId: { type: 'number', description: '任务 ID' }, comment: { type: 'string', description: '审批意见' } },
      required: ['taskId'],
    },
    async execute(args) {
      try { await taskApi.approve(args.taskId as number, (args.comment as string) || ''); return { success: true, message: '审批通过' }; }
      catch { return { success: false, message: `审批失败: ${(e as Error).message}` }; }
    },
  }),

  'workflow:reject': (ctx) => ({
    id: 'workflow:reject',
    category: SkillCategory.WORKFLOW,
    name: 'reject_workflow',
    description: '审批拒绝。',
    parameters: {
      type: 'object',
      properties: { taskId: { type: 'number', description: '任务 ID' }, comment: { type: 'string', description: '拒绝原因' } },
      required: ['taskId'],
    },
    async execute(args) {
      try { await taskApi.reject(args.taskId as number, (args.comment as string) || ''); return { success: true, message: '已拒绝' }; }
      catch { return { success: false, message: `拒绝失败: ${(e as Error).message}` }; }
    },
  }),

  'workflow:freeze': (ctx) => ({
    id: 'workflow:freeze',
    category: SkillCategory.WORKFLOW,
    name: 'freeze_workflow',
    description: '冻结流程定义。',
    parameters: {
      type: 'object',
      properties: { processId: { type: 'number', description: '流程 ID' } },
      required: ['processId'],
    },
    async execute(args) {
      try { await instanceApi.freeze(args.processId as number); return { success: true, message: '流程已冻结' }; }
      catch { return { success: false, message: `冻结失败: ${(e as Error).message}` }; }
    },
  }),

  'workflow:unfreeze': (ctx) => ({
    id: 'workflow:unfreeze',
    category: SkillCategory.WORKFLOW,
    name: 'unfreeze_workflow',
    description: '解冻流程定义。',
    parameters: {
      type: 'object',
      properties: { processId: { type: 'number', description: '流程 ID' } },
      required: ['processId'],
    },
    async execute(args) {
      try { await instanceApi.unfreeze(args.processId as number); return { success: true, message: '流程已解冻' }; }
      catch { return { success: false, message: `解冻失败: ${(e as Error).message}` }; }
    },
  }),

  'workflow:cancel': (ctx) => ({
    id: 'workflow:cancel',
    category: SkillCategory.WORKFLOW,
    name: 'cancel_workflow',
    description: '取消流程实例。',
    parameters: {
      type: 'object',
      properties: { instanceId: { type: 'number', description: '实例 ID' } },
      required: ['instanceId'],
    },
    async execute(args) {
      try { await instanceApi.cancel(args.instanceId as number); return { success: true, message: '流程已取消' }; }
      catch { return { success: false, message: `取消失败: ${(e as Error).message}` }; }
    },
  }),

  'workflow:lint': (ctx) => ({
    id: 'workflow:lint',
    category: SkillCategory.WORKFLOW,
    name: 'lint_workflow',
    description: '检查流程设计是否规范，返回问题列表。',
    parameters: {
      type: 'object',
      properties: { processId: { type: 'number', description: '流程 ID' } },
      required: ['processId'],
    },
    async execute(args) {
      try {
        const def = await workflowApi.getDefinition(args.processId as number);
        const result = await lintApi.lintWorkflow(def.nodes || '', def.edges || '', '');
        const { passed, errors, warnings, errorCount, warningCount } = result as unknown;
        const parts: string[] = [];
        if (passed) {
          parts.push('流程检查通过');
        } else {
          parts.push(`流程检查不通过：${errorCount} 个错误`);
          if (errors?.length) {
            parts.push(...errors.map((e: unknown) => `- [${e.category}] ${e.message}`));
          }
        }
        if (warningCount && warnings?.length) {
          parts.push(`${warningCount} 个警告：`);
          parts.push(...warnings.map((w: unknown) => `- [${w.category}] ${w.message}`));
        }
        return { success: true, message: parts.join('\n'), data: result };
      }
      catch { return { success: false, message: `检查失败: ${(e as Error).message}` }; }
    },
  }),

  'workflow:copy': (ctx) => ({
    id: 'workflow:copy',
    category: SkillCategory.WORKFLOW,
    name: 'copy_workflow',
    description: '复制现有流程。',
    parameters: {
      type: 'object',
      properties: { processId: { type: 'number', description: '源流程 ID' }, newName: { type: 'string', description: '新流程名称' } },
      required: ['processId'],
    },
    async execute(args) {
      try {
        const result = await workflowApi.copyDefinition(args.processId as number);
        return { success: true, message: '流程复制成功', data: result };
      } catch { return { success: false, message: `复制失败: ${(e as Error).message}` }; }
    },
  }),

  'workflow:preview': (ctx) => ({
    id: 'workflow:preview',
    category: SkillCategory.WORKFLOW,
    name: 'preview_workflow',
    description: '预览流程定义。',
    parameters: {
      type: 'object',
      properties: { processId: { type: 'number', description: '流程 ID' } },
      required: ['processId'],
    },
    async execute(args) {
      if (ctx.onWorkflowNavigate) ctx.onWorkflowNavigate({ view: 'designer', processId: args.processId as number });
      return { success: true, message: '已导航到流程设计器' };
    },
  }),
};