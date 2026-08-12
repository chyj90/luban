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