import { get, post, put, del } from '@/api/client';
import type { Application, CreateAppRequest } from '@/types/application';

export async function getApplication(id: number) {
  return get<Application>(`/applications/${id}`);
}

export async function listApplications(workspaceId: number) {
  return get<Application[]>('/applications', { params: { workspaceId } });
}

export async function createApplication(data: CreateAppRequest) {
  return post<Application>('/applications', data);
}

export async function updateApplication(id: number, name: string) {
  return put<Application>(`/applications/${id}`, { name });
}

export async function deleteApplication(id: number) {
  return del<void>(`/applications/${id}`);
}