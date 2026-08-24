export interface ToolGroup {
  id: number;
  name: string;
  code: string;
  description: string;
  systemPromptHint: string;
  icon: string;
  sortOrder: number;
  status: string;
  publicKey: string;
  keyPairCreatedAt: string;
}

export interface ToolDefinition {
  id: number;
  name: string;
  displayName: string;
  toolType: 'HTTP' | 'SQL' | 'MCP_PASSTHROUGH';
  description: string;
  inputSchema: string;
  outputSchema: string;
  config: string;
  groupId: number;
  status: string;
}

export interface ToolSearchResult {
  id: number;
  name: string;
  displayName: string;
  description: string;
  toolType: string;
}

export interface ToolTestResult {
  toolName: string;
  result: string;
  elapsedMs: number;
}

export interface McpServer {
  id: number;
  name: string;
  description: string;
  serverUrl: string;
  authType: string;
  authConfig: string;
  status: string;
  syncInterval: number;
  lastSyncAt: string;
  lastSyncStatus: string;
}

export interface McpToolDiscovery {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface SystemPermission {
  id: number;
  userId: number;
  userName: string;
  groupId: number;
  groupName: string;
  status: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
  reason: string;
  rejectReason: string;
  workflowInstanceId: number;
  createdAt: string;
  approvedAt: string;
  rejectedAt: string;
}

export interface SystemWithPerm {
  groupId: number;
  name: string;
  code: string;
  description: string;
  icon: string;
  status: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
  reason: string;
  rejectReason: string;
}

export interface PendingApproval {
  type: string;
  taskId: number;
  permissionId: number;
  applicant: string;
  applicantName?: string;
  applicantId?: number;
  systemName: string;
  groupId?: number;
  reason?: string;
  nodeName: string;
  createdAt: string;
  keyName?: string;
  toolName?: string;
}

export interface AgentConfig {
  id: number;
  name: string;
  modelEndpoint: string;
  modelName: string;
  isDefault: boolean;
  status: string;
}

export interface SwaggerEndpoint {
  path: string;
  method: string;
  summary: string;
  description: string;
  tag: string;
  name: string;
  parameters: Record<string, unknown>;
  inputSchema: string;
  config: string;
}