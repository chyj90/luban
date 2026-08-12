import { get, post } from '@/api/client';
import type { JsFunction, CreateJsFunctionRequest } from '@/types/query';

export async function listJsFunctions(pageId: number) {
  return get<JsFunction[]>('/js-functions', { params: { pageId } });
}

export async function createJsFunction(data: CreateJsFunctionRequest) {
  return post<JsFunction>('/js-functions', data);
}