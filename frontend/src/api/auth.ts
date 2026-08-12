import { post } from '@/api/client';
import type { LoginRequest, RegisterRequest, AuthResponse, User } from '@/types/user';

export async function login(data: LoginRequest) {
  return post<AuthResponse>('/auth/login', data);
}

export async function register(data: RegisterRequest) {
  return post<AuthResponse>('/auth/register', data);
}

export async function logout() {
  return post<void>('/auth/logout');
}

export async function getMe() {
  return post<User>('/users/me');
}