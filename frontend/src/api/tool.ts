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

export function listToolDefinitions(params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return get<ToolDefinition[]>(`/tools${qs}`);
}

export function createToolDefinition(data: Partial<ToolDefinition>) {
  return post<ToolDefinition>('/tools', data);
}

export function updateToolDefinition(id: number, data: Partial<ToolDefinition>) {
  return put<ToolDefinition>(`/tools/${id}`, data);
}

export function deleteToolDefinition(id: number) {
  return del<void>(`/tools/${id}`);
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

export function listProcessedApprovals() {
  return get<PendingApproval[]>('/permissions/processed');
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

export function testAgentConfig(data: { modelEndpoint: string; secretKey: string }) {
  return post<{ success: boolean; models?: { id: string; name: string }[]; error?: string }>(
    '/agent-configs/test',
    data,
  );
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

export function generateApiKey(name?: string) {
  return post<unknown>('/api-keys', name ? { name } : undefined);
}

export function renameApiKey(keyId: number, name: string) {
  return put<unknown>(`/api-keys/${keyId}/name`, { name });
}

export function requestToolPermission(apiKeyId: number, toolId: number) {
  return post<unknown>(`/api-keys/${apiKeyId}/request-tool`, { toolId });
}

export function requestToolPermissions(apiKeyId: number, toolIds: number[]) {
  return post<unknown>(`/api-keys/${apiKeyId}/request-tools`, { toolIds });
}

export function listKeyTools(apiKeyId: number) {
  return get<unknown[]>(`/api-keys/${apiKeyId}/tools`);
}

export function deleteApiKey(id: number) {
  return del<void>(`/api-keys/${id}`);
}

export function deletePermanentApiKey(id: number) {
  return del<void>(`/api-keys/${id}/permanent`);
}

export function restoreApiKey(id: number) {
  return post<unknown>(`/api-keys/${id}/restore`);
}

// Datasource permissions
export function listKeyDatasources(apiKeyId: number) {
  return get<unknown[]>(`/api-keys/${apiKeyId}/datasources`);
}

export function listAvailableDatasources(groupId: number) {
  return get<unknown[]>(`/api-keys/available-datasources?groupId=${groupId}`);
}

export function requestDatasourcePermission(apiKeyId: number, datasourceId: number) {
  return post<unknown>(`/api-keys/${apiKeyId}/request-datasource`, { datasourceId });
}

// Application binding
export function listKeysByApplication(applicationId: number) {
  return get<unknown[]>(`/api-keys/by-application/${applicationId}`);
}

export function listApplicationsByKey(apiKeyId: number) {
  return get<unknown[]>(`/api-keys/${apiKeyId}/applications`);
}

export function bindApplicationToKey(apiKeyId: number, applicationId: number) {
  return post<unknown>(`/api-keys/${apiKeyId}/bind-application`, { applicationId });
}

export function unbindApplicationFromKey(apiKeyId: number, applicationId: number) {
  return post<unknown>(`/api-keys/${apiKeyId}/unbind-application`, { applicationId });
}

// Application resource aggregation
export function listApplicationTools(applicationId: number) {
  return get<unknown[]>(`/api-keys/application/${applicationId}/tools`);
}

export function listApplicationDatasources(applicationId: number) {
  return get<unknown[]>(`/api-keys/application/${applicationId}/datasources`);
}