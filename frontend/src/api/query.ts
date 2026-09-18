import { get, post, put, del } from '@/api/client';
import type { Query, CreateQueryRequest, UpdateQueryRequest, RunQueryRequest, RunQueryResponse } from '@/types/query';

export async function listQueries(applicationId: number) {
  return get<Query[]>('/queries', { params: { applicationId } });
}

/** 工作中心数据看板：当前用户可访问应用内的洞察沉淀查询 */
export async function listInsightSavedQueries() {
  return get<Query[]>('/queries/insight-saved');
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

export async function runQuery(id: number, data?: RunQueryRequest, previewAsUserId?: number) {
  // previewAsUserId：预览身份切换（仅应用所有者，后端校验）——this.auth 按该用户解析，
  // 用于验证"我的数据"类查询在不同账号下返回不同结果集
  return post<RunQueryResponse>(`/queries/${id}/run`, data,
    previewAsUserId != null ? { params: { previewAsUserId } } : undefined);
}

export async function executeSql(datasourceId: number, sql: string, multi?: boolean, allowDdl?: boolean, rollback?: boolean) {
  return post<any>('/queries/execute', {
    datasourceId,
    sql,
    multi: multi || undefined,
    allowDdl: allowDdl || undefined,
    rollback: rollback || undefined,
  });
}

export async function runRuntimeQuery(pageId: number, queryId: number, data?: RunQueryRequest) {
  return post<RunQueryResponse>(`/runtime/${pageId}/query/${queryId}/run`, data);
}