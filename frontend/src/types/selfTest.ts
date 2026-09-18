/** 自检测试引擎前端类型（与后端 com.luban.selftest.dto 对应） */

export interface SelfTestExpectation {
  operator: 'cell_eq' | 'rows_count_eq' | 'cell_contains' | 'is_empty';
  value?: string;
}

export interface SelfTestStep {
  id: string;
  /** 执行身份：TestSpec.actors 的别名；缺省为应用所有者 */
  actor?: string;
  type: 'query_run' | 'workflow_start' | 'task_complete' | 'wait_outbox' | 'assert_sql' | 'capture_sql';
  queryId?: number;
  params?: Record<string, unknown>;
  definitionId?: number;
  formData?: Record<string, unknown>;
  instanceRef?: string;
  action?: 'APPROVE' | 'REJECT';
  comment?: string;
  timeoutSeconds?: number;
  sql?: string;
  captureVar?: string;
  expect?: SelfTestExpectation;
}

export interface SelfTestSpec {
  testName: string;
  /** 断言/捕获用的数据源，必须属于被测应用 */
  datasourceId?: number;
  /** 角色别名 → 平台用户 ID（必须真实存在） */
  actors: Record<string, number>;
  steps: SelfTestStep[];
}

export interface SelfTestStepResult {
  id: string;
  type: string;
  actorId: number | null;
  passed: boolean;
  error: string | null;
  durationMs: number;
  evidence: Record<string, unknown> | null;
}

export interface SelfTestReport {
  runId: string;
  passed: boolean;
  summary: string;
  steps: SelfTestStepResult[];
  cleanupLog: string[];
  residuals: string[];
  warnings: string[];
}
