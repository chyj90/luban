import { get, post, put, del, axiosInstance } from './index';
import type { User, Role, Department, PageResult, ImportResult } from '@/types/user';
import type { Member } from '@/types/workflow';

export function getMyPermissions() {
  return get<string[]>('/auth/permissions');
}

export function listPermissions() {
  return get<{ key: string; label: string; desc: string; section: string }[]>('/permissions');
}

export function listUsers(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  accountFilter?: string;
}) {
  return get<PageResult<User>>('/users', { params });
}

export function listSimpleUsers(keyword?: string, page = 1, pageSize = 50) {
  return get<PageResult<{ id: number; account: string; email: string }>>('/users/simple', {
    params: { keyword, page, pageSize },
  });
}

export async function downloadUserTemplate(): Promise<Blob> {
  const res = await axiosInstance.get('/users/export-template', { responseType: 'blob' });
  return res.data;
}

export function importUsers(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  return post<ImportResult>('/users/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export function listRoles() {
  return get<Role[]>('/roles');
}

export function listDepartments() {
  return get<Department[]>('/departments');
}

export function createUserFromMember(memberId: number, userType: 'normal' | 'test' = 'normal') {
  return post<User>(`/users/from-member/${memberId}?userType=${userType}`);
}

export function updateUserRole(userId: number, roleIds: number[]) {
  return put<User>(`/users/${userId}/role`, roleIds);
}

export function updateUserDepartment(userId: number, deptId: number) {
  return put<User>(`/users/${userId}/department?deptId=${deptId}`);
}

export function updateUserLeader(userId: number, leaderId: number | null) {
  return put<User>(`/users/${userId}/leader?leaderId=${leaderId ?? ''}`);
}

export function createRole(data: { name: string; slug: string; description: string; scope: string }) {
  return post<Role>('/roles', data);
}

export function updateRole(id: number, data: { name?: string; description?: string }) {
  return put<Role>(`/roles/${id}`, data);
}

export function deleteRole(id: number) {
  return del<void>(`/roles/${id}`);
}

export function getRolePermissions(id: number) {
  return get<string[]>(`/roles/${id}/permissions`);
}

export function updateRolePermissions(id: number, permissions: string[]) {
  return put<void>(`/roles/${id}/permissions`, { permissions });
}

export function getRoleUsers(id: number) {
  return get<number[]>(`/roles/${id}/users`);
}

export function updateRoleUsers(id: number, userIds: number[]) {
  return put<void>(`/roles/${id}/users`, { userIds });
}

export function createDepartment(data: { name: string; parentId?: number; managerId?: number }) {
  return post<Department>('/departments', data);
}

export function updateDepartment(id: number, data: { name?: string; parentId?: number; managerId?: number }) {
  return put<Department>(`/departments/${id}`, data);
}

export function deleteDepartment(id: number) {
  return del<void>(`/departments/${id}`);
}

export function listDepartmentMembers(deptId: number) {
  return get<Member[]>(`/departments/${deptId}/members`);
}

export function updateMember(id: number, data: {
  name?: string;
  email?: string;
  mobile?: string;
  position?: string;
  employeeNo?: string;
  departmentId?: number | null;
}) {
  return put<Member>(`/members/${id}`, data);
}