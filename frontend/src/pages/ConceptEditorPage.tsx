import { useState, useEffect, useCallback, useRef } from 'react';
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
  useReactFlow,
  Panel,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from '@xyflow/react';
import type { Connection, Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import * as dagre from 'dagre';
import {
  listConcepts,
  createConcept,
  updateConcept,
  deleteConcept,
  getConceptRelations,
  createConceptRelation,
  deleteConceptRelation,
  getConceptTools,
  bindToolConcept,
  unbindToolConcept,
  getConcept,
} from '@/api/concept';
import { listToolDefinitions } from '@/api/tool';
import type {
  Concept,
  ConceptRelation,
  ToolConcept,
  ConceptDetailResponse,
  ToolBindingInfo,
  ConceptTreeResponse,
} from '@/types/concept';
import {
  RELATION_TYPE_LABELS,
  RELATION_TYPE_COLORS,
  RELATION_TYPE_PRIORITY,
  CONCEPT_NODE_ICONS,
  CONCEPT_NODE_COLORS,
} from '@/types/concept';
import { useToastStore } from '@/stores/toastStore';
import { useConfirmStore } from '@/stores/confirmStore';
import './ConceptEditorPage.css';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 64;

function getNodeType(concept: Concept, concepts: Concept[], relations: ConceptRelation[]): string {
  if (relations.some((r) => r.sourceConceptId === concept.id && r.relationType === 'COMPUTED_FROM')) return 'computed';
  if (relations.some((r) => r.targetConceptId === concept.id && r.relationType === 'DERIVED_FROM')) return 'condition';
  if (concept.groupId != null) return 'system';
  if (!concept.parentId && concepts.some((c) => c.parentId === concept.id)) return 'root';
  return 'default';
}

function ConceptNode({ data }: { data: { label: string; description: string; nodeType: string; icon: string } }) {
  const bgColor = CONCEPT_NODE_COLORS[data.nodeType] || CONCEPT_NODE_COLORS.default;
  const borderColor = (() => {
    switch (data.nodeType) {
      case 'root': return '#fa8c16';
      case 'computed': return '#722ed1';
      case 'condition': return '#eb2f96';
      case 'system': return '#13c2c2';
      default: return '#1677ff';
    }
  })();

  return (
    <div
      style={{
        width: NODE_WIDTH,
        padding: '8px 12px',
        borderRadius: 8,
        border: `2px solid ${borderColor}`,
        background: bgColor,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        cursor: 'pointer',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: borderColor }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 16 }}>{data.icon}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>{data.label}</span>
      </div>
      {data.description && (
        <div style={{ fontSize: 11, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 22 }}>
          {data.description}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: borderColor }} />
    </div>
  );
}

const nodeTypes = { conceptNode: ConceptNode };

const RELATION_OPTIONS = [
  { type: 'COMPUTED_FROM', title: '由...计算得出', desc: '此概念通过公式由其他概念计算而来', dot: RELATION_TYPE_COLORS.COMPUTED_FROM, autoKeywords: ['率', '比例', 'OEE', '齐套', '利用率'] },
  { type: 'PARENT_OF', title: '包含', desc: '此概念包含子概念，是层级关系', dot: RELATION_TYPE_COLORS.PARENT_OF, autoKeywords: ['总数', '清单', '层级', '指标'] },
  { type: 'EQUIVALENT_TO', title: '等同于', desc: '两个概念表示同一个东西（跨系统同义）', dot: RELATION_TYPE_COLORS.EQUIVALENT_TO, autoKeywords: ['MES.', 'QMS.', 'SAP.', 'ERP.'] },
  { type: 'PREREQUISITE_OF', title: '前提条件', desc: '需要先有当前概念才能计算目标概念', dot: RELATION_TYPE_COLORS.PREREQUISITE_OF, autoKeywords: ['排产', '计划', '工单'] },
  { type: 'UPPER_STREAM_OF', title: '上游产出', desc: '上游工序的产出流入下游工序', dot: RELATION_TYPE_COLORS.UPPER_STREAM_OF, autoKeywords: ['工序', '产出', '投入'] },
  { type: 'DERIVED_FROM', title: '条件触发', desc: '满足条件后推导出的状态', dot: RELATION_TYPE_COLORS.DERIVED_FROM, autoKeywords: ['状态', '异常', '紧张', '告警'] },
];

function getRelationTypeDirection(type: string): 'source_to_target' | 'target_to_source' {
  if (type === 'COMPUTED_FROM' || type === 'PARENT_OF' || type === 'PREREQUISITE_OF') return 'source_to_target';
  return 'target_to_source';
}

function suggestRelationType(sourceName: string, targetName: string): string {
  const combined = `${sourceName} ${targetName}`;
  let bestType = 'PARENT_OF';
  let bestScore = 0;
  for (const opt of RELATION_OPTIONS) {
    let score = 0;
    for (const kw of opt.autoKeywords) { if (combined.includes(kw)) score += 1; }
    if (sourceName.includes('产出') && targetName.includes('投入')) score += opt.type === 'UPPER_STREAM_OF' ? 5 : 0;
    if (sourceName.includes('比例') || sourceName.includes('率') || sourceName.includes('OEE')) score += opt.type === 'COMPUTED_FROM' ? 5 : 0;
    if (score > bestScore) { bestScore = score; bestType = opt.type; }
  }
  return bestType;
}

function layoutNodes(concepts: Concept[], relations: ConceptRelation[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 });

  const nodes: Node[] = concepts.map((c) => {
    const nodeType = getNodeType(c, concepts, relations);
    return {
      id: String(c.id),
      type: 'conceptNode',
      position: { x: 0, y: 0 },
      data: { label: c.name, description: c.description || '', nodeType, icon: CONCEPT_NODE_ICONS[nodeType] || CONCEPT_NODE_ICONS.default },
    };
  });

  const edges: Edge[] = [];
  for (const c of concepts) {
    if (c.parentId) {
      edges.push({
        id: `parent-${c.parentId}-${c.id}`,
        source: String(c.parentId),
        target: String(c.id),
        type: 'smoothstep',
        style: { stroke: RELATION_TYPE_COLORS.PARENT_OF, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: RELATION_TYPE_COLORS.PARENT_OF },
        label: RELATION_TYPE_LABELS.PARENT_OF,
        labelStyle: { fontSize: 10, fill: RELATION_TYPE_COLORS.PARENT_OF },
        labelBgStyle: { fill: '#fff', fillOpacity: 0.9 },
      });
    }
  }

  for (const r of relations) {
    if (r.relationType === 'PARENT_OF') continue;
    const color = RELATION_TYPE_COLORS[r.relationType] || '#999';
    const label = RELATION_TYPE_LABELS[r.relationType] || r.relationType;
    const dir = getRelationTypeDirection(r.relationType);
    const isBidirectional = r.relationType === 'EQUIVALENT_TO';
    edges.push({
      id: `rel-${r.id}`,
      source: dir === 'source_to_target' ? String(r.sourceConceptId) : String(r.targetConceptId),
      target: dir === 'source_to_target' ? String(r.targetConceptId) : String(r.sourceConceptId),
      type: 'smoothstep',
      animated: r.relationType === 'UPPER_STREAM_OF',
      style: { stroke: color, strokeWidth: 2, strokeDasharray: r.relationType === 'DERIVED_FROM' || r.relationType === 'COMPUTED_FROM' ? '5,5' : 'none' },
      markerEnd: isBidirectional ? undefined : { type: MarkerType.ArrowClosed, color },
      markerStart: isBidirectional ? { type: MarkerType.ArrowClosed, color } : undefined,
      label,
      labelStyle: { fontSize: 10, fill: color },
      labelBgStyle: { fill: '#fff', fillOpacity: 0.9 },
    });
  }

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => g.setEdge(e.source, e.target, {}));
  dagre.layout(g);

  return {
    nodes: nodes.map((n) => {
      const pos = g.node(n.id);
      return { ...n, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 } };
    }),
    edges,
  };
}

export default function ConceptEditorPage() {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [relations, setRelations] = useState<ConceptRelation[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [selectedConcept, setSelectedConcept] = useState<Concept | null>(null);
  const [selectedRelations, setSelectedRelations] = useState<ConceptRelation[]>([]);
  const [selectedTools, setSelectedTools] = useState<ToolBindingInfo[]>([]);
  const [editingForm, setEditingForm] = useState({ name: '', description: '' });
  const [inlineEditing, setInlineEditing] = useState<string | null>(null);
  const [inlineName, setInlineName] = useState('');

  const [showRelationDialog, setShowRelationDialog] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<{ source: string; target: string } | null>(null);
  const [selectedRelationType, setSelectedRelationType] = useState('PARENT_OF');
  const [relationExpression, setRelationExpression] = useState('');

  const [showToolPicker, setShowToolPicker] = useState(false);
  const [availableTools, setAvailableTools] = useState<{ id: number; displayName: string; description: string }[]>([]);
  const [selectedToolId, setSelectedToolId] = useState<number | null>(null);
  const [selectedToolRelation, setSelectedToolRelation] = useState('PRODUCES');

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId?: string } | null>(null);
  const [treeMode, setTreeMode] = useState(false);
  const [treeData, setTreeData] = useState<ConceptTreeResponse[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);

  const reactFlow = useReactFlow();
  const toast = useToastStore((s) => s.add);
  const confirm = useConfirmStore((s) => s.show);
  const undoStack = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const redoStack = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);

  const pushUndo = useCallback(() => {
    undoStack.current.push({ nodes: [...nodes], edges: [...edges] });
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
  }, [nodes, edges]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [conceptsRes, relationsRes] = await Promise.all([
        listConcepts(),
        getConceptRelations(0),
      ]);
      const allConcepts = conceptsRes.data;
      setConcepts(allConcepts);

      const allRelations: ConceptRelation[] = [];
      for (const c of allConcepts) {
        const relRes = await getConceptRelations(c.id);
        allRelations.push(...relRes.data);
      }
      const uniqueRelations = allRelations.filter((r, i, arr) =>
        arr.findIndex((x) => x.id === r.id) === i
      );
      setRelations(uniqueRelations);

      const layout = layoutNodes(allConcepts, uniqueRelations);
      setNodes(layout.nodes);
      setEdges(layout.edges);
      undoStack.current = [];
      redoStack.current = [];
    } catch {
      toast('加载概念数据失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const selectConcept = useCallback(async (conceptId: string) => {
    const concept = concepts.find((c) => String(c.id) === conceptId);
    if (!concept) return;
    setSelectedConcept(concept);
    setEditingForm({ name: concept.name, description: concept.description || '' });
    setSelectedEdge(null);

    try {
      const [detailRes, relRes] = await Promise.all([
        getConcept(concept.id),
        getConceptRelations(concept.id),
      ]);
      setSelectedRelations(relRes.data);
      setSelectedTools(detailRes.data.toolBindings);
    } catch {
      setSelectedRelations([]);
      setSelectedTools([]);
    }
  }, [concepts]);

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    selectConcept(node.id);
  }, [selectConcept]);

  const onNodeDoubleClick: NodeMouseHandler = useCallback((_event, node) => {
    const concept = concepts.find((c) => String(c.id) === node.id);
    if (concept) {
      setInlineEditing(node.id);
      setInlineName(concept.name);
    }
  }, [concepts]);

  const handleInlineSave = useCallback(async (nodeId: string) => {
    if (!inlineName.trim()) return;
    const conceptId = Number(nodeId);
    try {
      await updateConcept(conceptId, { name: inlineName.trim() });
      toast('名称已更新', 'success');
      setInlineEditing(null);
      fetchData();
    } catch {
      toast('更新失败', 'error');
    }
  }, [inlineName, fetchData, toast]);

  const onPaneClick = useCallback(() => {
    setSelectedConcept(null);
    setSelectedRelations([]);
    setSelectedTools([]);
    setContextMenu(null);
    setSelectedEdge(null);
  }, []);

  const onPaneDoubleClick = useCallback((event: React.MouseEvent) => {
    const name = prompt('请输入概念名称:');
    if (!name?.trim()) return;
    createConcept({ name: name.trim() }).then(() => {
      toast('概念创建成功', 'success');
      fetchData();
    }).catch(() => toast('概念创建失败', 'error'));
  }, [fetchData, toast]);

  const onPaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY });
  }, []);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
  }, []);

  const onEdgeClick: EdgeMouseHandler = useCallback((_event, edge) => {
    setSelectedEdge(edge);
    setSelectedConcept(null);
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    pushUndo();
    const suggested = suggestRelationType(
      concepts.find((c) => String(c.id) === connection.source)?.name || '',
      concepts.find((c) => String(c.id) === connection.target)?.name || ''
    );
    setPendingConnection({ source: connection.source, target: connection.target });
    setSelectedRelationType(suggested);
    setRelationExpression('');
    setShowRelationDialog(true);
  }, [concepts, pushUndo]);

  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
    // Check if dropped on another node to create PARENT_OF
    const allNodes = reactFlow.getNodes();
    const draggingNode = allNodes.find((n) => n.id === node.id);
    if (!draggingNode) return;
    const rect = document.querySelector('.react-flow__pane')?.getBoundingClientRect();
    if (!rect) return;
    // Find nodes that overlap with the dragged node
    const overlap = allNodes.find((n) => {
      if (n.id === node.id) return false;
      const dx = Math.abs(draggingNode.position.x - n.position.x);
      const dy = Math.abs(draggingNode.position.y - n.position.y);
      return dx < NODE_WIDTH && dy < NODE_HEIGHT * 0.8;
    });
    if (overlap) {
      const target = concepts.find((c) => String(c.id) === overlap.id);
      const source = concepts.find((c) => String(c.id) === node.id);
      if (target && source && source.parentId !== target.id) {
        confirm({
          title: '建立包含关系',
          message: `将「${source.name}」设为「${target.name}」的子概念？`,
        }).then((ok) => {
          if (ok) {
            updateConcept(source.id, { name: source.name, parentId: target.id }).then(() => {
              toast('包含关系已建立', 'success');
              fetchData();
            }).catch(() => toast('操作失败', 'error'));
          }
        });
      }
    }
  }, [concepts, reactFlow, confirm, fetchData, toast]);

  const handleCreateRelation = async () => {
    if (!pendingConnection) return;
    const sourceId = Number(pendingConnection.source);
    const targetId = Number(pendingConnection.target);
    const dir = getRelationTypeDirection(selectedRelationType);
    try {
      await createConceptRelation(
        dir === 'source_to_target' ? sourceId : targetId,
        {
          targetConceptId: dir === 'source_to_target' ? targetId : sourceId,
          relationType: selectedRelationType,
          expression: relationExpression || undefined,
        }
      );
      toast('关系创建成功', 'success');
      setShowRelationDialog(false);
      setPendingConnection(null);
      fetchData();
    } catch {
      toast('关系创建失败', 'error');
    }
  };

  const handleCreateConcept = async () => {
    const name = prompt('请输入概念名称:');
    if (!name?.trim()) return;
    pushUndo();
    try {
      await createConcept({ name: name.trim() });
      toast('概念创建成功', 'success');
      fetchData();
    } catch {
      toast('概念创建失败', 'error');
    }
  };

  const handleUpdateConcept = async () => {
    if (!selectedConcept) return;
    pushUndo();
    try {
      await updateConcept(selectedConcept.id, {
        name: editingForm.name,
        description: editingForm.description,
      });
      toast('概念更新成功', 'success');
      fetchData();
      setSelectedConcept((prev) => prev ? { ...prev, ...editingForm } : null);
    } catch {
      toast('概念更新失败', 'error');
    }
  };

  const handleDeleteConcept = async () => {
    if (!selectedConcept) return;
    const confirmed = await confirm({
      title: '删除概念',
      message: `确定要删除概念「${selectedConcept.name}」吗？相关关系也会被删除。`,
    });
    if (!confirmed) return;
    pushUndo();
    try {
      await deleteConcept(selectedConcept.id);
      toast('概念已删除', 'success');
      setSelectedConcept(null);
      fetchData();
    } catch {
      toast('删除失败', 'error');
    }
  };

  const handleDeleteRelation = async (relationId: number) => {
    if (!selectedConcept) return;
    pushUndo();
    try {
      await deleteConceptRelation(selectedConcept.id, relationId);
      toast('关系已删除', 'success');
      const relRes = await getConceptRelations(selectedConcept.id);
      setSelectedRelations(relRes.data);
      fetchData();
    } catch {
      toast('删除失败', 'error');
    }
  };

  const handleDeleteEdge = async () => {
    if (!selectedEdge) return;
    const edgeId = selectedEdge.id;
    if (edgeId.startsWith('rel-')) {
      const relId = Number(edgeId.replace('rel-', ''));
      const confirmed = await confirm({ title: '删除关系', message: '确定要删除这条关系吗？' });
      if (!confirmed) return;
      pushUndo();
      try {
        // Delete from either endpoint
        const rel = relations.find((r) => r.id === relId);
        if (rel) {
          await deleteConceptRelation(rel.sourceConceptId, relId);
        }
        toast('关系已删除', 'success');
        setSelectedEdge(null);
        fetchData();
      } catch {
        toast('删除失败', 'error');
      }
    }
    if (edgeId.startsWith('parent-')) {
      const parts = edgeId.split('-');
      const childId = Number(parts[2]);
      const confirmed = await confirm({ title: '移除父子关系', message: '确定要移除父子关系吗？' });
      if (!confirmed) return;
      pushUndo();
      try {
        const child = concepts.find((c) => c.id === childId);
        if (child) {
          await updateConcept(childId, { name: child.name, parentId: undefined });
          toast('父子关系已移除', 'success');
          setSelectedEdge(null);
          fetchData();
        }
      } catch {
        toast('操作失败', 'error');
      }
    }
  };

  const handleOpenToolPicker = async () => {
    try {
      const res = await listToolDefinitions();
      setAvailableTools(res.data.map((t: { id: number; displayName: string; description: string }) => ({
        id: t.id,
        displayName: t.displayName,
        description: t.description,
      })));
      setShowToolPicker(true);
      setSelectedToolId(null);
    } catch {
      toast('加载工具列表失败', 'error');
    }
  };

  const handleBindTool = async () => {
    if (!selectedConcept || !selectedToolId) return;
    try {
      await bindToolConcept(selectedToolId, {
        conceptId: selectedConcept.id,
        relation: selectedToolRelation,
      });
      toast('工具绑定成功', 'success');
      setShowToolPicker(false);
      const detailRes = await getConcept(selectedConcept.id);
      setSelectedTools(detailRes.data.toolBindings);
    } catch {
      toast('工具绑定失败', 'error');
    }
  };

  const handleUnbindTool = async (bindId: number) => {
    if (!selectedConcept) return;
    try {
      await unbindToolConcept(selectedConcept.id, bindId);
      toast('已解绑', 'success');
      const detailRes = await getConcept(selectedConcept.id);
      setSelectedTools(detailRes.data.toolBindings);
    } catch {
      toast('解绑失败', 'error');
    }
  };

  const handleUndo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (prev) {
      redoStack.current.push({ nodes: [...nodes], edges: [...edges] });
      setNodes(prev.nodes);
      setEdges(prev.edges);
    }
  }, [nodes, edges, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    const next = redoStack.current.pop();
    if (next) {
      undoStack.current.push({ nodes: [...nodes], edges: [...edges] });
      setNodes(next.nodes);
      setEdges(next.edges);
    }
  }, [nodes, edges, setNodes, setEdges]);

  const handleCopyNode = useCallback(() => {
    if (!selectedConcept) return;
    const name = prompt('复制概念名称:', selectedConcept.name + ' (副本)');
    if (!name?.trim()) return;
    createConcept({ name: name.trim(), description: selectedConcept.description }).then(() => {
      toast('概念已复制', 'success');
      fetchData();
    }).catch(() => toast('复制失败', 'error'));
  }, [selectedConcept, fetchData, toast]);

  const handleFitView = () => reactFlow.fitView({ padding: 0.2 });

  const deleteSelected = useCallback(async () => {
    if (selectedConcept) {
      await handleDeleteConcept();
    } else if (selectedEdge) {
      await handleDeleteEdge();
    }
  }, [selectedConcept, selectedEdge, handleDeleteConcept, handleDeleteEdge]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        handleCopyNode();
      } else if (e.key === 'f' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (selectedConcept) {
          reactFlow.setCenter(
            nodes.find((n) => n.id === String(selectedConcept.id))?.position.x || 0,
            nodes.find((n) => n.id === String(selectedConcept.id))?.position.y || 0,
            { zoom: 1.5, duration: 300 }
          );
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo, handleCopyNode, deleteSelected, selectedConcept, reactFlow, nodes]);

  const toggleTreeMode = useCallback(async () => {
    if (!treeMode) {
      try {
        const res = await getConceptTree();
        setTreeData(res.data);
      } catch {
        toast('加载树形数据失败', 'error');
      }
    }
    setTreeMode(!treeMode);
  }, [treeMode, toast]);

  const renderTree = (items: ConceptTreeResponse[], depth: number = 0): React.ReactNode => {
    return items.map((item) => (
      <div key={item.id}>
        <div
          className="treeNode"
          style={{ paddingLeft: depth * 24 + 8 }}
          onClick={() => {
            setTreeMode(false);
            selectConcept(String(item.id));
            const node = nodes.find((n) => n.id === String(item.id));
            if (node) reactFlow.setCenter(node.position.x, node.position.y, { zoom: 1.5, duration: 300 });
          }}
        >
          <span className="treeIcon">{CONCEPT_NODE_ICONS[getNodeType(item as Concept, concepts, relations)] || CONCEPT_NODE_ICONS.default}</span>
          <span className="treeName">{item.name}</span>
          {item.relations.length > 0 && (
            <span className="treeRelations">
              {item.relations.map((r) => (
                <span key={r.id} className="treeRelationTag" style={{ background: RELATION_TYPE_COLORS[r.relationType] || '#999' }}>
                  {RELATION_TYPE_LABELS[r.relationType] || r.relationType} → {r.targetConceptName}
                </span>
              ))}
            </span>
          )}
        </div>
        {item.children.length > 0 && renderTree(item.children, depth + 1)}
      </div>
    ));
  };

  if (loading) {
    return <div className="loading">加载中...</div>;
  }

  const zoomLevel = Math.round(reactFlow.getZoom() * 100);

  return (
    <div className="conceptEditor">
      <div className="toolbar">
        <span className="toolbarTitle">概念本体编辑器</span>
        <button className="toolbarBtnPrimary" onClick={handleCreateConcept}>+ 新建概念</button>
        <button className={`toolbarBtn ${treeMode ? 'toolbarBtnActive' : ''}`} onClick={toggleTreeMode}>
          {treeMode ? '图编辑视图' : '树形视图'}
        </button>
        <div className="toolbarActions">
          <button className="toolbarBtn" onClick={fetchData}>刷新</button>
        </div>
      </div>

      <div className="body">
        {treeMode ? (
          <div className="treeView">
            <div className="treeViewHeader">概念树形结构</div>
            {treeData.length === 0 ? (
              <div className="emptyState">暂无概念数据</div>
            ) : (
              <div className="treeViewContent">{renderTree(treeData)}</div>
            )}
          </div>
        ) : (
          <div className="canvas">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              onNodeDragStop={onNodeDragStop}
              onPaneClick={onPaneClick}
              onPaneDoubleClick={onPaneDoubleClick}
              onPaneContextMenu={onPaneContextMenu}
              onNodeContextMenu={onNodeContextMenu}
              onEdgeClick={onEdgeClick}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              deleteKeyCode={null}
              multiSelectionKeyCode="Shift"
              snapToGrid
              snapGrid={[10, 10]}
            >
              <Controls />
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
              <Panel position="bottom-center">
                <div className="bottomBar">
                  <span>{concepts.length} 个概念</span>
                  <span className="bottomBarSep">|</span>
                  <span>{relations.length} 条关系</span>
                  <span className="bottomBarSep">|</span>
                  <span>缩放: {zoomLevel}%</span>
                  <button className="bottomBarBtn" onClick={handleFitView}>适配画布</button>
                </div>
              </Panel>
            </ReactFlow>
          </div>
        )}

        {!treeMode && selectedConcept && (
          <div className="sidebar">
            <div className="sidebarTitle">{selectedConcept.name}</div>

            <div className="sidebarSection">
              <div className="sidebarLabel">基本信息</div>
              <div className="formGroup">
                <label className="formLabel">名称</label>
                <input
                  className="formInput"
                  value={editingForm.name}
                  onChange={(e) => setEditingForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="formGroup">
                <label className="formLabel">描述</label>
                <textarea
                  className="formTextarea"
                  value={editingForm.description}
                  onChange={(e) => setEditingForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="formActions">
                <button className="btnPrimary" onClick={handleUpdateConcept}>保存</button>
                <button className="btnDanger" onClick={handleDeleteConcept}>删除</button>
              </div>
            </div>

            <div className="sidebarSection">
              <div className="sidebarLabel">关系</div>
              {selectedRelations.length === 0 ? (
                <div className="emptyState">暂无关系，从节点拖线到另一个节点创建</div>
              ) : (
                selectedRelations.map((r) => {
                  const isSource = r.sourceConceptId === selectedConcept.id;
                  const otherId = isSource ? r.targetConceptId : r.sourceConceptId;
                  const otherConcept = concepts.find((c) => c.id === otherId);
                  const color = RELATION_TYPE_COLORS[r.relationType] || '#999';
                  const label = RELATION_TYPE_LABELS[r.relationType] || r.relationType;
                  const dir = getRelationTypeDirection(r.relationType);
                  const arrow = (dir === 'source_to_target' && isSource) || (dir !== 'source_to_target' && !isSource) ? ' → ' : ' ← ';
                  return (
                    <div key={r.id} className="relationItem">
                      <div className="relationItemLeft">
                        <span className="relationTypeTag" style={{ background: color }}>{label}</span>
                        <span className="relationTarget">
                          {selectedConcept.name}{arrow}{otherConcept?.name || `ID:${otherId}`}
                        </span>
                      </div>
                      <button className="relationDelete" onClick={() => handleDeleteRelation(r.id)}>×</button>
                      {r.expression && <div className="relationExpr">公式: {r.expression}</div>}
                    </div>
                  );
                })
              )}
            </div>

            <div className="sidebarSection">
              <div className="sidebarLabel">生产该概念的工具</div>
              {selectedTools.filter((t) => t.relation === 'PRODUCES').length === 0 ? (
                <div className="emptyState">暂无</div>
              ) : (
                selectedTools.filter((t) => t.relation === 'PRODUCES').map((tb) => (
                  <div key={tb.id} className="toolBindItem">
                    <span className="toolBindTag" style={{ background: '#52c41a' }}>生产</span>
                    <span className="toolBindName">{tb.toolName}</span>
                    <button className="toolBindDelete" onClick={() => handleUnbindTool(tb.id)}>×</button>
                  </div>
                ))
              )}
              <div className="sidebarLabel" style={{ marginTop: 12 }}>消费该概念的工具</div>
              {selectedTools.filter((t) => t.relation === 'CONSUMES').length === 0 ? (
                <div className="emptyState">暂无</div>
              ) : (
                selectedTools.filter((t) => t.relation === 'CONSUMES').map((tb) => (
                  <div key={tb.id} className="toolBindItem">
                    <span className="toolBindTag" style={{ background: '#1677ff' }}>消费</span>
                    <span className="toolBindName">{tb.toolName}</span>
                    <button className="toolBindDelete" onClick={() => handleUnbindTool(tb.id)}>×</button>
                  </div>
                ))
              )}
              <button className="btn" style={{ marginTop: 8 }} onClick={handleOpenToolPicker}>+ 绑定工具</button>
            </div>
          </div>
        )}

        {!treeMode && !selectedConcept && selectedEdge && (
          <div className="sidebar">
            <div className="sidebarTitle">关系详情</div>
            <div className="sidebarSection">
              <div className="formGroup">
                <label className="formLabel">关系 ID</label>
                <div className="formValue">{selectedEdge.id}</div>
              </div>
              <div className="formGroup">
                <label className="formLabel">来源</label>
                <div className="formValue">
                  {concepts.find((c) => String(c.id) === selectedEdge.source)?.name || selectedEdge.source}
                </div>
              </div>
              <div className="formGroup">
                <label className="formLabel">目标</label>
                <div className="formValue">
                  {concepts.find((c) => String(c.id) === selectedEdge.target)?.name || selectedEdge.target}
                </div>
              </div>
              <div className="formGroup">
                <label className="formLabel">关系类型</label>
                <div className="formValue">{selectedEdge.label as string || '未知'}</div>
              </div>
              <div className="formActions">
                <button className="btnDanger" onClick={handleDeleteEdge}>删除关系</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {inlineEditing && (
        <div className="overlay" onClick={() => setInlineEditing(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ padding: 20 }}>
            <div className="dialogTitle">编辑名称</div>
            <div className="formGroup">
              <input
                className="formInput"
                value={inlineName}
                onChange={(e) => setInlineName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleInlineSave(inlineEditing!); }}
                autoFocus
              />
            </div>
            <div className="formActions" style={{ marginTop: 12 }}>
              <button className="btnPrimary" onClick={() => handleInlineSave(inlineEditing!)}>保存</button>
              <button className="btn" onClick={() => setInlineEditing(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div className="contextMenu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {contextMenu.nodeId ? (
            <>
              <button className="contextMenuItem" onClick={() => {
                selectConcept(contextMenu.nodeId!);
                setContextMenu(null);
              }}>查看详情</button>
              <button className="contextMenuItem" onClick={() => {
                setInlineEditing(contextMenu.nodeId!);
                const concept = concepts.find((c) => String(c.id) === contextMenu.nodeId);
                if (concept) setInlineName(concept.name);
                setContextMenu(null);
              }}>重命名</button>
              <button className="contextMenuItem" onClick={() => {
                handleCopyNode();
                setContextMenu(null);
              }}>复制</button>
              <div className="contextMenuDivider" />
              <button className="contextMenuItem contextMenuDanger" onClick={() => {
                const concept = concepts.find((c) => String(c.id) === contextMenu.nodeId);
                if (concept) {
                  confirm({
                    title: '删除概念',
                    message: `确定要删除「${concept.name}」吗？`,
                  }).then((ok) => {
                    if (ok) {
                      deleteConcept(concept.id).then(() => {
                        toast('已删除', 'success');
                        setSelectedConcept(null);
                        fetchData();
                      });
                    }
                  });
                }
                setContextMenu(null);
              }}>删除</button>
            </>
          ) : (
            <>
              <button className="contextMenuItem" onClick={() => {
                handleCreateConcept();
                setContextMenu(null);
              }}>新建概念</button>
              <button className="contextMenuItem" onClick={() => {
                handleFitView();
                setContextMenu(null);
              }}>适配画布</button>
              <div className="contextMenuDivider" />
              <button className="contextMenuItem" onClick={() => {
                toggleTreeMode();
                setContextMenu(null);
              }}>树形视图</button>
            </>
          )}
        </div>
      )}

      {showRelationDialog && pendingConnection && (
        <div className="overlay" onClick={() => setShowRelationDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialogTitle">选择关系类型</div>
            <div className="dialogSubtitle">
              「{concepts.find((c) => String(c.id) === pendingConnection.source)?.name}」
              和
              「{concepts.find((c) => String(c.id) === pendingConnection.target)?.name}」
              是什么关系？
            </div>
            {RELATION_OPTIONS.map((opt) => (
              <button
                key={opt.type}
                className={`relationOption ${selectedRelationType === opt.type ? 'relationOptionSelected' : ''}`}
                onClick={() => setSelectedRelationType(opt.type)}
              >
                <div className="relationOptionTitle">
                  <span className="relationOptionDot" style={{ background: opt.dot }} />
                  {opt.title}
                  {opt.autoKeywords.some((kw) =>
                    `${pendingConnection.source}${pendingConnection.target}`.includes(kw)
                  ) && <span className="autoTag">推荐</span>}
                </div>
                <div className="relationOptionDesc">{opt.desc}</div>
              </button>
            ))}
            {selectedRelationType === 'COMPUTED_FROM' && (
              <div className="formGroup" style={{ marginTop: 12 }}>
                <label className="formLabel">计算公式（可选）</label>
                <input
                  className="formInput"
                  placeholder="如: 离职人数 / 员工总数"
                  value={relationExpression}
                  onChange={(e) => setRelationExpression(e.target.value)}
                />
              </div>
            )}
            <div className="formActions" style={{ marginTop: 16 }}>
              <button className="btnPrimary" onClick={handleCreateRelation}>确定</button>
              <button className="btn" onClick={() => setShowRelationDialog(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {showToolPicker && (
        <div className="overlay" onClick={() => setShowToolPicker(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialogTitle">绑定工具</div>
            <div className="dialogSubtitle">选择要绑定到「{selectedConcept?.name}」的工具</div>
            <div className="formGroup">
              <label className="formLabel">绑定关系</label>
              <select
                className="formSelect"
                value={selectedToolRelation}
                onChange={(e) => setSelectedToolRelation(e.target.value)}
              >
                <option value="PRODUCES">生产该概念</option>
                <option value="CONSUMES">消费该概念</option>
              </select>
            </div>
            <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 12 }}>
              {availableTools.map((tool) => (
                <button
                  key={tool.id}
                  className={`relationOption ${selectedToolId === tool.id ? 'relationOptionSelected' : ''}`}
                  onClick={() => setSelectedToolId(tool.id)}
                >
                  <div className="relationOptionTitle">{tool.displayName}</div>
                  <div className="relationOptionDesc">{tool.description}</div>
                </button>
              ))}
            </div>
            <div className="formActions">
              <button className="btnPrimary" onClick={handleBindTool} disabled={!selectedToolId}>绑定</button>
              <button className="btn" onClick={() => setShowToolPicker(false)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}