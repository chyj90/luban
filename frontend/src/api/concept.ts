import { get, post, put, del } from './client';
import type { Concept, ConceptDetailResponse, ConceptRelation, ConceptTreeResponse, ToolConcept, CreateConceptRequest, CreateRelationRequest, CreateToolConceptRequest } from '@/types/concept';

export function listConcepts(groupId?: number, keyword?: string) {
  const params = new URLSearchParams();
  if (groupId) params.set('groupId', String(groupId));
  if (keyword) params.set('keyword', keyword);
  return get<Concept[]>(`/concepts?${params.toString()}`);
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