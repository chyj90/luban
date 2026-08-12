import { get, post } from '@/api/client';
import type { Workspace } from '@/types/workspace';

export async function listWorkspaces() {
  return get<Workspace[]>('/workspaces');
}

export async function createWorkspace(name: string) {
  return post<Workspace>('/workspaces', { name });
}