export interface Concept {
  id: number;
  name: string;
  parentId: number | null;
  groupId: number | null;
  description: string;
  anomalyThresholdExpr: string | null;
  anomalyThresholdDesc: string | null;
  createdAt: string;
  updatedAt: string;
  mapped?: boolean;
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
  anomalyThresholdExpr?: string;
  anomalyThresholdDesc?: string;
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

export interface OntologyGroup {
  id: number;
  name: string;
  displayName: string;
  industryId: number | null;
  description: string;
  iconUrl: string;
  sortOrder: number;
  isSystem: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  conceptCount: number;
}

export interface Industry {
  id: number;
  name: string;
  displayName: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface IndustryRelation {
  id: number;
  industryId: number;
  relationType: string;
  description: string;
  label: string;
  color: string;
  sourceRole: string;
  targetRole: string;
  sourceToTarget: boolean;
  isTransitive: boolean;
  isSymmetric: boolean;
  sortOrder: number;
  isBuiltin: boolean;
  createdAt: string;
}

export interface ConceptMapping {
  id: number;
  conceptId: number;
  datasourceId: number;
  tableName: string;
  columnName: string;
  attributeName: string;
  mappingType: 'direct' | 'computed';
  computedExpr: string;
  confidence: number;
  isAuto: boolean;
  isRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConceptJoinMapping {
  id: number;
  conceptId: number;
  datasourceId: number;
  targetConcept: string;
  relationType: string;
  joinTable: string;
  joinCondition: string;
  joinType: 'LEFT' | 'INNER' | 'RIGHT';
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConceptToolBinding {
  id: number;
  conceptId: number;
  toolId: number;
  bindingType: string;
  isDefault: boolean;
  config: string;
  createdAt: string;
}

export interface ConceptFeedback {
  id: number;
  sessionId: string;
  messageId: string;
  feedbackType: 'like' | 'dislike';
  userQuestion: string;
  reasoning: string;
  resolvedConcepts: string;
  generatedSql: string;
  queryResult: string;
  userFeedback: string;
  status: 'recorded' | 'pending' | 'analyzing' | 'applied' | 'ignored';
  reviewedBy: string;
  reviewComment: string;
  createdAt: string;
  reviewedAt: string;
}

export interface RelationTypeMeta {
  name: string;
  description: string;
  label: string;
  color: string;
  sourceRole: string;
  targetRole: string;
  sourceToTarget: boolean;
  transitive: boolean;
  symmetric: boolean;
  sortOrder: number;
}

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