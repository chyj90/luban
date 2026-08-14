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

export interface WorkflowInstance {
  id: number;
  workflowId: number;
  applicationId: number;
  applicationName?: string;
  workflowVersion: number;
  definitionVersion: number;
  isTest: boolean;
  formId: number;
  formData: string;
  status: 'RUNNING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED' | 'FROZEN';
  initiatorId: number;
  currentNodes: string;
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
  action: string;
  fromNodeId: string;
  toNodeId: string;
  comment: string;
  detail: string;
  createdAt: string;
}

export interface Member {
  id: number;
  userId: number;
  name: string;
  email: string;
  mobile: string;
  avatar: string;
  departmentId: number;
  departmentName: string;
  position: string;
  externalId: string;
  employeeNo: string;
  leaderId: number;
  provider: string;
  status: string;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

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