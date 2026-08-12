import { get, post, put, del } from '@/api/client';
import type { Page, CodePage, CreateCodePageRequest, UpdateCodePageRequest } from '@/types/page';

export async function listPages(applicationId: number) {
  return get<Page[]>('/pages', { params: { applicationId } });
}

export async function createCodePage(data: CreateCodePageRequest) {
  return post<CodePage>('/pages/code', data);
}

export async function getCodePage(id: number) {
  return get<CodePage>(`/pages/${id}/code`);
}

export async function updateCodePage(id: number, data: UpdateCodePageRequest) {
  return put<CodePage>(`/pages/${id}/code`, data);
}

export async function deletePage(id: number) {
  return del<void>(`/pages/${id}`);
}

export async function renamePage(id: number, name: string) {
  return put<Page>(`/pages/${id}`, { name });
}