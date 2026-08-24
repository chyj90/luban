export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ImportResult {
  success: number;
  skipped: number;
  errors: string[];
}

export interface User {
  id: number;
  displayName: string;
  email: string;
  mobile: string | null;
  position: string | null;
  employeeNo: string | null;
  deptId: number | null;
  deptName: string | null;
  leaderId: number | null;
  userId: number | null;
  account: string | null;
  createdAt?: string;
  roleId: number | null;
  roleName: string | null;
  roleIds: string | null;
  hasAccount: boolean;
  superAdmin?: boolean;
}

export interface Role {
  id: number;
  name: string;
  slug: string;
  description: string;
  scope: string;
  createdBy?: number | null;
}

export interface Department {
  id: number;
  name: string;
  managerId: number | null;
  managerName: string | null;
  parentId: number | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  account: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}