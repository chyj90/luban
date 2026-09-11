import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background,
  addEdge, useNodesState, useEdgesState,
  Handle, Position,
  type Connection, type Edge, type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  createOrchestration, getOrchestration, saveOrchestration,
  lintOrchestration, testRunOrchestration, publishOrchestration,
  type OrchestrationTestRunResult,
} from '@/api/orchestration';
import { listQueries } from '@/api/query';
import { listApplicationTools, getToolSchema } from '@/api/tool';
import { workflowApi } from '@/api/workflow';
import Select from '@/components/Select';
import './Orchestration.css';

/** 节点面板：备菜（平台资源）+ 烹饪（Python）*/
const NODE_COLORS: Record<string, string> = {
  start: '#52c41a',
  query: '#1890ff',
  http: '#722ed1',
  workflow: '#13c2c2',
  python: '#fa8c16',
  transform: '#eb2f96',
  condition: '#faad14',
  parallel: '#2f54eb',
  output: '#f5222d',
};

const NODE_ICONS: Record<string, React.JSX.Element> = {
  start: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="6,4 20,12 6,20" /></svg>,
  query: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>,
  http: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>,
  workflow: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.6" y1="7.4" x2="15.4" y2="9.6" /><line x1="8.6" y1="16.6" x2="15.4" y2="14.4" /></svg>,
  python: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16,18 22,12 16,6" /><polyline points="8,6 2,12 8,18" /></svg>,
  transform: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17,1 21,5 17,9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7,23 3,19 7,15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>,
  condition: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2" transform="rotate(45 12 12)" /><path d="M9 9l6 6M15 9l-6 6" /></svg>,
  parallel: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="4" x2="8" y2="20" /><line x1="16" y1="4" x2="16" y2="20" /><line x1="4" y1="8" x2="20" y2="8" /><line x1="4" y1="16" x2="20" y2="16" /></svg>,
  output: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="12" cy="12" r="3" /></svg>,
};

function OrchNode({ data }: { data: Record<string, unknown> }) {
  const nodeType = (data.nodeType as string) || 'default';
  const color = NODE_COLORS[nodeType] || '#8c8c8c';
  const icon = NODE_ICONS[nodeType] || <span>?</span>;
  const name = (data.label as string) || nodeType;

  return (
    <div className="orch-node" style={{ borderColor: color }}>
      <Handle type="target" position={Position.Top} className="orch-handle" />
      <div className="orch-node-icon" style={{ background: color }}>{icon}</div>
      <div className="orch-node-label">{name}</div>
      <Handle type="source" position={Position.Bottom} className="orch-handle" />
    </div>
  );
}

const nodeTypes = { orchNode: OrchNode };

const NODE_PALETTE: Array<{ type: string; label: string; desc: string }> = [
  { type: 'query', label: '查询', desc: '本应用 Query' },
  { type: 'http', label: 'API', desc: '本应用 API 工具' },
  { type: 'workflow', label: '流程', desc: '本应用流程' },
  { type: 'python', label: 'Python', desc: '沙箱纯逻辑' },
  { type: 'transform', label: '变换', desc: 'JSON 字段映射' },
  { type: 'condition', label: '条件', desc: '分支路由' },
  { type: 'parallel', label: '并行', desc: '扇出/汇合' },
];

function dslToFlow(dsl: { nodes?: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>> }): {
  nodes: Node[]; edges: Edge[];
} {
  const PROTECTED = new Set(['start', 'output']);
  const nodes: Node[] = (dsl.nodes || []).map((rec) => {
    const data = ((rec.data as Record<string, unknown>) || {}) as Record<string, unknown>;
    const nodeType = rec.nodeType as string;
    return {
      id: String(rec.id),
      type: 'orchNode',
      position: (rec.position as { x: number; y: number }) || { x: 100, y: 100 },
      data: { ...data, nodeType, configJson: data.config ? JSON.stringify(data.config) : (data.configJson as string || '{}') },
      deletable: !PROTECTED.has(nodeType),
    } as Node;
  });
  const edges: Edge[] = (dsl.edges || []).map((rec) => ({
    id: String(rec.id || `${rec.source}-${rec.target}`),
    source: String(rec.source),
    target: String(rec.target),
    data: { condition: (rec.condition as string) || '' },
  })) as Edge[];
  return { nodes, edges };
}

function flowToDsl(nodes: Node[], edges: Edge[]): string {
  return JSON.stringify({
    nodes: nodes.map((n) => {
      const d = n.data as Record<string, unknown>;
      let config: unknown = {};
      if (d.config != null) { config = d.config; }
      return {
        id: n.id, nodeType: d.nodeType, position: n.position,
        data: { label: (d.label as string) || n.id, config },
      };
    }),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, condition: (e.data as Record<string, unknown> | undefined)?.condition || null })),
  });
}

const EMPTY_FLOW = () => dslToFlow({
  nodes: [
    { id: 'start', nodeType: 'start', position: { x: 300, y: 80 }, data: { label: '入口', config: { inputs: [] } } },
    { id: 'out', nodeType: 'output', position: { x: 300, y: 320 }, data: { label: '出口', config: {} } },
  ],
  edges: [],
});

// 条件语法: 字段名 运算符 字面量，逻辑用 && / || 连接
function parseCondRows(raw: string): Array<{ field: string; op: string; value: string; logic: '&&' | '||' }> {
  const rows: Array<{ field: string; op: string; value: string; logic: '&&' | '||' }> = [];
  const parts = raw.split(/(&&|\|\|)/);
  let i = 0;
  while (i < parts.length) {
    const seg = parts[i].trim();
    i++;
    if (!seg) { if (i < parts.length) i++; continue; }
    const m = seg.match(/(\w+)\s*(<=|>=|==|!=|<|>)\s*(\d+(?:\.\d+)?|'[^']*'|"[^"]*")/);
    if (m) {
      rows.push({ field: m[1], op: m[2], value: m[3], logic: '&&' });
    }
    if (i < parts.length) {
      const logic = parts[i].trim();
      if (logic === '||' && rows.length > 0) rows[rows.length - 1].logic = '||';
      i++;
    }
  }
  return rows;
}
function rowsToExpr(rows: Array<{ field: string; op: string; value: string; logic: '&&' | '||' }>): string {
  return rows.filter((r) => r.field && r.value).map((r, i) => {
    const prefix = i > 0 ? ` ${r.logic} ` : '';
    return `${prefix}${r.field} ${r.op} ${r.value}`;
  }).join('');
}

/** 嵌入式编排编辑器（AppEditorPage 主区渲染）。orchId=null 表示新建。 */
export function OrchestrationBuilder({ appId, orchId, onBack }: {
  appId: number;
  orchId: number | null;
  onBack: () => void;
}) {
  const [name, setName] = useState('');
  const [savedId, setSavedId] = useState<number | null>(orchId);
  const [status, setStatus] = useState('DRAFT');
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(EMPTY_FLOW().nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(EMPTY_FLOW().edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [configJson, setConfigJson] = useState('{}');
  const [edgeCondition, setEdgeCondition] = useState('');
  type CondRow = { field: string; op: string; value: string; logic: '&&' | '||' };
  const [condRows, setCondRows] = useState<CondRow[]>([]);
  const [lintErrors, setLintErrors] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<OrchestrationTestRunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [queryList, setQueryList] = useState<Array<{ id: number; name: string; params: string[] }>>([]);
  const [toolList, setToolList] = useState<Array<{ id: number; name: string }>>([]);
  const [workflowList, setWorkflowList] = useState<Array<{ id: number; name: string }>>([]);
  const [toolSchemaMap, setToolSchemaMap] = useState<Record<number, string[]>>({});

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedId), [nodes, selectedId]);
  const selectedNodeType = (selectedNode?.data as Record<string, unknown>)?.nodeType as string || '';

  const parsedConfig = useMemo(() => {
    try { return JSON.parse(configJson || '{}'); } catch { return {}; }
  }, [configJson]);

  // 记录焦点信息供芯片点击使用
  const chipFocusRef = useRef<{ configKey: string; idx: number; field: 'key' | 'value'; curKey: string; curVal: string } | null>(null);

  // 切换节点时重置焦点引用，避免旧节点的 configKey 污染新节点
  useEffect(() => { chipFocusRef.current = null; }, [selectedId]);

  // 自动新增字段的自增序号，避免多芯片覆盖
  const chipAutoKeyRef = useRef(0);

  // 芯片点击：插入到当前焦点输入框；若未聚焦则追加新行
  const onVarChipClick = (text: string) => {
    const f = chipFocusRef.current;
    if (!f) {
      const isKvNode = selectedNodeType === 'query' || selectedNodeType === 'http' || selectedNodeType === 'workflow';
      const configKey = isKvNode ? 'paramsTemplate' : 'template';
      const cfg = { ...(parsedConfig[configKey] as Record<string, unknown> || {}) };
      chipAutoKeyRef.current += 1;
      cfg[`new_field_${chipAutoKeyRef.current}`] = text;
      updateConfig(configKey, cfg);
      return;
    }
    const cfg = { ...(parsedConfig[f.configKey] as Record<string, unknown> || {}) };
    if (f.field === 'key') {
      if (text.startsWith('$') || text.startsWith('.')) {
        if (f.curKey) cfg[f.curKey] = text;
      } else {
        if (f.curKey) delete cfg[f.curKey];
        cfg[text] = f.curVal ?? '';
      }
    } else {
      const k = f.curKey || '';
      if (k) cfg[k] = text;
    }
    updateConfig(f.configKey, cfg);
  };

  // 获取选中节点的建议键名（null=未选择资源, [] = 已选择但无参数）
  const suggestedKeys = useMemo(() => {
    if (selectedNodeType === 'query') {
      const qId = Number(parsedConfig.queryId);
      if (!qId) return null;
      const q = queryList.find((x) => x.id === qId);
      return q?.params || [];
    }
    if (selectedNodeType === 'http') {
      const tId = Number(parsedConfig.toolId);
      if (!tId) return null;
      return toolSchemaMap[tId] || [];
    }
    return null;
  }, [selectedNodeType, parsedConfig, queryList, toolSchemaMap]);

  // API 节点选中工具后查询 schema
  useEffect(() => {
    if (selectedNodeType !== 'http') return;
    const tId = parsedConfig.toolId as number;
    if (!tId || toolSchemaMap[tId]) return;
    getToolSchema(tId).then((res) => {
      const keys: string[] = [];
      try {
        const props = (res.data as Record<string, unknown>)?.properties as Record<string, unknown> | undefined;
        if (props) keys.push(...Object.keys(props));
      } catch { /* ignore */ }
      setToolSchemaMap((prev) => ({ ...prev, [tId]: keys }));
    }).catch(() => {});
  }, [selectedNodeType, parsedConfig.toolId]);

  // 根据节点配置推测输出字段
  function inferNodeOutputFields(node: Node): string[] {
    const d = node.data as Record<string, unknown>;
    const nt = d.nodeType as string;
    const cfg = (d.config as Record<string, unknown>) || {};
    if (nt === 'transform') {
      const tpl = cfg.template as Record<string, unknown> | undefined;
      return tpl ? Object.keys(tpl) : [];
    }
    if (nt === 'query') {
      return ['rows', 'columns', 'totalCount'];
    }
    return [];
  }

  // 计算选中节点的可用变量
  const availableVars = useMemo(() => {
    const inputVars: string[] = [];
    const startNode = nodes.find((n) => (n.data as Record<string, unknown>).nodeType === 'start');
    if (startNode && selectedId !== startNode.id) {
      const sd = startNode.data as Record<string, unknown>;
      const sc = (sd.config as Record<string, unknown>) || JSON.parse((sd.configJson as string) || '{}');
      ((sc.inputs as Array<{ name: string }>) || []).forEach((p) => inputVars.push(`$input.${p.name}`));
    }
    const upstreamHints: Array<{ id: string; label: string; nodeType: string; fields: string[] }> = [];
    if (selectedId) {
      const queue = [selectedId];
      const visited = new Set<string>([selectedId]);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        edges.forEach((e) => {
          if (e.target === cur && !visited.has(e.source)) {
            visited.add(e.source);
            const src = nodes.find((n) => n.id === e.source);
            if (src) {
              const nt = (src.data as Record<string, unknown>).nodeType as string;
              if (nt !== 'start') {
                const label = ((src.data as Record<string, unknown>).label as string) || nt;
                const fields = inferNodeOutputFields(src);
                upstreamHints.push({ id: e.source, label, nodeType: nt, fields });
              }
            }
            queue.push(e.source);
          }
        });
      }
    }
    return { inputVars, upstreamHints };
  }, [nodes, edges, selectedId]);

  // 选中连线时，若源节点是条件节点，计算可用变量供条件表达式使用
  // 注意：条件左值只能是 __input__ 的字段名（纯名字，不带 $input. 前缀），右值为固定字面量
  const edgeVars = useMemo(() => {
    const inputVars: string[] = [];
    const outputHints: string[] = [];
    if (!selectedEdgeId) return { inputVars, outputHints };
    const edge = edges.find((e) => e.id === selectedEdgeId);
    if (!edge) return { inputVars, outputHints };
    const srcNode = nodes.find((n) => n.id === edge.source);
    if (!srcNode || (srcNode.data as Record<string, unknown>).nodeType !== 'condition') return { inputVars, outputHints };

    // 入口参数：纯字段名
    const startNode = nodes.find((n) => (n.data as Record<string, unknown>).nodeType === 'start');
    if (startNode) {
      const sd = startNode.data as Record<string, unknown>;
      const sc = (sd.config as Record<string, unknown>) || JSON.parse((sd.configJson as string) || '{}');
      ((sc.inputs as Array<{ name: string }>) || []).forEach((p) => inputVars.push(p.name));
    }

    // BFS 上游节点，尝试提取输出字段名
    const queue = [srcNode.id];
    const visited = new Set<string>([srcNode.id]);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      edges.forEach((e) => {
        if (e.target === cur && !visited.has(e.source)) {
          visited.add(e.source);
          const src = nodes.find((n) => n.id === e.source);
          if (src) {
            const nt = (src.data as Record<string, unknown>).nodeType as string;
            if (nt !== 'start') {
              const cfg = (src.data as Record<string, unknown>).config as Record<string, unknown> || {};
              // transform 节点：template 的 key 就是输出字段
              if (nt === 'transform' && cfg.template) {
                Object.keys(cfg.template as Record<string, unknown>).forEach((k) => { if (!outputHints.includes(k)) outputHints.push(k); });
              }
              // query/http/python/workflow 节点：paramsTemplate key 可能是输出字段的弱提示
              if (cfg.paramsTemplate) {
                Object.keys(cfg.paramsTemplate as Record<string, unknown>).forEach((k) => { if (!outputHints.includes(k)) outputHints.push(k); });
              }
            }
          }
          queue.push(e.source);
        }
      });
    }
    return { inputVars, outputHints };
  }, [nodes, edges, selectedEdgeId]);

  // condRows → edgeCondition → edge 同步
  useEffect(() => {
    const expr = rowsToExpr(condRows);
    setEdgeCondition(expr);
    if (selectedEdgeId && expr) {
      setEdges((eds) => eds.map((ed) => ed.id === selectedEdgeId
        ? { ...ed, data: { ...(ed.data as Record<string, unknown>), condition: expr } }
        : ed));
    }
  }, [condRows, selectedEdgeId, setEdges]);

  const updateConfig = (key: string, value: unknown) => {
    let cfg: Record<string, unknown> = {};
    try { cfg = JSON.parse(configJson || '{}'); } catch { /* ignore */ }
    cfg[key] = value;
    setConfigJson(JSON.stringify(cfg, null, 2));
  };

  // 可视化表单编辑自动同步到节点数据，无需单独点"应用配置"
  useEffect(() => {
    if (!selectedId) return;
    let parsed: unknown = {};
    try { parsed = JSON.parse(configJson || '{}'); } catch { return; }
    setNodes((nds) => nds.map((n) => (n.id === selectedId
      ? { ...n, data: { ...n.data, config: parsed, configJson: JSON.stringify(parsed) } }
      : n)));
  }, [configJson, selectedId, setNodes]);

  useEffect(() => {
    Promise.all([
      listQueries(appId).then((r) => r.data || []),
      listApplicationTools(appId).then((r) => (r.data as Array<{ id: number; displayName?: string; toolName?: string }>) || []),
      workflowApi.listDefinitions({ applicationId: appId }).then((wfs: Array<{ id: number; name: string }>) => wfs || []),
    ])
      .then(([queries, tools, workflows]) => {
        setQueryList(queries.map((q) => ({
          id: q.id, name: q.name,
          params: q.params ? Object.keys(q.params) : [],
        })));
        setToolList(tools.map((t) => ({ id: t.id, name: t.displayName || t.toolName || `工具 ${t.id}` })));
        setWorkflowList(workflows.map((w) => ({ id: w.id, name: w.name })));
      })
      .catch(() => {});
  }, [appId]);

  useEffect(() => {
    if (orchId == null) return;
    getOrchestration(orchId).then((res) => {
      const d = res.data;
      setName(d.name);
      setStatus(d.status);
      const flow = dslToFlow(JSON.parse(d.dsl || '{}'));
      setNodes(flow.nodes);
      setEdges(flow.edges);
    }).catch(() => setMsg('加载编排失败'));
  }, [orchId, setNodes, setEdges]);

  const onConnect = useCallback((c: Connection) => {
    setEdges((eds) => addEdge({ ...c, id: `e-${c.source}-${c.target}-${Date.now()}`, data: { condition: '' } }, eds));
  }, [setEdges]);

  const addNode = (type: string) => {
    const id = `${type}_${Date.now().toString(36)}`;
    setNodes((nds) => nds.concat({
      id, type: 'orchNode',
      position: { x: 240 + Math.random() * 160, y: 140 + Math.random() * 160 },
      data: {
        label: NODE_PALETTE.find((p) => p.type === type)?.label || type,
        nodeType: type,
        config: type === 'start' ? { inputs: [] } : {},
        configJson: type === 'start' ? '{"inputs":[]}' : '{}',
      },
    }));
  };

  const applyToSelected = () => {
    if (!selectedId) return;
    let parsed: unknown = {};
    try { parsed = JSON.parse(configJson || '{}'); } catch { setMsg('config JSON 语法错误'); return; }
    setNodes((nds) => nds.map((n) => (n.id === selectedId
      ? { ...n, data: { ...n.data, configJson: JSON.stringify(parsed) } }
      : n)));
    setMsg('配置已应用');
  };

  const currentDsl = () => flowToDsl(nodes, edges);

  const runLint = async () => {
    setBusy(true);
    setLintErrors([]);
    try {
      const res = await lintOrchestration(currentDsl());
      setLintErrors([...(res.data.errors || []), ...(res.data.warnings || []).map((w: string) => `⚠ ${w}`)]);
      setMsg(res.data.passed ? '校验通过' : `发现 ${res.data.errors.length} 个错误`);
    } catch (e) {
      setLintErrors([`请求失败: ${String(e)}`]);
    } finally { setBusy(false); }
  };

  const doSave = async (): Promise<number | null> => {
    setBusy(true);
    try {
      if (savedId == null) {
        const res = await createOrchestration({ name: name || `编排-${Date.now()}`, applicationId: appId, dsl: currentDsl() });
        setSavedId(res.data.id);
        setMsg(`已创建（ID: ${res.data.id}）`);
        return res.data.id;
      }
      await saveOrchestration(savedId, currentDsl());
      setMsg('已保存新版本');
      return savedId;
    } catch (e) {
      setMsg('保存失败: ' + String(e));
      return null;
    } finally { setBusy(false); }
  };

  const doTestRun = async () => {
    const saved = await doSave();
    if (saved == null) return;
    setBusy(true);
    try {
      const inputs: Record<string, unknown> = {};
      const startNode = nodes.find((n) => (n.data as Record<string, unknown>).nodeType === 'start');
      try {
        const sd2 = startNode?.data as Record<string, unknown>;
        const cfg = (sd2?.config as Record<string, unknown>) || JSON.parse((sd2?.configJson as string) || '{}');
        ((cfg.inputs as { name: string }[]) || []).forEach((p) => { inputs[p.name] = null; });
      } catch { /* start 未配置 */ }
      const res = await testRunOrchestration(saved, inputs);
      setTestResult(res.data);
    } finally { setBusy(false); }
  };

  const doPublish = async () => {
    const saved = await doSave();
    if (saved == null) return;
    setBusy(true);
    try {
      const res = await publishOrchestration(saved);
      setStatus('PUBLISHED');
      setMsg(`已发布（工具 ID: ${res.data.toolDefinitionId}）`);
    } finally { setBusy(false); }
  };

  return (
    <div className="orch-builder">
      <div className="orch-toolbar">
        <button className="orch-btn orch-btn-back" onClick={onBack}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          返回列表
        </button>
        <input className="orch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="编排名称" />
        <span className={`orch-status ${status.toLowerCase()}`}>{status}</span>
        <div className="orch-toolbar-spacer" />
        <button className="orch-btn" onClick={runLint} disabled={busy}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          校验
        </button>
        <button className="orch-btn" onClick={doTestRun} disabled={busy}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          试运行
        </button>
        <button className="orch-btn" onClick={doSave} disabled={busy}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
          保存
        </button>
        <button className="orch-btn orch-btn-primary" onClick={doPublish} disabled={busy || status === 'PUBLISHED'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
          发布
        </button>
        {msg && <span className="orch-msg">{msg}</span>}
      </div>
      <div className="orch-body">
        <div className="orch-palette">
          <h4 className="orch-palette-title">节点面板</h4>
          {NODE_PALETTE.map((p) => (
            <div key={p.type} className="orch-palette-item" onClick={() => addNode(p.type)}>
              <span className="orch-palette-icon" style={{ background: NODE_COLORS[p.type] || '#8c8c8c' }}>
                {NODE_ICONS[p.type] || <span>?</span>}
              </span>
              <div>
                <div className="orch-palette-label">{p.label}</div>
                <div className="orch-palette-desc">{p.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="orch-canvas">
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeClick={(_, n) => {
              setSelectedId(n.id);
              setSelectedEdgeId(null);
              const d = n.data as Record<string, unknown>;
              const cfg = d.config || JSON.parse((d.configJson as string) || '{}');
              setConfigJson(JSON.stringify(cfg, null, 2));
            }}
            onEdgeClick={(_, e) => {
              const src = nodes.find((n) => n.id === e.source);
              if (!src || (src.data as Record<string, unknown>).nodeType !== 'condition') return;
              setSelectedEdgeId(e.id);
              setSelectedId(null);
              const raw = ((e.data as Record<string, unknown> | undefined)?.condition as string) || '';
              setEdgeCondition(raw);
              setCondRows(parseCondRows(raw));
            }}
            onPaneClick={() => { setSelectedId(null); setSelectedEdgeId(null); }}
            fitView fitViewOptions={{ maxZoom: 0.8, minZoom: 0.3 }}
            defaultViewport={{ x: 0, y: 0, zoom: 0.6 }}>
            <Background />
          </ReactFlow>
        </div>
        <div className={`orch-inspector${!selectedId && !selectedEdgeId ? ' orch-inspector-collapsed' : ''}`}>
          {selectedEdgeId ? (
            <>
              <div className="orch-inspector-title">
                <span className="orch-inspector-title-label">连线条件</span>
              </div>

              <div className="orch-config-section">
                <label className="orch-config-label">条件</label>
                <p className="orch-config-hint">
                  左值：必须是字段名（入口参数或上游输出），右值：固定字面量或另一个字段名。<br />
                  支持 &&（且）、||（或）组合多条，点击下方芯片快速填入字段名
                </p>
                {(edgeVars.inputVars.length > 0 || edgeVars.outputHints.length > 0) && (
                  <div className="orch-var-chips" style={{ marginBottom: 8 }}>
                    {edgeVars.inputVars.map((v) => (
                      <span key={'ci_'+v} className="orch-var-chip orch-var-chip-input"
                        title={`入口参数：${v}`}
                        onClick={() => {
                          let next = [...condRows];
                          if (next.length === 0) next = [{ field: '', op: '>', value: '', logic: '&&' }];
                          const last = next.length - 1;
                          next[last] = { ...next[last], field: v };
                          setCondRows(next);
                        }}
                      >{v}</span>
                    ))}
                    {edgeVars.outputHints.length > 0 && edgeVars.inputVars.length > 0 && (
                      <span style={{ fontSize: 11, color: '#8c9cab', alignSelf: 'center', margin: '0 2px' }}>|</span>
                    )}
                    {edgeVars.outputHints.map((v) => (
                      <span key={'co_'+v} className="orch-var-chip orch-var-chip-node"
                        title={`上游输出字段：${v}`}
                        onClick={() => {
                          let next = [...condRows];
                          if (next.length === 0) next = [{ field: '', op: '>', value: '', logic: '&&' }];
                          const last = next.length - 1;
                          next[last] = { ...next[last], field: v };
                          setCondRows(next);
                        }}
                      >{v}</span>
                    ))}
                  </div>
                )}
                <div className="orch-cond-builder">
                  {condRows.map((row, i) => (
                    <div key={i} className="orch-cond-row">
                      {i > 0 && (
                        <Select className="orch-select-compact"
                          value={row.logic}
                          options={[{ value: '&&', label: '且 (&&)' }, { value: '||', label: '或 (||)' }]}
                          onChange={(v) => {
                            const next = [...condRows];
                            next[i] = { ...next[i], logic: v as '&&' | '||' };
                            setCondRows(next);
                          }}
                        />
                      )}
                      <input className="orch-config-input" style={{ width: 100, flexShrink: 0, ...(row.field && /^['"]|^\d/.test(row.field) ? { borderColor: '#e05567', background: '#fff5f5' } : {}) }}
                        value={row.field}
                        placeholder="字段名"
                        title={row.field && /^['"]|^\d/.test(row.field) ? '左值必须是字段名，不能是数字或字符串字面量' : ''}
                        onChange={(e) => {
                          const next = [...condRows];
                          next[i] = { ...next[i], field: e.target.value };
                          setCondRows(next);
                        }} />
                      <Select className="orch-select-compact"
                        value={row.op}
                        options={[
                          { value: '>', label: '>' }, { value: '>=', label: '>=' },
                          { value: '<', label: '<' }, { value: '<=', label: '<=' },
                          { value: '==', label: '==' }, { value: '!=', label: '!=' },
                        ]}
                        placeholder="运算符"
                        onChange={(v) => {
                          const next = [...condRows];
                          next[i] = { ...next[i], op: v };
                          setCondRows(next);
                        }}
                      />
                      <input className="orch-config-input" style={{ width: 100, flexShrink: 0 }}
                        value={row.value}
                        placeholder="数字/字符串/字段名"
                        onChange={(e) => {
                          const next = [...condRows];
                          next[i] = { ...next[i], value: e.target.value };
                          setCondRows(next);
                        }} />
                      <button className="orch-kv-remove"
                        onClick={() => {
                          const next = condRows.filter((_, j) => j !== i);
                          setCondRows(next);
                        }}>✕</button>
                    </div>
                  ))}
                  <button type="button" className="orch-kv-add"
                    onClick={() => setCondRows([...condRows, { field: '', op: '>', value: '', logic: '&&' }])}>
                    + 添加条件
                  </button>
                </div>
                {condRows.some((r) => r.field && /^['"]|^\d/.test(r.field)) && (
                  <div className="orch-lint-warn" style={{ color: '#e05567', marginTop: 8, fontSize: 12 }}>
                    ⚠ 左值不能是数字或带引号的字符串，请填入字段名（如 age、user.name、rows[0].status）
                  </div>
                )}
                {edgeCondition && (
                  <div style={{ marginTop: 6, opacity: 0.6, fontSize: 12 }}>表达式: {edgeCondition}</div>
                )}
              </div>
            </>
          ) : selectedNode ? (
            <>
              <div className="orch-inspector-title">
                <span className="orch-node-icon" style={{ background: NODE_COLORS[selectedNodeType] || '#8c8c8c' }}>
                  {NODE_ICONS[selectedNodeType] || <span>?</span>}
                </span>
                <span className="orch-inspector-title-label">
                  {NODE_PALETTE.find((p) => p.type === selectedNodeType)?.label || selectedNodeType} 配置
                </span>
              </div>

              {/* 名称（所有节点通用） */}
              <div className="orch-config-section">
                <label className="orch-config-label">名称</label>
                <input className="orch-config-input" value={(selectedNode?.data as Record<string, unknown>)?.label as string || ''}
                  onChange={(e) => {
                    setNodes((nds) => nds.map((n) => n.id === selectedId
                      ? { ...n, data: { ...n.data, label: e.target.value } }
                      : n));
                  }}
                  placeholder="节点名称" />
              </div>

              {/* 可用变量提示（条件节点不显示，变量移到边上） */}
              {selectedNodeType !== 'condition' && (availableVars.inputVars.length > 0 || availableVars.upstreamHints.length > 0) && (
                <div className="orch-config-section">
                  <label className="orch-config-label">可用变量</label>
                  <p className="orch-config-hint">先在上方输入框点一下定位光标，再点击下方芯片自动填入。</p>
                  <div className="orch-var-chips">
                    {availableVars.inputVars.map((v) => (
                      <span key={v} className="orch-var-chip orch-var-chip-input" title="点击插入" onClick={() => onVarChipClick(v)}>{v}</span>
                    ))}
                    {availableVars.inputVars.length > 0 && availableVars.upstreamHints.length > 0 && (
                      <span style={{ fontSize: 11, color: '#8c9cab', alignSelf: 'center', margin: '0 2px' }}>|</span>
                    )}
                    {availableVars.upstreamHints.map((uh) => (
                      <span key={uh.id}>
                        <span className="orch-var-chip orch-var-chip-node" title={`${uh.label}（${uh.nodeType}）`}
                          onClick={() => onVarChipClick(`$nodes.${uh.id}`)}>$nodes.{uh.id}</span>
                        {uh.fields.map((f) => (
                          <span key={`${uh.id}.${f}`} className="orch-var-chip orch-var-chip-field"
                            title={`${uh.label} 输出字段：${f}`}
                            onClick={() => onVarChipClick(`$nodes.${uh.id}.${f}`)}>.{f}</span>
                        ))}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 入口：输入参数可视化表格 */}
              {selectedNodeType === 'start' && (() => {
                const inputs = (parsedConfig.inputs as Array<Record<string, unknown>>) || [];
                const typeOpts = ['string', 'number', 'boolean', 'object', 'array'];
                const setInputs = (fn: (arr: Array<Record<string, unknown>>) => Array<Record<string, unknown>>) => {
                  updateConfig('inputs', fn([...inputs]));
                };
                return (
                  <div className="orch-config-section">
                    <label className="orch-config-label">输入参数</label>
                    <p className="orch-config-hint">定义编排入口接收的参数，下游通过 $input.名称 引用</p>
                    {inputs.map((p, i) => (
                      <div key={i} className="orch-kv-row">
                        <input className="orch-kv-key" placeholder="参数名" value={(p.name as string) || ''}
                          onChange={(e) => setInputs((arr) => { arr[i] = { ...arr[i], name: e.target.value }; return arr; })} />
                        <div className="orch-kv-select-wrap">
                          <Select
                            className="orch-select-compact"
                            value={(p.type as string) || 'string'}
                            options={typeOpts.map((t) => ({ value: t, label: t }))}
                            onChange={(v) => setInputs((arr) => { arr[i] = { ...arr[i], type: v }; return arr; })}
                          />
                        </div>
                        <label className="orch-kv-required">
                          <input type="checkbox" checked={!!p.required}
                            onChange={(e) => setInputs((arr) => { arr[i] = { ...arr[i], required: e.target.checked }; return arr; })} />
                          必填
                        </label>
                        <button className="orch-kv-remove" onClick={() => setInputs((arr) => arr.filter((_, j) => j !== i))}>✕</button>
                      </div>
                    ))}
                    <button type="button" className="orch-kv-add" onClick={() => setInputs((arr) => [...arr, { name: '', type: 'string', required: false }])}>+ 添加参数</button>
                  </div>
                );
              })()}

              {/* 查询 / API / 流程：资源选择 + 参数模板 */}
              {(selectedNodeType === 'query' || selectedNodeType === 'http' || selectedNodeType === 'workflow') && (() => {
                const isApi = selectedNodeType === 'http';
                const isWf = selectedNodeType === 'workflow';
                const list = selectedNodeType === 'query' ? queryList : isApi ? toolList : workflowList;
                const idKey = selectedNodeType === 'query' ? 'queryId' : isApi ? 'toolId' : 'workflowDefinitionId';
                const label = selectedNodeType === 'query' ? '选择查询' : isApi ? '选择 API 工具' : '选择流程';
                return (
                  <>
                    <div className="orch-config-section">
                      <label className="orch-config-label">{label}</label>
                      <Select
                        value={String((parsedConfig[idKey] as number) || '')}
                        options={list.map((item) => ({ value: String(item.id), label: item.name }))}
                        onChange={(v) => updateConfig(idKey, v ? Number(v) : 0)}
                        placeholder={`请选择${label.replace('选择', '')}`}
                      />
                    </div>
                    {(() => {
                      const KvEditor = (kvProps: { configKey: string; title: string; hint?: string; suggestedKeys?: string[] | null }) => {
                        const obj = parsedConfig[kvProps.configKey];
                        const entries: Array<[string, string]> = (obj && typeof obj === 'object' && !Array.isArray(obj))
                          ? Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)] as [string, string])
                          : [];
                        const setEntry = (idx: number, field: 'key' | 'value', val: string) => {
                          const n: Record<string, unknown> = {};
                          entries.forEach(([k, v], i) => {
                            if (i === idx) {
                              if (field === 'key') { if (val) n[val] = v; }
                              else { if (k) n[k] = val; else if (val) n[val] = ''; }
                            } else { if (k) n[k] = v; }
                          });
                          updateConfig(kvProps.configKey, n);
                        };
                        return (
                          <div className="orch-config-section">
                            <label className="orch-config-label">{kvProps.title}</label>
                            {kvProps.hint && <p className="orch-config-hint">{kvProps.hint}</p>}
                            {/* 建议键名芯片 */}
                            {kvProps.suggestedKeys !== null && kvProps.suggestedKeys !== undefined && (
                              kvProps.suggestedKeys.length > 0 ? (
                                <div className="orch-var-chips" style={{ marginBottom: 8 }}>
                                  {kvProps.suggestedKeys.map((sk) => (
                                    <span key={sk} className="orch-var-chip orch-var-chip-suggest"
                                      title={`点击添加键 "${sk}"`}
                                      onClick={() => onVarChipClick(sk)}
                                    >{sk}</span>
                                  ))}
                                </div>
                              ) : (
                                <p className="orch-config-hint" style={{ color: '#faad14' }}>该资源未定义入参，请手动输入键名</p>
                              )
                            )}
                            {entries.map(([k, v], i) => (
                              <div key={i} className="orch-kv-row">
                                <input className="orch-kv-key" placeholder="键名" value={k}
                                  onChange={(e) => setEntry(i, 'key', e.target.value)}
                                  onFocus={() => { chipFocusRef.current = { configKey: kvProps.configKey, idx: i, field: 'key', curKey: entries[i]?.[0] || '', curVal: entries[i]?.[1] || '' }; }} />
                                <input className="orch-kv-value" placeholder="值 或 $变量引用" value={v}
                                  onChange={(e) => setEntry(i, 'value', e.target.value)}
                                  onFocus={() => { chipFocusRef.current = { configKey: kvProps.configKey, idx: i, field: 'value', curKey: entries[i]?.[0] || '', curVal: entries[i]?.[1] || '' }; }} />
                                <button className="orch-kv-remove" onClick={() => {
                                  const n: Record<string, unknown> = {};
                                  entries.forEach(([kk, vv], ii) => { if (ii !== i && kk) n[kk] = vv; });
                                  updateConfig(kvProps.configKey, n);
                                }}>✕</button>
                              </div>
                            ))}
                            <button type="button" className="orch-kv-add" onClick={() => updateConfig(kvProps.configKey, { ...(obj as Record<string, unknown> || {}), '': '' })}>+ 添加参数</button>
                          </div>
                        );
                      };
                      return <KvEditor configKey="paramsTemplate" title="参数映射" hint={`将入口参数/上游输出映射为${selectedNodeType === 'query' ? '查询' : isApi ? 'API' : '流程'}参数，值可用 $input.字段 或 $nodes.节点ID`} suggestedKeys={suggestedKeys} />;
                    })()}
                    {/* API 额外配置 */}
                    {isApi && (() => {
                      const KvEditor2 = (kvProps: { configKey: string; title: string; hint?: string }) => {
                        const obj = parsedConfig[kvProps.configKey];
                        const entries: Array<[string, string]> = (obj && typeof obj === 'object' && !Array.isArray(obj))
                          ? Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)] as [string, string])
                          : [];
                        const setEntry2 = (idx: number, field: 'key' | 'value', val: string) => {
                          const n: Record<string, unknown> = {};
                          entries.forEach(([kk, vv], ii) => {
                            if (ii === idx) {
                              if (field === 'key') { if (val) n[val] = vv; }
                              else { if (kk) n[kk] = val; else if (val) n[val] = ''; }
                            } else { if (kk) n[kk] = vv; }
                          });
                          updateConfig(kvProps.configKey, n);
                        };
                        return (
                          <div className="orch-config-section">
                            <label className="orch-config-label">{kvProps.title}</label>
                            {kvProps.hint && <p className="orch-config-hint">{kvProps.hint}</p>}
                            {entries.map(([k, v], i) => (
                              <div key={i} className="orch-kv-row">
                                <input className="orch-kv-key" placeholder="键名" value={k}
                                  onChange={(e) => setEntry2(i, 'key', e.target.value)}
                                  onFocus={() => { chipFocusRef.current = { configKey: kvProps.configKey, idx: i, field: 'key', curKey: entries[i]?.[0] || '', curVal: entries[i]?.[1] || '' }; }} />
                                <input className="orch-kv-value" placeholder="值" value={v}
                                  onChange={(e) => setEntry2(i, 'value', e.target.value)}
                                  onFocus={() => { chipFocusRef.current = { configKey: kvProps.configKey, idx: i, field: 'value', curKey: entries[i]?.[0] || '', curVal: entries[i]?.[1] || '' }; }} />
                                <button className="orch-kv-remove" onClick={() => { const n: Record<string, unknown> = {}; entries.forEach(([kk, vv], ii) => { if (ii !== i && kk) n[kk] = vv; }); updateConfig(kvProps.configKey, n); }}>✕</button>
                              </div>
                            ))}
                            <button type="button" className="orch-kv-add" onClick={() => updateConfig(kvProps.configKey, { ...(obj as Record<string, unknown> || {}), '': '' })}>+ 添加</button>
                          </div>
                        );
                      };
                      return (
                        <>
                          <KvEditor2 configKey="headers" title="请求头" hint="自定义 HTTP 请求头" />
                          <div className="orch-config-section">
                            <label className="orch-config-label">超时（毫秒）</label>
                            <input className="orch-config-input" type="number" value={(parsedConfig.timeoutMs as number) || 10000}
                              onChange={(e) => updateConfig('timeoutMs', Number(e.target.value))} />
                          </div>
                          <div className="orch-config-section">
                            <label className="orch-config-label">重试次数</label>
                            <input className="orch-config-input" type="number" value={(parsedConfig.retries as number) || 0}
                              onChange={(e) => updateConfig('retries', Number(e.target.value))} />
                          </div>
                        </>
                      );
                    })()}
                    {/* 流程额外配置 */}
                    {isWf && (
                      <div className="orch-config-section">
                        <label className="orch-config-label">动作类型</label>
                        <Select
                          value={(parsedConfig.workflowAction as string) || 'start'}
                          options={[
                            { value: 'start', label: '发起流程' },
                            { value: 'get_status', label: '查询状态' },
                            { value: 'approve', label: '审批通过' },
                            { value: 'reject', label: '审批驳回' },
                          ]}
                          onChange={(v) => updateConfig('workflowAction', v)}
                        />
                      </div>
                    )}
                    <div className="orch-config-section">
                      <p className="orch-config-hint" style={{ background: '#f6f8fa', padding: '6px 8px', borderRadius: 4 }}>
                        <strong>输出引用：</strong>下游节点通过 <code>$nodes.{selectedId}</code> 引用本节点输出。<br />
                        例如 Python 节点中取本节点返回的 total 字段：<code>$nodes.{selectedId}.total</code>
                      </p>
                    </div>
                  </>
                );
              })()}

              {/* Python：代码 + 入口函数 + 依赖包 */}
              {selectedNodeType === 'python' && (
                <>
                  <div className="orch-config-section">
                    <label className="orch-config-label">Python 代码</label>
                    <textarea className="orch-config-textarea" rows={8} value={(parsedConfig.source as string) || ''}
                      onChange={(e) => updateConfig('source', e.target.value)}
                      placeholder={'# ctx 为上游所有节点输出的字典\n# 仅可 import: json/math/re/datetime/collections\n# 返回可 JSON 序列化的对象\ndef main(ctx):\n    return { "result": ctx }'} />
                  </div>
                  <div className="orch-config-section">
                    <label className="orch-config-label">入口函数名</label>
                    <input className="orch-config-input" value={(parsedConfig.entry as string) || 'main'}
                      onChange={(e) => updateConfig('entry', e.target.value)} placeholder="main" />
                  </div>
                  <div className="orch-config-section">
                    <label className="orch-config-label">依赖包（逗号分隔）</label>
                    <input className="orch-config-input" value={((parsedConfig.packages as string[]) || []).join(', ')}
                      onChange={(e) => updateConfig('packages', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                      placeholder="json, math, datetime" />
                  </div>
                </>
              )}

              {/* 变换：模板映射 */}
              {selectedNodeType === 'transform' && (() => {
                const obj = parsedConfig.template;
                const entries: Array<[string, string]> = (obj && typeof obj === 'object' && !Array.isArray(obj))
                  ? Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)] as [string, string])
                  : [];
                const setEntry = (idx: number, field: 'key' | 'value', val: string) => {
                  const n: Record<string, unknown> = {};
                  entries.forEach(([kk, vv], ii) => {
                    if (ii === idx) {
                      if (field === 'key') { if (val) n[val] = vv; }
                      else { if (kk) n[kk] = val; else if (val) n[val] = ''; }
                    } else { if (kk) n[kk] = vv; }
                  });
                  updateConfig('template', n);
                };
                return (
                  <div className="orch-config-section">
                    <label className="orch-config-label">字段映射（template）</label>
                    <p className="orch-config-hint">键=输出字段名，值可用 $input.字段 或 $nodes.节点ID.路径 引用上游数据</p>
                    {entries.map(([k, v], i) => (
                      <div key={i} className="orch-kv-row">
                        <input className="orch-kv-key" placeholder="输出字段" value={k}
                          onChange={(e) => setEntry(i, 'key', e.target.value)}
                          onFocus={() => { chipFocusRef.current = { configKey: 'template', idx: i, field: 'key', curKey: entries[i]?.[0] || '', curVal: entries[i]?.[1] || '' }; }} />
                        <input className="orch-kv-value" placeholder="$nodes.节点ID.字段 或 $input.字段" value={v}
                          onChange={(e) => setEntry(i, 'value', e.target.value)}
                          onFocus={() => { chipFocusRef.current = { configKey: 'template', idx: i, field: 'value', curKey: entries[i]?.[0] || '', curVal: entries[i]?.[1] || '' }; }} />
                        <button className="orch-kv-remove" onClick={() => {
                          const n: Record<string, unknown> = {};
                          entries.forEach(([kk, vv], ii) => { if (ii !== i && kk) n[kk] = vv; });
                          updateConfig('template', n);
                        }}>✕</button>
                      </div>
                    ))}
                    <button type="button" className="orch-kv-add" onClick={() => updateConfig('template', { ...(obj as Record<string, unknown> || {}), '': '' })}>+ 添加映射</button>
                  </div>
                );
              })()}

              {/* 条件：仅名称，条件在边上配置 */}
              {selectedNodeType === 'condition' && (
                <div className="orch-config-section">
                  <p className="orch-config-hint" style={{ color: '#faad14', margin: 0 }}>
                    条件表达式配置在<strong>连线</strong>上。请连接条件节点到分支节点后，选中连线编辑 condition 字段。
                  </p>
                </div>
              )}

              {/* 输出：无需配置，自动输出全量上下文 */}
              {selectedNodeType === 'output' && (
                <div className="orch-config-section">
                  <p className="orch-config-hint" style={{ margin: 0 }}>
                    输出节点无需配置。执行到此节点时，自动输出所有上游节点的执行结果。
                  </p>
                </div>
              )}

              {/* 错误策略（所有节点通用） */}
              <div className="orch-config-section">
                <label className="orch-config-label">错误策略</label>
                <Select
                  value={(parsedConfig.strategy as string) || 'fail'}
                  options={[
                    { value: 'fail', label: '失败终止（默认）' },
                    { value: 'fallback', label: '降级（输出 fallback 值）' },
                    { value: 'continue', label: '跳过继续' },
                  ]}
                  onChange={(v) => updateConfig('strategy', v)}
                />
              </div>

              <div className="orch-config-advanced-row">
                <details className="orch-config-advanced">
                  <summary className="orch-config-advanced-summary">原始 DSL 配置（高级）</summary>
                  <textarea className="orch-config-textarea" rows={8} value={configJson}
                    onChange={(e) => setConfigJson(e.target.value)}
                    placeholder="{}" />
                </details>
                <button className="orch-btn orch-btn-outline" onClick={applyToSelected}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  应用配置
                </button>
              </div>
            </>
          ) : (
            <div className="orch-inspector-empty">
              <div className="orch-inspector-empty-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              </div>
              <span className="orch-inspector-empty-text">点击画布中的节点或连线进行编辑</span>
            </div>
          )}
        </div>
      </div>
      {/* 右下角浮动提示卡片 */}
      <div className="orch-toasts">
        {lintErrors.length > 0 && (
          <div className="orch-toast orch-toast-warn">
            <div className="orch-toast-head">
              <span>校验结果</span>
              <button className="orch-toast-close" onClick={() => setLintErrors([])}>×</button>
            </div>
            {lintErrors.map((e, i) => <div key={i} className="orch-toast-item">{e}</div>)}
          </div>
        )}
        {testResult && (
          <div className={`orch-toast ${testResult.success ? 'orch-toast-ok' : 'orch-toast-err'}`}>
            <div className="orch-toast-head">
              <span>试运行 {testResult.success ? '✓' : '✗'}（{testResult.durationMs}ms）</span>
              <button className="orch-toast-close" onClick={() => setTestResult(null)}>×</button>
            </div>
            {(testResult.nodeTrace || []).map((t, i) => (
              <div key={i} className={`orch-toast-trace ${t.status.toLowerCase()}`}>{t.nodeId} [{t.status}] {t.elapsedMs}ms</div>
            ))}
            {testResult.errorMessage && <div className="orch-toast-error">{testResult.errorMessage}</div>}
            <pre className="orch-toast-data">{JSON.stringify(testResult.data, null, 2).slice(0, 300)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}