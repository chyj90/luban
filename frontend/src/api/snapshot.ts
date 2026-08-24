import { get, post } from './client';

export interface ConceptSnapshot {
  id: number;
  groupId: number;
  version: string;
  snapshot: string;
  changeLog: string;
  createdBy: string;
  createdAt: string;
}

export interface DiffResult {
  fromId: number;
  toId: number;
  fromVersion: string;
  toVersion: string;
  added: Array<Record<string, unknown>>;
  removed: Array<Record<string, unknown>>;
  modified: Array<{ id: number; name: string; changes: Array<{ field: string; from: string; to: string }> }>;
  summary: { addedCount: number; removedCount: number; modifiedCount: number };
  error?: string;
}

export function listSnapshots() {
  return get<ConceptSnapshot[]>('/concept-snapshots');
}

export function createSnapshot(data: {
  groupId: number;
  version: string;
  comment: string;
  createdBy: string;
}) {
  return post<ConceptSnapshot>('/concept-snapshots', data);
}

export function diffSnapshots(fromId: number, toId: number) {
  return get<DiffResult>(`/concept-snapshots/diff?fromId=${fromId}&toId=${toId}`);
}

export function getSnapshot(id: number) {
  return get<ConceptSnapshot>(`/concept-snapshots/${id}`);
}

export function rollbackSnapshot(id: number, reviewedBy: string) {
  return post<{ success: boolean; error?: string }>(`/concept-snapshots/${id}/rollback`, { reviewedBy });
}