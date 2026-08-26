import { get, post, put, del } from './client';
import { useAuthStore } from '@/stores/authStore';
import type { Concept, ConceptDetailResponse, ConceptRelation, ConceptTreeResponse, ToolConcept, CreateConceptRequest, CreateRelationRequest, CreateToolConceptRequest, OntologyGroup, Industry, IndustryRelation, ConceptMapping, ConceptJoinMapping, ConceptToolBinding, ConceptFeedback } from '@/types/concept';

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

export function listOntologyGroups(industryId?: number) {
  const params = industryId ? `?industryId=${industryId}` : '';
  return get<OntologyGroup[]>(`/ontology-groups${params}`);
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

export function listIndustries() {
  return get<Industry[]>('/industries');
}

export function getIndustry(id: number) {
  return get<Industry>(`/industries/${id}`);
}

export function createIndustry(data: Partial<Industry>) {
  return post<Industry>('/industries', data);
}

export function updateIndustry(id: number, data: Partial<Industry>) {
  return put<Industry>(`/industries/${id}`, data);
}

export function deleteIndustry(id: number) {
  return del<void>(`/industries/${id}`);
}

export function getIndustryRelations(industryId: number) {
  return get<IndustryRelation[]>(`/industries/${industryId}/relations`);
}

export function saveIndustryRelations(industryId: number, relations: Partial<IndustryRelation>[]) {
  return put<IndustryRelation[]>(`/industries/${industryId}/relations`, relations);
}

export function addIndustryRelation(industryId: number, data: Partial<IndustryRelation>) {
  return post<IndustryRelation>(`/industries/${industryId}/relations`, data);
}

export function addIndustryRelationsBatch(industryId: number, types: string[]) {
  return post<IndustryRelation[]>(`/industries/${industryId}/relations/batch`, types);
}

export function deleteIndustryRelation(industryId: number, relationId: number) {
  return del<void>(`/industries/${industryId}/relations/${relationId}`);
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

export function applyAutoMatchMappings(taskId: number, mappings: Record<string, unknown>[], joinMappings?: Record<string, unknown>[]) {
  return post<{ created: number; createdJoins: number; message: string }>(
    `/concepts/apply-auto-match-mappings`,
    { taskId, mappings, joinMappings },
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

export function quickConceptFeedback(data: {
  sessionId: string;
  messageId: string;
  feedbackType: 'like' | 'dislike';
  userQuestion: string;
  answer?: string;
  faissConcepts?: { conceptId: number; conceptName: string; confidence?: number }[];
  ontologyConcepts?: { conceptId: number; conceptName: string; depth?: number }[];
  usedConcepts?: { conceptId: number; conceptName: string }[];
  correctConceptId?: number;
  correctConceptName?: string;
  userDescription?: string;
}) {
  return post<ConceptFeedback>('/concept-feedback/quick', data);
}

export function reviewConceptFeedback(id: number, data: { reviewedBy: string; reviewComment: string }) {
  return put<ConceptFeedback>(`/concept-feedback/${id}/review`, data);
}

export function resolveConceptFeedback(id: number, data: { reviewedBy: string }) {
  return put<ConceptFeedback>(`/concept-feedback/${id}/resolve`, data);
}

export function analyzeConceptFeedback(id: number) {
  return post<Array<Record<string, unknown>>>(`/concept-feedback/${id}/analyze`);
}

export function previewConceptFeedbackSuggestion(id: number, suggestionIndex: number) {
  return post<Record<string, unknown>>(`/concept-feedback/${id}/preview-suggestion`, { suggestionIndex });
}

export function applyConceptFeedbackSuggestion(id: number, suggestionIndex: number, reviewedBy: string) {
  return post<Record<string, unknown>>(`/concept-feedback/${id}/apply-suggestion`, { suggestionIndex, reviewedBy });
}

export function ignoreConceptFeedback(id: number, data: { reviewedBy: string; reviewComment: string }) {
  return put<ConceptFeedback>(`/concept-feedback/${id}/ignore`, data);
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

export function getEmbeddingTasks() {
  return get<Array<{ id: number; conceptId: number; taskType: string; status: string; errorMsg: string; createdAt: string; finishedAt: string }>>('/concept-embeddings/tasks');
}

export interface EmbeddingHealth {
  totalConcepts: number;
  embeddedConcepts: number;
  coverageRate: number;
  embeddingModelVersion: string;
  faissHealthy: boolean;
  indexStats: Record<string, unknown>;
  lastRebuildAt: string | null;
  lastRebuildStatus: string;
  lastRegenerateAt: string | null;
  lastRegenerateStatus: string;
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
  return put<void>(`/async-tasks/${taskId}/mark-processed`);
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
  industryId: number | null,
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
  formData.append('industryId', industryId != null ? String(industryId) : 'auto');
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

export function previewConceptImport(data: { sourceType: string; content?: string; url?: string; industryId?: number; groupId?: number }) {
  return post<{ concepts: Array<Record<string, unknown>>; total: number; sourceType: string }>('/concepts/import/preview', data, { timeout: 120000 });
}

export function executeConceptImport(data: { sourceType: string; content?: string; url?: string; industryId?: number; groupId?: number; selectedItems: Array<Record<string, unknown>> }) {
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