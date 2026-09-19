import { get, post, put, del } from './client';
import { useAuthStore } from '@/stores/authStore';
import type { Concept, ConceptDetailResponse, ConceptRelation, ConceptTreeResponse, ToolConcept, CreateConceptRequest, CreateRelationRequest, CreateToolConceptRequest, OntologyGroup, RelationType, ConceptMapping, ConceptJoinMapping, ConceptToolBinding, ConceptFeedback, RelationTypeMeta } from '@/types/concept';

export function listConcepts(groupId?: number, keyword?: string) {
  const params = new URLSearchParams();
  if (groupId) params.set('groupId', String(groupId));
  if (keyword) params.set('keyword', keyword);
  return get<Concept[]>(`/concepts?${params.toString()}`);
}

export function batchGetConcepts(ids: number[]) {
  return post<Concept[]>('/concepts/batch', ids);
}

export function getConceptTree(groupId?: number) {
  const params = groupId ? `?groupId=${groupId}` : '';
  return get<ConceptTreeResponse[]>(`/concepts/tree${params}`);
}

export function getConcept(id: number) {
  return get<ConceptDetailResponse>(`/concepts/${id}`);
}

export function createConcept(data: CreateConceptRequest) {
  return post<Concept>('/concepts', data);
}

export function updateConcept(id: number, data: CreateConceptRequest) {
  return put<Concept>(`/concepts/${id}`, data);
}

export function deleteConcept(id: number) {
  return del<void>(`/concepts/${id}`);
}

export function getConceptRelations(conceptId: number) {
  return get<ConceptRelation[]>(`/concepts/${conceptId}/relations`);
}

export function listAllRelations(groupId?: number) {
  const params = groupId ? `?groupId=${groupId}` : '';
  return get<ConceptRelation[]>(`/concepts/relations${params}`);
}

export function createConceptRelation(conceptId: number, data: CreateRelationRequest) {
  return post<ConceptRelation>(`/concepts/${conceptId}/relations`, data);
}

export function updateConceptRelation(conceptId: number, relationId: number, data: CreateRelationRequest) {
  return put<ConceptRelation>(`/concepts/${conceptId}/relations/${relationId}`, data);
}

export function deleteConceptRelation(conceptId: number, relationId: number) {
  return del<void>(`/concepts/${conceptId}/relations/${relationId}`);
}

export function getConceptTools(conceptId: number) {
  return get<ToolConcept[]>(`/concepts/${conceptId}/tools`);
}

export function getToolConcepts(toolId: number) {
  return get<ToolConcept[]>(`/tools/${toolId}/concepts`);
}

export function bindToolConcept(toolId: number, data: CreateToolConceptRequest) {
  return post<ToolConcept>(`/tools/${toolId}/concepts`, data);
}

export function unbindToolConcept(toolId: number, bindId: number) {
  return del<void>(`/tools/${toolId}/concepts/${bindId}`);
}

export function listOntologyGroups() {
  return get<OntologyGroup[]>('/ontology-groups');
}

export function getOntologyGroup(id: number) {
  return get<OntologyGroup>(`/ontology-groups/${id}`);
}

export function createOntologyGroup(data: Partial<OntologyGroup>) {
  return post<OntologyGroup>('/ontology-groups', data);
}

export function updateOntologyGroup(id: number, data: Partial<OntologyGroup>) {
  return put<OntologyGroup>(`/ontology-groups/${id}`, data);
}

export function deleteOntologyGroup(id: number) {
  return del<void>(`/ontology-groups/${id}`);
}

export function listRelationTypes() {
  return get<RelationType[]>('/relation-types');
}

export function createRelationType(data: Partial<RelationType>) {
  return post<RelationType>('/relation-types', data);
}

export function updateRelationType(id: number, data: Partial<RelationType>) {
  return put<RelationType>(`/relation-types/${id}`, data);
}

export function deleteRelationType(id: number) {
  return del<void>(`/relation-types/${id}`);
}

export function listConceptMappings(conceptId: number, datasourceId?: number) {
  const params = datasourceId ? `?datasourceId=${datasourceId}` : '';
  return get<ConceptMapping[]>(`/concepts/${conceptId}/mappings${params}`);
}

export function createConceptMapping(conceptId: number, data: Partial<ConceptMapping>) {
  return post<ConceptMapping>(`/concepts/${conceptId}/mappings`, data);
}

export function updateConceptMapping(conceptId: number, mappingId: number, data: Partial<ConceptMapping>) {
  return put<ConceptMapping>(`/concepts/${conceptId}/mappings/${mappingId}`, data);
}

export function deleteConceptMapping(conceptId: number, mappingId: number) {
  return del<void>(`/concepts/${conceptId}/mappings/${mappingId}`);
}

export function autoMatchConceptMappings(conceptIds: number[], datasourceIds: number[]) {
  return post<{ taskId: number }>('/concepts/auto-match-mappings', { conceptIds, datasourceIds });
}

export function autoMatchConceptMappingsV2(conceptIds: number[], datasourceIds: number[]) {
  return post<{ taskId: number }>('/concepts/auto-match-mappings-v2', { conceptIds, datasourceIds });
}

export function applyAutoMatchMappings(taskId: number) {
  return post<{
    created: number;
    skipped: number;
    createdJoins: number;
    skippedJoins: number;
    savedDetails: { conceptId: number; tableName?: string; columnName?: string; joinTable?: string; mappingType: string }[];
    skippedDetails: { conceptId: number; tableName?: string; columnName?: string; joinTable?: string; reason: string }[];
    message: string;
  }>(
    `/concepts/apply-auto-match-mappings`,
    { taskId },
  );
}

export function retryAutoMatchMappings(taskId: number, conceptIds: number[]) {
  return post<{ taskId: number }>(
    `/concepts/retry-auto-match-mappings`,
    { taskId, conceptIds },
  );
}

export function listConceptJoinMappings(conceptId: number, datasourceId?: number) {
  const params = datasourceId ? `?datasourceId=${datasourceId}` : '';
  return get<ConceptJoinMapping[]>(`/concepts/${conceptId}/join-mappings${params}`);
}

export function createConceptJoinMapping(conceptId: number, data: Partial<ConceptJoinMapping>) {
  return post<ConceptJoinMapping>(`/concepts/${conceptId}/join-mappings`, data);
}

export function updateConceptJoinMapping(conceptId: number, mappingId: number, data: Partial<ConceptJoinMapping>) {
  return put<ConceptJoinMapping>(`/concepts/${conceptId}/join-mappings/${mappingId}`, data);
}

export function deleteConceptJoinMapping(conceptId: number, mappingId: number) {
  return del<void>(`/concepts/${conceptId}/join-mappings/${mappingId}`);
}

export function listConceptToolBindings(conceptId: number, bindingType?: string) {
  const params = bindingType ? `?bindingType=${bindingType}` : '';
  return get<ConceptToolBinding[]>(`/concepts/${conceptId}/tool-bindings${params}`);
}

export function createConceptToolBinding(conceptId: number, data: Partial<ConceptToolBinding>) {
  return post<ConceptToolBinding>(`/concepts/${conceptId}/tool-bindings`, data);
}

export function deleteConceptToolBinding(conceptId: number, bindingId: number) {
  return del<void>(`/concepts/${conceptId}/tool-bindings/${bindingId}`);
}

export function listConceptFeedback(sessionId?: string, status?: string) {
  const params = new URLSearchParams();
  if (sessionId) params.set('sessionId', sessionId);
  if (status) params.set('status', status);
  return get<ConceptFeedback[]>(`/concept-feedback?${params.toString()}`);
}

export function createConceptFeedback(data: Partial<ConceptFeedback>) {
  return post<ConceptFeedback>('/concept-feedback', data);
}

export function createProblemFeedback(data: {
  sessionId: string;
  messageId: string;
  userDescription: string;
  userQuestion?: string;
}) {
  return post<ConceptFeedback>('/concept-feedback', data);
}

export function ignoreConceptFeedback(id: number, data: { reviewedBy: string; reviewComment: string }) {
  return put<ConceptFeedback>(`/concept-feedback/${id}/ignore`, data);
}

export function deleteConceptFeedback(id: number) {
  return del<void>(`/concept-feedback/${id}`);
}

export function getRoleConceptPermissions(roleId: number) {
  return get<{ groups: { groupId: number }[] }>(`/roles/${roleId}/concept-permissions`);
}

export function updateRoleConceptPermissions(roleId: number, groupIds: number[]) {
  return put<void>(`/roles/${roleId}/concept-permissions`, { groupIds });
}

export function rebuildConceptIndex() {
  return post<{ status: string; message: string }>('/concept-embeddings/rebuild');
}

export interface EmbeddingHealth {
  totalConcepts: number;
  embeddedConcepts: number;
  coverageRate: number;
  embeddingModelVersion: string;
  faissHealthy: boolean;
  indexStats: Record<string, unknown>;
}

export function getEmbeddingHealth() {
  return get<EmbeddingHealth>('/concept-embeddings/health');
}

export interface AsyncTaskInfo {
  id: number;
  taskType: string;
  status: string;
  progress: number;
  totalSteps: number;
  currentStep: string;
  result: string;
  errorMsg: string;
  userId: number;
  createdAt: string;
  finishedAt: string;
  processed: boolean;
}

export function getPendingAsyncTasks() {
  return get<AsyncTaskInfo[]>('/async-tasks/pending');
}

export interface ProcessedTasksPage {
  content: AsyncTaskInfo[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
}

export function getProcessedAsyncTasks(page: number, size: number) {
  return get<ProcessedTasksPage>('/async-tasks/processed', { params: { page, size } });
}

export function markTaskProcessed(taskId: number) {
  return put<null>(`/async-tasks/${taskId}/mark-processed`);
}

export function executeImportFromTask(taskId: number, selectedItems: Array<Record<string, unknown>>) {
  return post<{ created: number; skipped: number; newRelationTypes?: string[] }>('/concepts/import/execute-from-task', {
    taskId,
    selectedItems,
  });
}

export function uploadConceptImportAsync(
  file: File | null,
  sourceType: string,
  groupId: number | null,
  extra?: { content?: string; url?: string },
): Promise<{ taskId: number }> {
  const formData = new FormData();
  if (file) {
    formData.append('file', file);
  }
  if (extra?.content) {
    formData.append('content', extra.content);
  }
  if (extra?.url) {
    formData.append('url', extra.url);
  }
  formData.append('sourceType', sourceType);
  formData.append('groupId', groupId != null ? String(groupId) : 'auto');

  const token = useAuthStore.getState().token;
  return fetch('/api/v1/concepts/import/preview/async', {
    method: 'POST',
    body: formData,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  }).then((res) => res.json().then((d) => d.data));
}

export function regenerateAllEmbeddings() {
  return post<{ status: string; message: string }>('/concept-embeddings/regenerate-all');
}

export function previewConceptImport(data: { sourceType: string; content?: string; url?: string; groupId?: number }) {
  return post<{ concepts: Array<Record<string, unknown>>; total: number; sourceType: string }>('/concepts/import/preview', data, { timeout: 120000 });
}

export function executeConceptImport(data: { sourceType: string; content?: string; url?: string; groupId?: number; selectedItems: Array<Record<string, unknown>> }) {
  return post<{ created: number; skipped: number; imported: Array<Record<string, unknown>>; newRelationTypes?: string[] }>('/concepts/import/execute', data);
}

export interface OntologyChangeLog {
  id: number;
  sessionId: string;
  changeId: string;
  operation: string;
  entityType: string;
  entityId: number | null;
  beforeSnapshot: string | null;
  afterSnapshot: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED';
  operatorId: number;
  operatorName: string;
  triggerType: string;
  reasoning: string | null;
  executedAt: string | null;
  createdAt: string;
}

export function listOntologyChangeLogsBySession(sessionId: string) {
  return get<OntologyChangeLog[]>(`/ontology/changes/session/${sessionId}`);
}

export function listPendingOntologyChanges(sessionId?: string) {
  return get<OntologyChangeLog[]>('/ontology/changes/pending', sessionId ? { params: { sessionId } } : undefined);
}

export function approveOntologyChange(changeId: number) {
  return post<{ success: boolean; status: string }>(`/ontology/changes/${changeId}/approve`);
}

export function rejectOntologyChange(changeId: number) {
  return post<{ success: boolean; status: string }>(`/ontology/changes/${changeId}/reject`);
}

export function batchApproveOntologyChanges(changeIds: number[]) {
  return post<{ success: boolean; approved: number }>('/ontology/changes/batch', { changeIds });
}

export function batchRejectOntologyChanges(changeIds: number[]) {
  return post<{ success: boolean; rejected: number }>('/ontology/changes/batch/reject', { changeIds });
}

/** 建模 agent 语义缺口回流：提交本体变更草稿进审批队列 */
export function proposeOntologyChanges(data: { sessionId?: string; reasoning: string; changes: Array<Record<string, unknown>> }) {
  return post<{ success: boolean; recorded: Array<{ changeId: string; operation: string; status: string }> }>(
    '/ontology/changes/propose',
    data,
  );
}

// ===== 绑定集（Binding Profile） =====

export interface BindingProfileInfo {
  id: number;
  datasourceId: number;
  datasourceName: string;
  name: string;
  description: string;
  status: string;
  mappedConcepts: number;
  totalConcepts: number;
  synonymCount: number;
  enumColumnCount: number;
  updatedAt: string;
}

export interface SynonymDictEntry {
  term: string;
  conceptName?: string;
  synonyms?: string[];
  note?: string;
}

export interface EnumDictEntry {
  table: string;
  column: string;
  values?: string[];
  syncedAt?: string;
}

export function listBindingProfiles() {
  return get<BindingProfileInfo[]>('/binding-profiles');
}

export function getBindingProfile(datasourceId: number) {
  return get<BindingProfileInfo & { synonymDict: string | null; enumDict: string | null }>(`/binding-profiles/datasource/${datasourceId}`);
}

/** 一键接入：对该数据源启动全量概念自动映射（规则优先 + LLM 兜底），返回异步 taskId */
export function autoBindProfile(datasourceId: number, conceptIds?: number[]) {
  return post<{ profileId: number; taskId: number; conceptCount: number }>(
    `/binding-profiles/datasource/${datasourceId}/auto-bind`,
    conceptIds?.length ? { conceptIds } : {},
  );
}

export function getAsyncTask(id: number) {
  return get<AsyncTaskInfo>(`/async-tasks/${id}`);
}

export interface AutoMatchApplyResult {
  created: number;
  skipped: number;
  createdJoins: number;
  skippedJoins: number;
  message: string;
  savedDetails?: Array<{ conceptId: number; tableName?: string; columnName?: string }>;
  skippedDetails?: Array<{ conceptId: number; tableName?: string; reason?: string }>;
}

export function updateBindingProfile(id: number, data: { name?: string; description?: string; synonymDict?: SynonymDictEntry[] }) {
  return put<BindingProfileInfo>(`/binding-profiles/${id}`, {
    ...data,
    synonymDict: data.synonymDict ? JSON.stringify(data.synonymDict) : undefined,
  });
}

export function refreshEnumColumn(datasourceId: number, table: string, column: string) {
  return post<{ table: string; column: string; values: string[] }>(`/binding-profiles/datasource/${datasourceId}/enum-refresh`, { table, column });
}

// ===== 语义包典型问题回归 =====

export interface RegressionPackageInfo {
  name: string;
  displayName: string;
  description: string;
  caseCount: number;
}

export function listRegressionPackages() {
  return get<RegressionPackageInfo[]>('/ontology/regression/packages');
}

export function runRegression(packageName: string) {
  return post<{ taskId: number }>('/ontology/regression/run', { packageName });
}

// ===== 问题洞察（问数流量缺口挖掘 + 用户反馈） =====

export interface GapCluster {
  bucket: string;
  action: string;
  term: string;
  count: number;
  samples: Array<{ question: string; at: string }>;
}

export interface QuestionGapReport {
  windowDays: number;
  totalQuestions: number;
  buckets: { noConcept: number; sqlFail: number; permissionDenied: number; userFlagged: number };
  clusters: GapCluster[];
}

export function getQuestionGaps(days = 14) {
  return get<QuestionGapReport>(`/ontology/gaps?days=${days}`);
}

// ===== 跨源桥接（Federation Bridge） =====

export interface FederationBridgeInfo {
  id: number;
  name: string;
  leftDatasourceId: number;
  leftDatasourceName: string;
  leftTable: string;
  leftColumn: string;
  rightDatasourceId: number;
  rightDatasourceName: string;
  rightTable: string;
  rightColumn: string;
  joinType: string;
  description: string;
}

export function listFederationBridges() {
  return get<FederationBridgeInfo[]>('/federation-bridges');
}

export function createFederationBridge(data: Partial<FederationBridgeInfo>) {
  return post<FederationBridgeInfo>('/federation-bridges', data);
}

export function deleteFederationBridge(id: number) {
  return del<void>(`/federation-bridges/${id}`);
}

/** 按数据源视图：列出在某数据源上有绑定映射的概念及其映射明细 */
export function listConceptsByDatasource(datasourceId: number) {
  return get<Array<{ conceptId: number; name: string; groupId: number; description: string; mappings: Array<{ tableName: string; columnName: string; attributeName: string; mappingType: string }> }>>(
    `/concepts/by-datasource/${datasourceId}`,
  );
}

export function fetchBuiltinRelationTypes() {
  return get<RelationTypeMeta[]>('/ontology-groups/builtin-relation-types');
}
export interface Nl2SqlMapping {
  tableName: string;
  columnName: string;
  attributeName: string;
  mappingType: string;
  computedExpr?: string;
}

export interface Nl2SqlJoin {
  joinType: string;
  joinTable: string;
  joinCondition: string;
}

export interface Nl2SqlGenerateResult {
  sql: string;
  mainTable: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  mappings: Nl2SqlMapping[];
  joins: Nl2SqlJoin[];
}

/** 按概念口径生成基准 SQL（表/列/JOIN 全部来自概念映射，与智能问数同源） */
export function generateNl2Sql(data: { conceptIds: number[]; filters?: Record<string, unknown> }) {
  return post<Nl2SqlGenerateResult>('/nl2sql/generate', data);
}

export function validateNl2Sql(sql: string, datasourceId?: number) {
  return post<{ valid: boolean; errors: string[]; warnings: string[] }>('/nl2sql/validate', {
    sql,
    datasourceId,
  });
}
