import type {
  FormDefinition,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowTask,
  WorkflowHistory,
  FormWorkflowBinding,
  Member,
  Department,
  Role,
} from '../types/workflow';
import { axiosInstance as api } from './client';

export const formApi = {
  list: (params?: { applicationId?: number }) =>
    api.get<FormDefinition[]>('/forms', { params }).then(r => r.data),

  get: (id: number) =>
    api.get<FormDefinition>(`/forms/${id}`).then(r => r.data),

  create: (data: Partial<FormDefinition>) =>
    api.post<FormDefinition>('/forms', data).then(r => r.data),

  update: (id: number, data: Partial<FormDefinition>) =>
    api.put<FormDefinition>(`/forms/${id}`, data).then(r => r.data),

  publish: (id: number) =>
    api.post<FormDefinition>(`/forms/${id}/publish`).then(r => r.data),

  delete: (id: number) =>
    api.delete(`/forms/${id}`).then(r => r.data),

  copy: (id: number) =>
    api.post<FormDefinition>(`/forms/${id}/copy`).then(r => r.data),

  preview: (id: number) =>
    api.get(`/forms/${id}/preview`).then(r => r.data),
};

export const workflowApi = {
  listDefinitions: (params?: { applicationId?: number }) =>
    api.get<WorkflowDefinition[]>('/workflows', { params }).then(r => r.data),

  getDefinition: (id: number) =>
    api.get<WorkflowDefinition>(`/workflows/${id}`).then(r => r.data),

  createDefinition: (data: Partial<WorkflowDefinition>) =>
    api.post<WorkflowDefinition>('/workflows', data).then(r => r.data),

  updateDefinition: (id: number, data: Partial<WorkflowDefinition>) =>
    api.put<WorkflowDefinition>(`/workflows/${id}`, data).then(r => r.data),

  publishDefinition: (id: number) =>
    api.post<WorkflowDefinition>(`/workflows/${id}/publish`).then(r => r.data),

  unpublishDefinition: (id: number) =>
    api.post<WorkflowDefinition>(`/workflows/${id}/unpublish`).then(r => r.data),

  deleteDefinition: (id: number) =>
    api.delete(`/workflows/${id}`),

  validateDefinition: (id: number) =>
    api.post(`/workflows/${id}/validate`).then(r => r.data),

  copyDefinition: (id: number) =>
    api.post<WorkflowDefinition>(`/workflows/${id}/copy`).then(r => r.data),

  getVersions: (id: number) =>
    api.get<WorkflowDefinition[]>(`/workflows/${id}/versions`).then(r => r.data),
};

export const instanceApi = {
  list: () =>
    api.get<WorkflowInstance[]>('/workflow-instances').then(r => r.data),

  get: (id: number) =>
    api.get<WorkflowInstance>(`/workflow-instances/${id}`).then(r => r.data),

  getHistory: (id: number) =>
    api.get<WorkflowHistory[]>(`/workflow-instances/${id}/history`).then(r => r.data),

  start: (params: { definitionId: number; formData: string }) =>
    api.post<WorkflowInstance>('/workflow-instances', params).then(r => r.data),

  cancel: (id: number) =>
    api.put(`/workflow-instances/${id}/cancel`),

  freeze: (id: number) =>
    api.put(`/workflow-instances/${id}/freeze`),

  unfreeze: (id: number) =>
    api.put(`/workflow-instances/${id}/unfreeze`),

  rejectTo: (instanceId: number, targetNodeId: string, comment: string) =>
    api.post(`/workflow-instances/${instanceId}/reject-to`, { targetNodeId, comment }),

  forceJump: (instanceId: number, targetNodeId: string, comment: string) =>
    api.post(`/workflow-instances/${instanceId}/force-jump`, { targetNodeId, comment }),

  resubmit: (instanceId: number, formData: string) =>
    api.post<WorkflowInstance>(`/workflow-instances/${instanceId}/resubmit`, { formData }).then(r => r.data),

  getSubProcesses: (instanceId: number) =>
    api.get<WorkflowInstance[]>(`/workflow-instances/${instanceId}/sub-processes`).then(r => r.data),
};

export const taskApi = {
  list: (params?: { status?: string }) =>
    api.get<WorkflowTask[]>('/tasks', { params }).then(r => r.data),

  get: (id: number) =>
    api.get<WorkflowTask>(`/tasks/${id}`).then(r => r.data),

  approve: (id: number, comment: string) =>
    api.put<WorkflowTask>(`/tasks/${id}/approve`, { comment }).then(r => r.data),

  reject: (id: number, comment: string) =>
    api.put<WorkflowTask>(`/tasks/${id}/reject`, { comment }).then(r => r.data),

  transfer: (id: number, targetUserId: number, targetUserName: string, comment: string) =>
    api.put<WorkflowTask>(`/tasks/${id}/transfer`, { targetUserId, targetUserName, comment }).then(r => r.data),

  delegate: (id: number, delegateUserId: number, comment: string) =>
    api.put<WorkflowTask>(`/tasks/${id}/delegate`, { delegateUserId, comment }).then(r => r.data),

  addSign: (id: number, addUserId: number, addSignType: string, comment: string) =>
    api.put<WorkflowTask>(`/tasks/${id}/add-sign`, { addUserId, addSignType, comment }).then(r => r.data),

  rejectToPrevious: (id: number, comment: string) =>
    api.post<WorkflowTask>(`/tasks/${id}/reject-previous`, { comment }).then(r => r.data),
};

export const adminApi = {
  forceJump: (instanceId: number, targetNodeId: string, comment: string) =>
    api.put(`/admin/instances/${instanceId}/force-jump`, { targetNodeId, comment }),

  forceStop: (instanceId: number, comment: string) =>
    api.put(`/admin/instances/${instanceId}/force-stop`, { comment }),

  forceWithdraw: (instanceId: number, comment: string) =>
    api.put(`/admin/instances/${instanceId}/force-withdraw`, { comment }),

  reassignTask: (taskId: number, newAssigneeId: number, comment: string) =>
    api.put<WorkflowTask>(`/admin/tasks/${taskId}/reassign`, { newAssigneeId, comment }).then(r => r.data),
};

export const orgApi = {
  getMembers: (params?: { departmentId?: number; keyword?: string }) =>
    api.get<Member[]>('/members', { params }).then(r => r.data),

  getMember: (id: number) =>
    api.get<Member>(`/members/${id}`).then(r => r.data),

  getDepartments: (params?: { parentId?: number }) =>
    api.get<Department[]>('/departments', { params }).then(r => r.data),

  getDepartmentTree: () =>
    api.get<Department[]>('/departments/tree').then(r => r.data),

  getDepartment: (id: number) =>
    api.get<Department>(`/departments/${id}`).then(r => r.data),

  getDepartmentMembers: (id: number) =>
    api.get<Member[]>(`/departments/${id}/members`).then(r => r.data),

  getRoles: (workspaceId: number) =>
    api.get<Role[]>('/roles', { params: { workspaceId } }).then(r => r.data),

  createRole: (data: Partial<Role>) =>
    api.post<Role>('/roles', data).then(r => r.data),

  updateRole: (id: number, data: Partial<Role>) =>
    api.put<Role>(`/roles/${id}`, data).then(r => r.data),

  deleteRole: (id: number) =>
    api.delete(`/roles/${id}`).then(r => r.data),
};

export const syncApi = {
  syncOrganization: () =>
    api.post('/sync/organization').then(r => r.data),

  syncCallback: (payload: Record<string, unknown>) =>
    api.post('/sync/organization/callback', payload).then(r => r.data),
};

export const lintApi = {
  lintFormCode: (html: string, css: string, js: string) =>
    api.post('/lint/form-code', { html, css, js }).then(r => r.data),

  lintFieldSchema: (fields: string) =>
    api.post('/lint/field-schema', { fields }).then(r => r.data),

  lintWorkflow: (nodes: string, edges: string, fields: string) =>
    api.post('/lint/workflow', { nodes, edges, fields }).then(r => r.data),

  lintCondition: (expression: string, fields: string) =>
    api.post('/lint/condition', { expression, fields }).then(r => r.data),
};

export const bindingApi = {
  list: (params?: { formId?: number; workflowId?: number; applicationId?: number }) =>
    api.get<FormWorkflowBinding[]>('/form-workflow-bindings', { params }).then(r => r.data),

  getDefault: (formId: number) =>
    api.get<FormWorkflowBinding>('/form-workflow-bindings/default', { params: { formId } }).then(r => r.data),

  bind: (data: { formId: number; workflowId: number; workflowVersion?: number; bindingType?: string; isDefault?: boolean }) =>
    api.post<FormWorkflowBinding>('/form-workflow-bindings', data).then(r => r.data),

  update: (id: number, data: { workflowVersion?: number; bindingType?: string; isDefault?: boolean }) =>
    api.put<FormWorkflowBinding>(`/form-workflow-bindings/${id}`, data).then(r => r.data),

  setDefault: (id: number) =>
    api.put(`/form-workflow-bindings/${id}/default`),

  unbind: (id: number) =>
    api.delete(`/form-workflow-bindings/${id}`),
};