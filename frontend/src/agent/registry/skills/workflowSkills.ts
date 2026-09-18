import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { formApi, workflowApi, instanceApi, taskApi, orgApi, bindingApi, lintApi, observabilityApi } from '@/api/workflow';
import type { WorkflowDefinition } from '@/types/workflow';
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

/**
 * 校验并序列化流程图。后端 WorkflowDefinition 的 nodes/edges 是 TEXT 列存 JSON 字符串
 * （实体字段为 String，直接传数组会 Jackson 400），所有工具在发请求前统一走这里：
 * 数组 → 校验节点/连线/引用 → 序列化为字符串。
 */
async function validateAndSerializeWorkflowGraph(
  rawNodes: unknown,
  rawEdges: unknown,
): Promise<{ nodes: string; edges: string } | { error: string }> {
  const toGraph = (v: unknown): unknown[] | null => {
    if (Array.isArray(v)) return v;
    // 模型偶发无视 schema 传 JSON 字符串：能解析成数组就收下，避免被 JSON.stringify 二次编码写脏库
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v);
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  };

  const nodes = toGraph(rawNodes);
  const edges = toGraph(rawEdges);
  if (!nodes || !edges) {
    return { error: 'nodes 和 edges 必须是数组（节点列表/连线列表），不能是对象、字符串或其它类型' };
  }
  const nodeError = validateWorkflowNodes(nodes);
  if (nodeError) {
    return { error: nodeError };
  }
  const nodeIds = new Set(nodes.map((n) => (n as Record<string, unknown>).id as string));
  const edgeError = validateWorkflowEdges(edges, nodeIds);
  if (edgeError) {
    return { error: edgeError };
  }
  const refError = await validateNodeConfigReferences(nodes);
  if (refError) {
    return { error: refError };
  }
  return { nodes: JSON.stringify(nodes), edges: JSON.stringify(edges) };
}

export const workflowSkills: Record<string, SkillFactory> = {
  'workflow:design_form': (ctx) => ({
    id: 'workflow:design_form',
    category: SkillCategory.WORKFLOW,
    name: 'design_form',
    description: '设计流程表单。三种用法：只传 formId 查看表单已有字段（只读）；formId+fields 修改该表单（fields 整体覆盖）；都不传则新建表单。',
    parameters: {
      type: 'object',
      properties: {
        formId: { type: 'number', description: '表单 ID：查看时单独传；修改时与 fields 一起传；新建时不传' },
        name: { type: 'string', description: '表单名称（新建必填；修改时可选，不传保持原名）' },
        fields: { type: 'array', description: '表单字段列表（修改时必须传修改后的完整字段列表，整体覆盖原字段）' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const formId = args.formId as number | undefined;
        const fields = args.fields as unknown[] | undefined;
        if (formId && (!fields || fields.length === 0)) {
          const existing = await formApi.get(formId);
          const fieldList = existing.fields
            ? (typeof existing.fields === 'string' ? JSON.parse(existing.fields) : existing.fields)
            : [];
          return {
            success: true,
            message: `表单「${existing.name}」(ID: ${formId}) 已有字段：${fieldList.map((f: { key: string; label: string; type: string; required?: boolean }) => `${f.label}(${f.key}, ${f.type}${f.required ? ', 必填' : ''})`).join('；')}。如需修改请带 formId + 完整 fields 重新调用本工具`,
            data: existing,
          };
        }
        if (formId) {
          // 修改已有表单：先取现有定义合并，后端 update 会用入参直接覆盖
          // name/description/codePageId，不回读会把未传字段清成 null
          const existing = await formApi.get(formId);
          const result = await formApi.update(formId, {
            name: (args.name as string) || existing.name,
            description: existing.description,
            applicationId: existing.applicationId,
            codePageId: existing.codePageId,
            fields: JSON.stringify(fields),
          });
          if (ctx.onWorkflowNavigate) ctx.onWorkflowNavigate({ view: 'designer', formMode: true, formId: result.id });
          return { success: true, message: `表单「${result.name}」(ID: ${formId}) 已更新，共 ${(fields as unknown[]).length} 个字段`, data: result };
        }
        if (!args.name) {
          return { success: false, message: '新建表单必须提供 name（表单名称）。修改已有表单请传 formId + fields。' };
        }
        const result = await formApi.create({
          name: args.name as string,
          applicationId: (args.applicationId as number) || ctx.applicationId,
          fields: JSON.stringify((args.fields as unknown[]) || []),
        });
        if (ctx.onWorkflowNavigate) ctx.onWorkflowNavigate({ view: 'designer', formMode: true, formId: result.id });
        return { success: true, message: `表单创建成功 (ID: ${result.id})`, data: result };
      } catch (e: unknown) {
        const errMsg = (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
          || (e as Error).message
          || '未知错误';
        return { success: false, message: `表单保存失败：${errMsg}。请检查 fields 格式是否正确（参考系统提示词中的字段类型和格式）。` };
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
      const { name, applicationId, nodes, edges } = args as { name: string; applicationId: number; nodes: unknown[]; edges: unknown[] };
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
        const graph = await validateAndSerializeWorkflowGraph(nodes, edges);
        if ('error' in graph) {
          return { success: false, message: graph.error };
        }
        const result = await workflowApi.createDefinition({
          name, description, applicationId: appId,
          nodes: graph.nodes, edges: graph.edges,
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

  'workflow:get_definition': () => ({
    id: 'workflow:get_definition',
    category: SkillCategory.WORKFLOW,
    name: 'get_definition',
    description: '查看流程定义的完整节点和连线结构。修改已有流程前必须先调用本工具获取现有结构，再基于它调用 update_workflow。',
    parameters: {
      type: 'object',
      properties: { processId: { type: 'number', description: '流程 ID' } },
      required: ['processId'],
    },
    async execute(args) {
      try {
        const def = await workflowApi.getDefinition(args.processId as number);
        const parse = (v: unknown) => {
          if (typeof v !== 'string') return v;
          try { return JSON.parse(v); } catch { return v; }
        };
        const nodes = parse(def.nodes) as Array<Record<string, unknown>> | unknown;
        const edges = parse(def.edges) as Array<Record<string, unknown>> | unknown;

        const parts: string[] = [`流程「${def.name}」(ID: ${def.id}) 当前结构：`];
        if (Array.isArray(nodes)) {
          parts.push('节点：');
          for (const n of nodes) {
            const data = n.data as Record<string, unknown> | undefined;
            const config = data?.config as Record<string, unknown> | undefined;
            const label = (data?.label as string) || (config?.nodeName as string) || (n.id as string);
            let extra = '';
            if (config && typeof config === 'object') {
              const configParts = Object.entries(config)
                .filter(([k]) => k !== 'nodeName')
                .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
              if (configParts.length > 0) extra = `（${configParts.join(', ')}）`;
            }
            parts.push(`  - ${n.id} [${n.nodeType}] ${label}${extra}`);
          }
        }
        if (Array.isArray(edges)) {
          parts.push('连线：');
          for (const e of edges) {
            const cond = (e.data as Record<string, unknown> | undefined)?.condition;
            parts.push(`  - ${e.source} → ${e.target}${cond ? ` [条件: ${cond}]` : ''}`);
          }
        }
        parts.push('修改此流程时，请基于以上结构调用 update_workflow(processId, nodes, edges)，传入修改后的完整节点和连线。');
        return {
          success: true,
          message: parts.join('\n'),
          data: { ...def, nodes, edges },
        };
      } catch (e: unknown) {
        const errMsg = (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
          || (e as Error).message
          || '未知错误';
        // 404 在进 controller 前由 AppAccess 拦截器判定，语义就是"流程不存在"。
        // 不明确说破的话模型会把 404 当权限/参数问题，换 lint/copy 反复试探（2026-09-16 流程 242 案例）
        if (/\[HTTP 404\]/.test(errMsg)) {
          return {
            success: false,
            message: `流程 ${args.processId} 不存在（可能已被删除或 ID 已过期——流程被删后页面 JS 里的 startWorkflow(旧ID) 不会自动更新）。请用 list_workflows 查看当前应用的流程列表核对，不要换其它工具反复探测。`,
          };
        }
        return { success: false, message: `获取流程定义失败：${errMsg}` };
      }
    },
  }),

  'workflow:update_definition': (ctx) => ({
    id: 'workflow:update_definition',
    category: SkillCategory.WORKFLOW,
    name: 'update_workflow',
    description: '更新已有流程定义。用于修改流程路由逻辑、替换审批节点、增删节点触发器等。nodes/edges 必须基于 get_definition 返回的现有结构修改后整体传入，未传的字段保持不变。',
    parameters: {
      type: 'object',
      properties: {
        processId: { type: 'number', description: '要更新的流程 ID' },
        name: { type: 'string', description: '流程名称（可选，不传保持原名）' },
        nodes: { type: 'array', description: '修改后的完整节点列表（数组），必须与 edges 一起传入' },
        edges: { type: 'array', description: '修改后的完整连线列表（数组），必须与 nodes 一起传入' },
      },
      required: ['processId'],
    },
    async execute(args) {
      try {
        const updateData: Partial<WorkflowDefinition> = {};
        if (args.name) updateData.name = args.name as string;
        if (args.nodes || args.edges) {
          if (!args.nodes || !args.edges) {
            return {
              success: false,
              message: '更新流程失败：nodes 和 edges 必须一起传入修改后的完整内容（先 get_definition 读取现有结构，基于它修改后整体传入），只传其一会破坏流程图完整性。',
            };
          }
          const graph = await validateAndSerializeWorkflowGraph(args.nodes, args.edges);
          if ('error' in graph) {
            return { success: false, message: graph.error };
          }
          updateData.nodes = graph.nodes;
          updateData.edges = graph.edges;
        }
        if (!updateData.name && !updateData.nodes) {
          return { success: false, message: '更新流程失败：至少要传 name 或 nodes+edges 之一，没有可更新的内容。' };
        }
        const result = await workflowApi.updateDefinition(args.processId as number, updateData);
        if (ctx.onWorkflowNavigate) ctx.onWorkflowNavigate({ view: 'designer', processId: result.id });
        return { success: true, data: result, message: `流程「${result.name || args.processId}」(ID: ${args.processId}) 已更新` };
      } catch (e: unknown) {
        const errMsg = (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
          || (e as Error).message
          || '未知错误';
        return { success: false, message: `更新流程失败：${errMsg}。如果修改已有流程失败，可以尝试用 design_workflow 创建新流程。` };
      }
    },
  }),

  'workflow:bind': (_ctx) => ({
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
        // 404 语义就是 formId/processId 有一方不存在（可能已被删除），不明确说破模型会反复换工具试探
        if (/\[HTTP 404\]/.test(errMsg)) {
          return {
            success: false,
            message: `流程绑定失败：formId ${args.formId} 或 processId ${args.processId} 不存在（可能已被删除或 ID 已过期）。请分别核实两个 ID；表单已删除且本次确需表单的，先用 design_form 重建再用新 formId 绑定。`,
          };
        }
        return { success: false, message: `流程绑定失败：${errMsg}。请确保 formId 和 processId 正确。` };
      }
    },
  }),

  'workflow:search_members': (_ctx) => ({
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
      } catch (e: unknown) {
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
      } catch (e: unknown) {
        return { success: false, message: `搜索角色失败: ${(e as Error).message}` };
      }
    },
  }),

  'workflow:search_departments': (_ctx) => ({
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
      } catch (e: unknown) {
        return { success: false, message: `搜索部门失败: ${(e as Error).message}` };
      }
    },
  }),

  'workflow:list': (ctx) => ({
    id: 'workflow:list',
    category: SkillCategory.WORKFLOW,
    name: 'list_workflows',
    description: '列出当前应用的流程定义（ID/名称/状态）。判断某个流程 ID 是否存在、寻找可复用流程时必须先用本工具，禁止用 copy_workflow 等写操作探测存在性。',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string', description: '按状态筛选（DRAFT/PUBLISHED）' } },
    },
    async execute(args) {
      try {
        const result = await workflowApi.listDefinitions({
          applicationId: ctx.applicationId,
          status: args.status as string | undefined,
        });
        if (!result || result.length === 0) {
          return { success: true, message: `当前应用（ID: ${ctx.applicationId}）暂无流程定义`, data: result };
        }
        // 发布链标注：发布时平台会保留发布版 ID 并新建一条 DRAFT 作为下一版编辑草稿
        //（新 ID）。运行时（页面 startWorkflow/编排）必须引用已发布 ID——列表里直接说清，
        // 避免把同名草稿副本当成可发起流程（2026-09-17 事故：发布 250 后出现草稿 258）
        const lines = result.map((d) => {
          const def = d as { id: number; name: string; status: string; version?: number; publishedVersionId?: number | null };
          if (String(def.status).toUpperCase() === 'DRAFT' && def.publishedVersionId != null) {
            return `  - ${def.id} 「${def.name}」 ${def.status}（发布版 ${def.publishedVersionId} 的下一版编辑草稿，发起/引用一律用已发布 ID ${def.publishedVersionId}，勿用本 ID）`;
          }
          const versionSuffix = def.version != null ? ` v${def.version}` : '';
          return `  - ${def.id} 「${def.name}」 ${def.status}${versionSuffix}`;
        });
        return { success: true, message: `当前应用共 ${result.length} 个流程定义：\n${lines.join('\n')}`, data: result };
      } catch (e: unknown) {
        return { success: false, message: `获取流程列表失败: ${(e as Error).message}` };
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
    async execute(_args) {
      try {
        const result = await instanceApi.list({ applicationId: ctx.applicationId });
        return { success: true, message: `共 ${result.length} 个流程实例`, data: result };
      } catch (e: unknown) {
        return { success: false, message: `获取流程实例失败: ${(e as Error).message}` };
      }
    },
  }),

  'workflow:approve': (_ctx) => ({
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
      catch (e: unknown) { return { success: false, message: `审批失败: ${(e as Error).message}` }; }
    },
  }),

  'workflow:reject': (_ctx) => ({
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
      catch (e: unknown) { return { success: false, message: `拒绝失败: ${(e as Error).message}` }; }
    },
  }),

  'workflow:freeze': (_ctx) => ({
    id: 'workflow:freeze',
    category: SkillCategory.WORKFLOW,
    name: 'freeze_workflow',
    description: '冻结流程实例。',
    parameters: {
      type: 'object',
      properties: { instanceId: { type: 'number', description: '流程实例 ID' } },
      required: ['instanceId'],
    },
    async execute(args) {
      try { await instanceApi.freeze(args.instanceId as number); return { success: true, message: '流程实例已冻结' }; }
      catch (e: unknown) { return { success: false, message: `冻结失败: ${(e as Error).message}` }; }
    },
  }),

  'workflow:unfreeze': (_ctx) => ({
    id: 'workflow:unfreeze',
    category: SkillCategory.WORKFLOW,
    name: 'unfreeze_workflow',
    description: '解冻流程实例。',
    parameters: {
      type: 'object',
      properties: { instanceId: { type: 'number', description: '流程实例 ID' } },
      required: ['instanceId'],
    },
    async execute(args) {
      try { await instanceApi.unfreeze(args.instanceId as number); return { success: true, message: '流程实例已解冻' }; }
      catch (e: unknown) { return { success: false, message: `解冻失败: ${(e as Error).message}` }; }
    },
  }),

  'workflow:cancel': (_ctx) => ({
    id: 'workflow:cancel',
    category: SkillCategory.WORKFLOW,
    name: 'cancel_workflow',
    description: '取消流程实例。⚠️ 会终止运行中的流程实例，需用户确认后执行。',
    parameters: {
      type: 'object',
      properties: { instanceId: { type: 'number', description: '实例 ID' } },
      required: ['instanceId'],
    },
    isDangerous: true,
    requiresConfirmation: true,
    async execute(args) {
      try { await instanceApi.cancel(args.instanceId as number); return { success: true, message: '流程已取消' }; }
      catch (e: unknown) { return { success: false, message: `取消失败: ${(e as Error).message}` }; }
    },
  }),

  'workflow:lint': (_ctx) => ({
    id: 'workflow:lint',
    category: SkillCategory.WORKFLOW,
    name: 'lint_workflow',
    description: '检查流程设计是否规范（服务端自动装载绑定表单字段，含触发器 paramsMapping 断链、条件字段引用检查），返回问题列表。',
    parameters: {
      type: 'object',
      properties: { processId: { type: 'number', description: '流程 ID' } },
      required: ['processId'],
    },
    async execute(args) {
      try {
        // 定义级 lint：后端自动装载绑定表单字段（触发器断链检查生效）；
        // 旧端点兜底（字段为空时后端跳过字段相关检查）
        let result: unknown;
        try {
          result = await lintApi.lintWorkflowDefinition(args.processId as number);
        } catch {
          const def = await workflowApi.getDefinition(args.processId as number);
          result = await lintApi.lintWorkflow(def.nodes || '', def.edges || '', '');
        }
        const lintResult = result as { passed?: boolean; errors?: Array<{ category?: string; message?: string }>; warnings?: Array<{ category?: string; message?: string }>; errorCount?: number; warningCount?: number };
        const { passed, errors, warnings, errorCount, warningCount } = lintResult;
        const parts: string[] = [];
        if (passed) {
          parts.push('流程检查通过');
        } else {
          parts.push(`流程检查不通过：${errorCount} 个错误`);
          if (errors?.length) {
            parts.push(...errors.map((e) => `- [${e.category || ''}] ${e.message || ''}`));
          }
        }
        if (warningCount && warnings?.length) {
          parts.push(`${warningCount} 个警告：`);
          parts.push(...warnings.map((w) => `- [${w.category || ''}] ${w.message || ''}`));
        }
        return { success: true, message: parts.join('\n'), data: result };
      }
      catch (e: unknown) {
        const errMsg = (e as Error).message || '未知错误';
        if (/\[HTTP 404\]/.test(errMsg)) {
          return { success: false, message: `流程 ${args.processId} 不存在，无法检查（可能已被删除或 ID 已过期）。请用 list_workflows 核对。` };
        }
        return { success: false, message: `检查失败: ${errMsg}` };
      }
    },
  }),

  'workflow:rehearse-triggers': (_ctx) => ({
    id: 'workflow:rehearse-triggers',
    category: SkillCategory.WORKFLOW,
    name: 'rehearse_triggers',
    description: [
      '触发器预演：给定样例表单数据与样例发起人，静态推演流程将走的分支路径、每个节点会触发的触发器、',
      'paramsMapping 解析出的参数、QUERY 目标渲染后的 SQL；并报告审批人解析为空（节点会被静默跳过）、',
      '参数断链、条件分支不命中等会导致静默失败的问题。不发起实例、不执行任何写操作。',
      '发布流程前、或在页面挂接 startWorkflow 后必须预演一次：用贴近真实的样例数据各跑一遍主分支。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        processId: { type: 'number', description: '流程 ID' },
        sampleFormData: {
          type: 'object',
          description: '样例表单数据（模拟发起时 startWorkflow 的 formData，字段名与绑定表单逐字一致）',
          additionalProperties: true,
        },
        sampleInitiatorId: { type: 'number', description: '样例发起人的平台用户 ID（用于审批人解析与 this.auth 渲染，强烈建议提供真实账号）' },
      },
      required: ['processId', 'sampleFormData'],
    },
    async execute(args) {
      try {
        const result = await lintApi.rehearseTriggers(
          args.processId as number,
          (args.sampleFormData as Record<string, unknown>) || {},
          args.sampleInitiatorId as number | undefined,
        ) as {
          definitionName?: string; status?: string;
          path?: Array<{ nodeId?: string; nodeType?: string; nodeName?: string; approverType?: string; previewAssignees?: number[] }>;
          triggers?: Array<{ nodeId?: string; nodeName?: string; triggerId?: string; on?: string; fireTiming?: string; targetType?: string; targetRef?: number | string; params?: Record<string, unknown>; nullParamsFrom?: string[]; queryPreview?: { renderedSql?: string; placeholderIdentity?: boolean; missingRequiredParams?: string[]; error?: string } }>;
          passed?: boolean;
          errors?: Array<{ category?: string; message?: string }>;
          warnings?: Array<{ category?: string; message?: string }>;
          infos?: Array<{ category?: string; message?: string }>;
        };
        const parts: string[] = [];
        parts.push(`流程「${result.definitionName}」（${result.status}）预演结果：${result.passed ? '未发现阻断性问题' : `发现 ${result.errors?.length || 0} 个阻断问题`}`);
        if (result.path?.length) {
          parts.push('路径推演：' + result.path.map((n) =>
            `${n.nodeName || n.nodeId}[${n.nodeType}]` + (n.nodeType === 'approval'
              ? `（审批人: ${n.previewAssignees?.length ? n.previewAssignees.join(',') : '解析为空!'})` : '')
          ).join(' → '));
        }
        if (result.triggers?.length) {
          parts.push('将触发的触发器：');
          for (const t of result.triggers) {
            parts.push(`- [${t.on}] ${t.nodeName || t.nodeId} → ${t.targetType}:${t.targetRef}（${t.fireTiming}），params=${JSON.stringify(t.params || {})}`);
            if (t.queryPreview?.renderedSql) {
              parts.push(`  渲染 SQL: ${t.queryPreview.renderedSql.replace(/\s+/g, ' ').slice(0, 300)}`);
            }
            if (t.queryPreview?.missingRequiredParams?.length) {
              parts.push(`  ⚠️ 必填参数缺失: ${t.queryPreview.missingRequiredParams.join(', ')}`);
            }
          }
        } else {
          parts.push('未收集到任何会触发的触发器（检查触发器是否配置在路径节点上）');
        }
        if (result.errors?.length) {
          parts.push(`${result.errors.length} 个错误：`);
          parts.push(...result.errors.map((e) => `- [${e.category || ''}] ${e.message || ''}`));
        }
        if (result.warnings?.length) {
          parts.push(`${result.warnings.length} 个警告：`);
          parts.push(...result.warnings.map((w) => `- [${w.category || ''}] ${w.message || ''}`));
        }
        if (result.infos?.length) {
          parts.push(...result.infos.map((i) => `- [${i.category || ''}] ${i.message || ''}`));
        }
        return { success: true, message: parts.join('\n'), data: result };
      }
      catch (e: unknown) {
        const errMsg = (e as Error).message || '未知错误';
        if (/\[HTTP 404\]/.test(errMsg)) {
          return { success: false, message: `流程 ${args.processId} 不存在，无法预演。请用 list_workflows 核对。` };
        }
        return { success: false, message: `预演失败: ${errMsg}` };
      }
    },
  }),

  'workflow:copy': (_ctx) => ({
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
      } catch (e: unknown) {
        const errMsg = (e as Error).message || '未知错误';
        if (/\[HTTP 404\]/.test(errMsg)) {
          return { success: false, message: `流程 ${args.processId} 不存在，无法复制。copy_workflow 是写操作，不能用来探测流程是否存在，请用 list_workflows 核对。` };
        }
        return { success: false, message: `复制失败: ${errMsg}` };
      }
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

  'workflow:publish': (_ctx) => ({
    id: 'workflow:publish',
    category: SkillCategory.WORKFLOW,
    name: 'publish_workflow',
    description: '发布流程定义，使其生效。发布后流程才可被发起使用。',
    parameters: {
      type: 'object',
      properties: { processId: { type: 'number', description: '要发布的流程定义 ID' } },
      required: ['processId'],
    },
    async execute(args) {
      try {
        const result = await workflowApi.publishDefinition(args.processId as number);
        return { success: true, message: '流程已发布', data: result };
      } catch (e: unknown) { return { success: false, message: `发布失败: ${(e as Error).message}` }; }
    },
  }),

  'workflow:unpublish': (_ctx) => ({
    id: 'workflow:unpublish',
    category: SkillCategory.WORKFLOW,
    name: 'unpublish_workflow',
    description: '下线已发布的流程定义（PUBLISHED → DRAFT）：流程不可再发起新实例，定义保留，可随时重新 publish_workflow 上线。delete_workflow 删除已发布流程前必须先执行本工具。',
    parameters: {
      type: 'object',
      properties: { processId: { type: 'number', description: '要下线的流程定义 ID' } },
      required: ['processId'],
    },
    async execute(args) {
      try {
        const result = await workflowApi.unpublishDefinition(args.processId as number);
        return { success: true, message: `流程 ${args.processId} 已下线（PUBLISHED → DRAFT），不可再发起；如需彻底删除可继续调用 delete_workflow`, data: result };
      } catch (e: unknown) {
        const errMsg = (e as Error).message || '未知错误';
        if (/\[HTTP 404\]/.test(errMsg) || /流程定义不存在/.test(errMsg)) {
          return { success: false, message: `流程 ${args.processId} 不存在，无法下线（可能已被删除）。请用 list_workflows 核对。` };
        }
        if (/只能下线已发布的流程/.test(errMsg)) {
          return { success: false, message: `流程 ${args.processId} 当前不是已发布状态（可能已是 DRAFT），无需下线；如要删除可直接调用 delete_workflow。` };
        }
        return { success: false, message: `下线失败: ${errMsg}` };
      }
    },
  }),

  'workflow:delete': (_ctx) => ({
    id: 'workflow:delete',
    category: SkillCategory.WORKFLOW,
    name: 'delete_workflow',
    description: '删除流程定义（不可恢复）。单个用 processId；批量（≥2 个）必须用 processIds 传完整 ID 数组——一次确认整批执行，禁止拆成逐个调用（确认门每次只放行一次调用，逐个删会反复打断用户）。PUBLISHED 流程会自动先下线再删除，无需预先 unpublish。删除后页面 JS 里对应 startWorkflow(流程ID) 调用点失效，汇报时必须提醒同步清理。',
    parameters: {
      type: 'object',
      properties: {
        processId: { type: 'number', description: '要删除的流程定义 ID（单个删除时用）' },
        processIds: { type: 'array', items: { type: 'number' }, description: '要删除的流程定义 ID 数组（批量删除时用，一次确认整批执行）' },
      },
    },
    isDangerous: true,
    requiresConfirmation: true,
    async execute(args) {
      const ids = Array.isArray(args.processIds) && args.processIds.length > 0
        ? Array.from(new Set((args.processIds as unknown[]).map(Number).filter((n) => Number.isFinite(n))))
        : Number.isFinite(Number(args.processId)) ? [Number(args.processId)] : [];
      if (!ids.length) {
        return { success: false, message: '请提供 processId（单个）或 processIds（批量 ID 数组）之一' };
      }
      const deleted: number[] = [];
      const skipped: string[] = [];
      const failed: string[] = [];
      for (const id of ids) {
        try {
          await workflowApi.deleteDefinition(id);
          deleted.push(id);
        } catch (e: unknown) {
          const errMsg = (e as Error).message || '未知错误';
          if (/已发布的流程不能删除/.test(errMsg)) {
            // 用户已确认删除，下线是删除的前置步骤（可逆），自动完成，不再单独打断确认
            try {
              await workflowApi.unpublishDefinition(id);
              await workflowApi.deleteDefinition(id);
              deleted.push(id);
            } catch (e2: unknown) {
              failed.push(`${id}: 自动下线后删除仍失败 (${(e2 as Error).message})`);
            }
          } else if (/流程定义不存在/.test(errMsg) || /\[HTTP 404\]/.test(errMsg)) {
            skipped.push(`${id}: 不存在（可能已删除过）`);
          } else {
            failed.push(`${id}: ${errMsg}`);
          }
        }
      }
      const parts: string[] = [];
      if (deleted.length) parts.push(`已删除 ${deleted.length} 个：${deleted.join(',')}`);
      if (skipped.length) parts.push(`跳过 ${skipped.length} 个：${skipped.join('；')}`);
      if (failed.length) parts.push(`失败 ${failed.length} 个：${failed.join('；')}`);
      const message = ids.length === 1 && deleted.length === 1
        ? `流程 ${ids[0]} 已删除（不可恢复）。⚠️ 页面 JS 中 startWorkflow(${ids[0]}) 调用点已失效，需同步清理`
        : `批量删除完成（目标 ${ids.length} 个）。⚠️ 页面 JS 中对应 startWorkflow 调用点已失效，需同步清理\n${parts.join('\n')}`;
      return { success: failed.length === 0, message, data: { deleted, skipped, failed } };
    },
  }),

  'workflow:instance-timeline': (_ctx) => ({
    id: 'workflow:instance-timeline',
    category: SkillCategory.WORKFLOW,
    name: 'get_instance_timeline',
    description: `查看流程实例的完整时间线（历史记录）。重点关注以下动作留痕：SKIP=审批人解析为空节点被跳过（APPROVED 触发器不会执行）、SUSPENDED=实例因审批人缺失被挂起、FAIL=解析失败阻止推进。排查"审批走完了但业务数据没回写"类问题从这里入手。`,
    parameters: {
      type: 'object',
      properties: { instanceId: { type: 'number', description: '实例 ID' } },
      required: ['instanceId'],
    },
    async execute(args) {
      try {
        const history = await instanceApi.getHistory(args.instanceId as number);
        if (!history.length) {
          return { success: true, message: `实例 ${args.instanceId} 暂无历史记录`, data: history };
        }
        const parts = history.map((h) => {
          const action = String(h.action || '').toUpperCase();
          const marker = action === 'SKIP' ? ' ⚠️跳过' : action === 'SUSPENDED' ? ' ⚠️挂起' : action === 'FAIL' ? ' ❌失败' : '';
          return `- [${h.createdAt}] ${h.nodeId} ${action}${marker} ${h.comment || ''}`;
        });
        return { success: true, message: `实例 ${args.instanceId} 时间线（${history.length} 条）：\n${parts.join('\n')}`, data: history };
      } catch (e: unknown) { return { success: false, message: `查询失败: ${(e as Error).message}` }; }
    },
  }),

  'workflow:trigger-outbox': (_ctx) => ({
    id: 'workflow:trigger-outbox',
    category: SkillCategory.WORKFLOW,
    name: 'list_trigger_outbox',
    description: `查询触发器派发记录（outbox）。两种用法：① 按实例查（instanceId）：该实例每条触发器的组/顺序/状态/重试次数/最后错误；② 查死信（dead: true）：全平台重试耗尽的 DEAD 回写，需要人工介入。PENDING 停留过久=派发卡住；DEAD=回写最终失败（业务库状态与流程状态已分叉）。`,
    parameters: {
      type: 'object',
      properties: {
        instanceId: { type: 'number', description: '实例 ID（与 dead 二选一）' },
        dead: { type: 'boolean', description: '查最近死信（DEAD）列表' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const rows = args.dead
          ? await observabilityApi.deadTriggerLetters()
          : args.instanceId
            ? await observabilityApi.instanceTriggerOutbox(args.instanceId as number)
            : null;
        if (!rows) {
          return { success: false, message: '请提供 instanceId 或 dead=true 之一' };
        }
        if (!rows.length) {
          return { success: true, message: args.dead ? '当前没有死信（DEAD）记录' : `实例 ${args.instanceId} 暂无触发器派发记录`, data: rows };
        }
        const parts = rows.map((r) => {
          const group = r.groupId ? ` 组=${String(r.groupId).slice(0, 8)}#${r.groupOrder}` : '';
          return `- row=${r.id} 实例=${r.instanceId} 节点=${r.nodeId} → ${r.targetType}:${r.targetRef}${group} 状态=${r.status} 重试=${r.attempts}/${r.maxAttempts}${r.minAffectedRows != null ? ` minAffectedRows=${r.minAffectedRows}` : ''}${r.lastError ? ` 最后错误: ${r.lastError}` : ''}`;
        });
        const deadHint = args.dead ? '\n⚠️ 死信代表回写最终失败：流程状态与业务库状态已分叉，请人工核对业务数据后处理。' : '';
        return { success: true, message: `共 ${rows.length} 条记录：\n${parts.join('\n')}${deadHint}`, data: rows };
      } catch (e: unknown) { return { success: false, message: `查询失败: ${(e as Error).message}` }; }
    },
  }),
};