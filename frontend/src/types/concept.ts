export interface Concept {
  id: number;
  name: string;
  parentId: number | null;
  groupId: number | null;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConceptDetailResponse {
  id: number;
  name: string;
  parentId: number | null;
  groupId: number | null;
  description: string;
  createdAt: string;
  updatedAt: string;
  relations: RelationInfo[];
  toolBindings: ToolBindingInfo[];
}

export interface RelationInfo {
  id: number;
  relationType: string;
  sourceConceptId: number;
  sourceConceptName: string;
  targetConceptId: number;
  targetConceptName: string;
  expression: string | null;
  description: string;
}

export interface ToolBindingInfo {
  id: number;
  toolId: number;
  toolName: string;
  relation: string;
}

export interface ConceptTreeResponse {
  id: number;
  name: string;
  parentId: number | null;
  groupId: number | null;
  description: string;
  relations: TreeRelationInfo[];
  children: ConceptTreeResponse[];
}

export interface TreeRelationInfo {
  id: number;
  relationType: string;
  targetConceptId: number;
  targetConceptName: string;
  expression: string | null;
  description: string;
}

export interface ConceptRelation {
  id: number;
  sourceConceptId: number;
  targetConceptId: number;
  relationType: string;
  expression: string | null;
  description: string;
  createdAt: string;
}

export interface ToolConcept {
  id: number;
  toolId: number;
  conceptId: number;
  relation: string;
  createdAt: string;
}

export interface CreateConceptRequest {
  name: string;
  parentId?: number;
  groupId?: number;
  description?: string;
}

export interface CreateRelationRequest {
  targetConceptId: number;
  relationType: string;
  expression?: string;
  description?: string;
}

export interface CreateToolConceptRequest {
  conceptId: number;
  relation: string;
}

export const RELATION_TYPE_LABELS: Record<string, string> = {
  PARENT_OF: '包含',
  COMPUTED_FROM: '计算得出',
  EQUIVALENT_TO: '等同于',
  PREREQUISITE_OF: '前提条件',
  DERIVED_FROM: '条件触发',
  UPPER_STREAM_OF: '上游产出',
};

export const RELATION_TYPE_COLORS: Record<string, string> = {
  PARENT_OF: '#1890ff',
  COMPUTED_FROM: '#722ed1',
  EQUIVALENT_TO: '#52c41a',
  PREREQUISITE_OF: '#fa8c16',
  DERIVED_FROM: '#eb2f96',
  UPPER_STREAM_OF: '#13c2c2',
};

export const RELATION_TYPE_PRIORITY: Record<string, number> = {
  PARENT_OF: 0,
  COMPUTED_FROM: 1,
  EQUIVALENT_TO: 2,
  PREREQUISITE_OF: 3,
  DERIVED_FROM: 4,
  UPPER_STREAM_OF: 5,
};

export const CONCEPT_NODE_ICONS: Record<string, string> = {
  default: '🔵',
  root: '🌐',
  computed: '📐',
  condition: '⚡',
  system: '📦',
};

export const CONCEPT_NODE_COLORS: Record<string, string> = {
  default: '#f0f5ff',
  leaf: '#f6ffed',
  root: '#fff7e6',
  computed: '#f9f0ff',
  condition: '#fff2e8',
  system: '#e6fffb',
};