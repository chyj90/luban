/**
 * Agent 附件文件 API（/api/v1/agent/files）
 * 上传即由后端同步解析：原始文件持久化 + 提取文本/元信息落库，
 * 对话注入用上传响应里的 summary/previewText，按需深读走 text/sheet 分页接口。
 */
import { get, del, post, axiosInstance } from './client';
import type { ApiResponse } from '@/types/api';
import type { AttachmentMeta } from '@/types/agent';

export const AGENT_FILE_ACCEPT = '.docx,.txt,.md,.csv,.xlsx,.xls';

/**
 * 后端响应主键是 fileKey，前端统一用 fileId —— 在 API 层做一次归一，
 * 避免上传响应/列表里的字段名不一致导致占位 fileId 覆盖失败
 */
function normalizeFile<T extends Record<string, unknown>>(raw: T): AttachmentMeta {
  const r = raw as Record<string, unknown>;
  return {
    ...(r as unknown as AttachmentMeta),
    fileId: (r.fileKey as string) ?? (r.fileId as string) ?? '',
  };
}

/** 上传并解析。上传体积大，独立 timeout；progress 回调 0-100 */
export function uploadAgentFile(
  file: File,
  appId?: number,
  onProgress?: (pct: number) => void,
): Promise<ApiResponse<AttachmentMeta>> {
  const formData = new FormData();
  formData.append('file', file);
  return axiosInstance.post<ApiResponse<Record<string, unknown>>>('/agent/files', formData, {
    params: appId != null ? { appId } : undefined,
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
    onUploadProgress: (e) => {
      if (e.total && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  }).then((r) => ({ ...r.data, data: normalizeFile(r.data.data || {}) }));
}

export function listAgentFiles(appId: number) {
  return get<Record<string, unknown>[]>('/agent/files', { params: { appId } })
    .then((res) => ({ ...res, data: (res.data || []).map(normalizeFile) }));
}

export function getAgentFileMeta(fileKey: string) {
  return get<Record<string, unknown>>(`/agent/files/${fileKey}`)
    .then((res) => ({ ...res, data: normalizeFile(res.data || {}) }));
}

/** 提取文本分页读取（word/txt/csv） */
export function readAgentFileText(fileKey: string, offset = 0, limit = 4000) {
  return get<{
    fileKey: string;
    fileType: string;
    totalChars: number;
    offset: number;
    limit: number;
    content: string;
    nextOffset: number | null;
  }>(`/agent/files/${fileKey}/text`, { params: { offset, limit } });
}

/** Excel 明细行分页读取 */
export function readAgentFileSheet(
  fileKey: string,
  opts?: { sheetName?: string; startRow?: number; maxRows?: number },
) {
  return get<{
    fileKey: string;
    sheetName: string;
    totalRows: number;
    startRow: number;
    rows: string[][];
    nextStartRow: number | null;
  }>(`/agent/files/${fileKey}/sheet`, { params: opts });
}

export function deleteAgentFile(fileKey: string) {
  return del<void>(`/agent/files/${fileKey}`);
}

/**
 * 在沙箱执行 LLM 编写的 Python 代码解析附件。
 * 契约：代码定义 def main(ctx)，ctx['_files'][文件名] 为文件路径，返回值 JSON ≤5000 字符。
 */
export function executeAgentFilePython(fileKey: string, code: string) {
  return post<{
    success: boolean;
    result: Record<string, unknown> | null;
    stderr: string;
    errorCode: string | null;
  }>(`/agent/files/${fileKey}/execute-python`, { code }, { timeout: 90000 });
}
