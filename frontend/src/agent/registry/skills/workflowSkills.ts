import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { formApi, workflowApi, instanceApi, taskApi, orgApi, bindingApi, lintApi } from '@/api/workflow';
import { listRoles, listDepartments } from '@/api/user';

const VALID_NODE_TYPES = ['start', 'approval', 'condition', 'parallel', 'sub_process', 'end', 'cc'];

function validateWorkflowNodes(nodes: unknown[]): string | null {
  if (!nodes || nodes.length === 0) {
    return '节点列表不能为空';
  }

  const errors: string[] = [];

  nodes.forEach((node: unknown, i: number) => {
    const n = node as Record<string, unknown>;
    const prefix = `节点[${i}]`;

    if (!n.nodeType) {
      errors.push(`${prefix}: 缺少 nodeType 字段（如 "start"、"approval"、"condition"、"end"）`);
    } else if (!VALID_NODE_TYPES.includes(n.nodeType as string)) {
      errors.push(`${prefix}: nodeType "${n.nodeType}" 无效，必须是 ${VALID_NODE_TYPES.join('/')} 之一`);
    }

    const expectedType = n.nodeType ? `${n.nodeType}Node` : '';
    if (!n.type) {
      errors.push(`${prefix}: 缺少 type 字段，应为 "${expectedType}"（nodeType + "Node" 后缀）`);
    } else if (expectedType && n.type !== expectedType) {
      errors.push(`${prefix}: type "${n.type}" 不正确，应为 "${expectedType}"`);
    }

    if (!n.position || typeof (n.position as Record<string, unknown>)?.x !== 'number' || typeof (n.position as Record<string, unknown>)?.y !== 'number') {
      errors.push(`${prefix}: 缺少 position 字段，格式为 { x: number, y: number }`);
    }

    if (!n.id) {
      errors.push(`${prefix}: 缺少 id 字段（如 "start"、"approval_1"、"end"），边将通过此 id 连接节点`);
    }

    const data = n.data as Record<string, unknown> | undefined;
    if (!data) {
      errors.push(`${prefix}: 缺少 data 字段`);
    } else {
      if (!data.label) {
        errors.push(`${prefix}: data.label 不能为空，应为节点显示名称`);
      }
      if (!data.nodeType) {
        errors.push(`${prefix}: data.nodeType 不能为空，应与 nodeType 字段一致`);
      }
      const config = data.config as Record<string, unknown> | undefined;
      if (!config) {
        errors.push(`${prefix}: data.config 不能为空`);
      } else if (!config.nodeName) {
        errors.push(`${prefix}: data.config.nodeName 不能为空，应为节点名称`);
      }
    }
  });

  if (errors.length > 0) {
    return `节点格式校验失败，请修正后重试：\n${errors.map((e) => `  - ${e}`).join('\n')}\n\n` +
      `正确格式示例（含所有节点类型）：\n` +
      `"nodes": [\n` +
      `  { "id": "start", "nodeType": "start", "type": "startNode", "position": { "x": 300, "y": 50 }, "data": { "label": "发起人", "nodeType": "start", "config": { "nodeName": "发起人" } } },\n` +
      `  { "id": "approval_1", "nodeType": "approval", "type": "approvalNode", "position": { "x": 300, "y": 170 }, "data": { "label": "部门负责人审批", "nodeType": "approval", "config": { "nodeName": "部门负责人审批", "approverType": "department_head", "departmentSource": "initiator" } } },\n` +
      `  { "id": "end", "nodeType": "end", "type": "endNode", "position": { "x": 300, "y": 290 }, "data": { "label": "结束", "nodeType": "end", "config": { "nodeName": "结束" } } }\n` +
      `]\n` +
      `edges 连线示例：\n` +
      `"edges": [\n` +
      `  { "id": "e1", "source": "start", "target": "approval_1", "type": "smoothstep", "markerEnd": { "type": "arrowclosed", "width": 20, "height": 20 } },\n` +
      `  { "id": "e2", "source": "approval_1", "target": "end", "type": "smoothstep", "markerEnd": { "type": "arrowclosed", "width": 20, "height": 20 } }\n` +
      `]\n` +
      `注意：type = nodeType + "Node"（如 approval → approvalNode，不是 approverNode）`;
  }
  return null;
}

function validateWorkflowEdges(edges: unknown[], nodeIds: Set<string>): string | null {
  if (!edges || edges.length === 0) {
    return '连线列表不能为空';
  }

  const errors: string[] = [];

  edges.forEach((edge: unknown, i: number) => {
    const e = edge as Record<string, unknown>;
    const prefix = `连线[${i}]`;

    if (!e.id || typeof e.id !== 'string') {
      errors.push(`${prefix}: 缺少 id 字段（如 "e1"、"e2"），必须为字符串`);
    }
    if (!e.source || typeof e.source !== 'string') {
      errors.push(`${prefix}: 缺少 source 字段，必须为源节点的 id`);
    } else if (!nodeIds.has(e.source as string)) {
      errors.push(`${prefix}: source "${e.source}" 不存在于节点列表中，请检查节点 id 是否正确`);
    }
    if (!e.target || typeof e.target !== 'string') {
      errors.push(`${prefix}: 缺少 target 字段，必须为目标节点的 id`);
    } else if (!nodeIds.has(e.target as string)) {
      errors.push(`${prefix}: target "${e.target}" 不存在于节点列表中，请检查节点 id 是否正确`);
    }
    if (!e.type || typeof e.type !== 'string') {
      errors.push(`${prefix}: 缺少 type 字段，必须为 "smoothstep"`);
    }
    if (!e.markerEnd || typeof (e.markerEnd as Record<string, unknown>)?.type !== 'string') {
      errors.push(`${prefix}: 缺少 markerEnd 字段，必须为 { "type": "arrowclosed", "width": 20, "height": 20 }`);
    }
  });

  if (errors.length > 0) {
    return `连线格式校验失败，请修正后重试：\n${errors.map((e) => `  - ${e}`).join('\n')}\n\n` +
      `正确连线格式示例：\n` +
      `"edges": [\n` +
      `  { "id": "e1", "source": "start", "target": "approval_1", "type": "smoothstep", "markerEnd": { "type": "arrowclosed", "width": 20, "height": 20 } },\n` +
      `  { "id": "e2", "source": "approval_1", "target": "end", "type": "smoothstep", "markerEnd": { "type": "arrowclosed", "width": 20, "height": 20 } }\n` +
      `]\n` +
      `注意：source 和 target 必须引用节点列表中的 id（如 "start"、"approval_1"、"end"），不能使用节点 label 名称`;
  }
  return null;
}

async function validateNodeConfigReferences(nodes: unknown[]): Promise<string | null> {
  const roleIdSet = new Set<number>();
  const memberIdSet = new Set<number>();
  const departmentIdSet = new Set<number>();

  const collectIds = (ids: unknown, target: Set<number>) => {
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === 'number') target.add(id);
        else if (typeof id === 'string' && !isNaN(Number(id))) target.add(Number(id));
      }
    }
  };

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i] as Record<string, unknown>;
    if (n.nodeType !== 'approval') continue;
    const config = (n.data as Record<string, unknown>)?.config as Record<string, unknown> | undefined;
    if (!config) continue;
    collectIds(config.roleIds, roleIdSet);
    collectIds(config.memberIds, memberIdSet);
    collectIds(config.departmentIds, departmentIdSet);
  }

  if (roleIdSet.size === 0 && memberIdSet.size === 0 && departmentIdSet.size === 0) {
    return null;
  }

  let validRoles = new Set<number>();
  let validMembers = new Set<number>();
  let validDepartments = new Set<number>();

  try {
    const promises: Promise<void>[] = [];

    if (roleIdSet.size > 0) {
      promises.push(
        listRoles().then((res) => {
          validRoles = new Set((res.data || []).map((r: { id: number }) => r.id));
        }),
      );
    }

    if (memberIdSet.size > 0) {
      promises.push(
        orgApi.getMembers().then((members) => {
          validMembers = new Set((members || []).map((m: { id: number }) => m.id));
        }),
      );
    }

    if (departmentIdSet.size > 0) {
      promises.push(
        listDepartments().then((res) => {
          validDepartments = new Set((res.data || []).map((d: { id: number }) => d.id));
        }),
      );
    }

    await Promise.all(promises);
  } catch (e) {
    console.warn('[workflowSkills] 无法验证节点引用，跳过:', e);
    return null;
  }

  const errors: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i] as Record<string, unknown>;
    if (n.nodeType !== 'approval') continue;
    const config = (n.data as Record<string, unknown>)?.config as Record<string, unknown> | undefined;
    if (!config) continue;
    const prefix = `节点[${i}]（${config.nodeName || '审批节点'}）`;

    const validateIds = (ids: unknown, validSet: Set<number>, label: string, searchTool: string) => {
      if (Array.isArray(ids)) {
        for (const id of ids) {
          const numId = typeof id === 'number' ? id : Number(id);
          if (!validSet.has(numId)) {
            errors.push(`${prefix}: ${label} ${id} 不存在，请先使用 ${searchTool} 查询可用项后重新调用 design_workflow`);
          }
        }
      }
    };

    validateIds(config.roleIds, validRoles, '角色 ID', 'search_roles');
    validateIds(config.memberIds, validMembers, '人员 ID', 'search_members');
    validateIds(config.departmentIds, validDepartments, '部门 ID', 'search_departments');
  }

  if (errors.length > 0) {
    return `节点引用校验失败，请修正后重试：\n${errors.map((e) => `  - ${e}`).join('\n')}`;
  }
  return null;
}

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
      } catch (e: unknown) {
        const errMsg = (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
          || (e as Error).message
          || '未知错误';
        return { success: false, message: `表单创建失败：${errMsg}。请检查 fields 格式是否正确（参考系统提示词中的字段类型和格式）。` };
      }
    },
  }),

  'workflow:design': (ctx) => ({
    id: 'workflow:design',
    category: SkillCategory.WORKFLOW,
    name: 'design_workflow',
    description: '创建审批流程。⚠️ 必须在函数调用参数中传入 name/applicationId/nodes/edges，不要只在思考中描述。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '流程名称（如：采购审批流程）', minLength: 1 },
        applicationId: { type: 'number', description: '应用 ID' },
        nodes: { type: 'array', description: '节点列表。每个节点必须有 nodeType/type/position/data 字段', minItems: 1 },
        edges: { type: 'array', description: '连线列表。每条连线必须有 id(字符串)/source/target/type("smoothstep")/markerEnd({"type":"arrowclosed","width":20,"height":20})', minItems: 1 },
      },
      required: ['name', 'applicationId', 'nodes', 'edges'],
    },
    async execute(args) {
      const { name, applicationId, nodes, edges } = args as unknown;
      const description = (args as Record<string, unknown>).description as string | undefined;

      const missing: string[] = [];
      if (!name) missing.push('name（流程名称，如 "采购审批流程"）');
      if (!applicationId) missing.push(`applicationId（当前应用 ID: ${ctx.applicationId || '未知'}）`);
      if (!nodes || !Array.isArray(nodes) || nodes.length === 0) missing.push('nodes（节点数组，至少包含 start 和 end 节点）');
      if (!edges || !Array.isArray(edges) || edges.length === 0) missing.push('edges（连线数组）');

      if (missing.length > 0) {
        return {
          success: false,
          message: `design_workflow 调用失败：工具调用参数为空或缺少必填字段。\n` +
            `缺少的参数：${missing.join('、')}\n` +
            `请在函数调用中传入完整的 JSON 参数，不要只在思考文本中描述。示例：\n` +
            `{ "name": "流程名称", "applicationId": ${ctx.applicationId || 1}, "nodes": [{ "id": "start", "nodeType": "start", "type": "startNode", "position": { "x": 300, "y": 50 }, "data": { "label": "发起人", "nodeType": "start", "config": { "nodeName": "发起人" } } }, { "id": "approval_1", "nodeType": "approval", "type": "approvalNode", "position": { "x": 300, "y": 170 }, "data": { "label": "审批人", "nodeType": "approval", "config": { "nodeName": "审批人", "approverType": "leader", "leaderOf": "initiator" } } }, { "id": "end", "nodeType": "end", "type": "endNode", "position": { "x": 300, "y": 290 }, "data": { "label": "结束", "nodeType": "end", "config": { "nodeName": "结束" } } }], "edges": [{ "id": "e1", "source": "start", "target": "approval_1", "type": "smoothstep", "markerEnd": { "type": "arrowclosed" } }, { "id": "e2", "source": "approval_1", "target": "end", "type": "smoothstep", "markerEnd": { "type": "arrowclosed" } }] }`,
        };
      }

      const appId = (applicationId as number) || ctx.applicationId;
      try {
        const validationError = validateWorkflowNodes((nodes as unknown[]) || []);
        if (validationError) {
          return { success: false, message: validationError };
        }
        const nodeIds = new Set((nodes as unknown[]).map((n: unknown) => (n as Record<string, unknown>).id as string));
        const edgeError = validateWorkflowEdges((edges as unknown[]) || [], nodeIds);
        if (edgeError) {
          return { success: false, message: edgeError };
        }
        const refError = await validateNodeConfigReferences((nodes as unknown[]) || []);
        if (refError) {
          return { success: false, message: refError };
        }
        const result = await workflowApi.createDefinition({
          name, description, applicationId: appId,
          nodes: JSON.stringify(nodes || []), edges: JSON.stringify(edges || []),
        });
        if (ctx.onWorkflowNavigate) ctx.onWorkflowNavigate({ view: 'designer', processId: result.id });
        return { success: true, data: result, message: `流程「${name}」创建成功` };
      } catch (e: unknown) {
        const errMsg = (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
          || (e as Error).message
          || '未知错误';
        return { success: false, message: `创建流程「${name}」失败：${errMsg}。请检查 nodes 和 edges 格式是否正确（参考系统提示词中的节点和连线格式）。` };
      }
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
      } catch (e: unknown) {
        const errMsg = (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
          || (e as Error).message
          || '未知错误';
        return { success: false, message: `流程绑定失败：${errMsg}。请确保 formId 和 processId 正确。` };
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