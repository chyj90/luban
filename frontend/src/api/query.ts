import { get, post, put, del } from '@/api/client';
import type { Query, CreateQueryRequest, UpdateQueryRequest, RunQueryRequest, RunQueryResponse } from '@/types/query';

export async function listQueries(applicationId: number) {
  return get<Query[]>('/queries', { params: { applicationId } });
}

export async function createQuery(data: CreateQueryRequest) {
  return post<Query>('/queries', data);
}

export async function updateQuery(id: number, data: UpdateQueryRequest) {
  return put<Query>(`/queries/${id}`, data);
}

export async function deleteQuery(id: number) {
  return del<void>(`/queries/${id}`);
}

export async function runQuery(id: number, data?: RunQueryRequest) {
  return post<RunQueryResponse>(`/queries/${id}/run`, data);
}

export async function executeSql(datasourceId: number, sql: string, multi?: boolean) {
  return post<any>('/queries/execute', { datasourceId, sql, multi: multi || undefined });
}

export async function runRuntimeQuery(pageId: number, queryId: number, data?: RunQueryRequest) {
  return post<RunQueryResponse>(`/runtime/${pageId}/query/${queryId}/run`, data);
}