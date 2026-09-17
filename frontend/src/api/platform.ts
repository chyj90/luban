import { get } from '@/api/client';

/**
 * 平台资产运行时查询（唯一事实源在平台侧，业务库不冗余）：
 * 业务表只存 user_id 绑定键，姓名/部门等身份属性在渲染时从这里实时解析——
 * 平台新增/改名/调岗用户自动对全部应用生效，无需任何同步。
 */

/** 最小字段集（组织目录语义，无 PII）：手机号/邮箱等敏感档案走用户管理端权限接口 */
export interface PlatformAssetUser {
  id: number;
  /** 显示名 */
  name: string;
  account: string;
  deptId?: number | null;
  deptName?: string | null;
  /** 直属领导（主部门的 leader，用户 ID） */
  leaderId?: number | null;
}

export interface PlatformAssetDepartment {
  id: number;
  name: string;
  parentId?: number | null;
  /** 部门经理（平台用户 ID） */
  managerId?: number | null;
  path?: string | null;
}

export interface PlatformUserQuery {
  keyword?: string;
  deptId?: number;
  /** 按绑定键批量精确解析（页面拿业务行的 user_id 列表回查身份） */
  ids?: number[];
  page?: number;
  pageSize?: number;
}

export interface PlatformUsersResult {
  rows: PlatformAssetUser[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PlatformDepartmentsResult {
  rows: PlatformAssetDepartment[];
  total: number;
}

/** 分页检索平台用户（keyword 模糊匹配姓名/账号；禁止全量拉取，按需取用） */
export async function getPlatformUsers(params?: PlatformUserQuery) {
  return get<PlatformUsersResult>('/platform/users', { params });
}

/** 部门组织树（部门量级远小于用户，全量返回） */
export async function getPlatformDepartments() {
  return get<PlatformDepartmentsResult>('/platform/departments');
}
