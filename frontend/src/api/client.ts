import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import type { ApiResponse } from '@/types/api';
import { useAuthStore } from '@/stores/authStore';

const BASE_URL = '/api/v1';

const axiosInstance: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

axiosInstance.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export async function get<T>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
  const res = await axiosInstance.get<ApiResponse<T>>(url, config);
  return res.data;
}

export async function post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
  const res = await axiosInstance.post<ApiResponse<T>>(url, data, config);
  return res.data;
}

export async function put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
  const res = await axiosInstance.put<ApiResponse<T>>(url, data, config);
  return res.data;
}

export async function del<T>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
  const res = await axiosInstance.delete<ApiResponse<T>>(url, config);
  return res.data;
}

export { axiosInstance };