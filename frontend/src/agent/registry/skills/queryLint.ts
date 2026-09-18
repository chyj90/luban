/**
 * 查询静态 lint（B1）：
 * 页面侧有 LubanUI 校验，查询侧此前只有保存时 EXPLAIN——身份过滤缺失、回写无守卫
 * 这两类问题都到运行时才以"静默错误数据"的形式暴露（2026-09-17 请假案例：root 与
 * 员工看到同一份"我的请假"，根因就是身份过滤没生效且无任何环节检查）。
 *
 * 本模块把建模规范变成机器检查，在 create_query/update_query 时强制执行：
 *  - 身份域检查：名字/用途表明"按当前用户过滤"的查询必须用 {{ this.auth.* }} 过滤，
 *    禁止用 this.params 传身份（调用方可传任意值 → 越权 + 数据串号）；
 *  - 回写守卫检查：UPDATE/DELETE 写查询建议带状态守卫（触发器是异步 at-least-once
 *    派发，状态守卫让重复派发命中 0 行）。
 *
 * 业务绑定豁免（2026-09-17 员工管理案例）：INSERT/UPDATE 写查询里"管理员为业务记录
 * 绑定平台用户"的参数（如员工档案绑定归属 user_id）是业务数据而非身份过滤，一律拦截
 * 会逼 DBA 改名规避（empUserId），语义丢失且下一个 agent 还会踩。此类参数在 description
 * 中显式标注 [业务绑定] 后豁免——但出现在 WHERE 子句中仍视为身份过滤（越权风险不变）。
 */
export interface QueryLintInput {
  name?: string;
  body?: string;
  description?: string;
  purpose?: string;
  /** 参数定义列表（create_query/update_query 的 params），用于识别 [业务绑定] 标注 */
  params?: Array<{ name?: string; description?: string }>;
}

export interface QueryLintResult {
  errors: string[];
  warnings: string[];
}

/** 名字或用途表明该查询是"当前用户视角"的数据（我的请假/GetMyProfile/我的XX） */
function isIdentityScoped(input: QueryLintInput): boolean {
  const name = input.name || '';
  const semantics = `${input.description || ''} ${input.purpose || ''}`;
  if (/^My[A-Z]|我的/.test(name)) return true;
  if (/当前登录|当前用户|我的可用|本人|以.{0,6}身份/.test(semantics)) return true;
  return false;
}

const IDENTITY_PARAM_KEYS = [
  'userId', 'user_id', 'employeeId', 'employee_id', 'currentUserId', 'initiatorId',
];

const BUSINESS_BINDING_MARKER = '[业务绑定]';

/** 参数是否声明了 [业务绑定] 标注（管理端为业务记录绑定平台用户，非身份过滤） */
function isBusinessBindingParam(key: string, input: QueryLintInput): boolean {
  return (input.params || []).some(
    (p) => (p.name || '') === key && (p.description || '').includes(BUSINESS_BINDING_MARKER),
  );
}

/** 顶层 WHERE 关键字位置（括号深度为 0 处的第一个 WHERE），无则 -1 */
function topLevelWhereIndex(upperBody: string): number {
  let depth = 0;
  for (let i = 0; i < upperBody.length; i++) {
    const ch = upperBody[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && upperBody.startsWith('WHERE', i)) {
      const before = i > 0 ? upperBody[i - 1] : ' ';
      const after = upperBody[i + 5] || ' ';
      if (!/[A-Z0-9_]/.test(before) && !/[A-Z0-9_]/.test(after)) return i;
    }
  }
  return -1;
}

/** 参数在 body 中是否有出现在 fromIndex 及之后的引用（即落入 WHERE 过滤段） */
function hasOccurrenceFrom(body: string, needle: string, fromIndex: number): boolean {
  if (fromIndex < 0) return false;
  return body.indexOf(needle, fromIndex) !== -1;
}

export function lintQuery(input: QueryLintInput): QueryLintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const body = input.body || '';
  if (!body.trim()) return { errors, warnings };

  // ── 身份域检查 ──────────────────────────────────────────────
  const upperBody = body.toUpperCase();
  const isInsertOrUpdate = upperBody.trimStart().startsWith('INSERT ') || upperBody.trimStart().startsWith('UPDATE ');
  const identityParamsInBody = IDENTITY_PARAM_KEYS.filter((k) =>
    body.includes(`this.params.${k}`));
  if (identityParamsInBody.length > 0) {
    const whereIdx = isInsertOrUpdate ? topLevelWhereIndex(upperBody) : -1;
    const flagged = identityParamsInBody.filter((k) => {
      // 写查询中经 [业务绑定] 标注的参数：出现在顶层 WHERE 之外才豁免
      if (isInsertOrUpdate && isBusinessBindingParam(k, input)) {
        return hasOccurrenceFrom(body, `this.params.${k}`, whereIdx);
      }
      return true;
    });
    if (flagged.length > 0) {
      errors.push(
        `[身份过滤] 查询通过 this.params.${flagged[0]} 接收身份参数——身份由调用方传入可被篡改，` +
        '且页面漏传时参数为 NULL，所有人看到同一份数据或空数据。' +
        '请改为在 SQL 中直接使用 {{ this.auth.userId }}（服务端注入当前登录人，页面传不进来、改不了）。' +
        '若是 INSERT/UPDATE 写查询里由管理端指定的业务归属用户（并非按当前登录人过滤），' +
        `在对应参数 description 中标注 ${BUSINESS_BINDING_MARKER} 即可放行`
      );
    }
  }
  if (isIdentityScoped(input) && !body.includes('this.auth.')) {
    errors.push(
      `[身份过滤] 查询「${input.name || ''}」按名字/用途是当前用户视角的数据（我的XX/当前用户），` +
      '但 SQL 没有引用 {{ this.auth.* }} 过滤——这样所有账号看到同一份数据（2026-09-17 请假案例的根因）。' +
      '请在 WHERE 中加入按当前登录人的过滤（如 AND user_id = {{ this.auth.userId }}，' +
      '业务表经 employees 绑定平台账号时用 JOIN 解析）；如果该查询确实不是身份域数据，请修正查询名与用途描述'
    );
  }

  // ── 回写守卫检查 ────────────────────────────────────────────
  const trimmed = body.trim().toUpperCase();
  const isWrite = trimmed.startsWith('UPDATE ') || trimmed.startsWith('DELETE ');
  // 守卫识别必须用大写后的 trimmed：SQL 实际写法多为小写 status，
  // 测 body（原始大小写）会让子查询里的合法守卫全部漏判成误报
  if (isWrite && !/\bSTATUS\b/.test(trimmed)) {
    warnings.push(
      '[回写守卫] 该写查询没有状态条件守卫。被审批触发器引用时（异步 at-least-once 派发），' +
      '重复派发会重复执行（如重复扣减余额）。建议加状态守卫（如 AND status = \'待审批\'），' +
      '让重复派发命中 0 行；不同事件绑定不同查询、状态写死在 SQL 里是推荐范式'
    );
  }

  return { errors, warnings };
}
