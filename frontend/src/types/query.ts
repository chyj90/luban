export interface Query {
  id: number;
  applicationId: number;
  datasourceId: number;
  name: string;
  body: string;
  sqlBody?: string;
  params: Record<string, unknown>;
  description?: string;
  /** INSIGHT=智能洞察沉淀，空=应用开发创建 */
  source?: string;
  /** 非空=已发布为平台资产（值为所属系统 id），源应用保留编辑/删除权 */
  publishedGroupId?: number | null;
  /** 平台发布查询在 accessible 视图中的授权状态：APPROVED 可运行，PENDING 申请中 */
  accessStatus?: 'APPROVED' | 'PENDING';
  createdAt: string;
}

export interface CreateQueryRequest {
  applicationId: number;
  datasourceId: number;
  name: string;
  body?: string;
  params?: Record<string, unknown>;
  description?: string;
  source?: string;
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