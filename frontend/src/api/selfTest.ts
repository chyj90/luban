import { get, post } from './client';
import type { ApiResponse } from '../types/api';
import type { SelfTestRun, SelfTestRunSource, SelfTestSpec } from '../types/selfTest';

/**
 * 应用链路自检（L2 业务链路层）。异步运行记录模型：
 * start 立即返回 RUNNING 记录（含 runId），终态报告经 getRun 轮询获取并持久化（历史可回看）。
 * 仅应用所有者可调用；应用已有自检在跑时 start 返回那条运行中记录（followedExisting=true）。
 */
export const selfTestApi = {
  start: (appId: number, spec: SelfTestSpec, source: SelfTestRunSource = 'MANUAL'): Promise<ApiResponse<SelfTestRun>> =>
    post<SelfTestRun>(`/applications/${appId}/self-test/runs?source=${source}`, spec),

  getRun: (appId: number, runId: string): Promise<ApiResponse<SelfTestRun>> =>
    get<SelfTestRun>(`/applications/${appId}/self-test/runs/${encodeURIComponent(runId)}`),

  listRuns: (appId: number, limit = 20): Promise<ApiResponse<SelfTestRun[]>> =>
    get<SelfTestRun[]>(`/applications/${appId}/self-test/runs?limit=${limit}`),
};
