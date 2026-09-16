export interface Query {
  id: number;
  applicationId: number;
  datasourceId: number;
  name: string;
  body: string;
  sqlBody?: string;
  params: Record<string, unknown>;
  createdAt: string;
}

export interface CreateQueryRequest {
  applicationId: number;
  datasourceId: number;
  name: string;
  body?: string;
  params?: Record<string, unknown>;
  description?: string;
}

export interface UpdateQueryRequest {
  name?: string;
  body?: string;
  params?: Record<string, unknown>;
  description?: string;
}

export interface RunQueryRequest {
  params?: Record<string, unknown>;
}

export interface RunQueryResponse {
  columns: string[];
  rows: unknown[][];
  totalCount: number;
  executionTime: number;
  resolvedSql?: string;
  /** INSERT 执行后的自增主键（非自增/无主键为 null）——审批回写场景据此把业务记录 id 放进 startWorkflow 的 formData */
  insertId?: number | null;
}

export interface JsFunction {
  id: number;
  pageId: number;
  name: string;
  body: string;
  createdAt: string;
}

export interface CreateJsFunctionRequest {
  pageId: number;
  name: string;
  body?: string;
}