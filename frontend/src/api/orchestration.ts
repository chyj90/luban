import { get, post, put, del } from './client';

/** 编排定义（列表/详情共用结构） */
export interface OrchestrationDefinition {
  id: number;
  name: string;
  description: string;
  applicationId: number;
  currentVersionId: number;
  publishedVersionId: number | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
}

export interface OrchestrationLintIssue {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

export interface OrchestrationTestRunResult {
  success: boolean;
  data: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  nodeTrace: Array<{ nodeId: string; nodeType: string; status: string; elapsedMs: number; error?: string }>;
  durationMs: number;
  executionId: number;
}

export async function listOrchestrations(applicationId: number) {
  return get<OrchestrationDefinition[]>('/orchestrations', { params: { applicationId } });
}

export async function createOrchestration(data: { name: string; description?: string; applicationId: number; dsl: string }) {
  return post<OrchestrationDefinition>('/orchestrations', data);
}

export async function getOrchestration(id: number) {
  return get<{ id: number; name: string; description: string; status: string; currentVersionId: number; publishedVersionId: number; dsl: string }>(`/orchestrations/${id}`);
}

export async function saveOrchestration(id: number, dsl: string) {
  return put<{ versionId: number }>(`/orchestrations/${id}`, { dsl });
}

export async function lintOrchestration(dsl: string) {
  return post<{ passed: boolean; errors: string[]; warnings: string[] }>('/orchestrations/lint', { dsl });
}

export async function testRunOrchestration(id: number, inputs: Record<string, unknown>) {
  return post<OrchestrationTestRunResult>(`/orchestrations/${id}/test-run`, { inputs });
}

export async function publishOrchestration(id: number) {
  return post<{ publishedVersionId: number; toolDefinitionId: number }>(`/orchestrations/${id}/publish`);
}

export async function listOrchestrationExecutions(id: number) {
  return get<unknown[]>(`/orchestrations/${id}/executions`);
}

export async function deleteOrchestration(id: number) {
  return del<void>(`/orchestrations/${id}`);
}