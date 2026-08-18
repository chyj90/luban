import { get, put } from './index';
import type { User, Role, Department } from '@/types/user';

export function listUsers() {
  return get<User[]>('/users');
}

export function listRoles() {
  return get<Role[]>('/roles');
}

export function listDepartments() {
  return get<Department[]>('/departments');
}

export function updateUserRole(userId: number, roleId: number) {
  return put<User>(`/users/${userId}/role?roleId=${roleId}`);
}

export function updateUserDepartment(userId: number, deptId: number) {
  return put<User>(`/users/${userId}/department?deptId=${deptId}`);
}

export function updateUserLeader(userId: number, leaderId: number | null) {
  return put<User>(`/users/${userId}/leader?leaderId=${leaderId ?? ''}`);
}

export function createRole(data: { name: string; slug: string; description: string; scope: string }) {
  return get<Role>('/roles/create', data);
}

export function updateRole(id: number, data: { name: string; slug: string; description: string }) {
  return put<Role>(`/roles/${id}`, data);
}

export function deleteRole(id: number) {
  return get<Record<string, unknown>>(`/roles/${id}/delete`);
}

export function createDepartment(data: { name: string; managerId: number | null; parentId: number | null }) {
  return get<Department>('/departments/create', data);
}

export function updateDepartment(id: number, data: { name: string; managerId: number | null; parentId: number | null }) {
  return put<Department>(`/departments/${id}`, data);
}

export function deleteDepartment(id: number) {
  return get<Record<string, unknown>>(`/departments/${id}/delete`);
}