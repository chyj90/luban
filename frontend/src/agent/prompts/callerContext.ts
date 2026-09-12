import { useAuthStore } from '@/stores/authStore';

/**
 * 调用方身份（当前登录用户）。
 * 所有子智能体/直连智能体的系统提示词都从这里取身份，禁止各自读 store 拼字符串——
 * 保证 @提及直连与主智能体委派两条入口拿到的用户上下文完全一致。
 */
export interface CallerIdentity {
  memberId: number;
  name: string;
  account?: string | null;
  email?: string | null;
  deptName?: string | null;
}

export function getCallerIdentity(): CallerIdentity | undefined {
  const u = useAuthStore.getState().user;
  if (!u) return undefined;
  return {
    memberId: u.id,
    name: u.displayName,
    account: u.account,
    email: u.email,
    deptName: u.deptName,
  };
}

/** 渲染注入系统提示词的"当前用户身份"段；未登录时返回空串（调用方直接拼接即可） */
export function formatCallerContext(identity: CallerIdentity | undefined): string {
  if (!identity) return '';
  return [
    '## 当前用户身份',
    '你正在为以下用户工作，用户描述中出现"我""当前用户""本人"等指代时，均指这个用户：',
    `- 用户 ID：${identity.memberId}`,
    `- 姓名：${identity.name}`,
    identity.account ? `- 账号：${identity.account}` : '',
    identity.email ? `- 邮箱：${identity.email}` : '',
    identity.deptName ? `- 部门：${identity.deptName}` : '',
    '',
    `⚠️ 需要以"当前用户"作为操作对象时（审批人、发起人、负责人等），直接使用用户 ID ${identity.memberId}，无需再查询成员列表。`,
  ].filter(Boolean).join('\n');
}
