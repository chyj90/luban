import { get, post, put, del } from '@/api/client';
import type { Datasource, CreateDatasourceRequest, TestDatasourceResponse, DatasourceStructure } from '@/types/datasource';

export async function listDatasources(slug: string, ownerId?: number) {
  return get<Datasource[]>('/datasources', { params: ownerId != null ? { slug, ownerId } : { slug } });
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