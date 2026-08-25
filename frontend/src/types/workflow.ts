export interface FormDefinition {
  id: number;
  name: string;
  description: string;
  applicationId: number;
  codePageId: number;
  fields: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowDefinition {
  id: number;
  name: string;
  description: string;
  applicationId: number;
  scope: 'APPLICATION' | 'PLATFORM';
  version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  nodes: string;
  edges: string;
  createdBy: number;
  publishedVersionId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface FormWorkflowBinding {
  id: number;
  formId: number;
  workflowId: number;
  workflowVersion: number | null;
  bindingType: 'ONE_TO_ONE' | 'ONE_TO_MANY';
  isDefault: boolean;
  createdAt: string;
}

export interface PendingTaskInfo {
  nodeId: string;
  nodeName: string;
  assigneeId: number;
  assigneeName?: string;
}

export interface WorkflowInstance {
  id: number;
  workflowId: number;
  workflowName?: string;
  applicationId: number;
  applicationName?: string;
  workflowVersion: number;
  definitionVersion: number;
  formId: number;
  formData: string;
  status: 'RUNNING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED' | 'FROZEN';
  initiatorId: number;
  initiatorName?: string;
  currentNodes: string;
  pendingTasks: PendingTaskInfo[];
  deadline: string;
  startedAt: string;
  completedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowTask {
  id: number;
  instanceId: number;
  applicationId: number;
  applicationName?: string;
  nodeId: string;
  nodeName?: string;
  assigneeId: number;
  assigneeType: 'NORMAL' | 'TRANSFER' | 'DELEGATE' | 'ADD_SIGN';
  originalAssigneeId: number | null;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';
  action: 'APPROVE' | 'REJECT' | 'TRANSFER' | 'ADD_SIGN' | null;
  comment: string;
  attachments: string;
  deadline: string;
  slaBreached: boolean;
  collaborationMode: string;
  allAssigneeIds: string;
  completedAssigneeIds: string;
  remindedAt: string;
  startedAt: string;
  completedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowHistory {
  id: number;
  instanceId: number;
  taskId: number | null;
  nodeId: string;
  operatorId: number;
  operatorName?: string;
  action: string;
  fromNodeId: string;
  toNodeId: string;
  comment: string;
  detail: string;
  createdAt: string;
}

// Member 已合并到 User，不再使用此类型
// 请使用 @/types/user 中的 User 接口

export interface Department {
  id: number;
  name: string;
  parentId: number;
  externalId: string;
  provider: string;
  path: string;
  managerId: number;
  orderNum: number;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: number;
  name: string;
  slug: string;
  description: string;
  applicationId: number;
  memberIds: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowNode {
  nodeId: string;
  nodeType: 'start' | 'approval' | 'condition' | 'parallel' | 'sub_process' | 'end' | 'cc';
  nodeName: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  condition?: string;
}