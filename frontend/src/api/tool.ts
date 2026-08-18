import { get, post, put, del } from './client';
import type {
  ToolGroup,
  ToolDefinition,
  ToolSearchResult,
  ToolTestResult,
  McpServer,
  McpToolDiscovery,
  SystemPermission,
  SystemWithPerm,
  PendingApproval,
  AgentConfig,
  SwaggerEndpoint,
} from '@/types/tool';

export function listToolGroups() {
  return get<ToolGroup[]>('/tool-groups');
}

export function createToolGroup(data: Partial<ToolGroup>) {
  return post<ToolGroup>('/tool-groups', data);
}

export function updateToolGroup(id: number, data: Partial<ToolGroup>) {
  return put<ToolGroup>(`/tool-groups/${id}`, data);
}

export function deleteToolGroup(id: number) {
  return del<void>(`/tool-groups/${id}`);
}

export function listToolDefinitions(groupId?: number) {
  const url = groupId ? `/tool-definitions?groupId=${groupId}` : '/tool-definitions';
  return get<ToolDefinition[]>(url);
}

export function createToolDefinition(data: Partial<ToolDefinition>) {
  return post<ToolDefinition>('/tool-definitions', data);
}

export function updateToolDefinition(id: number, data: Partial<ToolDefinition>) {
  return put<ToolDefinition>(`/tool-definitions/${id}`, data);
}

export function deleteToolDefinition(id: number) {
  return del<void>(`/tool-definitions/${id}`);
}

export function searchTools(systemId: number, query: string) {
  return get<ToolSearchResult[]>(`/tools/search?systemId=${systemId}&query=${encodeURIComponent(query)}`);
}

export function getToolSchema(id: number) {
  return get<Record<string, unknown>>(`/tools/${id}/schema`);
}

export function testTool(id: number, arguments_: Record<string, unknown>) {
  return post<ToolTestResult>(`/tools/${id}/test`, arguments_);
}

export function listSystems() {
  return get<{ groupId: number; toolCount: number }[]>('/tools/systems');
}

export function listMcpServers() {
  return get<McpServer[]>('/mcp-servers');
}

export function createMcpServer(data: Partial<McpServer>) {
  return post<McpServer>('/mcp-servers', data);
}

export function updateMcpServer(id: number, data: Partial<McpServer>) {
  return put<McpServer>(`/mcp-servers/${id}`, data);
}

export function deleteMcpServer(id: number) {
  return del<void>(`/mcp-servers/${id}`);
}

export function testMcpConnection(id: number) {
  return post<Record<string, unknown>>(`/mcp-servers/${id}/test`);
}

export function discoverMcpTools(id: number) {
  return post<{ tools: McpToolDiscovery[]; toolCount: number }>(`/mcp-servers/${id}/discover`);
}

export function syncMcpTools(id: number, groupId: number) {
  return post<Record<string, unknown>>(`/mcp-servers/${id}/sync?groupId=${groupId}`);
}

export function getSystemPermissions() {
  return get<SystemWithPerm[]>('/permissions/systems');
}

export function applySystemPermission(groupId: number, reason: string) {
  return post<Record<string, unknown>>('/permissions/apply', { groupId, reason });
}

export function listMyPermissions() {
  return get<SystemPermission[]>('/permissions/my');
}

export function listPendingApprovals() {
  return get<PendingApproval[]>('/permissions/pending');
}

export function approvePermission(id: number, taskId: number, comment: string) {
  return post<Record<string, unknown>>(`/permissions/${id}/approve`, { taskId, comment });
}

export function rejectPermission(id: number, taskId: number, comment: string) {
  return post<Record<string, unknown>>(`/permissions/${id}/reject`, { taskId, comment });
}

export function getAgentConfig() {
  return get<AgentConfig[]>('/agent-configs');
}

export function updateAgentConfig(id: number, data: Partial<AgentConfig>) {
  return put<AgentConfig>(`/agent-configs/${id}`, data);
}

export function parseSwagger(data: { url?: string; content?: string }) {
  return post<{ endpoints: SwaggerEndpoint[]; total: number; swaggerVersion: string }>(
    '/tools/import/swagger/parse',
    data,
  );
}

export function batchImportSwagger(groupId: number, endpoints: SwaggerEndpoint[]) {
  return post<Record<string, unknown>>('/tools/import/swagger/batch', { groupId, endpoints });
}

export function listApiKeys() {
  return get<unknown[]>('/api-keys');
}

export function generateApiKey() {
  return post<unknown>('/api-keys');
}

export function requestToolPermission(apiKeyId: number, toolId: number) {
  return post<unknown>(`/api-keys/${apiKeyId}/request-tool`, { toolId });
}

export function deleteApiKey(id: number) {
  return del<void>(`/api-keys/${id}`);
}