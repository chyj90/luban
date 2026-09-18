import { post } from './client';
import type { ApiResponse } from '../types/api';
import type { SelfTestReport, SelfTestSpec } from '../types/selfTest';

/** 应用链路自检（L2 业务链路层）。仅应用所有者可调用，报告同步返回。 */
export const selfTestApi = {
  run: (appId: number, spec: SelfTestSpec): Promise<ApiResponse<SelfTestReport>> =>
    post<SelfTestReport>(`/applications/${appId}/self-test/run`, spec),
};
