export interface Query {
  id: number;
  applicationId: number;
  datasourceId: number;
  name: string;
  body: string;
  params: Record<string, unknown>;
  createdAt: string;
}

export interface CreateQueryRequest {
  applicationId: number;
  datasourceId: number;
  name: string;
  body?: string;
  params?: Record<string, unknown>;
}

export interface UpdateQueryRequest {
  name?: string;
  body?: string;
  params?: Record<string, unknown>;
}

export interface RunQueryRequest {
  params?: Record<string, unknown>;
}

export interface RunQueryResponse {
  columns: string[];
  rows: unknown[][];
  totalCount: number;
  executionTime: number;
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