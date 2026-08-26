import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Network, RefreshCw, GitBranch, ShieldCheck } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import {
  ReactFlow,
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
  batchGetConcepts,
  createConcept,
  updateConcept,
  deleteConcept,
  getConceptRelations,
  listAllRelations,
  createConceptRelation,
  deleteConceptRelation,
  bindToolConcept,
  unbindToolConcept,
  getConcept,
  listConceptMappings,
  createConceptMapping,
  updateConceptMapping,
  deleteConceptMapping,
  autoMatchConceptMappings,
  applyAutoMatchMappings,
  listConceptJoinMappings,
  createConceptJoinMapping,
  updateConceptJoinMapping,
  deleteConceptJoinMapping,
  rebuildConceptIndex,
  listOntologyGroups,
  getOntologyGroup,
  listIndustries,
  getConceptTree,
  listPendingOntologyChanges,
  approveOntologyChange,
  rejectOntologyChange,
  batchApproveOntologyChanges,
  batchRejectOntologyChanges,
  type OntologyChangeLog,
  getIndustryRelations,
} from '@/api/concept';
import { listToolDefinitions, listToolGroups } from '@/api/tool';
import { listDatasources } from '@/api/datasource';
import type { Datasource } from '@/types/datasource';
import type {
  Concept,
  ConceptRelation,
  ToolBindingInfo,
  ConceptTreeResponse,
  ConceptMapping,
  ConceptJoinMapping,
  OntologyGroup,
  Industry,
  IndustryRelation,
} from '@/types/concept';
import {
  RELATION_TYPE_LABELS,
  RELATION_TYPE_COLORS,
  CONCEPT_NODE_ICONS,
  CONCEPT_NODE_COLORS,
} from '@/types/concept';
import { useToastStore } from '@/stores/toastStore';
import { useConfirmStore } from '@/stores/confirmStore';
import { useAuthStore } from '@/stores/authStore';
import Select from '@/components/Select';
import './ConceptEditorPage.css';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 64;

const DOMAIN_COLORS = [
  '#1677ff', '#52c41a', '#fa8c16', '#722ed1', '#eb2f96',
  '#13c2c2', '#f5222d', '#faad14', '#2f54eb', '#a0d911',
  '#fa541c', '#1890ff', '#7cb305', '#531dab', '#c41d7f',
];

function safeJsonParse(str: string | null): Record<string, unknown> | null {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function formatSnapshot(obj: Record<string, unknown> | null, entityType: string): React.ReactNode {
  if (!obj) return null;

  const inner = (obj as Record<string, unknown>).concept || (obj as Record<string, unknown>).relation || (obj as Record<string, unknown>).mapping || (obj as Record<string, unknown>).joinMapping || obj;
  const data = inner as Record<string, unknown>;

  const extract = (keys: string[]) => keys.map((k) => {
    const v = data[k];
    return v !== undefined && v !== null ? String(v) : null;
  }).filter(Boolean);

  if (entityType === 'CONCEPT') {
    const fields = extract(['name', 'description', 'calculationFormula', 'threshold', 'industryId', 'industryName']);
    return fields.length > 0 ? fields.join(' | ') : JSON.stringify(data);
  }
  if (entityType === 'RELATION') {
    const source = data.sourceConceptName || data.sourceConceptId || '?';
    const target = data.targetConceptName || data.targetConceptId || '?';
    const type = data.relationType || '?';
    return <span>{source} <strong>{type}</strong> {target}</span>;
  }
  if (entityType === 'MAPPING') {
    const cn = data.conceptName || data.conceptId || '?';
    const tbl = data.tableName || '?';
    const col = data.columnName || data.columnId || '?';
    const mt = data.mappingType || '?';
    return <span>{cn} → {tbl}.{col} <em>({mt})</em></span>;
  }
  if (entityType === 'JOIN_MAPPING') {
    const lt = data.leftTable || '?';
    const lc = data.leftColumn || '?';
    const rt = data.rightTable || '?';
    const rc = data.rightColumn || '?';
    const jt = data.joinType || '?';
    return <span>{lt}.{lc} → {rt}.{rc} <em>({jt})</em></span>;
  }
  return JSON.stringify(data);
}

function getNodeType(concept: Concept, concepts: Concept[], relations: ConceptRelation[]): string {
  if (relations.some((r) => r.sourceConceptId === concept.id && r.relationType === 'COMPUTED_FROM')) return 'computed';
  if (relations.some((r) => r.targetConceptId === concept.id && r.relationType === 'DERIVED_FROM')) return 'condition';
  if (concept.groupId != null) return 'system';
  if (!concept.parentId && concepts.some((c) => c.parentId === concept.id)) return 'root';
  return 'default';
}

function ConceptNode({ data }: { data: { label: string; description: string; nodeType: string; icon: string; domainName?: string; domainColor?: string; mapped?: boolean } }) {
  const bgColor = CONCEPT_NODE_COLORS[data.nodeType] || CONCEPT_NODE_COLORS.default;
  const borderColor = (() => {
    if (data.domainColor) return data.domainColor;
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
        {data.mapped && (
          <span style={{ fontSize: 10, color: '#52c41a', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 3, padding: '0 4px', lineHeight: '16px', flexShrink: 0 }}>已映射</span>
        )}
      </div>
      {data.description && (
        <div style={{ fontSize: 11, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 22 }}>
          {data.description}
        </div>
      )}
      {data.domainName && (
        <div style={{
          fontSize: 10, marginTop: 2, paddingLeft: 22,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{
            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
            background: data.domainColor || '#999', flexShrink: 0,
          }} />
          <span style={{ color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {data.domainName}
          </span>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: borderColor }} />
    </div>
  );
}

const nodeTypes = { conceptNode: ConceptNode };

function getRelationTypeDirection(type: string): 'source_to_target' | 'target_to_source' {
  if (type === 'COMPUTED_FROM' || type === 'PARENT_OF' || type === 'PREREQUISITE_OF') return 'source_to_target';
  return 'target_to_source';
}

function suggestRelationType(sourceName: string, targetName: string): string {
  const combined = `${sourceName} ${targetName}`;
  let bestType = 'PARENT_OF';
  let bestScore = 0;
  for (const opt of relationOptions) {
    let score = 0;
    for (const kw of opt.autoKeywords) { if (combined.includes(kw)) score += 1; }
    if (sourceName.includes('产出') && targetName.includes('投入')) score += opt.type === 'UPPER_STREAM_OF' ? 5 : 0;
    if (sourceName.includes('比例') || sourceName.includes('率') || sourceName.includes('OEE')) score += opt.type === 'COMPUTED_FROM' ? 5 : 0;
    if (score > bestScore) { bestScore = score; bestType = opt.type; }
  }
  return bestType;
}

function layoutNodes(
  concepts: Concept[],
  relations: ConceptRelation[],
  getDomainName: (gid: number | null | undefined) => string,
  getDomainColor: (gid: number | null | undefined) => string | undefined,
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 });

  const conceptDomainMap = new Map<number, { groupId: number | null; name: string; color?: string }>();
  for (const c of concepts) {
    conceptDomainMap.set(c.id, {
      groupId: c.groupId,
      name: getDomainName(c.groupId),
      color: getDomainColor(c.groupId),
    });
  }

  const nodes: Node[] = concepts.map((c) => {
    const nodeType = getNodeType(c, concepts, relations);
    const domain = conceptDomainMap.get(c.id);
    return {
      id: String(c.id),
      type: 'conceptNode',
      position: { x: 0, y: 0 },
      data: {
        label: c.name,
        description: c.description || '',
        nodeType,
        icon: CONCEPT_NODE_ICONS[nodeType] || CONCEPT_NODE_ICONS.default,
        domainName: domain?.name,
        domainColor: domain?.color,
        mapped: c.mapped,
      },
    };
  });

  const conceptIdSet = new Set(concepts.map((c) => c.id));
  const edges: Edge[] = [];
  for (const c of concepts) {
    if (c.parentId && conceptIdSet.has(c.parentId)) {
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

    const srcDomain = conceptDomainMap.get(r.sourceConceptId);
    const tgtDomain = conceptDomainMap.get(r.targetConceptId);
    const isCrossDomain = srcDomain && tgtDomain && srcDomain.groupId !== tgtDomain.groupId;

    const edgeStyle = {
      stroke: isCrossDomain ? '#8c8c8c' : color,
      strokeWidth: isCrossDomain ? 2.5 : 2,
      strokeDasharray: isCrossDomain ? '8,4' : (r.relationType === 'DERIVED_FROM' || r.relationType === 'COMPUTED_FROM' ? '5,5' : 'none'),
    };

    edges.push({
      id: `rel-${r.id}`,
      source: dir === 'source_to_target' ? String(r.sourceConceptId) : String(r.targetConceptId),
      target: dir === 'source_to_target' ? String(r.targetConceptId) : String(r.sourceConceptId),
      type: 'smoothstep',
      animated: r.relationType === 'UPPER_STREAM_OF' || isCrossDomain,
      style: edgeStyle,
      markerEnd: isBidirectional ? undefined : {
        type: MarkerType.ArrowClosed,
        color: isCrossDomain ? '#8c8c8c' : color,
      },
      markerStart: isBidirectional ? {
        type: MarkerType.ArrowClosed,
        color: isCrossDomain ? '#8c8c8c' : color,
      } : undefined,
      label: isCrossDomain
        ? `${label} (跨域)`
        : label,
      labelStyle: {
        fontSize: 10,
        fill: isCrossDomain ? '#8c8c8c' : color,
        fontStyle: isCrossDomain ? 'italic' : 'normal',
      },
      labelBgStyle: {
        fill: isCrossDomain ? '#fafafa' : '#fff',
        fillOpacity: 0.9,
      },
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
  const [searchParams] = useSearchParams();
  const urlDomainId = Number(searchParams.get('domainId')) || null;
  const urlDomainIdRef = useRef<number | null>(urlDomainId);

  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [relations, setRelations] = useState<ConceptRelation[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConcept, setSelectedConcept] = useState<Concept | null>(null);
  const [selectedRelations, setSelectedRelations] = useState<ConceptRelation[]>([]);
  const [selectedTools, setSelectedTools] = useState<ToolBindingInfo[]>([]);
  const [editingForm, setEditingForm] = useState({ name: '', description: '', anomalyThresholdExpr: '', anomalyThresholdDesc: '' });
  const [inlineEditing, setInlineEditing] = useState<string | null>(null);
  const [inlineName, setInlineName] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createDialogName, setCreateDialogName] = useState('');
  const createDialogCallback = useRef<((name: string) => void) | null>(null);

  const [showRelationDialog, setShowRelationDialog] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<{ source: string; target: string } | null>(null);
  const [selectedRelationType, setSelectedRelationType] = useState('PARENT_OF');
  const [relationExpression, setRelationExpression] = useState('');

  const [showToolPicker, setShowToolPicker] = useState(false);
  const [availableTools, setAvailableTools] = useState<{ id: number; displayName: string; description: string; groupId: number; groupName: string }[]>([]);
  const [selectedToolId, setSelectedToolId] = useState<number | null>(null);
  const [selectedToolRelation, setSelectedToolRelation] = useState('PRODUCES');

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId?: string } | null>(null);
  const [treeMode, setTreeMode] = useState(false);
  const [treeData, setTreeData] = useState<ConceptTreeResponse[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);

  const [conceptMappings, setConceptMappings] = useState<ConceptMapping[]>([]);
  const [joinMappings, setJoinMappings] = useState<ConceptJoinMapping[]>([]);
  const [showMappingForm, setShowMappingForm] = useState(false);
  const [mappingForm, setMappingForm] = useState<Partial<ConceptMapping>>({});
  const [editingMappingId, setEditingMappingId] = useState<number | null>(null);
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [joinForm, setJoinForm] = useState<Partial<ConceptJoinMapping>>({});
  const [editingJoinId, setEditingJoinId] = useState<number | null>(null);

  const [industries, setIndustries] = useState<Industry[]>([]);
  const [selectedIndustryId, setSelectedIndustryId] = useState<number | null>(null);
  const [domainGroups, setDomainGroups] = useState<OntologyGroup[]>([]);
  const [selectedDomainId, setSelectedDomainId] = useState<number | null | undefined>(undefined);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [selectedDatasourceIds, setSelectedDatasourceIds] = useState<number[]>([]);
  const [showDatasourceModal, setShowDatasourceModal] = useState(false);
  const [showConceptSelectModal, setShowConceptSelectModal] = useState(false);
  const [selectedConceptIds, setSelectedConceptIds] = useState<number[]>([]);
  const [allIndustryConcepts, setAllIndustryConcepts] = useState<Map<number, Concept[]>>(new Map());
  const [ownerNameMap, setOwnerNameMap] = useState<Map<number, string>>(new Map());
  const [domainLegendCollapsed, setDomainLegendCollapsed] = useState(false);
  const domainColorMap = useRef<Record<number, string>>({});
  const domainGroupsFetchedRef = useRef<number | null>(null);
  const [industryConceptGroupMap, setIndustryConceptGroupMap] = useState<Map<number, number>>(new Map());
  const [industryAllRelations, setIndustryAllRelations] = useState<ConceptRelation[]>([]);
  const [industryRelationTypes, setIndustryRelationTypes] = useState<IndustryRelation[]>([]);

  const relationOptions = useMemo(() => {
    const AUTO_KEYWORD_MAP: Record<string, string[]> = {
      'COMPUTED_FROM': ['率', '比例', 'OEE', '齐套', '利用率'],
      'PARENT_OF': ['总数', '清单', '层级', '指标'],
      'EQUIVALENT_TO': ['MES.', 'QMS.', 'SAP.', 'ERP.'],
      'PREREQUISITE_OF': ['排产', '计划', '工单'],
      'UPPER_STREAM_OF': ['工序', '产出', '投入'],
      'DERIVED_FROM': ['状态', '异常', '紧张', '告警'],
    };
    return industryRelationTypes.map((ir) => ({
      type: ir.relationType,
      title: RELATION_TYPE_LABELS[ir.relationType] || ir.relationType,
      desc: ir.description || '',
      dot: RELATION_TYPE_COLORS[ir.relationType] || '#999',
      autoKeywords: AUTO_KEYWORD_MAP[ir.relationType] || [],
      builtin: ir.isBuiltin,
    }));
  }, [industryRelationTypes]);

  const [showChangeReview, setShowChangeReview] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<OntologyChangeLog[]>([]);
  const [changesLoading, setChangesLoading] = useState(false);
  const [selectedChangeIds, setSelectedChangeIds] = useState<Set<number>>(new Set());

  const crossDomainStats = useMemo(() => {
    const domainIdToName = new Map<number, string>();
    domainGroups.forEach((d) => domainIdToName.set(d.id, d.displayName));
    const conceptToDomain = industryConceptGroupMap;
    const crossByDomain = new Map<number, { count: number; peers: Map<number, number> }>();
    industryAllRelations.forEach((r) => {
      const srcDomain = conceptToDomain.get(r.sourceConceptId);
      const tgtDomain = conceptToDomain.get(r.targetConceptId);
      if (srcDomain != null && tgtDomain != null && srcDomain !== tgtDomain) {
        [srcDomain, tgtDomain].forEach((d) => {
          if (!crossByDomain.has(d)) {
            crossByDomain.set(d, { count: 0, peers: new Map() });
          }
        });
        const srcEntry = crossByDomain.get(srcDomain)!;
        srcEntry.count++;
        srcEntry.peers.set(tgtDomain, (srcEntry.peers.get(tgtDomain) || 0) + 1);
        const tgtEntry = crossByDomain.get(tgtDomain)!;
        tgtEntry.count++;
        tgtEntry.peers.set(srcDomain, (tgtEntry.peers.get(srcDomain) || 0) + 1);
      }
    });
    return { crossByDomain, domainIdToName };
  }, [industryAllRelations, industryConceptGroupMap, domainGroups]);

  const groupedDatasources = useMemo(() => {
    const groups = new Map<number, Datasource[]>();
    const noOwner: Datasource[] = [];
    datasources.forEach((ds) => {
      if (ds.ownerId != null) {
        const list = groups.get(ds.ownerId) || [];
        list.push(ds);
        groups.set(ds.ownerId, list);
      } else {
        noOwner.push(ds);
      }
    });
    return { groups, noOwner };
  }, [datasources]);

  const [showSearchRelation, setShowSearchRelation] = useState(false);
  const [searchRelSourceId, setSearchRelSourceId] = useState<number | null>(null);
  const [searchRelKeyword, setSearchRelKeyword] = useState('');
  const [searchRelResults, setSearchRelResults] = useState<Concept[]>([]);
  const [searchRelTargetId, setSearchRelTargetId] = useState<number | null>(null);
  const [searchRelType, setSearchRelType] = useState('PARENT_OF');
  const [searchRelExpression, setSearchRelExpression] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const reactFlow = useReactFlow();
  const toast = useToastStore((s) => s.show);
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.superAdmin === true;
  const confirm = useConfirmStore((s) => s.confirm);
  const selectedIndustryIdRef = useRef<number | null>(null);
  const undoStack = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const redoStack = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);

  const pushUndo = useCallback(() => {
    undoStack.current.push({ nodes: [...nodes], edges: [...edges] });
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
  }, [nodes, edges]);

  const getDomainName = useCallback((groupId: number | null | undefined): string => {
    if (groupId == null) return '全局';
    const g = domainGroups.find((d) => d.id === groupId);
    return g ? g.displayName : '全局';
  }, [domainGroups]);

  const getDomainColor = useCallback((groupId: number | null | undefined): string | undefined => {
    if (groupId == null) return undefined;
    if (!domainColorMap.current[groupId]) {
      const idx = domainGroups.findIndex((d) => d.id === groupId);
      domainColorMap.current[groupId] = idx >= 0 ? DOMAIN_COLORS[idx % DOMAIN_COLORS.length] : '#999';
    }
    return domainColorMap.current[groupId];
  }, [domainGroups]);

  const fetchIndustries = useCallback(async () => {
    try {
      const res = await listIndustries();
      setIndustries(res.data);

      if (urlDomainIdRef.current) {
        try {
          const domainRes = await getOntologyGroup(urlDomainIdRef.current);
          const domainIndustryId = domainRes.data.industryId;
          if (domainIndustryId && res.data.some((ind) => ind.id === domainIndustryId)) {
            setSelectedIndustryId(domainIndustryId);
            return;
          }
        } catch {
          // fall through to default selection
        }
      }

      if (res.data.length > 0 && selectedIndustryIdRef.current === null) {
        setSelectedIndustryId(res.data[0].id);
      }
    } catch {
      // industries are optional
    }
  }, []);

  const fetchDomainGroups = useCallback(async (industryId?: number | null) => {
    if (!industryId || domainGroupsFetchedRef.current === industryId) return;
    domainGroupsFetchedRef.current = industryId;
    try {
      const res = await listOntologyGroups(industryId);
      const groups = res.data;
      setDomainGroups(groups);
      if (urlDomainIdRef.current && groups.some((g) => g.id === urlDomainIdRef.current)) {
        setSelectedDomainId(urlDomainIdRef.current);
        urlDomainIdRef.current = null;
      } else if (groups.length > 0) {
        setSelectedDomainId(groups[0].id);
      } else {
        setSelectedDomainId(null);
      }

      const [allConceptsRes, allRelationsRes] = await Promise.all([
        Promise.all(groups.map((g) => listConcepts(g.id))),
        listAllRelations(),
      ]);
      const map = new Map<number, number>();
      const groupConcepts = new Map<number, Concept[]>();
      allConceptsRes.forEach((r, i) => {
        const gid = groups[i].id;
        groupConcepts.set(gid, r.data);
        r.data.forEach((c) => map.set(c.id, c.groupId!));
      });
      setAllIndustryConcepts(groupConcepts);
      setIndustryConceptGroupMap(map);
      const conceptIds = new Set(map.keys());
      setIndustryAllRelations(allRelationsRes.data.filter(
        (r) => conceptIds.has(r.sourceConceptId) || conceptIds.has(r.targetConceptId)
      ));
    } catch {
      // domains are optional, don't block
    }
  }, []);

  const fetchData = useCallback(async () => {
    if (selectedDomainId === undefined) return;
    const industryId = selectedIndustryIdRef.current;
    if (industryId === null) return;
    try {
      setLoading(true);

      let visibleConcepts: Concept[] = [];
      let allRelations: ConceptRelation[] = [];

      if (selectedDomainId) {
        const [conceptsRes, relationsRes] = await Promise.all([
          listConcepts(selectedDomainId),
          listAllRelations(selectedDomainId),
        ]);
        visibleConcepts = conceptsRes.data;
        allRelations = relationsRes.data;

        const domainConceptIds = new Set(visibleConcepts.map((c) => c.id));
        const crossDomainIds = new Set<number>();
        for (const r of allRelations) {
          if (domainConceptIds.has(r.sourceConceptId) && !domainConceptIds.has(r.targetConceptId)) {
            crossDomainIds.add(r.targetConceptId);
          } else if (!domainConceptIds.has(r.sourceConceptId) && domainConceptIds.has(r.targetConceptId)) {
            crossDomainIds.add(r.sourceConceptId);
          }
        }
        for (const c of visibleConcepts) {
          if (c.parentId && !domainConceptIds.has(c.parentId)) {
            crossDomainIds.add(c.parentId);
          }
        }
        if (crossDomainIds.size > 0) {
          const crossRes = await batchGetConcepts([...crossDomainIds]);
          visibleConcepts = [...visibleConcepts, ...crossRes.data];
        }
      } else {
        if (domainGroups.length > 0) {
          const domainIds = domainGroups.map((g) => g.id);
          const [conceptsResults, relationsRes] = await Promise.all([
            Promise.all(domainIds.map((id) => listConcepts(id))),
            listAllRelations(),
          ]);
          const conceptMap = new Map<number, Concept>();
          for (const r of conceptsResults) {
            for (const c of r.data) {
              conceptMap.set(c.id, c);
            }
          }
          visibleConcepts = [...conceptMap.values()];
          allRelations = relationsRes.data;
        }
      }

      const visibleConceptIds = new Set(visibleConcepts.map((c) => c.id));
      allRelations = allRelations.filter(
        (r) => visibleConceptIds.has(r.sourceConceptId) && visibleConceptIds.has(r.targetConceptId)
      );

      setConcepts(visibleConcepts);
      setRelations(allRelations);

      const layout = layoutNodes(visibleConcepts, allRelations, getDomainName, getDomainColor);
      setNodes(layout.nodes);
      setEdges(layout.edges);
      reactFlow.fitView({ padding: 0.2 });
      undoStack.current = [];
      redoStack.current = [];
    } catch {
      toast('加载概念数据失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedDomainId, domainGroups, setNodes, setEdges, toast, getDomainName, getDomainColor]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => { fetchIndustries(); }, [fetchIndustries]);

  useEffect(() => {
    listDatasources('PLATFORM').then((res) => setDatasources(res.data)).catch(() => {});
  }, []);

  useEffect(() => {
    listToolGroups().then((res) => {
      const map = new Map<number, string>();
      res.data.forEach((g) => map.set(g.id, g.name));
      setOwnerNameMap(map);
    }).catch(() => {});
  }, []);

  useEffect(() => { selectedIndustryIdRef.current = selectedIndustryId; }, [selectedIndustryId]);

  useEffect(() => {
    if (selectedIndustryId !== null) {
      fetchDomainGroups(selectedIndustryId);
      getIndustryRelations(selectedIndustryId).then((res) => {
        setIndustryRelationTypes(res.data);
      }).catch(() => {});
    } else {
      setIndustryRelationTypes([]);
    }
  }, [fetchDomainGroups, selectedIndustryId]);

  const selectConcept = useCallback(async (conceptId: string) => {
    const concept = concepts.find((c) => String(c.id) === conceptId);
    if (!concept) return;
    setSelectedConcept(concept);
    setEditingForm({ name: concept.name, description: concept.description || '', anomalyThresholdExpr: concept.anomalyThresholdExpr || '', anomalyThresholdDesc: concept.anomalyThresholdDesc || '' });
    setSelectedEdge(null);

    try {
      const [detailRes, relRes, mappingRes, joinRes] = await Promise.all([
        getConcept(concept.id),
        getConceptRelations(concept.id),
        listConceptMappings(concept.id),
        listConceptJoinMappings(concept.id),
      ]);
      setSelectedRelations(relRes.data);
      setSelectedTools(detailRes.data.toolBindings);
      setConceptMappings(mappingRes.data);
      setJoinMappings(joinRes.data);
    } catch {
      setSelectedRelations([]);
      setSelectedTools([]);
      setConceptMappings([]);
      setJoinMappings([]);
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

  const openCreateDialog = useCallback((defaultName: string, cb: (name: string) => void) => {
    setCreateDialogName(defaultName);
    createDialogCallback.current = cb;
    setShowCreateDialog(true);
  }, []);

  const handleCreateDialogConfirm = useCallback(() => {
    const name = createDialogName.trim();
    if (!name) return;
    setShowCreateDialog(false);
    createDialogCallback.current?.(name);
    createDialogCallback.current = null;
  }, [createDialogName]);

  const onPaneDoubleClick = useCallback((_event: React.MouseEvent) => {
    openCreateDialog('', (name) => {
      createConcept({ name }).then(() => {
        toast('概念创建成功', 'success');
        fetchData();
      }).catch(() => toast('概念创建失败', 'error'));
    });
  }, [fetchData, toast, openCreateDialog]);

  const onPaneDoubleClickHandler = useCallback((event: React.MouseEvent) => {
    onPaneDoubleClick(event);
  }, [onPaneDoubleClick]);

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

  const onNodeDragStop = useCallback((_event: MouseEvent | TouchEvent, node: Node) => {
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
        }).then((ok: boolean) => {
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

  const handleSearchConcepts = useCallback(async (keyword: string) => {
    setSearchRelKeyword(keyword);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!keyword.trim()) {
      setSearchRelResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await listConcepts(undefined, keyword.trim());
        setSearchRelResults(res.data);
      } catch {
        // ignore
      }
    }, 300);
  }, []);

  const handleOpenSearchRelation = (sourceId: number) => {
    setSearchRelSourceId(sourceId);
    setSearchRelTargetId(null);
    setSearchRelKeyword('');
    setSearchRelResults([]);
    setSearchRelType('PARENT_OF');
    setSearchRelExpression('');
    setShowSearchRelation(true);
  };

  const handleCreateSearchRelation = async () => {
    if (!searchRelSourceId || !searchRelTargetId) return;
    const dir = getRelationTypeDirection(searchRelType);
    const sourceId = dir === 'source_to_target' ? searchRelSourceId : searchRelTargetId;
    const targetId = dir === 'source_to_target' ? searchRelTargetId : searchRelSourceId;
    try {
      await createConceptRelation(sourceId, {
        targetConceptId: targetId,
        relationType: searchRelType,
        expression: searchRelExpression || undefined,
      });
      toast('关系创建成功', 'success');
      setShowSearchRelation(false);
      fetchData();
      if (selectedConcept?.id === searchRelSourceId) {
        const relRes = await getConceptRelations(searchRelSourceId);
        setSelectedRelations(relRes.data);
      }
    } catch {
      toast('关系创建失败', 'error');
    }
  };

  const handleCreateConcept = useCallback(() => {
    openCreateDialog('', (name) => {
      pushUndo();
      createConcept({ name }).then(() => {
        toast('概念创建成功', 'success');
        fetchData();
      }).catch(() => toast('概念创建失败', 'error'));
    });
  }, [pushUndo, fetchData, toast, openCreateDialog]);

  const handleRebuildIndex = async () => {
    try {
      await rebuildConceptIndex();
      toast('索引重建完成', 'success');
    } catch {
      toast('索引重建失败，请确认 Embedding 服务已启动', 'error');
    }
  };

  const loadPendingChanges = async () => {
    setChangesLoading(true);
    try {
      const data = await listPendingOntologyChanges();
      setPendingChanges(data);
      setSelectedChangeIds(new Set());
    } catch {
      toast('加载变更记录失败', 'error');
    } finally {
      setChangesLoading(false);
    }
  };

  const handleApproveChange = async (changeId: number) => {
    try {
      await approveOntologyChange(changeId);
      setPendingChanges((prev) => prev.map((c) => c.id === changeId ? { ...c, status: 'APPROVED' as const } : c));
      toast('变更已通过', 'success');
    } catch {
      toast('操作失败', 'error');
    }
  };

  const handleRejectChange = async (changeId: number) => {
    try {
      await rejectOntologyChange(changeId);
      setPendingChanges((prev) => prev.filter((c) => c.id !== changeId));
      setSelectedChangeIds((prev) => {
        const next = new Set(prev);
        next.delete(changeId);
        return next;
      });
      toast('变更已拒绝', 'success');
    } catch {
      toast('操作失败', 'error');
    }
  };

  const handleBatchApprove = async () => {
    if (selectedChangeIds.size === 0) return;
    try {
      await batchApproveOntologyChanges(Array.from(selectedChangeIds));
      setPendingChanges((prev) => prev.map((c) =>
        selectedChangeIds.has(c.id) ? { ...c, status: 'APPROVED' as const } : c
      ));
      setSelectedChangeIds(new Set());
      toast(`已通过 ${selectedChangeIds.size} 条变更`, 'success');
    } catch {
      toast('批量操作失败', 'error');
    }
  };

  const handleBatchReject = async () => {
    if (selectedChangeIds.size === 0) return;
    try {
      await batchRejectOntologyChanges(Array.from(selectedChangeIds));
      setPendingChanges((prev) => prev.filter((c) => !selectedChangeIds.has(c.id)));
      setSelectedChangeIds(new Set());
      toast(`已拒绝 ${selectedChangeIds.size} 条变更`, 'success');
    } catch {
      toast('批量操作失败', 'error');
    }
  };

  const toggleSelectAll = () => {
    const pendingOnly = pendingChanges.filter((c) => c.status === 'PENDING');
    if (selectedChangeIds.size === pendingOnly.length) {
      setSelectedChangeIds(new Set());
    } else {
      setSelectedChangeIds(new Set(pendingOnly.map((c) => c.id)));
    }
  };

  const toggleChangeSelection = (changeId: number) => {
    setSelectedChangeIds((prev) => {
      const next = new Set(prev);
      if (next.has(changeId)) {
        next.delete(changeId);
      } else {
        next.add(changeId);
      }
      return next;
    });
  };

  const handleUpdateConcept = async () => {
    if (!selectedConcept) return;
    pushUndo();
    try {
      await updateConcept(selectedConcept.id, {
        name: editingForm.name,
        description: editingForm.description,
        anomalyThresholdExpr: editingForm.anomalyThresholdExpr || undefined,
        anomalyThresholdDesc: editingForm.anomalyThresholdDesc || undefined,
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
      const [groupsRes, toolsRes] = await Promise.all([
        listToolGroups(),
        listToolDefinitions(),
      ]);
      const groups = groupsRes.data as { id: number; name: string }[];
      const groupMap = new Map(groups.map((g) => [g.id, g.name]));
      setAvailableTools(toolsRes.data.map((t: { id: number; displayName: string; description: string; groupId: number }) => ({
        id: t.id,
        displayName: t.displayName,
        description: t.description,
        groupId: t.groupId,
        groupName: groupMap.get(t.groupId) || '未分组',
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

  const handleOpenMappingForm = (mapping?: ConceptMapping) => {
    if (mapping) {
      setEditingMappingId(mapping.id);
      setMappingForm(mapping);
    } else {
      setEditingMappingId(null);
      setMappingForm({ datasourceId: undefined, tableName: '', columnName: '', attributeName: '', mappingType: 'direct' });
    }
    setShowMappingForm(true);
  };

  const handleAutoMatch = async () => {
    if (!selectedIndustryId) {
      toast('请先选择一个行业', 'warning');
      return;
    }
    setSelectedDatasourceIds([]);
    setShowConceptSelectModal(true);
    const unmapped: number[] = [];
    for (const concepts of allIndustryConcepts.values()) {
      for (const c of concepts) {
        if (!c.mapped) unmapped.push(c.id);
      }
    }
    setSelectedConceptIds(unmapped);
  };

  const handleConceptSelectNext = () => {
    if (selectedConceptIds.length === 0) {
      toast('请至少选择一个概念', 'warning');
      return;
    }
    setShowConceptSelectModal(false);
    setShowDatasourceModal(true);
  };

  const handleAutoMatchConfirm = async () => {
    if (selectedDatasourceIds.length === 0) {
      toast('请先选择至少一个数据源', 'warning');
      return;
    }
    if (selectedConceptIds.length === 0) {
      toast('请先选择概念', 'warning');
      return;
    }
    setShowDatasourceModal(false);
    try {
      const res = await autoMatchConceptMappings(selectedConceptIds, selectedDatasourceIds);
      toast(`自动映射任务已提交（任务ID: ${res.data.taskId}），请在异步任务列表查看结果`, 'success');
      setSelectedDatasourceIds([]);
      setSelectedConceptIds([]);
    } catch {
      toast('提交自动映射任务失败', 'error');
    }
  };

  const handleSaveMapping = async () => {
    if (!selectedConcept || !mappingForm.tableName || !mappingForm.columnName) return;
    try {
      if (editingMappingId) {
        await updateConceptMapping(selectedConcept.id, editingMappingId, mappingForm);
        toast('映射已更新', 'success');
      } else {
        await createConceptMapping(selectedConcept.id, mappingForm);
        toast('映射已创建', 'success');
      }
      setShowMappingForm(false);
      const res = await listConceptMappings(selectedConcept.id);
      setConceptMappings(res.data);
    } catch {
      toast('保存映射失败', 'error');
    }
  };

  const handleDeleteMapping = async (mappingId: number) => {
    if (!selectedConcept) return;
    try {
      await deleteConceptMapping(selectedConcept.id, mappingId);
      toast('映射已删除', 'success');
      setConceptMappings((prev) => prev.filter((m) => m.id !== mappingId));
    } catch {
      toast('删除失败', 'error');
    }
  };

  const handleOpenJoinForm = (join?: ConceptJoinMapping) => {
    if (join) {
      setEditingJoinId(join.id);
      setJoinForm(join);
    } else {
      setEditingJoinId(null);
      setJoinForm({ datasourceId: undefined, targetConcept: '', relationType: 'LEFT', joinTable: '', joinCondition: '' });
    }
    setShowJoinForm(true);
  };

  const handleSaveJoin = async () => {
    if (!selectedConcept || !joinForm.targetConcept || !joinForm.joinTable || !joinForm.joinCondition) return;
    try {
      if (editingJoinId) {
        await updateConceptJoinMapping(selectedConcept.id, editingJoinId, joinForm);
        toast('JOIN 映射已更新', 'success');
      } else {
        await createConceptJoinMapping(selectedConcept.id, joinForm);
        toast('JOIN 映射已创建', 'success');
      }
      setShowJoinForm(false);
      const res = await listConceptJoinMappings(selectedConcept.id);
      setJoinMappings(res.data);
    } catch {
      toast('保存 JOIN 映射失败', 'error');
    }
  };

  const handleDeleteJoin = async (joinId: number) => {
    if (!selectedConcept) return;
    try {
      await deleteConceptJoinMapping(selectedConcept.id, joinId);
      toast('JOIN 映射已删除', 'success');
      setJoinMappings((prev) => prev.filter((j) => j.id !== joinId));
    } catch {
      toast('删除失败', 'error');
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
    openCreateDialog(selectedConcept.name + ' (副本)', (name) => {
      createConcept({ name, description: selectedConcept.description }).then(() => {
        toast('概念已复制', 'success');
        fetchData();
      }).catch(() => toast('复制失败', 'error'));
    });
  }, [selectedConcept, fetchData, toast, openCreateDialog]);

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
          className={`treeNode ${depth > 0 ? 'treeNodeIndent' : ''}`}
          style={{ paddingLeft: depth * 32 + 12 }}
          onClick={() => {
            setTreeMode(false);
            selectConcept(String(item.id));
            const node = nodes.find((n) => n.id === String(item.id));
            if (node) reactFlow.setCenter(node.position.x, node.position.y, { zoom: 1.5, duration: 300 });
          }}
        >
          <span className="treeIcon">{CONCEPT_NODE_ICONS[getNodeType(item as unknown as Concept, concepts, relations)] || CONCEPT_NODE_ICONS.default}</span>
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

  const zoomLevel = Math.round(reactFlow.getZoom() * 100);

  return (
    <div className="conceptEditor">
      <PageTopbar
        icon={<Network size={22} />}
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 className="page-topbar__title" style={{ margin: 0 }}>概念编辑器</h2>
            <button className="titleIconBtn" onClick={fetchData} title="刷新">
              <RefreshCw size={15} />
            </button>
            <button
              className={`titleIconBtn ${treeMode ? 'titleIconBtnActive' : ''}`}
              onClick={toggleTreeMode}
              title={treeMode ? '图编辑视图' : '树形视图'}
            >
              <GitBranch size={15} />
            </button>
          </span>
        }
        subtitle="可视化编辑概念图谱，管理概念、关系与工具绑定"
        actions={
          <div className="toolbar">
            <div className="toolbarDomainSelect">
              <Select
                value={selectedIndustryId ? String(selectedIndustryId) : ''}
                options={industries.map((ind) => ({
                  value: String(ind.id),
                  label: ind.displayName,
                }))}
                onChange={(v) => setSelectedIndustryId(v ? Number(v) : null)}
                placeholder="选择行业"
              />
            </div>
            <div className="toolbarDomainSelect">
              <Select
                value={selectedDomainId ? String(selectedDomainId) : ''}
                options={[
                  { value: '', label: '全部概念域' },
                  ...domainGroups.map((d) => ({
                    value: String(d.id),
                    label: `${d.displayName} (${d.name})`,
                  })),
                ]}
                onChange={(v) => setSelectedDomainId(v ? Number(v) : null)}
                placeholder="全部概念域"
              />
            </div>
            <button className="toolbarBtnPrimary" onClick={handleCreateConcept}>+ 新建概念</button>
            <div className="toolbarActions">
              <button className="toolbarBtn" onClick={handleAutoMatch}>⚡ 自动映射</button>
              <button className="toolbarBtn" onClick={handleRebuildIndex}>重建索引</button>
              {isSuperAdmin && (
                <button
                  className="toolbarBtn"
                  onClick={() => {
                    setShowChangeReview(true);
                    loadPendingChanges();
                  }}
                >
                  <ShieldCheck size={14} style={{ marginRight: 4 }} />
                  变更审核
                </button>
              )}
            </div>
          </div>
        }
      />

      <div className="body">
        {loading ? (
          <div className="canvasLoading">
            <svg className="canvasLoadingIcon" viewBox="0 0 40 40" width="40" height="40">
              <circle cx="20" cy="20" r="16" fill="none" stroke="#e6f4ff" strokeWidth="3" />
              <circle cx="20" cy="20" r="16" fill="none" stroke="#1677ff" strokeWidth="3" strokeLinecap="round" strokeDasharray="100" strokeDashoffset="60" />
            </svg>
            <span className="canvasLoadingText">加载中</span>
          </div>
        ) : selectedIndustryId === null ? (
          <div className="emptyState">请先选择一个行业</div>
        ) : treeMode ? (
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
              onDoubleClick={onPaneDoubleClickHandler}
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
              {domainGroups.length > 0 && (
                <Panel position="top-left" className="domainLegend">
                  <div className="domainLegendTitle" onClick={() => setDomainLegendCollapsed(!domainLegendCollapsed)}>
                    <span className="domainLegendCollapseIcon">{domainLegendCollapsed ? '▸' : '▾'}</span>
                    概念域
                  </div>
                  {!domainLegendCollapsed && (
                    <div className="domainLegendBody">
                      {domainGroups.map((d, i) => {
                    const crossInfo = crossDomainStats.crossByDomain.get(d.id);
                    const crossCount = crossInfo?.count || 0;
                    const peers = crossInfo?.peers;
                    return (
                      <div key={d.id} className="domainLegendItem">
                        <span className="domainLegendDot" style={{ background: DOMAIN_COLORS[i % DOMAIN_COLORS.length] }} />
                        <span className="domainLegendName">{d.displayName}</span>
                        <span className="domainLegendCount">{d.conceptCount || 0}</span>
                        {crossCount > 0 && (
                          <span className="domainLegendCross" title={
                            peers ? '跨域边\n' + [...peers.entries()].map(([pid, cnt]) =>
                              `${crossDomainStats.domainIdToName.get(pid) || '未知'}: ${cnt}条`
                            ).join('\n') : '跨域边'
                          }>
                            ⇄{crossCount}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {concepts.some((c) => c.groupId == null) && (
                    <div className="domainLegendItem">
                      <span className="domainLegendDot" style={{ background: '#bfbfbf' }} />
                      <span className="domainLegendName">全局</span>
                      <span className="domainLegendCount">
                        {concepts.filter((c) => c.groupId == null).length}
                      </span>
                    </div>
                  )}
                    </div>
                  )}
                </Panel>
              )}
              <Panel position="bottom-center">
                <div className="bottomBar">
                  <span>{concepts.filter((c) => !selectedDomainId || c.groupId === selectedDomainId).length} 个概念</span>
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
            <div className="sidebarHeader">
              <span className="sidebarHeaderIcon">{CONCEPT_NODE_ICONS[getNodeType(selectedConcept, concepts, relations)] || CONCEPT_NODE_ICONS.default}</span>
              <div className="sidebarHeaderInfo">
                <div className="sidebarHeaderName">{selectedConcept.name}</div>
                <div className="sidebarHeaderMeta">
                  {selectedConcept.groupId && (
                    <span className="sidebarHeaderDomain" style={{ color: getDomainColor(selectedConcept.groupId), borderColor: getDomainColor(selectedConcept.groupId) }}>
                      {getDomainName(selectedConcept.groupId)}
                    </span>
                  )}
                  <span className="sidebarHeaderType">{getNodeType(selectedConcept, concepts, relations)}</span>
                </div>
              </div>
            </div>

            <div className="sidebarCard">
              <div className="sidebarCardTitle">基本信息</div>
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
                  rows={3}
                />
              </div>
              <div className="formGroup">
                <label className="formLabel">异常阈值表达式</label>
                <input
                  className="formInput"
                  placeholder="如: > 5%, < 80% 计划值"
                  value={editingForm.anomalyThresholdExpr}
                  onChange={(e) => setEditingForm((f) => ({ ...f, anomalyThresholdExpr: e.target.value }))}
                />
              </div>
              <div className="formGroup">
                <label className="formLabel">异常阈值说明</label>
                <input
                  className="formInput"
                  placeholder="如: 退货率超过5%判定为异常"
                  value={editingForm.anomalyThresholdDesc}
                  onChange={(e) => setEditingForm((f) => ({ ...f, anomalyThresholdDesc: e.target.value }))}
                />
              </div>
              <div className="formActions">
                <button className="btnPrimary" onClick={handleUpdateConcept}>保存</button>
                <button className="btnDanger" onClick={handleDeleteConcept}>删除</button>
              </div>
            </div>

            <div className="sidebarCard">
              <div className="sidebarCardTitle">
                关系
                {selectedRelations.length > 0 && <span className="sidebarCardBadge">{selectedRelations.length}</span>}
              </div>
              {selectedRelations.length === 0 ? (
                <div className="emptyHint">从节点拖线到另一个节点创建关系</div>
              ) : (
                selectedRelations.map((r) => {
                  const isSource = r.sourceConceptId === selectedConcept.id;
                  const otherId = isSource ? r.targetConceptId : r.sourceConceptId;
                  const otherConcept = concepts.find((c) => c.id === otherId);
                  const color = RELATION_TYPE_COLORS[r.relationType] || '#999';
                  const label = RELATION_TYPE_LABELS[r.relationType] || r.relationType;
                  const dir = getRelationTypeDirection(r.relationType);
                  const arrow = (dir === 'source_to_target' && isSource) || (dir !== 'source_to_target' && !isSource) ? ' → ' : ' ← ';
                  const otherGroup = otherConcept ? getDomainName(otherConcept.groupId) : '';
                  return (
                    <div key={r.id} className="sidebarItem">
                      <div className="sidebarItemMain">
                        <span className="sidebarItemTag" style={{ background: color }}>{label}</span>
                        <span className="sidebarItemText">
                          {selectedConcept.name}{arrow}{otherConcept?.name || `ID:${otherId}`}
                          {otherGroup && otherGroup !== getDomainName(selectedConcept.groupId) && (
                            <span className="crossDomainBadge" title="跨域关系">{otherGroup}</span>
                          )}
                        </span>
                      </div>
                      <button className="sidebarItemRemove" onClick={() => handleDeleteRelation(r.id)}>×</button>
                      {r.expression && <div className="sidebarItemExtra">公式: {r.expression}</div>}
                    </div>
                  );
                })
              )}
              <button className="sidebarAddBtn" onClick={() => handleOpenSearchRelation(selectedConcept.id)}>+ 添加关系</button>
            </div>

            <div className="sidebarCard">
              <div className="sidebarCardTitle">
                绑定工具
                {selectedTools.length > 0 && <span className="sidebarCardBadge">{selectedTools.length}</span>}
              </div>
              <div className="sidebarCardSubTitle">生产概念的工具</div>
              {selectedTools.filter((t) => t.relation === 'PRODUCES').length === 0 ? (
                <div className="emptyHint">暂无</div>
              ) : (
                selectedTools.filter((t) => t.relation === 'PRODUCES').map((tb) => (
                  <div key={tb.id} className="sidebarItem">
                    <div className="sidebarItemMain">
                      <span className="sidebarItemTag" style={{ background: '#52c41a' }}>生产</span>
                      <span className="sidebarItemText">{tb.toolName}</span>
                    </div>
                    <button className="sidebarItemRemove" onClick={() => handleUnbindTool(tb.id)}>×</button>
                  </div>
                ))
              )}
              <div className="sidebarCardSubTitle">消费概念的工具</div>
              {selectedTools.filter((t) => t.relation === 'CONSUMES').length === 0 ? (
                <div className="emptyHint">暂无</div>
              ) : (
                selectedTools.filter((t) => t.relation === 'CONSUMES').map((tb) => (
                  <div key={tb.id} className="sidebarItem">
                    <div className="sidebarItemMain">
                      <span className="sidebarItemTag" style={{ background: '#1677ff' }}>消费</span>
                      <span className="sidebarItemText">{tb.toolName}</span>
                    </div>
                    <button className="sidebarItemRemove" onClick={() => handleUnbindTool(tb.id)}>×</button>
                  </div>
                ))
              )}
              <button className="sidebarAddBtn" onClick={handleOpenToolPicker}>+ 绑定工具</button>
            </div>

            <div className="sidebarCard">
              <div className="sidebarCardTitle">
                字段映射
                {conceptMappings.length > 0 && <span className="sidebarCardBadge">{conceptMappings.length}</span>}
              </div>
              {conceptMappings.length === 0 ? (
                <div className="emptyHint">暂无字段映射</div>
              ) : (
                conceptMappings.map((m) => (
                  <div key={m.id} className="sidebarItem">
                    <div className="sidebarItemMain">
                      <span className="sidebarItemTag" style={{ background: '#722ed1' }}>{m.mappingType}</span>
                      <span className="sidebarItemText">
                        {m.tableName}.{m.columnName}
                        {m.attributeName && ` → ${m.attributeName}`}
                      </span>
                    </div>
                    <div className="sidebarItemActions">
                      <button className="sidebarItemEdit" onClick={() => handleOpenMappingForm(m)}>✎</button>
                      <button className="sidebarItemRemove" onClick={() => handleDeleteMapping(m.id)}>×</button>
                    </div>
                  </div>
                ))
              )}
              <button className="sidebarAddBtn" onClick={() => handleOpenMappingForm()}>+ 添加映射</button>
            </div>

            <div className="sidebarCard">
              <div className="sidebarCardTitle">
                JOIN 映射
                {joinMappings.length > 0 && <span className="sidebarCardBadge">{joinMappings.length}</span>}
              </div>
              {joinMappings.length === 0 ? (
                <div className="emptyHint">暂无 JOIN 映射</div>
              ) : (
                joinMappings.map((j) => (
                  <div key={j.id} className="sidebarItem">
                    <div className="sidebarItemMain">
                      <span className="sidebarItemTag" style={{ background: '#13c2c2' }}>{j.relationType} JOIN</span>
                      <span className="sidebarItemText">
                        {j.targetConcept} ← {j.joinTable}
                      </span>
                    </div>
                    <div className="sidebarItemActions">
                      <button className="sidebarItemEdit" onClick={() => handleOpenJoinForm(j)}>✎</button>
                      <button className="sidebarItemRemove" onClick={() => handleDeleteJoin(j.id)}>×</button>
                    </div>
                    <div className="sidebarItemExtra">{j.joinCondition}</div>
                  </div>
                ))
              )}
              <button className="sidebarAddBtn" onClick={() => handleOpenJoinForm()}>+ 添加 JOIN</button>
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
              {relations.some(r => `rel-${r.id}` === selectedEdge.id) && (
                <div className="formActions">
                  <button className="btnDanger" onClick={handleDeleteEdge}>删除关系</button>
                </div>
              )}
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

      {showCreateDialog && (
        <div className="overlay" onClick={() => { setShowCreateDialog(false); createDialogCallback.current = null; }}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ padding: 20 }}>
            <div className="dialogTitle">新建概念</div>
            <div className="dialogSubtitle">请输入概念名称</div>
            <div className="formGroup">
              <input
                className="formInput"
                value={createDialogName}
                onChange={(e) => setCreateDialogName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateDialogConfirm(); }}
                placeholder="概念名称"
                autoFocus
              />
            </div>
            <div className="formActions" style={{ marginTop: 12 }}>
              <button className="btnPrimary" onClick={handleCreateDialogConfirm}>确定</button>
              <button className="btn" onClick={() => { setShowCreateDialog(false); createDialogCallback.current = null; }}>取消</button>
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
                  }).then((ok: boolean) => {
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
            {relationOptions.map((opt) => (
              <button
                key={opt.type}
                className={`relationOption ${selectedRelationType === opt.type ? 'relationOptionSelected' : ''}`}
                onClick={() => setSelectedRelationType(opt.type)}
              >
                {opt.builtin && <div className="relationOptionSeparator" />}
                <div className="relationOptionTitle">
                  <span className="relationOptionDot" style={{ background: opt.dot }} />
                  {opt.title}
                  {opt.autoKeywords.some((kw) =>
                    `${pendingConnection.source}${pendingConnection.target}`.includes(kw)
                  ) && <span className="autoTag">推荐</span>}
                  {opt.builtin && <span className="builtinTag">内置</span>}
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
              <Select
                value={selectedToolRelation}
                options={[
                  { value: 'PRODUCES', label: '生产该概念' },
                  { value: 'CONSUMES', label: '消费该概念' },
                ]}
                onChange={setSelectedToolRelation}
              />
            </div>
            <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 12 }}>
              {(() => {
                const grouped = new Map<string, typeof availableTools>();
                for (const t of availableTools) {
                  const key = t.groupName;
                  if (!grouped.has(key)) grouped.set(key, []);
                  grouped.get(key)!.push(t);
                }
                return Array.from(grouped.entries()).map(([groupName, tools]) => (
                  <div key={groupName} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, color: '#999', padding: '4px 8px', fontWeight: 600 }}>
                      {groupName}
                    </div>
                    {tools.map((tool) => (
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
                ));
              })()}
            </div>
            <div className="formActions">
              <button className="btnPrimary" onClick={handleBindTool} disabled={!selectedToolId}>绑定</button>
              <button className="btn" onClick={() => setShowToolPicker(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {showMappingForm && (
        <div className="overlay" onClick={() => setShowMappingForm(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialogTitle">{editingMappingId ? '编辑字段映射' : '添加字段映射'}</div>
            <div className="dialogSubtitle">概念「{selectedConcept?.name}」的数据库字段映射</div>
            <div className="formGroup">
              <label className="formLabel">数据源 ID</label>
              <input
                className="formInput"
                type="number"
                placeholder="数据源 ID"
                value={mappingForm.datasourceId || ''}
                onChange={(e) => setMappingForm((f) => ({ ...f, datasourceId: Number(e.target.value) }))}
              />
            </div>
            <div className="formGroup">
              <label className="formLabel">表名</label>
              <input
                className="formInput"
                placeholder="如: hr_employee"
                value={mappingForm.tableName || ''}
                onChange={(e) => setMappingForm((f) => ({ ...f, tableName: e.target.value }))}
              />
            </div>
            <div className="formGroup">
              <label className="formLabel">字段名</label>
              <input
                className="formInput"
                placeholder="如: employee_name"
                value={mappingForm.columnName || ''}
                onChange={(e) => setMappingForm((f) => ({ ...f, columnName: e.target.value }))}
              />
            </div>
            <div className="formGroup">
              <label className="formLabel">属性名</label>
              <input
                className="formInput"
                placeholder="如: 姓名、编号、创建时间"
                value={mappingForm.attributeName || ''}
                onChange={(e) => setMappingForm((f) => ({ ...f, attributeName: e.target.value }))}
              />
            </div>
            <div className="formGroup">
              <label className="formLabel">映射类型</label>
              <Select
                value={mappingForm.mappingType || 'direct'}
                options={[
                  { value: 'direct', label: '直接映射' },
                  { value: 'computed', label: '计算字段' },
                ]}
                onChange={(v) => setMappingForm((f) => ({ ...f, mappingType: v as ConceptMapping['mappingType'] }))}
              />
            </div>
            {mappingForm.mappingType === 'computed' && (
              <div className="formGroup">
                <label className="formLabel">计算表达式</label>
                <input
                  className="formInput"
                  placeholder="如: salary * 12"
                  value={mappingForm.computedExpr || ''}
                  onChange={(e) => setMappingForm((f) => ({ ...f, computedExpr: e.target.value }))}
                />
              </div>
            )}
            <div className="formGroup">
              <label className="formLabel">置信度 (0-1)</label>
              <input
                className="formInput"
                type="number"
                min="0"
                max="1"
                step="0.1"
                value={mappingForm.confidence ?? 0.8}
                onChange={(e) => setMappingForm((f) => ({ ...f, confidence: Number(e.target.value) }))}
              />
            </div>
            <div className="formActions">
              <button className="btnPrimary" onClick={handleSaveMapping}>保存</button>
              <button className="btn" onClick={() => setShowMappingForm(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {showJoinForm && (
        <div className="overlay" onClick={() => setShowJoinForm(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialogTitle">{editingJoinId ? '编辑 JOIN 映射' : '添加 JOIN 映射'}</div>
            <div className="dialogSubtitle">概念「{selectedConcept?.name}」的关联表映射</div>
            <div className="formGroup">
              <label className="formLabel">数据源 ID</label>
              <input
                className="formInput"
                type="number"
                placeholder="数据源 ID"
                value={joinForm.datasourceId || ''}
                onChange={(e) => setJoinForm((f) => ({ ...f, datasourceId: Number(e.target.value) }))}
              />
            </div>
            <div className="formGroup">
              <label className="formLabel">关联概念</label>
              <input
                className="formInput"
                placeholder="如: department"
                value={joinForm.targetConcept || ''}
                onChange={(e) => setJoinForm((f) => ({ ...f, targetConcept: e.target.value }))}
              />
            </div>
            <div className="formGroup">
              <label className="formLabel">JOIN 类型</label>
              <Select
                value={joinForm.relationType || 'LEFT'}
                options={[
                  { value: 'LEFT', label: 'LEFT JOIN' },
                  { value: 'RIGHT', label: 'RIGHT JOIN' },
                  { value: 'INNER', label: 'INNER JOIN' },
                  { value: 'FULL', label: 'FULL JOIN' },
                ]}
                onChange={(v) => setJoinForm((f) => ({ ...f, relationType: v }))}
              />
            </div>
            <div className="formGroup">
              <label className="formLabel">JOIN 表名</label>
              <input
                className="formInput"
                placeholder="如: hr_department"
                value={joinForm.joinTable || ''}
                onChange={(e) => setJoinForm((f) => ({ ...f, joinTable: e.target.value }))}
              />
            </div>
            <div className="formGroup">
              <label className="formLabel">JOIN 条件</label>
              <input
                className="formInput"
                placeholder="如: t1.dept_id = t2.id"
                value={joinForm.joinCondition || ''}
                onChange={(e) => setJoinForm((f) => ({ ...f, joinCondition: e.target.value }))}
              />
            </div>
            <div className="formActions">
              <button className="btnPrimary" onClick={handleSaveJoin}>保存</button>
              <button className="btn" onClick={() => setShowJoinForm(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {showSearchRelation && (
        <div className="overlay" onClick={() => setShowSearchRelation(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
            <div className="dialogTitle">添加关系</div>
            <div className="dialogSubtitle">
              为「{concepts.find((c) => c.id === searchRelSourceId)?.name}」选择关联概念
            </div>
            <div className="formGroup">
              <label className="formLabel">搜索概念（全量搜索，不限域）</label>
              <input
                className="formInput"
                placeholder="输入概念名称搜索..."
                value={searchRelKeyword}
                onChange={(e) => handleSearchConcepts(e.target.value)}
                autoFocus
              />
            </div>
            {searchRelResults.length > 0 && (
              <div className="searchResultList">
                {searchRelResults.map((c) => (
                  <button
                    key={c.id}
                    className={`searchResultItem ${searchRelTargetId === c.id ? 'searchResultItemActive' : ''}`}
                    onClick={() => setSearchRelTargetId(c.id)}
                    disabled={c.id === searchRelSourceId}
                  >
                    <span className="searchResultName">{c.name}</span>
                    <span className="searchResultDesc">{c.description || ''}</span>
                    <span className="searchResultDomain">{getDomainName(c.groupId)}</span>
                  </button>
                ))}
              </div>
            )}
            {searchRelKeyword && searchRelResults.length === 0 && (
              <div className="emptyState" style={{ padding: 12 }}>未找到匹配概念</div>
            )}
            {searchRelTargetId && (
              <>
                <div className="dialogSubtitle" style={{ marginTop: 12 }}>
                  选择关系类型
                </div>
                {relationOptions.map((opt) => (
                  <button
                    key={opt.type}
                    className={`relationOption ${searchRelType === opt.type ? 'relationOptionSelected' : ''}`}
                    onClick={() => setSearchRelType(opt.type)}
                  >
                    <div className="relationOptionTitle">
                      <span className="relationOptionDot" style={{ background: opt.dot }} />
                      {opt.title}
                    </div>
                    <div className="relationOptionDesc">{opt.desc}</div>
                  </button>
                ))}
                {searchRelType === 'COMPUTED_FROM' && (
                  <div className="formGroup" style={{ marginTop: 12 }}>
                    <label className="formLabel">计算公式（可选）</label>
                    <input
                      className="formInput"
                      placeholder="如: 离职人数 / 员工总数"
                      value={searchRelExpression}
                      onChange={(e) => setSearchRelExpression(e.target.value)}
                    />
                  </div>
                )}
              </>
            )}
            <div className="formActions" style={{ marginTop: 16 }}>
              <button
                className="btnPrimary"
                disabled={!searchRelTargetId}
                onClick={handleCreateSearchRelation}
              >
                确定
              </button>
              <button className="btn" onClick={() => setShowSearchRelation(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {showConceptSelectModal && (
        <div className="modalOverlay" onClick={() => setShowConceptSelectModal(false)}>
          <div className="modalContent modalContentWide" onClick={(e) => e.stopPropagation()}>
            <h3 className="modalTitle">选择概念</h3>
            <p className="modalDesc">选择需要进行自动映射的概念，未映射的概念默认已勾选</p>
            <div className="conceptSelectBody">
              {(() => {
                const unmappedIds = new Set<number>();
                const mappedIds = new Set<number>();
                const allIds: number[] = [];
                const domainList: { gid: number; name: string; concepts: Concept[] }[] = [];
                for (const [gid, concepts] of allIndustryConcepts.entries()) {
                  const domain = domainGroups.find(d => d.id === gid);
                  domainList.push({ gid, name: domain?.displayName || `域 ${gid}`, concepts });
                  for (const c of concepts) {
                    allIds.push(c.id);
                    if (c.mapped) mappedIds.add(c.id);
                    else unmappedIds.add(c.id);
                  }
                }
                const allSelected = selectedConceptIds.length === allIds.length && allIds.length > 0;
                const allUnmappedSelected = unmappedIds.size > 0 &&
                  [...unmappedIds].every(id => selectedConceptIds.includes(id));
                return (
                  <>
                    <div className="conceptSelectActions">
                      <label className="conceptSelectAll">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={() => setSelectedConceptIds(allSelected ? [] : [...allIds])}
                        />
                        全选
                      </label>
                      <button
                        className="conceptSelectUnmappedBtn"
                        onClick={() => {
                          if (allUnmappedSelected) {
                            setSelectedConceptIds(prev => prev.filter(id => !unmappedIds.has(id)));
                          } else {
                            setSelectedConceptIds(prev => {
                              const next = new Set(prev);
                              unmappedIds.forEach(id => next.add(id));
                              return [...next];
                            });
                          }
                        }}
                      >
                        {allUnmappedSelected ? '取消未映射' : '仅选未映射'}
                      </button>
                      <span className="conceptSelectCount">已选 {selectedConceptIds.length}/{allIds.length}</span>
                    </div>
                    <div className="conceptSelectList">
                      {domainList.map(({ gid, name, concepts }) => {
                        const domainColor = domainColorMap.current[gid] || '#999';
                        return (
                          <div key={gid} className="conceptSelectDomain">
                            <div className="conceptSelectDomainHeader">
                              <span className="conceptSelectDomainDot" style={{ background: domainColor }} />
                              {name}
                              <span className="conceptSelectDomainCount">
                                {concepts.filter(c => selectedConceptIds.includes(c.id)).length}/{concepts.length}
                              </span>
                            </div>
                            {concepts.map(c => (
                              <label
                                key={c.id}
                                className={`conceptSelectItem ${c.mapped ? 'conceptSelectItemMapped' : ''}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedConceptIds.includes(c.id)}
                                  onChange={() => {
                                    setSelectedConceptIds(prev =>
                                      prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id]
                                    );
                                  }}
                                />
                                <span className="conceptSelectItemName">{c.name}</span>
                                {c.description && <span className="conceptSelectItemDesc">{c.description}</span>}
                                <span className={`conceptSelectItemStatus ${c.mapped ? 'mapped' : 'unmapped'}`}>
                                  {c.mapped ? '✓ 已映射' : '◦ 未映射'}
                                </span>
                              </label>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
            <div className="formActions">
              <button className="btnPrimary" onClick={handleConceptSelectNext}>下一步：选择数据源</button>
              <button className="btn" onClick={() => setShowConceptSelectModal(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {showDatasourceModal && (
        <div className="modalOverlay" onClick={() => setShowDatasourceModal(false)}>
          <div className="modalContent" onClick={(e) => e.stopPropagation()}>
            <h3 className="modalTitle">选择数据源</h3>
            <p className="modalDesc">选择要匹配的数据源，将对已选的 {selectedConceptIds.length} 个概念进行字段映射</p>
            <div className="datasourceCheckList">
              {[...groupedDatasources.groups.entries()].map(([ownerId, dsList]) => (
                <div key={ownerId} className="datasourceGroup">
                  <div className="datasourceGroupHeader">{ownerNameMap.get(ownerId) || `系统 ${ownerId}`}</div>
                  {dsList.map((ds) => (
                    <label key={ds.id} className="datasourceCheckItem">
                      <input
                        type="checkbox"
                        checked={selectedDatasourceIds.includes(ds.id)}
                        onChange={() => {
                          setSelectedDatasourceIds((prev) =>
                            prev.includes(ds.id) ? prev.filter((id) => id !== ds.id) : [...prev, ds.id]
                          );
                        }}
                      />
                      <span className="datasourceCheckName">{ds.name}</span>
                      <span className="datasourceCheckType">{ds.type}</span>
                    </label>
                  ))}
                </div>
              ))}
              {groupedDatasources.noOwner.length > 0 && (
                <div className="datasourceGroup">
                  <div className="datasourceGroupHeader">未归类</div>
                  {groupedDatasources.noOwner.map((ds) => (
                    <label key={ds.id} className="datasourceCheckItem">
                      <input
                        type="checkbox"
                        checked={selectedDatasourceIds.includes(ds.id)}
                        onChange={() => {
                          setSelectedDatasourceIds((prev) =>
                            prev.includes(ds.id) ? prev.filter((id) => id !== ds.id) : [...prev, ds.id]
                          );
                        }}
                      />
                      <span className="datasourceCheckName">{ds.name}</span>
                      <span className="datasourceCheckType">{ds.type}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="formActions">
              <button className="btnPrimary" onClick={handleAutoMatchConfirm}>开始匹配</button>
              <button className="btn" onClick={() => setShowDatasourceModal(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {showChangeReview && (
        <div className="modalOverlay" onClick={() => setShowChangeReview(false)}>
          <div className="changeReviewPanel" onClick={(e) => e.stopPropagation()}>
            <div className="changeReviewHeader">
              <h3 className="changeReviewTitle">
                <ShieldCheck size={18} />
                本体变更审核
              </h3>
              <button className="changeReviewClose" onClick={() => setShowChangeReview(false)}>✕</button>
            </div>

            <div className="changeReviewBody">
              {changesLoading ? (
                <div className="changeReviewLoading">加载中...</div>
              ) : pendingChanges.length === 0 ? (
                <div className="changeReviewEmpty">暂无待审核的变更</div>
              ) : (
                <>
                  <div className="changeReviewToolbar">
                    <label className="changeReviewSelectAll">
                      <input
                        type="checkbox"
                        checked={pendingChanges.filter((c) => c.status === 'PENDING').length > 0 && selectedChangeIds.size === pendingChanges.filter((c) => c.status === 'PENDING').length}
                        onChange={toggleSelectAll}
                      />
                      <span>全选</span>
                    </label>
                    <span className="changeReviewCount">
                      共 {pendingChanges.length} 条变更，已选 {selectedChangeIds.size} 条
                    </span>
                    <span className="changeReviewBreakdown">
                      <span className="breakdownItem concept">概念 {pendingChanges.filter((c) => c.entityType === 'CONCEPT').length}</span>
                      <span className="breakdownItem relation">关系 {pendingChanges.filter((c) => c.entityType === 'RELATION').length}</span>
                      <span className="breakdownItem mapping">映射 {pendingChanges.filter((c) => c.entityType === 'MAPPING').length}</span>
                      <span className="breakdownItem join">连接 {pendingChanges.filter((c) => c.entityType === 'JOIN_MAPPING').length}</span>
                    </span>
                    <div className="changeReviewBatchActions">
                      <button
                        className="changeReviewBatchBtn approve"
                        disabled={selectedChangeIds.size === 0}
                        onClick={handleBatchApprove}
                      >
                        批量通过
                      </button>
                      <button
                        className="changeReviewBatchBtn reject"
                        disabled={selectedChangeIds.size === 0}
                        onClick={handleBatchReject}
                      >
                        批量拒绝
                      </button>
                    </div>
                  </div>
                  <div className="changeReviewList">
                    {pendingChanges.map((change) => {
                      const isSelected = selectedChangeIds.has(change.id);
                      const opLabel = change.operation.replace(/_/g, ' ');
                      const beforeObj = change.beforeSnapshot ? safeJsonParse(change.beforeSnapshot) : null;
                      const afterObj = change.afterSnapshot ? safeJsonParse(change.afterSnapshot) : null;

                      return (
                        <div
                          key={change.id}
                          className={`changeReviewItem ${change.status === 'APPROVED' ? 'approved' : change.status === 'REJECTED' ? 'rejected' : ''}`}
                        >
                          <div className="changeReviewItemHeader">
                            <label className="changeReviewCheckbox">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={change.status !== 'PENDING'}
                                onChange={() => toggleChangeSelection(change.id)}
                              />
                            </label>
                            <span className="changeReviewOpTag">{opLabel}</span>
                            <span className="changeReviewEntityType">{change.entityType}</span>
                            <span className={`changeReviewStatusTag ${change.status.toLowerCase()}`}>
                              {change.status === 'PENDING' ? '待审核' : change.status === 'APPROVED' ? '已通过' : '已拒绝'}
                            </span>
                          </div>

                          {change.reasoning && (
                            <div className="changeReviewReasoning">{change.reasoning}</div>
                          )}

                          {beforeObj || afterObj ? (
                            <div className="changeReviewDiff">
                              {beforeObj ? (
                                <div className="changeReviewDiffCol before">
                                  <div className="changeReviewDiffLabel">变更前</div>
                                  <pre className="changeReviewDiffPre before">
                                    {formatSnapshot(beforeObj, change.entityType)}
                                  </pre>
                                </div>
                              ) : (
                                <div className="changeReviewDiffCol before">
                                  <div className="changeReviewDiffLabel">变更前</div>
                                  <pre className="changeReviewDiffPre before empty">（新建）</pre>
                                </div>
                              )}
                              {afterObj ? (
                                <div className="changeReviewDiffCol after">
                                  <div className="changeReviewDiffLabel">变更后</div>
                                  <pre className="changeReviewDiffPre after">
                                    {formatSnapshot(afterObj, change.entityType)}
                                  </pre>
                                </div>
                              ) : (
                                <div className="changeReviewDiffCol after">
                                  <div className="changeReviewDiffLabel">变更后</div>
                                  <pre className="changeReviewDiffPre after empty">（删除）</pre>
                                </div>
                              )}
                            </div>
                          ) : null}

                          <div className="changeReviewMeta">
                            <span>操作人：{change.operatorName}</span>
                            <span>触发方式：{change.triggerType === 'user_request' ? '用户请求' : '自动检测'}</span>
                            <span>{new Date(change.createdAt).toLocaleString()}</span>
                          </div>

                          {change.status === 'PENDING' && (
                            <div className="changeReviewActions">
                              <button
                                className="changeReviewApproveBtn"
                                onClick={() => handleApproveChange(change.id)}
                              >
                                ✓ 通过
                              </button>
                              <button
                                className="changeReviewRejectBtn"
                                onClick={() => handleRejectChange(change.id)}
                              >
                                ✕ 拒绝
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}