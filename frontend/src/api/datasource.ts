import { get, post, put, del } from '@/api/client';
import type { Datasource, CreateDatasourceRequest, TestDatasourceResponse, DatasourceStructure } from '@/types/datasource';

export async function listDatasources(slug: string, ownerId?: number) {
  return get<Datasource[]>('/datasources', { params: ownerId != null ? { slug, ownerId } : { slug } });
}

/**
 * 应用侧统一数据源视图（一个平台一套）：应用自建数据源 + 已授权平台数据源。
 * 平台数据源按"所属系统的系统权限"授权可见：未申请的不出现，申请中的带 accessStatus=PENDING。
 * includePending=true 时附带申请中的记录（不可执行，仅展示状态）。
 */
export async function listAccessibleDatasources(applicationId?: number, includePending?: boolean) {
  const params: Record<string, unknown> = {};
  if (applicationId != null) params.applicationId = applicationId;
  if (includePending) params.includePending = true;
  return get<Datasource[]>('/datasources/accessible', { params });
}

/** 应用开发/智能体/洞察沉淀用：已授权的平台数据源 + 应用自建数据源 */
export async function listUnifiedDatasources(applicationId?: number): Promise<Datasource[]> {
  const res = await listAccessibleDatasources(applicationId).catch(() => ({ data: [] as Datasource[] }));
  return res.data;
}

export async function createDatasource(data: CreateDatasourceRequest) {
  return post<Datasource>('/datasources', data);
}

export async function updateDatasource(id: number, data: CreateDatasourceRequest) {
  return put<Datasource>(`/datasources/${id}`, data);
}

export async function testDatasource(id: number) {
  return post<TestDatasourceResponse>(`/datasources/${id}/test`);
}

export async function getDatasourceStructure(id: number) {
  return get<DatasourceStructure>(`/datasources/${id}/structure`);
}

export async function deleteDatasource(id: number) {
  return del<void>(`/datasources/${id}`);
}

export async function syncTestSource(applicationId: number) {
  return post<Datasource>('/datasources/sync-test-source', null, { params: { applicationId } });
}