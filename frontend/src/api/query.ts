import { get, post, put, del } from '@/api/client';
import type { Query, CreateQueryRequest, UpdateQueryRequest, RunQueryRequest, RunQueryResponse } from '@/types/query';

export async function listQueries(applicationId: number) {
  return get<Query[]>('/queries', { params: { applicationId } });
}

/**
 * 一个平台一套 · 应用侧统一视图：应用自有查询 + 已授权系统的平台发布查询
 * （平台项带 accessStatus=APPROVED/PENDING，与数据源 accessible 同模型）。
 */
export async function listAccessibleQueries(applicationId: number, includePending = true) {
  return get<Query[]>('/queries/accessible', {
    params: { applicationId, includePending: String(includePending) },
  });
}

/** 发布为平台查询：挂到目标系统，KEY 可订阅调用，其他应用按系统权限使用 */
export async function publishQuery(id: number, groupId: number) {
  return post<Query>(`/queries/${id}/publish`, { groupId });
}

/** 取消发布：摘除平台身份（清理 QUERY 型工具定义），查询回到应用私有 */
export async function unpublishQuery(id: number) {
  return del<Query>(`/queries/${id}/publish`);
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