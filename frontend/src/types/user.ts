export interface User {
  id: number;
  email: string;
  name: string;
  displayName: string;
  username: string;
  roleId: number | null;
  roleName: string | null;
  deptId: number | null;
  deptName: string | null;
  leaderId: number | null;
  createdAt?: string;
}

export interface Role {
  id: number;
  name: string;
  slug: string;
  description: string;
  scope: string;
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
  name: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}