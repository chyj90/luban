import { useCallback, useState, useRef, DragEvent, useEffect } from 'react';
import { useSearchParams, useParams, useNavigate } from 'react-router-dom';
import * as dagre from 'dagre';
import {
  ReactFlow,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  MarkerType,
  Handle,
  Position,
} from '@xyflow/react';
import type { Connection, Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { WorkflowNode, WorkflowEdge } from '../../types/workflow';
import { workflowApi, formApi, bindingApi, instanceApi } from '../../api/workflow';
import { toast } from '@/stores/toastStore';
import { isImpersonating } from '../../utils/impersonation';
import ApproverSelector from './ApproverSelector';
import Select from '@/components/Select';
import * as XLSX from 'xlsx';
import styles from './WorkflowDesigner.module.css';

const initialNodes: Node[] = [
  {
    id: 'start',
    type: 'startNode',
    position: { x: 296, y: 50 },
    data: { label: '发起人', nodeType: 'start', config: { nodeName: '发起人' } },
  },
  {
    id: 'end',
    type: 'endNode',
    position: { x: 296, y: 400 },
    data: { label: '结束', nodeType: 'end', config: { nodeName: '结束' } },
  },
];

const initialEdges = [
  {
    id: 'start-end',
    source: 'start',
    target: 'end',
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed },
    pathOptions: { borderRadius: 0 },
  },
] as unknown as Edge[];

const nodeTypes = {
  approvalNode: ApprovalNode,
  conditionNode: ConditionNode,
  parallelNode: ParallelNode,
  sub_processNode: SubProcessNode,
  ccNode: CcNode,
  startNode: StartNode,
  endNode: EndNode,
};

const NODE_COLORS: Record<string, string> = {
  start: '#52c41a',
  approval: '#1890ff',
  condition: '#fa8c16',
  parallel: '#722ed1',
  sub_process: '#8c8c8c',
  end: '#ff4d4f',
  cc: '#13c2c2',
};

const NODE_ICONS: Record<string, string> = {
  start: '>',
  approval: 'A',
  condition: '<>',
  parallel: '||',
  sub_process: '>',
  end: 'O',
  cc: 'CC',
};

const NODE_PANEL_ITEMS = [
  { type: 'approval', label: '审批节点', desc: '设置审批人' },
  { type: 'condition', label: '条件分支', desc: '根据条件分流' },
  { type: 'parallel', label: '并行分支', desc: '多路并行' },
  { type: 'sub_process', label: '子流程', desc: '嵌套流程' },
  { type: 'cc', label: '抄送节点', desc: '通知抄送人' },
];

function groupFormFieldsIntoRows<T extends { colSpan?: number }>(fields: T[]): T[][] {
  const rows: T[][] = [];
  const rowSpans: number[] = [];

  for (const f of fields) {
    const span = f.colSpan || 4;
    let placed = false;

    for (let i = 0; i < rows.length; i++) {
      if (rowSpans[i] + span <= 4) {
        rows[i].push(f);
        rowSpans[i] += span;
        placed = true;
        break;
      }
    }

    if (!placed) {
      rows.push([f]);
      rowSpans.push(span);
    }
  }

  return rows;
}

export default function WorkflowDesigner({
  nodesConfig: _initialNodesConfig,
  edgesConfig: _initialEdgesConfig,
  onChange: _onChange,
  embedded = false,
  processId: propProcessId,
  formMode: propFormMode = false,
  formId,
  onBack,
  appId,
}: {
  nodesConfig?: WorkflowNode[];
  edgesConfig?: WorkflowEdge[];
  onChange?: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
  embedded?: boolean;
  processId?: number;
  formMode?: boolean;
  formId?: number;
  onBack?: () => void;
  appId?: number;
}) {
  const [searchParams] = useSearchParams();
  const params = useParams();
  const effectiveAppId = appId || (params.appId ? Number(params.appId) : undefined);
  const processId = propProcessId || (params.id && params.id !== 'new' ? Number(params.id) : undefined) || (searchParams.get('processId') ? Number(searchParams.get('processId')) : undefined);
  const formMode = propFormMode || searchParams.get('formMode') === 'true';
  const startMode = !propFormMode && searchParams.get('mode') === 'start';
  const resolvedFormId = formId || (searchParams.get('formId') ? Number(searchParams.get('formId')) : undefined);
  const [nodes, setNodes, onNodesChange] = useNodesState(processId ? [] : initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(processId ? [] : initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedNodeConfig, setSelectedNodeConfig] = useState<Record<string, unknown>>({});
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDescription, setWorkflowDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [boundFormId, setBoundFormId] = useState<number | null>(null);
  const [formFieldNames, setFormFieldNames] = useState<string[]>([]);
  const [formPickerOpen, setFormPickerOpen] = useState(false);
  const [availableForms, setAvailableForms] = useState<Array<{ id: number; name: string }>>([]);
  const [availableWorkflows, setAvailableWorkflows] = useState<Array<{ id: number; name: string }>>([]);
  const [viewportZoom, setViewportZoom] = useState(1);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const nodeIdCounter = useRef(0);
  const [canvasReady, setCanvasReady] = useState(!processId);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPreview, setFormPreview] = useState(false);
  const [formFields, setFormFields] = useState<Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
    options: Array<{ label: string; value: string }>;
    columns: Array<{ key: string; label: string; type: string }>;
    computedFrom: string;
    colSpan: number;
  }>>([]);

  const [editingFieldIndex, setEditingFieldIndex] = useState<number | null>(null);

  const [startFormFields, setStartFormFields] = useState<Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
    colSpan: number;
    computedFrom: string;
    options: Array<{ label: string; value: string }>;
    columns: Array<{ key: string; label: string; type: string }>;
  }>>([]);
  const [startFormData, setStartFormData] = useState<Record<string, string>>({});
  const [excelParsedData, setExcelParsedData] = useState<Record<string, Array<Record<string, string>>>>({});
  const [startFormLoading, setStartFormLoading] = useState(false);
  const [startFormError, setStartFormError] = useState<string | null>(null);
  const [startSubmitting, setStartSubmitting] = useState(false);
  const [startSubmitted, setStartSubmitted] = useState(false);
  const navigate = useNavigate();
  const [startWorkflowName, setStartWorkflowName] = useState('');

  const historyRef = useRef<Array<{ nodes: Node[]; edges: Edge[] }>>([]);
  const historyPosRef = useRef(-1);
  const restoringRef = useRef(false);
  const initRef = useRef(true);

  const onViewportChange = useCallback(
    (_event: unknown, viewport: { zoom: number }) => {
      setViewportZoom(viewport.zoom);
    },
    [],
  );

  const pushHistory = useCallback(() => {
    if (restoringRef.current || initRef.current) return;
    const s = { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) };
    historyRef.current = historyRef.current.slice(0, historyPosRef.current + 1);
    historyRef.current.push(s);
    historyPosRef.current = historyRef.current.length - 1;
  }, [nodes, edges]);

  useEffect(() => {
    if (initRef.current) return;
    pushHistory();
  }, [nodes, edges, pushHistory]);

  // Load start form data when in start mode
  useEffect(() => {
    if (!startMode || !processId) return;
    setStartFormLoading(true);
    setStartFormError(null);

    const parseFormFields = (fieldsJson: string | null | undefined) => {
      try {
        const fields = fieldsJson ? JSON.parse(fieldsJson) : [];
        if (Array.isArray(fields) && fields.length > 0) {
          setStartFormFields(fields.map((f: unknown) => ({
            key: f.key || f.name || '',
            label: f.label || f.name || '',
            type: f.type || 'text',
            required: f.required || false,
            colSpan: f.colSpan || 1,
            computedFrom: f.computedFrom || '',
            options: f.options || [],
            columns: f.columns || [],
          })));
          const initial: Record<string, string> = {};
          fields.forEach((f: unknown) => {
            initial[f.key || f.name || ''] = '';
          });
          setStartFormData(initial);
          return true;
        }
      } catch {
        // parse failed, fall through
      }
      return false;
    };

    workflowApi.getDefinition(processId).then((def) => {
      setStartWorkflowName(def.name || '未命名流程');

      const effectiveId = def.publishedVersionId || processId;

      bindingApi.list({ workflowId: effectiveId }).then((bindings) => {
        const binding = bindings.find(b => b.workflowId === effectiveId);
        if (!binding) {
          setStartFormError('该流程未关联表单');
          setStartFormLoading(false);
          return;
        }
        return formApi.get(binding.formId).then((form) => {
          if (!parseFormFields(form.fields)) {
            setStartFormFields([]);
          }
          setStartFormLoading(false);
        }).catch(() => {
          setStartFormError('加载表单失败');
          setStartFormLoading(false);
        });
      }).catch(() => {
        setStartFormError('加载绑定信息失败');
        setStartFormLoading(false);
      });
    }).catch(() => {
      setStartFormError('加载流程信息失败');
      setStartFormLoading(false);
    });
  }, [startMode, processId]);

  const handleUndo = useCallback(() => {
    if (historyPosRef.current <= 0) return;
    historyPosRef.current--;
    const s = historyRef.current[historyPosRef.current];
    restoringRef.current = true;
    setNodes(s.nodes);
    setEdges(s.edges);
    setTimeout(() => { restoringRef.current = false; }, 0);
  }, [setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    if (historyPosRef.current >= historyRef.current.length - 1) return;
    historyPosRef.current++;
    const s = historyRef.current[historyPosRef.current];
    restoringRef.current = true;
    setNodes(s.nodes);
    setEdges(s.edges);
    setTimeout(() => { restoringRef.current = false; }, 0);
  }, [setNodes, setEdges]);

  const handleAutoLayout = useCallback(() => {
    if (nodes.length === 0) return;
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 100 });

    const nodeWidth = 220;
    const nodeHeight = 80;

    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();
    nodes.forEach((n) => { inDegree.set(n.id, 0); outDegree.set(n.id, 0); });
    edges.forEach((e) => {
      inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
      outDegree.set(e.source, (outDegree.get(e.source) || 0) + 1);
    });

    const startNode = nodes.find((n) => (n.data as unknown)?.nodeType === 'start');
    const endNode = nodes.find((n) => (n.data as unknown)?.nodeType === 'end');

    nodes.forEach((node) => {
      g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });
    edges.forEach((edge) => {
      g.setEdge(edge.source, edge.target);
    });

    if (startNode) {
      nodes.forEach((n) => {
        if (n.id !== startNode.id && (inDegree.get(n.id) || 0) === 0) {
          g.setEdge(startNode.id, n.id);
        }
      });
    }
    if (endNode) {
      nodes.forEach((n) => {
        if (n.id !== endNode.id && (outDegree.get(n.id) || 0) === 0) {
          g.setEdge(n.id, endNode.id);
        }
      });
    }

    dagre.layout(g);

    const laidOut = nodes.map((node) => {
      const pos = g.node(node.id);
      return {
        ...node,
        position: {
          x: pos.x - nodeWidth / 2,
          y: pos.y - nodeHeight / 2,
        },
      };
    });

    setNodes(laidOut);
  }, [nodes, edges, setNodes]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  useEffect(() => {
    if (processId) {
      workflowApi.getDefinition(processId).then((def) => {
        setWorkflowName(def.name || '');
        setWorkflowDescription(def.description || '');
        try {
          if (def.nodes) {
            const parsed = JSON.parse(def.nodes);
            let maxCounter = 0;
            parsed.forEach((node: unknown) => {
              const match = node.id?.match(/_(\d+)$/);
              if (match) {
                maxCounter = Math.max(maxCounter, parseInt(match[1], 10));
              }
            });
            nodeIdCounter.current = maxCounter;
            const safeNodes = parsed.map((node: unknown, i: number) => ({
              ...node,
              position: node.position && typeof node.position.x === 'number' && typeof node.position.y === 'number'
                ? node.position
                : { x: 300, y: 100 + i * 120 },
            }));
            setNodes(safeNodes);
          }
          if (def.edges) {
            const parsed = JSON.parse(def.edges);
            setEdges(parsed);
          }
        } catch { /* ignore parse errors */ }
        initRef.current = false;
        setCanvasReady(true);
      }).catch(() => {
        toast.error('加载流程数据失败');
        initRef.current = false;
        setCanvasReady(true);
      });
    } else {
      initRef.current = false;
    }
  }, [processId, setNodes, setEdges]);

  useEffect(() => {
    if (processId) {
      bindingApi.list({ workflowId: processId }).then((bindings) => {
        const binding = bindings?.[0];
        if (binding) {
          setBoundFormId(binding.formId);
          formApi.get(binding.formId).then((form) => {
            try {
              const fields = form.fields ? JSON.parse(form.fields) : [];
              setFormFieldNames(Array.isArray(fields) ? fields.map((f: unknown) => f.name || f.key) : []);
            } catch { setFormFieldNames([]); }
          }).catch(() => {});
        }
      }).catch(() => {});
    }
  }, [processId]);

  useEffect(() => {
    if (formMode && resolvedFormId) {
      formApi.get(resolvedFormId).then((form) => {
        setFormName(form.name || '');
        setFormDescription(form.description || '');
        try {
          const fields = form.fields ? JSON.parse(form.fields) : [];
          if (Array.isArray(fields)) {
            setFormFields(fields.map((f: unknown) => ({
              key: f.key || '',
              label: f.label || '',
              type: f.type || 'text',
              required: !!f.required,
              options: f.options || [],
              columns: f.columns || [],
              computedFrom: f.computedFrom || '',
              colSpan: f.colSpan || 4,
            })));
          }
        } catch { /* ignore parse error */ }
      }).catch(console.error);
    }
  }, [formMode, resolvedFormId]);

  const openFormPicker = useCallback(async () => {
    setFormPickerOpen(true);
    try {
      const forms = await formApi.list({ applicationId: appId } as unknown);
      setAvailableForms(forms.map((f: unknown) => ({ id: f.id, name: f.name })));
    } catch {
      setAvailableForms([]);
    }
  }, [appId]);

  const loadWorkflows = useCallback(async () => {
    if (availableWorkflows.length > 0) return;
    try {
      const defs = await workflowApi.listDefinitions({ applicationId: appId } as unknown);
      setAvailableWorkflows(defs.filter((d: unknown) => d.id !== processId).map((d: unknown) => ({ id: d.id, name: d.name })));
    } catch {
      setAvailableWorkflows([]);
    }
  }, [appId, processId, availableWorkflows.length]);

  const bindForm = useCallback(async (formId: number) => {
    if (!processId) {
      toast.warning('请先保存流程后再关联表单');
      return;
    }
    try {
      await bindingApi.bind({ formId, workflowId: processId });
      setBoundFormId(formId);
      setFormPickerOpen(false);
      const form = await formApi.get(formId);
      try {
        const fields = form.fields ? JSON.parse(form.fields) : [];
        setFormFieldNames(Array.isArray(fields) ? fields.map((f: unknown) => f.name || f.key) : []);
      } catch { setFormFieldNames([]); }
      toast.success('表单关联成功');
    } catch (e: unknown) {
      toast.error(e?.response?.data?.message || '关联失败');
    }
  }, [processId]);

  const GATEWAY_TYPES = new Set(['condition', 'parallel']);

  const handleSave = useCallback(async () => {
    if (!workflowName.trim()) {
      toast.warning('请输入流程名称');
      return;
    }
    setSaving(true);
    try {
      const outgoing = new Map<string, number>();
      edges.forEach((e) => {
        outgoing.set(e.source, (outgoing.get(e.source) || 0) + 1);
      });
      for (const node of nodes) {
        const nt = (node.data as unknown)?.nodeType || node.type?.replace('Node', '') || '';
        if (!GATEWAY_TYPES.has(nt) && (outgoing.get(node.id) || 0) > 1) {
          toast.warning(`节点「${(node.data as unknown)?.label || node.id}」有多条出边，请使用「并行节点」或「条件节点」来分叉`);
          setSaving(false);
          return;
        }
      }
      const data = {
        name: workflowName.trim(),
        description: workflowDescription.trim(),
        applicationId: appId,
        nodes: JSON.stringify(nodes),
        edges: JSON.stringify(edges),
      };
      if (processId) {
        await workflowApi.updateDefinition(processId, data as unknown);
        toast.success('保存成功');
      } else {
        const created = await workflowApi.createDefinition(data as unknown);
        toast.success('创建成功');
        // Update URL if navigating from /workflow/designer to /workflow/designer/:id
        if (!embedded) {
          window.history.replaceState(null, '', `/apps/${appId}/designer/${created.id}`);
        }
      }
    } catch (e: unknown) {
      const msg = e?.response?.data?.message || e?.message || '保存失败';
      toast.error(typeof msg === 'string' ? msg.substring(0, 200) : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [workflowName, workflowDescription, nodes, edges, processId, embedded]);

  const handlePublish = useCallback(async () => {
    if (!processId) {
      toast.warning('请先保存流程后再发布');
      return;
    }
    if (!workflowName.trim()) {
      toast.warning('请输入流程名称');
      return;
    }
    setShowPublishDialog(true);
  }, [processId, workflowName]);

  const confirmPublish = useCallback(async () => {
    if (!processId) return;
    setPublishing(true);
    setShowPublishDialog(false);
    try {
      const data = {
        name: workflowName.trim(),
        description: workflowDescription.trim(),
        applicationId: appId,
        nodes: JSON.stringify(nodes),
        edges: JSON.stringify(edges),
      };
      await workflowApi.updateDefinition(processId, data as unknown);
      await workflowApi.publishDefinition(processId);
      toast.success('发布成功');
      if (!embedded) {
        window.location.reload();
      }
    } catch (e: unknown) {
      const msg = e?.response?.data?.message || e?.message || '发布失败';
      toast.error(typeof msg === 'string' ? msg.substring(0, 200) : '发布失败');
    } finally {
      setPublishing(false);
    }
  }, [processId, embedded, workflowName, workflowDescription, appId, nodes, edges]);

  const handleTest = useCallback(async () => {
    if (!processId) {
      toast.warning('请先保存流程后再发起测试');
      return;
    }
    try {
      await workflowApi.initTestData(appId!);
      const _def = await workflowApi.getDefinition(processId);
      const isTest = true;
      await instanceApi.start({
        definitionId: processId,
        formData: '{}',
        isTest,
      });
      toast.success('测试流程已发起，请前往「我的工作」查看');
    } catch (e: unknown) {
      const msg = e?.response?.data?.message || e?.message || '发起测试失败';
      toast.error(typeof msg === 'string' ? msg.substring(0, 200) : '发起测试失败');
    }
  }, [processId, appId]);

  const handleSubmitStartForm = useCallback(async () => {
    if (!processId) return;
    const missing = startFormFields.filter(f => f.required && !startFormData[f.key]?.trim());
    if (missing.length > 0) {
      toast.warning(`请填写：${missing.map(f => f.label).join('、')}`);
      return;
    }
    setStartSubmitting(true);
    try {
      const merged: Record<string, unknown> = { ...startFormData };
      Object.entries(excelParsedData).forEach(([key, rows]) => {
        if (rows.length > 0) merged[key] = rows;
      });
      const formData = JSON.stringify(merged);
      await instanceApi.start({
        definitionId: processId,
        formData,
        isTest: isImpersonating(),
      });
      setStartSubmitted(true);
      toast.success('流程已发起');
      setTimeout(() => navigate(effectiveAppId ? `/apps/${effectiveAppId}` : '/work'), 1500);
    } catch (e: unknown) {
      const msg = e?.response?.data?.message || e?.message || '发起失败';
      toast.error(typeof msg === 'string' ? msg.substring(0, 200) : '发起失败');
    } finally {
      setStartSubmitting(false);
    }
  }, [processId, startFormFields, startFormData, excelParsedData]);

  const onConnect = useCallback(
    (params: Connection) => {
      const sourceNode = nodes.find((n) => n.id === params.source);
      if (sourceNode) {
        const nodeType = (sourceNode.data as unknown)?.nodeType || sourceNode.type?.replace('Node', '') || '';
        if (!GATEWAY_TYPES.has(nodeType)) {
          const existingOutgoing = edges.filter((e) => e.source === params.source);
          if (existingOutgoing.length > 0) {
            toast.warning('非网关节点只能有一条出边，请使用「并行节点」或「条件节点」来分叉');
            return;
          }
        }
      }
      setEdges((eds) =>
        addEdge(
          { ...params, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed }, pathOptions: { borderRadius: 0 } } as unknown,
          eds,
        ),
      );
    },
    [setEdges, nodes, edges],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow');
      if (!type || !reactFlowWrapper.current) return;

      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      let x = event.clientX - reactFlowBounds.left - 100;
      const y = event.clientY - reactFlowBounds.top - 20;

      const threshold = 16;
      const aligned = nodes.find((n) => n.position && Math.abs(n.position.x - x) < threshold);
      if (aligned) {
        x = aligned.position.x;
      }

      nodeIdCounter.current += 1;
      const nodeId = `${type}_${nodeIdCounter.current}`;
      const color = NODE_COLORS[type] || '#8c8c8c';
      const icon = NODE_ICONS[type] || '';
      const label = NODE_PANEL_ITEMS.find(i => i.type === type)?.label || type;

      const newNode: Node = {
        id: nodeId,
        type: type !== 'start' && type !== 'end' ? `${type}Node` : undefined,
        position: { x, y },
        selected: true,
        data: {
          label,
          nodeType: type,
          color,
          icon,
          config: { nodeName: label },
        },
      };

      setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), newNode] as Node[]);
      setSelectedNode(newNode);
      setSelectedNodeConfig(newNode.data.config as Record<string, unknown> || {});
    },
    [nodes, setNodes],
  );

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setSelectedNodeConfig(node.data.config as Record<string, unknown> || {});
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const onNodesDelete = useCallback((deleted: Node[]) => {
    if (selectedNode && deleted.some((n) => n.id === selectedNode.id)) {
      setSelectedNode(null);
    }
  }, [selectedNode]);

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      if (!node.position) return;
      const threshold = 8;
      const connectedEdges = edges.filter(
        (e) => e.source === node.id || e.target === node.id,
      );
      const connectedIds = new Set(
        connectedEdges.map((e) => (e.source === node.id ? e.target : e.source)),
      );

      let targetX = node.position.x;
      connectedIds.forEach((id) => {
        const other = nodes.find((n) => n.id === id);
        if (other && other.position && Math.abs(other.position.x - node.position.x) < threshold) {
          targetX = other.position.x;
        }
      });

      if (targetX !== node.position.x) {
        setNodes((nds) =>
          nds.map((n) =>
            n.id === node.id
              ? { ...n, position: { ...n.position, x: targetX } }
              : n,
          ),
        );
      }
    },
    [edges, nodes, setNodes],
  );

  const updateNodeConfig = useCallback(
    (key: string, value: unknown) => {
      setSelectedNodeConfig((prev) => ({ ...prev, [key]: value }));
      setNodes((nds) =>
        nds.map((n) =>
          n.id === selectedNode?.id
            ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } }
            : n,
        ),
      );
    },
    [selectedNode, setNodes],
  );

  const nodeLabel = (type: string) => {
    const item = NODE_PANEL_ITEMS.find(i => i.type === type);
    return item ? item.label : type;
  };

  const handleFormSave = useCallback(async () => {
    if (!formName.trim()) {
      toast.error('请输入表单名称');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: formName,
        description: formDescription,
        fields: JSON.stringify(formFields),
        applicationId: appId,
      };
      if (resolvedFormId) {
        await formApi.update(resolvedFormId, payload);
        toast.success('表单更新成功');
      } else {
        await formApi.create(payload);
        toast.success('表单创建成功');
      }
      if (onBack) onBack();
      else window.history.back();
    } catch (e: unknown) {
      const msg = e?.response?.data?.message || e?.message || '保存失败';
      toast.error(typeof msg === 'string' ? msg.substring(0, 200) : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [formName, formDescription, formFields, appId, resolvedFormId, onBack]);

  const addFormField = useCallback(() => {
    setFormFields(prev => [...prev, { key: '', label: '', type: 'text', required: false, options: [], columns: [], computedFrom: '', colSpan: 4 }]);
    setEditingFieldIndex(formFields.length);
  }, [formFields.length]);

  const removeFormField = useCallback((index: number) => {
    setFormFields(prev => prev.filter((_, i) => i !== index));
  }, []);

  const updateFormField = useCallback((index: number, field: Partial<typeof formFields[number]>) => {
    setFormFields(prev => prev.map((f, i) => i === index ? { ...f, ...field } : f));
  }, []);

  if (formMode) {
    const selectedField = editingFieldIndex !== null ? formFields[editingFieldIndex] : null;
    const addOption = () => {
      if (editingFieldIndex === null) return;
      const field = formFields[editingFieldIndex];
      updateFormField(editingFieldIndex, { options: [...field.options, { label: '', value: '' }] });
    };
    const removeOption = (oi: number) => {
      if (editingFieldIndex === null) return;
      const field = formFields[editingFieldIndex];
      updateFormField(editingFieldIndex, { options: field.options.filter((_, i) => i !== oi) });
    };
    const updateOption = (oi: number, opt: Partial<{ label: string; value: string }>) => {
      if (editingFieldIndex === null) return;
      const field = formFields[editingFieldIndex];
      const opts = field.options.map((o, i) => i === oi ? { ...o, ...opt } : o);
      updateFormField(editingFieldIndex, { options: opts });
    };
    const addColumn = () => {
      if (editingFieldIndex === null) return;
      const field = formFields[editingFieldIndex];
      updateFormField(editingFieldIndex, { columns: [...field.columns, { key: '', label: '', type: 'text' }] });
    };
    const removeColumn = (ci: number) => {
      if (editingFieldIndex === null) return;
      const field = formFields[editingFieldIndex];
      updateFormField(editingFieldIndex, { columns: field.columns.filter((_, i) => i !== ci) });
    };
    const updateColumn = (ci: number, col: Partial<{ key: string; label: string; type: string }>) => {
      if (editingFieldIndex === null) return;
      const field = formFields[editingFieldIndex];
      const cols = field.columns.map((c, i) => i === ci ? { ...c, ...col } : c);
      updateFormField(editingFieldIndex, { columns: cols });
    };
    const isEnumType = (t: string) => ['select', 'multi_select', 'radio'].includes(t);
    return (
      <div className={styles.designer}>
        <div className={styles.toolbar}>
          <button className={styles.toolbarBtn} onClick={() => onBack ? onBack() : window.history.back()}>
            ← 返回
          </button>
          <div className={styles.toolbarActions}>
            <button className={styles.toolbarBtn} onClick={() => { setFormPreview(!formPreview); setEditingFieldIndex(null); }}>
              {formPreview ? '编辑' : '预览'}
            </button>
            <button className={styles.toolbarBtnPrimary} onClick={handleFormSave} disabled={saving}>
              {saving ? '保存中...' : '保存表单'}
            </button>
          </div>
        </div>
        <div className={styles.body}>
          <div className={styles.leftPanel} style={{ flex: '0 0 280px' }}>
            <div className={styles.panelTitle}>字段列表</div>
            {formFields.map((field, index) => (
              <div
                key={index}
                className={styles.conditionItem}
                style={{ cursor: 'pointer', borderLeft: editingFieldIndex === index ? '3px solid #1677ff' : '3px solid transparent' }}
                onClick={() => setEditingFieldIndex(index)}
              >
                <div className={styles.conditionHeader}>
                  <span className={styles.conditionIndex}>{index + 1}</span>
                  <span style={{ flex: 1 }}>{field.label || '未命名字段'}</span>
                  <span style={{ fontSize: 11, color: '#8c9cab' }}>{field.type}</span>
                  <button
                    className={styles.formBindBtn}
                    style={{ marginLeft: 4, color: '#ff4d4f', borderColor: '#ff4d4f', padding: '2px 6px', fontSize: 11 }}
                    onClick={(e) => { e.stopPropagation(); removeFormField(index); if (editingFieldIndex === index) setEditingFieldIndex(null); }}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
            <button
              className={styles.formBindBtn}
              style={{ marginTop: 8, width: '100%' }}
              onClick={addFormField}
            >
              + 添加字段
            </button>
          </div>
          <div className={styles.canvas} style={{ flex: 1, background: '#fff', padding: 24, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className={styles.configGroup}>
              <label className={styles.configLabel}>表单名称</label>
              <input
                className={styles.configInput}
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="请输入表单名称"
              />
            </div>
            <div className={styles.configGroup}>
              <label className={styles.configLabel}>表单描述</label>
              <textarea
                className={styles.configInput}
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                placeholder="请输入表单描述"
                rows={3}
                style={{ resize: 'vertical' }}
              />
            </div>
            {formPreview ? (
              <div style={{ flex: 1, border: '1px solid #e8edf3', borderRadius: 8, padding: 20 }}>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{formName || '未命名表单'}</div>
                {formDescription && <div style={{ fontSize: 13, color: '#8c9cab', marginBottom: 16 }}>{formDescription}</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {groupFormFieldsIntoRows(formFields).map((row, ri) => (
                    <div key={ri} style={{ display: 'flex', gap: 12 }}>
                      {row.map((field, i) => (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: field.colSpan || 4 }}>
                      <label style={{ fontSize: 13, fontWeight: 500, color: '#1f1f1f' }}>
                        {field.label || field.key || `字段${i + 1}`}
                        {field.required && <span style={{ color: '#ff4d4f', marginLeft: 4 }}>*</span>}
                      </label>
                      {field.type === 'textarea' ? (
                        <textarea
                          disabled
                          className={styles.configInput}
                          rows={3}
                          placeholder={`请输入${field.label || field.key}`}
                          style={{ resize: 'vertical' }}
                        />
                      ) : field.type === 'select' ? (
                        <select disabled className={styles.configInput}>
                          {field.options.map((opt, oi) => <option key={oi}>{opt.label || opt.value}</option>)}
                        </select>
                      ) : field.type === 'multi_select' ? (
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          {field.options.map((opt, oi) => (
                            <label key={oi} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <input type="checkbox" disabled />
                              {opt.label || opt.value}
                            </label>
                          ))}
                        </div>
                      ) : field.type === 'radio' ? (
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          {field.options.map((opt, oi) => (
                            <label key={oi} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <input type="radio" disabled name={`field_${i}`} />
                              {opt.label || opt.value}
                            </label>
                          ))}
                        </div>
                      ) : field.type === 'checkbox' ? (
                        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="checkbox" disabled />
                          {field.label || field.key}
                        </label>
                      ) : field.type === 'switch' ? (
                        <div style={{ width: 44, height: 22, borderRadius: 11, background: '#d9d9d9', position: 'relative' }}>
                          <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: 2 }} />
                        </div>
                      ) : field.type === 'date' ? (
                        <input type="date" disabled className={styles.configInput} />
                      ) : field.type === 'datetime' ? (
                        <input type="datetime-local" disabled className={styles.configInput} />
                      ) : field.type === 'number' ? (
                        <input type="number" disabled className={styles.configInput} placeholder={`请输入${field.label || field.key}`} />
                      ) : field.type === 'file' || field.type === 'excel' ? (
                        <>
                          <div style={{ border: '1px dashed #d9d9d9', borderRadius: 6, padding: '16px 12px', textAlign: 'center', color: '#8c9cab', fontSize: 13 }}>
                            {field.type === 'excel' ? '点击上传 Excel 文件' : '点击上传文件'}
                          </div>
                          {field.type === 'excel' && field.columns && field.columns.length > 0 && (
                            <div style={{ marginTop: 8, border: '1px solid #e8e8e8', borderRadius: 4, overflow: 'hidden' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                  <tr style={{ background: '#fafafa' }}>
                                    {field.columns.map((col, ci) => (
                                      <th key={ci} style={{ padding: '8px 12px', borderBottom: '1px solid #e8e8e8', textAlign: 'left', fontWeight: 500 }}>{col.label}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    {field.columns.map((col, ci) => (
                                      <td key={ci} style={{ padding: '8px 12px', color: '#ccc' }}>—</td>
                                    ))}
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          )}
                        </>
                      ) : field.type === 'member' || field.type === 'department' ? (
                        <input disabled className={styles.configInput} placeholder={field.type === 'member' ? '选择人员' : '选择部门'} />
                      ) : field.type === 'detail_table' ? (
                        <div style={{ border: '1px solid #e8edf3', borderRadius: 6, overflow: 'hidden' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                              <tr style={{ background: '#fafafa' }}>
                                {field.columns.map((col, ci) => <th key={ci} style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #e8edf3', color: '#8c9cab' }}>{col.label || col.key}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              <tr><td colSpan={field.columns.length || 1} style={{ padding: 16, textAlign: 'center', color: '#bfbfbf' }}>暂无数据</td></tr>
                            </tbody>
                          </table>
                        </div>
                      ) : field.type === 'computed' ? (
                        <input disabled className={styles.configInput} style={{ background: '#f5f5f5', color: '#8c9cab' }} placeholder="自动计算" />
                      ) : (
                        <input disabled className={styles.configInput} placeholder={`请输入${field.label || field.key}`} />
                      )}
                    </div>
                  ))}
                </div>
              ))}
              {formFields.length === 0 && (
                <div style={{ textAlign: 'center', color: '#bfbfbf', padding: 40, fontSize: 14 }}>暂无字段，请切换到编辑模式添加</div>
              )}
            </div>
              </div>
            ) : selectedField ? (
              <>
                <div className={styles.configGroup}>
                  <label className={styles.configLabel}>编辑字段 #{editingFieldIndex! + 1}</label>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <input
                      className={styles.configInputSmall}
                      placeholder="字段标识(key)"
                      value={selectedField.key}
                      onChange={e => updateFormField(editingFieldIndex!, { key: e.target.value })}
                    />
                    <input
                      className={styles.configInputSmall}
                      placeholder="字段标签"
                      value={selectedField.label}
                      onChange={e => updateFormField(editingFieldIndex!, { label: e.target.value })}
                    />
                    <select
                      className={styles.configInputSmall}
                      value={selectedField.type}
                      onChange={e => {
                        const newType = e.target.value;
                        updateFormField(editingFieldIndex!, {
                          type: newType,
                          colSpan: (newType === 'excel' || newType === 'file') ? 4 : undefined,
                        });
                      }}
                    >
                      <option value="text">文本</option>
                      <option value="number">数字</option>
                      <option value="date">日期</option>
                      <option value="datetime">日期时间</option>
                      <option value="select">下拉选择</option>
                      <option value="multi_select">多选下拉</option>
                      <option value="radio">单选按钮组</option>
                      <option value="checkbox">复选框</option>
                      <option value="switch">开关</option>
                      <option value="textarea">多行文本</option>
                      <option value="file">附件上传</option>
                      <option value="excel">Excel上传</option>
                      <option value="member">人员选择</option>
                      <option value="department">部门选择</option>
                      <option value="detail_table">明细表</option>
                      <option value="computed">计算字段</option>
                    </select>
                    <label style={{ fontSize: 12, color: '#8c9cab', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                      <input
                        type="checkbox"
                        checked={selectedField.required}
                        onChange={e => updateFormField(editingFieldIndex!, { required: e.target.checked })}
                      />
                      必填
                    </label>
                    <select
                      className={styles.configInputSmall}
                      value={selectedField.colSpan || 4}
                      onChange={e => updateFormField(editingFieldIndex!, { colSpan: Number(e.target.value) })}
                      style={{ width: 72 }}
                      disabled={selectedField.type === 'excel' || selectedField.type === 'file'}
                    >
                      <option value={4}>4栏</option>
                      <option value={3}>3栏</option>
                      <option value={2}>2栏</option>
                      <option value={1}>1栏</option>
                    </select>
                  </div>
                </div>

                {isEnumType(selectedField.type) && (
                  <div className={styles.configGroup}>
                    <label className={styles.configLabel}>枚举选项</label>
                    {selectedField.options.map((opt, oi) => (
                      <div key={oi} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <input
                          className={styles.configInputSmall}
                          placeholder="选项值"
                          value={opt.value}
                          onChange={e => updateOption(oi, { value: e.target.value })}
                        />
                        <input
                          className={styles.configInputSmall}
                          placeholder="选项标签"
                          value={opt.label}
                          onChange={e => updateOption(oi, { label: e.target.value })}
                        />
                        <button
                          className={styles.formBindBtn}
                          style={{ color: '#ff4d4f', borderColor: '#ff4d4f', padding: '2px 8px', fontSize: 11, flexShrink: 0 }}
                          onClick={() => removeOption(oi)}
                        >
                          删除
                        </button>
                      </div>
                    ))}
                    <button
                      className={styles.formBindBtn}
                      style={{ marginTop: 4, width: '100%' }}
                      onClick={addOption}
                    >
                      + 添加选项
                    </button>
                  </div>
                )}

                {selectedField.type === 'detail_table' && (
                  <div className={styles.configGroup}>
                    <label className={styles.configLabel}>明细表列</label>
                    {selectedField.columns.map((col, ci) => (
                      <div key={ci} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <input
                          className={styles.configInputSmall}
                          placeholder="列标识"
                          value={col.key}
                          onChange={e => updateColumn(ci, { key: e.target.value })}
                        />
                        <input
                          className={styles.configInputSmall}
                          placeholder="列标签"
                          value={col.label}
                          onChange={e => updateColumn(ci, { label: e.target.value })}
                        />
                        <select
                          className={styles.configInputSmall}
                          value={col.type}
                          onChange={e => updateColumn(ci, { type: e.target.value })}
                        >
                          <option value="text">文本</option>
                          <option value="number">数字</option>
                          <option value="date">日期</option>
                        </select>
                        <button
                          className={styles.formBindBtn}
                          style={{ color: '#ff4d4f', borderColor: '#ff4d4f', padding: '2px 8px', fontSize: 11, flexShrink: 0 }}
                          onClick={() => removeColumn(ci)}
                        >
                          删除
                        </button>
                      </div>
                    ))}
                    <button
                      className={styles.formBindBtn}
                      style={{ marginTop: 4, width: '100%' }}
                      onClick={addColumn}
                    >
                      + 添加列
                    </button>
                  </div>
                )}

                {selectedField.type === 'excel' && (
                  <div className={styles.configGroup}>
                    <label className={styles.configLabel}>Excel 解析配置</label>
                    <div className={styles.configHint} style={{ marginBottom: 8 }}>
                      用户上传 Excel 后自动解析为表格，列定义如下：
                    </div>
                    {selectedField.columns.map((col, ci) => (
                      <div key={ci} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <input
                          className={styles.configInputSmall}
                          placeholder="列标识"
                          value={col.key}
                          onChange={e => updateColumn(ci, { key: e.target.value })}
                        />
                        <input
                          className={styles.configInputSmall}
                          placeholder="列标签"
                          value={col.label}
                          onChange={e => updateColumn(ci, { label: e.target.value })}
                        />
                        <select
                          className={styles.configInputSmall}
                          value={col.type}
                          onChange={e => updateColumn(ci, { type: e.target.value })}
                        >
                          <option value="text">文本</option>
                          <option value="number">数字</option>
                          <option value="date">日期</option>
                        </select>
                        <button
                          className={styles.formBindBtn}
                          style={{ color: '#ff4d4f', borderColor: '#ff4d4f', padding: '2px 8px', fontSize: 11, flexShrink: 0 }}
                          onClick={() => removeColumn(ci)}
                        >
                          删除
                        </button>
                      </div>
                    ))}
                    <button
                      className={styles.formBindBtn}
                      style={{ marginTop: 4, width: '100%' }}
                      onClick={addColumn}
                    >
                      + 添加列
                    </button>
                  </div>
                )}

                {selectedField.type === 'computed' && (
                  <div className={styles.configGroup}>
                    <label className={styles.configLabel}>计算公式</label>
                    <p className={styles.configHint} style={{ marginBottom: 8 }}>
                      点击字段和运算符可插入到表达式。仅显示数值/日期/文本/计算类型的字段。
                    </p>
                    <input
                      className={`${styles.configInput} ap-computed-input`}
                      placeholder="例如: amount * price"
                      value={selectedField.computedFrom || ''}
                      onChange={e => updateFormField(editingFieldIndex!, { computedFrom: e.target.value })}
                    />
                    <div className={styles.conditionRef}>
                      <div className={styles.conditionRefTitle}>支持运算符（点击插入）</div>
                      <div className={styles.conditionOpList}>
                        {['+', '-', '*', '/', '%', '>', '<', '>=', '<=', '==', '!=', '&&', '||', '(', ')'].map((op) => (
                          <span
                            key={op}
                            className={styles.conditionOpTag}
                            style={{ cursor: 'pointer' }}
                            onClick={() => {
                              const input = document.querySelector<HTMLInputElement>('.ap-computed-input');
                              if (input) {
                                const start = input.selectionStart || 0;
                                const end = input.selectionEnd || 0;
                                const val = input.value;
                                const newVal = val.slice(0, start) + ` ${op} ` + val.slice(end);
                                updateFormField(editingFieldIndex!, { computedFrom: newVal });
                                setTimeout(() => { input.selectionStart = input.selectionEnd = start + op.length + 2; }, 0);
                              }
                            }}
                          >
                            {op}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className={styles.conditionRef}>
                      <div className={styles.conditionRefTitle}>可用字段（点击插入）</div>
                      <div className={styles.conditionParamList}>
                        {formFields.filter((f, i) => {
                          if (i === editingFieldIndex) return false;
                          const t = f.type;
                          return ['number', 'computed', 'text', 'date', 'datetime', 'textarea', 'select', 'radio'].includes(t);
                        }).length === 0 ? (
                          <span className={styles.configHint}>暂无可选字段</span>
                        ) : (
                          <div className={styles.conditionParamGroup}>
                            {formFields.filter((f, i) => {
                              if (i === editingFieldIndex) return false;
                              const t = f.type;
                              return ['number', 'computed', 'text', 'date', 'datetime', 'textarea', 'select', 'radio'].includes(t);
                            }).map((f) => (
                              <span
                                key={f.key}
                                className={styles.conditionParamTag}
                                style={{ cursor: 'pointer' }}
                                onClick={() => {
                                  const input = document.querySelector<HTMLInputElement>('.ap-computed-input');
                                  if (input) {
                                    const start = input.selectionStart || 0;
                                    const end = input.selectionEnd || 0;
                                    const val = input.value;
                                    const newVal = val.slice(0, start) + f.key + val.slice(end);
                                    updateFormField(editingFieldIndex!, { computedFrom: newVal });
                                    setTimeout(() => { input.selectionStart = input.selectionEnd = start + f.key.length; }, 0);
                                  }
                                }}
                              >
                                {f.key}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8c9cab', fontSize: 14 }}>
                {formFields.length === 0 ? '点击左侧"添加字段"开始设计表单' : '点击左侧字段进行编辑'}
              </div>
            )}
          </div>
          <div className={styles.rightPanel} style={{ flex: '0 0 0', display: 'none' }} />
        </div>
      </div>
    );
  }

  if (startMode) {
    const renderField = (field: typeof startFormFields[0]) => {
      const val = startFormData[field.key] || '';
      const onChange = (v: string) => {
        setStartFormData(prev => ({ ...prev, [field.key]: v }));
      };

      if (field.type === 'computed') {
        try {
          const ctx: Record<string, number> = {};
          startFormFields.forEach(f => {
            if (f.type === 'number' || f.type === 'computed') {
              ctx[f.key] = Number(startFormData[f.key]) || 0;
            }
          });
          const expr = field.computedFrom.replace(/\b([a-zA-Z_]\w*)\b/g, (m: string) => {
            return ctx[m] !== undefined ? String(ctx[m]) : '0';
          });
          const result = Function(`"use strict"; return (${expr})`)();
          if (String(result) !== val) {
            setTimeout(() => onChange(String(result)), 0);
          }
        } catch { /* ignore parse errors */ }
        return (
          <input
            className={styles.configInput}
            type="text"
            value={val}
            readOnly
            style={{ width: '100%', background: '#f5f5f5', cursor: 'not-allowed' }}
          />
        );
      }

      if (field.type === 'excel') {
        const rows = excelParsedData[field.key] || [];
        return (
          <div>
            <label style={{ display: 'block', cursor: 'pointer' }}>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  onChange(file.name);
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    try {
                      const wb = XLSX.read(ev.target?.result, { type: 'array' });
                      const ws = wb.Sheets[wb.SheetNames[0]];
                      const data = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { header: 1, defval: '' });
                      if (data.length > 0) {
                        const rawHeaders = (data[0] as string[]).map(h => String(h).trim()).filter(h => h !== '');
                        const headerMap: Record<string, string> = {};
                        rawHeaders.forEach(h => {
                          const col = field.columns?.find(c => c.key === h || c.label === h);
                          headerMap[h] = col ? col.key : h;
                        });
                        const parsed = data.slice(1)
                          .filter((row: unknown) => row.some((cell: unknown) => cell !== '' && cell !== null && cell !== undefined))
                          .map((row: unknown) => {
                            const obj: Record<string, string> = {};
                            rawHeaders.forEach((h, i) => { obj[headerMap[h]] = String(row[i] ?? ''); });
                            return obj;
                          });
                        setExcelParsedData(prev => ({ ...prev, [field.key]: parsed }));
                      }
                    } catch { /* ignore parse errors */ }
                  };
                  reader.readAsArrayBuffer(file);
                }}
                style={{ display: 'none' }}
              />
              <div style={{ border: '1px dashed #d9d9d9', borderRadius: 6, padding: '16px 12px', textAlign: 'center', color: '#8c9cab', fontSize: 13 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6, verticalAlign: 'middle' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                {val ? val : '点击上传 Excel 文件'}
              </div>
            </label>
            {field.columns && field.columns.length > 0 && (
              <div style={{ marginTop: 8, border: '1px solid #e8e8e8', borderRadius: 4, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#fafafa' }}>
                      {field.columns.map((col, ci) => (
                        <th key={ci} style={{ padding: '8px 12px', borderBottom: '1px solid #e8e8e8', textAlign: 'left', fontWeight: 500 }}>{col.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length > 0 ? rows.map((row, ri) => (
                      <tr key={ri}>
                        {field.columns.map((col, ci) => (
                          <td key={ci} style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>{row[col.key] ?? '—'}</td>
                        ))}
                      </tr>
                    )) : (
                      <tr>
                        {field.columns.map((col, ci) => (
                          <td key={ci} style={{ padding: '8px 12px', color: '#ccc' }}>—</td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      }

      if (field.type === 'select') {
        return (
          <select
            className={styles.configInput}
            value={val}
            onChange={e => onChange(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="">请选择</option>
            {field.options.map((opt, i) => (
              <option key={i} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        );
      }
      if (field.type === 'radio') {
        return (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {field.options.map((opt, i) => (
              <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="radio"
                  name={field.key}
                  value={opt.value}
                  checked={val === opt.value}
                  onChange={e => onChange(e.target.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        );
      }
      if (field.type === 'multi_select') {
        return (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {field.options.map((opt, i) => {
              const checked = val.split(',').includes(opt.value);
              return (
                <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => {
                      const current = val ? val.split(',').filter(Boolean) : [];
                      const next = e.target.checked
                        ? [...current, opt.value]
                        : current.filter(v => v !== opt.value);
                      onChange(next.join(','));
                    }}
                  />
                  {opt.label}
                </label>
              );
            })}
          </div>
        );
      }
      if (field.type === 'checkbox') {
        return (
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={val === 'true'}
              onChange={e => onChange(e.target.checked ? 'true' : 'false')}
            />
            {field.label}
          </label>
        );
      }
      if (field.type === 'textarea') {
        return (
          <textarea
            className={styles.configInput}
            value={val}
            onChange={e => onChange(e.target.value)}
            rows={3}
            style={{ width: '100%', resize: 'vertical' }}
          />
        );
      }
      if (field.type === 'number') {
        return (
          <input
            className={styles.configInput}
            type="number"
            value={val}
            onChange={e => onChange(e.target.value)}
            style={{ width: '100%' }}
          />
        );
      }
      if (field.type === 'date') {
        return (
          <input
            className={styles.configInput}
            type="date"
            value={val}
            onChange={e => onChange(e.target.value)}
            style={{ width: '100%' }}
          />
        );
      }
      if (field.type === 'datetime') {
        return (
          <input
            className={styles.configInput}
            type="datetime-local"
            value={val}
            onChange={e => onChange(e.target.value)}
            style={{ width: '100%' }}
          />
        );
      }
      if (field.type === 'file') {
        return (
          <label style={{ display: 'block', cursor: 'pointer' }}>
            <input
              type="file"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) onChange(file.name);
              }}
              style={{ display: 'none' }}
            />
            <div style={{ border: '1px dashed #d9d9d9', borderRadius: 6, padding: '16px 12px', textAlign: 'center', color: '#8c9cab', fontSize: 13 }}>
              {val ? val : '点击上传文件'}
            </div>
          </label>
        );
      }
      if (field.type === 'switch') {
        return (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <div style={{ width: 44, height: 22, borderRadius: 11, background: val === 'true' ? '#1677ff' : '#d9d9d9', position: 'relative', transition: 'background 0.2s' }}>
              <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: val === 'true' ? 24 : 2, transition: 'left 0.2s' }} />
            </div>
            <input
              type="checkbox"
              checked={val === 'true'}
              onChange={e => onChange(e.target.checked ? 'true' : 'false')}
              style={{ display: 'none' }}
            />
          </label>
        );
      }
      if (field.type === 'detail_table') {
        return (
          <div style={{ border: '1px solid #e8edf3', borderRadius: 6, overflow: 'hidden' }}>
            {field.columns && field.columns.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#fafafa' }}>
                    {field.columns.map((col, ci) => (
                      <th key={ci} style={{ padding: '6px 10px', borderBottom: '1px solid #e8edf3', textAlign: 'left', color: '#8c9cab' }}>{col.label || col.key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={field.columns.length || 1} style={{ padding: 16, textAlign: 'center', color: '#bfbfbf' }}>暂无数据</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        );
      }
      if (field.type === 'member') {
        return (
          <input
            className={styles.configInput}
            placeholder="选择人员"
            value={val}
            onChange={e => onChange(e.target.value)}
            style={{ width: '100%' }}
          />
        );
      }
      if (field.type === 'department') {
        return (
          <input
            className={styles.configInput}
            placeholder="选择部门"
            value={val}
            onChange={e => onChange(e.target.value)}
            style={{ width: '100%' }}
          />
        );
      }
      return (
        <input
          className={styles.configInput}
          type="text"
          value={val}
          onChange={e => onChange(e.target.value)}
          style={{ width: '100%' }}
        />
      );
    };

    return (
      <div className={styles.designer}>
        <div className={styles.toolbar}>
          <button className={styles.toolbarBtn} onClick={() => window.history.back()}>
            ← 返回
          </button>
          <span className={styles.toolbarTitle}>{startWorkflowName}</span>
        </div>
        <div className={styles.body} style={{ justifyContent: 'center', padding: '32px 0' }}>
          <div style={{ width: 520, maxWidth: '100%' }}>
            {startFormLoading && (
              <div className={styles.emptyState}>
                <div className={styles.emptyText}>加载中...</div>
              </div>
            )}
            {startFormError && !startFormLoading && (
              <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                <p>{startFormError}</p>
                <button className={styles.toolbarBtn} onClick={() => window.history.back()} style={{ margin: '16px auto 0' }}>
                  返回
                </button>
              </div>
            )}
            {!startFormLoading && !startFormError && startFormFields.length === 0 && (
              <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                {startSubmitted ? (
                  <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8, padding: '20px 24px', textAlign: 'center' }}>
                    <p style={{ color: '#52c41a', fontSize: 16, fontWeight: 500, margin: '0 0 12px' }}>流程已发起</p>
                    <button className={styles.toolbarBtn} onClick={() => navigate(effectiveAppId ? `/apps/${effectiveAppId}` : '/work')} style={{ background: '#e6f7ff', border: '1px solid #91d5ff', color: '#1890ff', margin: '0 auto' }}>前往发起流程</button>
                  </div>
                ) : (
                  <>
                    <p style={{ margin: '0 0 16px' }}>该流程没有表单字段</p>
                    <button
                      className={styles.toolbarBtnPrimary}
                      onClick={handleSubmitStartForm}
                      disabled={startSubmitting}
                      style={{ margin: '16px auto 0' }}
                    >
                      {startSubmitting ? '提交中...' : '直接发起'}
                    </button>
                  </>
                )}
              </div>
            )}
            {!startFormLoading && !startFormError && startFormFields.length > 0 && (
              <div style={{ background: '#fff', borderRadius: 8, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                {startSubmitted ? (
                  <div style={{ textAlign: 'center', padding: '32px 0' }}>
                    <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8, padding: '20px 24px', textAlign: 'center' }}>
                      <p style={{ color: '#52c41a', fontSize: 16, fontWeight: 500, margin: '0 0 12px' }}>流程已发起</p>
                      <button className={styles.toolbarBtn} onClick={() => navigate(effectiveAppId ? `/apps/${effectiveAppId}` : '/work')} style={{ background: '#e6f7ff', border: '1px solid #91d5ff', color: '#1890ff', margin: '0 auto' }}>前往发起流程</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h2 style={{ margin: '0 0 24px', fontSize: 18, fontWeight: 600 }}>{startWorkflowName}</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {groupFormFieldsIntoRows(startFormFields).map((row, ri) => (
                        <div key={ri} style={{ display: 'flex', gap: 12 }}>
                          {row.map((field) => (
                            <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: field.colSpan || 4 }}>
                              <label style={{ fontSize: 13, fontWeight: 500, color: '#1f1f1f' }}>
                                {field.label}
                                {field.required && <span style={{ color: '#ff4d4f', marginLeft: 4 }}>*</span>}
                              </label>
                              {renderField(field)}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
                      <button
                        className={styles.toolbarBtnPrimary}
                        onClick={handleSubmitStartForm}
                        disabled={startSubmitting}
                      >
                        {startSubmitting ? '提交中...' : '提交'}
                      </button>
                      <button className={styles.toolbarBtn} onClick={() => window.history.back()}>
                        取消
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.designer} style={embedded ? { height: '100%' } : undefined}>
      <div className={styles.toolbar}>
        <button className={styles.toolbarBtn} onClick={() => onBack ? onBack() : window.history.back()}>
          ← 返回
        </button>
        <div className={styles.toolbarActions}>
          <button className={styles.toolbarBtn} onClick={handleUndo}>撤销</button>
          <button className={styles.toolbarBtn} onClick={handleRedo}>重做</button>
          <button className={styles.toolbarBtn} onClick={handleAutoLayout}>自动布局</button>
          <button className={styles.toolbarBtn} onClick={handleTest} disabled={!processId}>发起测试</button>
          <button className={styles.toolbarBtnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
          <button className={styles.toolbarBtnSuccess} onClick={handlePublish} disabled={publishing || !processId}>
            {publishing ? '发布中...' : '发布'}
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.leftPanel}>
          <div className={styles.panelTitle}>节点面板</div>
          {NODE_PANEL_ITEMS.map((item) => (
            <div
              key={item.type}
              className={styles.nodeCard}
              style={{ borderLeft: `4px solid ${NODE_COLORS[item.type]}` }}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/reactflow', item.type);
                e.dataTransfer.effectAllowed = 'move';
              }}
            >
              <span className={styles.nodeCardIcon}>{NODE_ICONS[item.type]}</span>
              <div>
                <div className={styles.nodeCardLabel}>{item.label}</div>
                <div className={styles.nodeCardDesc}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.canvas} ref={reactFlowWrapper}>
          {canvasReady && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesDelete={onNodesDelete}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onNodeDragStop={onNodeDragStop}
            onMoveEnd={onViewportChange}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[8, 8]}
            defaultEdgeOptions={{
              type: 'smoothstep',
              markerEnd: { type: MarkerType.ArrowClosed },
              pathOptions: { borderRadius: 0 },
            } as unknown}
            connectionLineStyle={{
              stroke: '#2563eb',
              strokeWidth: 2,
              strokeDasharray: '6 3',
            }}
          >
            <Controls />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          </ReactFlow>
          )}
        </div>

        <div className={styles.rightPanel}>
          {selectedNode ? (
            <div>
              <div className={styles.configPanelTitle}>
                {nodeLabel((selectedNode.data as { nodeType: string }).nodeType)} 配置
              </div>
              <div className={styles.configGroup}>
                <label className={styles.configLabel}>节点名称</label>
                <input
                  className={styles.configInput}
                  value={(selectedNodeConfig.nodeName as string) || ''}
                  onChange={(e) => updateNodeConfig('nodeName', e.target.value)}
                  placeholder="请输入节点名称"
                />
              </div>

              {(selectedNode.data as { nodeType: string }).nodeType === 'approval' && (
                <ApproverSelector
                  config={selectedNodeConfig}
                  onChange={updateNodeConfig}
                />
              )}

              {(selectedNode.data as { nodeType: string }).nodeType === 'condition' && (
                <div className={styles.configGroup}>
                  <label className={styles.configLabel}>分支条件</label>
                  {edges
                    .filter((e) => e.source === selectedNode.id)
                    .map((edge, idx) => {
                      const targetNode = nodes.find((n) => n.id === edge.target);
                      const targetLabel = (targetNode?.data as unknown)?.label || edge.target;
                      const edgeData = (edge.data || {}) as Record<string, unknown>;
                      return (
                        <div key={edge.id} className={styles.conditionItem}>
                          <div className={styles.conditionHeader}>
                            <span className={styles.conditionIndex}>#{idx + 1}</span>
                            <span className={styles.conditionTarget}>→ {targetLabel}</span>
                          </div>
                          <input
                            className={styles.configInput}
                            placeholder="条件表达式，如: amount > 1000"
                            value={(edgeData.condition as string) || ''}
                            onChange={(e) => {
                              setEdges((eds) =>
                                eds.map((ed) =>
                                  ed.id === edge.id
                                    ? { ...ed, data: { ...ed.data, condition: e.target.value } }
                                    : ed,
                                ),
                              );
                            }}
                          />
                          <input
                            className={styles.configInputSmall}
                            placeholder="分支名称（可选）"
                            value={(edgeData.label as string) || ''}
                            onChange={(e) => {
                              setEdges((eds) =>
                                eds.map((ed) =>
                                  ed.id === edge.id
                                    ? { ...ed, data: { ...ed.data, label: e.target.value } }
                                    : ed,
                                ),
                              );
                            }}
                          />
                        </div>
                      );
                    })}
                  {edges.filter((e) => e.source === selectedNode.id).length === 0 && (
                    <div className={styles.configHint}>请从条件节点拖出连线到目标节点，然后在此配置每个分支的条件表达式</div>
                  )}

                  <div className={styles.conditionRef}>
                    <div className={styles.conditionRefTitle}>支持运算符</div>
                    <div className={styles.conditionOpList}>
                      {['>', '<', '>=', '<=', '==', '!=', 'contains', 'startsWith', 'endsWith', 'isEmpty', 'isNotEmpty'].map((op) => (
                        <span key={op} className={styles.conditionOpTag}>{op}</span>
                      ))}
                    </div>
                  </div>

                  <div className={styles.conditionRef}>
                    <div className={styles.conditionRefTitle}>可用参数</div>
                    <div className={styles.conditionParamList}>
                      <div className={styles.conditionParamGroup}>
                        <span className={styles.conditionParamGroupLabel}>系统变量</span>
                        {['creatorId', 'creatorName', 'creatorDept', 'createTime'].map((p) => (
                          <span
                            key={p}
                            className={styles.conditionParamTag}
                            onClick={() => {
                              navigator.clipboard.writeText(p);
                              toast.success(`已复制: ${p}`);
                            }}
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                      {boundFormId && formFieldNames.length > 0 && (
                        <div className={styles.conditionParamGroup}>
                          <span className={styles.conditionParamGroupLabel}>表单字段</span>
                          {formFieldNames.map((p) => (
                            <span
                              key={p}
                              className={styles.conditionParamTag}
                              onClick={() => {
                                navigator.clipboard.writeText(p);
                                toast.success(`已复制: ${p}`);
                              }}
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className={styles.formBindRow}>
                      {boundFormId ? (
                        <span className={styles.formBindStatus}>
                          已关联表单 {formFieldNames.length} 个字段
                        </span>
                      ) : (
                        <span className={styles.formBindStatus}>未关联表单</span>
                      )}
                      <button className={styles.formBindBtn} onClick={openFormPicker}>
                        {boundFormId ? '更换' : '关联表单'}
                      </button>
                    </div>
                    {formPickerOpen && (
                      <div className={styles.formPicker}>
                        <div className={styles.formPickerTitle}>选择表单</div>
                        {availableForms.length === 0 && (
                          <div className={styles.formPickerEmpty}>暂无可选表单</div>
                        )}
                        {availableForms.map((f) => (
                          <div
                            key={f.id}
                            className={styles.formPickerItem}
                            onClick={() => bindForm(f.id)}
                          >
                            {f.name}
                          </div>
                        ))}
                        <button
                          className={styles.formPickCancel}
                          onClick={() => setFormPickerOpen(false)}
                        >
                          取消
                        </button>
                      </div>
                    )}
                    <div className={styles.configHint}>
                      点击参数可复制到剪贴板，粘贴到表达式输入框
                    </div>
                  </div>
                </div>
              )}
              {(selectedNode.data as { nodeType: string }).nodeType === 'sub_process' && (
                <div className={styles.configGroup}>
                  <label className={styles.configLabel}>子流程</label>
                  <p className={styles.configHint}>
                    选择一个已有的工作流作为子流程。执行到此节点时，会启动子流程并等待完成后再继续。
                  </p>
                  <Select
                    value={String((selectedNodeConfig.subProcessId as number) || '')}
                    options={availableWorkflows.map((w) => ({ value: String(w.id), label: w.name }))}
                    onChange={(v) => {
                      updateNodeConfig('subProcessId', v ? Number(v) : null);
                      const wf = availableWorkflows.find((w) => w.id === Number(v));
                      updateNodeConfig('subProcessName', wf?.name || '');
                    }}
                    placeholder="请选择子流程"
                    onOpen={loadWorkflows}
                  />
                  {availableWorkflows.length === 0 && (
                    <div className={styles.configHint}>暂无可选工作流</div>
                  )}
                </div>
              )}

              {(selectedNode.data as { nodeType: string }).nodeType === 'cc' && (
                <div className={styles.configGroup}>
                  <label className={styles.configLabel}>抄送人</label>
                  <p className={styles.configHint}>
                    抄送节点不会阻塞流程，流程到达此节点时会通知指定人员，并立即继续执行。
                  </p>
                  <ApproverSelector
                    config={selectedNodeConfig}
                    onChange={updateNodeConfig}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <div className={styles.configGroup}>
                <label className={styles.configLabel}>流程名称</label>
                <input
                  className={styles.configInput}
                  value={workflowName}
                  onChange={(e) => setWorkflowName(e.target.value)}
                  placeholder="输入流程名称"
                />
              </div>
              <div className={styles.configGroup}>
                <label className={styles.configLabel}>流程描述</label>
                <textarea
                  className={styles.configTextarea}
                  value={workflowDescription}
                  onChange={(e) => setWorkflowDescription(e.target.value)}
                  placeholder="输入流程描述（可选，用于用户发起时展示）"
                  rows={3}
                />
              </div>
              <div className={styles.emptyIcon}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </div>
              <div className={styles.emptyText}>点击节点查看配置</div>
              <div className={styles.emptyHint}>从左侧拖拽节点到画布开始设计流程</div>
            </div>
          )}
        </div>
      </div>

      <div className={styles.statusBar}>
        <span>节点: {nodes.length}</span>
        <span>连线: {edges.length}</span>
        <span>缩放: {Math.round(viewportZoom * 100)}%</span>
      </div>

      {showPublishDialog && (
        <div className={styles.modalOverlay} onClick={() => setShowPublishDialog(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>发布流程</div>
            <div className={styles.modalBody}>
              <p>发布后，普通用户将可以发起此流程。</p>
              <p>同时会创建新的草稿版本供您继续编辑。</p>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.toolbarBtn} onClick={() => setShowPublishDialog(false)}>取消</button>
              <button className={styles.toolbarBtnSuccess} onClick={confirmPublish} disabled={publishing}>
                {publishing ? '发布中...' : '确认发布'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StartNode({ data }: { data: Record<string, unknown> }) {
  return (
    <div className={styles.customNode} style={{ borderColor: NODE_COLORS.start }}>
      <div className={styles.nodeIcon} style={{ background: NODE_COLORS.start }}>{NODE_ICONS.start}</div>
      <div className={styles.nodeLabel}>{data.label as string}</div>
      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  );
}

function EndNode({ data }: { data: Record<string, unknown> }) {
  return (
    <div className={styles.customNode} style={{ borderColor: NODE_COLORS.end }}>
      <div className={styles.nodeIcon} style={{ background: NODE_COLORS.end }}>{NODE_ICONS.end}</div>
      <div className={styles.nodeLabel}>{data.label as string}</div>
      <Handle type="target" position={Position.Top} className={styles.handle} />
    </div>
  );
}

function ApprovalNode({ data }: { data: Record<string, unknown> }) {
  const config = (data.config || {}) as Record<string, unknown>;
  const approverType = config.approverType as string | undefined;
  const approverCount = config.approverCount as number | undefined;
  const approverIds = config.approverIds as string[] | undefined;
  const computedCount = approverType === 'member'
    ? (approverIds?.length || 0)
    : (approverType ? 1 : 0);
  const displayCount = approverCount != null ? approverCount : computedCount;
  return (
    <div className={styles.customNode} style={{ borderColor: NODE_COLORS.approval }}>
      <Handle type="target" position={Position.Top} className={styles.handle} />
      <div className={styles.nodeIcon} style={{ background: NODE_COLORS.approval }}>{NODE_ICONS.approval}</div>
      <div className={styles.nodeLabel}>{data.label as string}</div>
      <div className={styles.nodeSubLabel}>
        {displayCount > 0
          ? `${displayCount} 位审批人`
          : approverType
            ? '已设置审批人'
            : '未设置审批人'}
      </div>
      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  );
}

function ConditionNode({ data }: { data: Record<string, unknown> }) {
  return (
    <div className={styles.customNode} style={{ borderColor: NODE_COLORS.condition }}>
      <Handle type="target" position={Position.Top} className={styles.handle} />
      <div className={styles.nodeIcon} style={{ background: NODE_COLORS.condition }}>{NODE_ICONS.condition}</div>
      <div className={styles.nodeLabel}>{data.label as string}</div>
      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  );
}

function ParallelNode({ data }: { data: Record<string, unknown> }) {
  return (
    <div className={styles.customNode} style={{ borderColor: NODE_COLORS.parallel }}>
      <Handle type="target" position={Position.Top} className={styles.handle} />
      <div className={styles.nodeIcon} style={{ background: NODE_COLORS.parallel }}>{NODE_ICONS.parallel}</div>
      <div className={styles.nodeLabel}>{data.label as string}</div>
      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  );
}

function SubProcessNode({ data }: { data: Record<string, unknown> }) {
  const config = (data.config || {}) as Record<string, unknown>;
  return (
    <div className={styles.customNode} style={{ borderColor: NODE_COLORS.sub_process }}>
      <Handle type="target" position={Position.Top} className={styles.handle} />
      <div className={styles.nodeIcon} style={{ background: NODE_COLORS.sub_process }}>{NODE_ICONS.sub_process}</div>
      <div className={styles.nodeLabel}>{data.label as string}</div>
      <div className={styles.nodeSubLabel}>
        {config.subProcessName ? `→ ${config.subProcessName}` : '未选择子流程'}
      </div>
      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  );
}

function CcNode({ data }: { data: Record<string, unknown> }) {
  const config = (data.config || {}) as Record<string, unknown>;
  return (
    <div className={styles.customNode} style={{ borderColor: NODE_COLORS.cc }}>
      <Handle type="target" position={Position.Top} className={styles.handle} />
      <div className={styles.nodeIcon} style={{ background: NODE_COLORS.cc }}>{NODE_ICONS.cc}</div>
      <div className={styles.nodeLabel}>{data.label as string}</div>
      <div className={styles.nodeSubLabel}>
        {(config.approverIds as string[])?.length
          ? `${(config.approverIds as string[]).length} 位抄送人`
          : '未设置抄送人'}
      </div>
      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  );
}