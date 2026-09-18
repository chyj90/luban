import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { createQuery, updateQuery, deleteQuery, runQuery, executeSql, testDatasource } from '@/api';
import { listUnifiedDatasources } from '@/api/datasource';
import { listQueries, listPages, getCodePage } from '@/api';
import { lintQuery } from './queryLint';
import { consumeApproval, approvePendingApproval } from '../../core/confirmationGuard';
import { toolArgsKey } from '../../kernel/runtime';

/** create/update_query 缺表降级时后端返回的警告字段（QueryService.validationWarning） */
interface ValidationWarning {
  validationWarning?: string;
}

/** DDL 确认卡片展示用：尽力解析数据源名称，失败时退回 ID（不让确认流程被辅助查询卡住） */
async function resolveDatasourceName(
  ctx: { applicationId: number },
  datasourceId: number,
): Promise<string> {
  try {
    const datasources = await listUnifiedDatasources(ctx.applicationId);
    const ds = (datasources as Array<{ id: number; name?: string }>).find((d) => d.id === datasourceId);
    return ds?.name ? `${ds.name} (ID:${datasourceId})` : `ID:${datasourceId}`;
  } catch {
    return `ID:${datasourceId}`;
  }
}

export const querySkills: Record<string, SkillFactory> = {
  'query:list': (ctx) => ({
    id: 'query:list',
    category: SkillCategory.QUERY,
    name: 'list_queries',
    description: '列出当前应用中所有查询。',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const res = await listQueries(ctx.applicationId);
      return { success: true, message: `共 ${res.data.length} 个查询`, data: res.data };
    },
  }),

  'query:create': (ctx) => {
    const testedDatasources = new Set<number>();

    function validateSqlQuoting(body: string): string | null {
      const doubleQuotePattern = /'{{\s*this\.params\.\w+\s*}}'/g;
      const matches = body.match(doubleQuotePattern);
      if (matches) {
        const examples = [...new Set(matches)].slice(0, 3).join('、');
        return `SQL 引号错误：{{ }} 会自动给字符串加引号，SQL 中不能再手写引号。\n` +
          `检测到 ${matches.length} 处双重引号（如 ${examples}），请去掉 {{ }} 外层的单引号。\n` +
          `例：'{{ this.params.name }}' → {{ this.params.name }}\n` +
          `LIKE 场景：'%{{ this.params.name }}%' → CONCAT('%', {{ this.params.name }}, '%')`;
      }
      return null;
    }

    async function ensureConnected(datasourceId: number): Promise<string | null> {
      if (testedDatasources.has(datasourceId)) return null;
      try {
        await testDatasource(datasourceId);
        testedDatasources.add(datasourceId);
        return null;
      } catch (e) {
        const datasources = await listUnifiedDatasources(ctx.applicationId).catch(() => []);
        const ds = datasources.find((d: { id: number; name?: string }) => d.id === datasourceId);
        const dsName = ds ? `「${ds.name}」` : `ID:${datasourceId}`;
        return `数据源 ${dsName} 连接失败，请先在「数据源管理」中检查连接配置并确保测试通过后再继续。`;
      }
    }

    return {
      id: 'query:create',
      category: SkillCategory.QUERY,
      name: 'create_query',
      description: `创建一个新的查询。首次使用某个数据源时会自动探测连通性，不通则暂停。创建时自动校验 SQL 语法，不合法则创建失败，不入库。

## SQL 查询
body 填写 SQL 语句，使用 {{ this.params.xxx }} 绑定参数：
  SELECT * FROM users WHERE name = {{ this.params.userName }}

支持动态 SQL 标签（<if>、<where>、<set>、<foreach>），统一使用 this.params.X 访问参数：
正确：<if test="this.params.status != null and this.params.status != ''">AND o.status = {{ this.params.status }}</if>
OGNL 运算符：and、or、!、==、!=、<、>、<=、>=（不能用 &&、||，必须用 and、or）

⚠️ {{ }} 会自动给字符串值加引号，SQL 中不要再手写引号：
  错误：WHERE name = '{{ this.params.name }}'（双重引号 → ''x''）
  正确：WHERE name = {{ this.params.name }}
  LIKE 场景：LIKE CONCAT('%', {{ this.params.name }}, '%')（不要写 '%{{}}%'）

⚠️ 参数值中的冒号会被模板引擎破坏（如 09:50:00 → 09NULLNULL）：时间参数请让调用方传 HHMMSS 紧凑格式并用 STR_TO_DATE({{ this.params.time }}, '%H%i%s') 转换，或直接用数据库 NOW()；纯日期 YYYY-MM-DD 不受影响。
⚠️ 查询名用帕斯卡命名（如 GetMeetings、InsertSignin）：页面代码通过 DataQuery.查询名 调用且区分大小写，创建后名称不可再随意变更大小写。`,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '查询名称，帕斯卡命名（如 GetMeetings、InsertSignin）。页面代码用 DataQuery.查询名 调用且区分大小写' },
          datasourceId: { type: 'number', description: '数据源 ID' },
          body: { type: 'string', description: 'SQL 语句' },
          type: { type: 'string', enum: ['SQL'], description: '查询类型' },
          params: { type: 'array', items: { type: 'object' }, description: '参数定义列表' },
          description: { type: 'string', description: '查询描述' },
        },
        required: ['name', 'datasourceId', 'body'],
      },
      async execute(args) {
        const datasourceId = args.datasourceId as number;
        const body = args.body as string;

        const quoteError = validateSqlQuoting(body);
        if (quoteError) {
          return { success: false, message: quoteError };
        }

        // 身份/守卫 lint：身份域查询缺 this.auth 过滤直接阻断（错数据比报错贵得多）
        const lint = lintQuery({ name: args.name as string, body, description: args.description as string, params: args.params as Array<{ name?: string; description?: string }> | undefined });
        if (lint.errors.length > 0) {
          return { success: false, message: `查询未通过静态检查，未创建：\n${lint.errors.map((e) => `- ${e}`).join('\n')}` };
        }

        const connError = await ensureConnected(datasourceId);
        if (connError) return { success: false, message: connError, _pause: true };
        try {
          const paramsArray = (args.params as unknown[]) || [];
          const params = paramsArray.length > 0
            ? Object.fromEntries(paramsArray.map((p: any) => [p.name || p.key, p]))
            : undefined;

          const res = await createQuery({
            applicationId: ctx.applicationId,
            name: args.name as string,
            datasourceId,
            body,
            params,
            description: (args.description as string) || '',
          });
          ctx.onQueriesChange?.();
          ctx.onQuerySelect?.({ id: res.data.id, name: res.data.name });
          // 缺表降级：目标表尚不存在时后端不再拒绝创建（建表与查询创建解耦），
          // 警告透传给 DBA——查询已保存，等表就绪后 run_query 即可，禁止重复创建
          const tableWarning = (res.data as ValidationWarning | undefined)?.validationWarning;
          const warnings = [...lint.warnings];
          if (tableWarning) warnings.push(tableWarning);
          return {
            success: true,
            message: warnings.length > 0
              ? `查询 "${args.name}" 创建成功\n${warnings.map((w) => `⚠️ ${w}`).join('\n')}`
              : `查询 "${args.name}" 创建成功`,
            data: res.data,
          };
        } catch (e) {
          return { success: false, message: `创建查询失败: ${(e as Error).message}` };
        }
      },
    };
  },

  'query:update': (ctx) => ({
    id: 'query:update',
    category: SkillCategory.QUERY,
    name: 'update_query',
    description: '更新已有查询的 SQL 语句或参数。',
    parameters: {
      type: 'object',
      properties: {
        queryId: { type: 'number', description: '查询 ID' },
        body: { type: 'string', description: '新的 SQL 语句' },
        name: { type: 'string', description: '查询名称' },
        params: { type: 'array', items: { type: 'object' }, description: '参数定义列表；传空数组 [] 表示清空全部参数，不传则保持不变' },
        description: { type: 'string', description: '查询描述' },
      },
      required: ['queryId'],
    },
    async execute(args) {
      try {
        // 仅当调用方完全未传 params 时保持 undefined（后端按 null 跳过，部分更新语义）；
        // 显式传空数组表示清空全部参数 → 转空对象，否则后端收到 null 会跳过赋值，
        // 废弃参数永远删不掉（2026-09-14 GetMyLeaves 残留 employeeNo 案例）
        const params = args.params === undefined
          ? undefined
          : Object.fromEntries((args.params as unknown[]).map((p: any) => [p.name || p.key, p]));

        // 身份/守卫 lint：与 create 同标准，改坏身份过滤同样阻断
        let lint: ReturnType<typeof lintQuery> | null = null;
        if (args.body) {
          lint = lintQuery({ name: args.name as string, body: args.body as string, description: args.description as string, params: args.params as Array<{ name?: string; description?: string }> | undefined });
          if (lint.errors.length > 0) {
            return { success: false, message: `查询未通过静态检查，未更新：\n${lint.errors.map((e) => `- ${e}`).join('\n')}` };
          }
        }

        const res = await updateQuery(args.queryId as number, {
          body: args.body as string | undefined,
          name: args.name as string | undefined,
          params,
          description: (args.description as string) || '',
        });
        ctx.onQueriesChange?.();
        ctx.onQuerySelect?.({ id: args.queryId as number, name: (args.name as string) || '' });
        const tableWarning = (res.data as ValidationWarning | undefined)?.validationWarning;
        const warnings = lint ? [...lint.warnings] : [];
        if (tableWarning) warnings.push(tableWarning);
        return {
          success: true,
          message: warnings.length > 0
            ? `查询更新成功\n${warnings.map((w) => `⚠️ ${w}`).join('\n')}`
            : '查询更新成功',
          data: res.data,
        };
      } catch (e) {
        return { success: false, message: `更新查询失败: ${(e as Error).message}` };
      }
    },
  }),

  'query:delete': (ctx) => ({
    id: 'query:delete',
    category: SkillCategory.QUERY,
    name: 'delete_query',
    description: '删除一个查询。注意：此操作不可撤销，删除前请确认。',
    parameters: {
      type: 'object',
      properties: { queryId: { type: 'number', description: '查询 ID' } },
      required: ['queryId'],
    },
    isDangerous: true,
    requiresConfirmation: true,
    async execute(args) {
      try {
        await deleteQuery(args.queryId as number);
        ctx.onQueriesChange?.();
        return { success: true, message: '查询删除成功' };
      } catch (e) {
        return { success: false, message: `删除查询失败: ${(e as Error).message}` };
      }
    },
  }),

  'query:run': (ctx) => ({
    id: 'query:run',
    category: SkillCategory.QUERY,
    name: 'run_query',
    description: '执行一个查询并返回结果，用于调试和验证。',
    parameters: {
      type: 'object',
      properties: {
        queryId: { type: 'number', description: '查询 ID' },
        params: { type: 'object', description: '查询参数' },
      },
      required: ['queryId'],
    },
    async execute(args) {
      try {
        const params = (args.params as Record<string, unknown>) || {};
        const res = await runQuery(args.queryId as number, { params });
        const queryId = args.queryId as number;
        const columns = (res.data?.columns as string[]) || [];
        const rows = (res.data?.rows as unknown[][]) || [];
        const totalCount = res.data?.totalCount ?? 0;
        const executionTime = res.data?.executionTime ?? 0;

        ctx.onQuerySelect?.({ id: queryId, name: '' });
        ctx.onQueryRun?.({
          queryId,
          queryName: '',
          params,
          result: { columns, rows, totalCount, executionTime },
        });

        const colInfo = columns.length > 0 ? `\n列名：${columns.join('、')}` : '';
        let sampleInfo = '';
        if (rows.length > 0 && columns.length > 0) {
          const sampleRows = rows.slice(0, 3).map((row) => {
            const obj: Record<string, unknown> = {};
            columns.forEach((col, i) => { obj[col] = (row as unknown[])[i]; });
            return obj;
          });
          sampleInfo = `\n前 ${sampleRows.length} 行：${JSON.stringify(sampleRows)}`;
        }
        const isWrite = totalCount > 0 && columns.length === 0;
        const typeInfo = isWrite ? `，影响 ${totalCount} 行` : `，返回 ${totalCount} 条数据`;
        return { success: true, message: `查询执行成功${typeInfo}${colInfo}${sampleInfo}`, data: res.data };
      } catch (e) {
        return { success: false, message: `执行查询失败: ${(e as Error).message}` };
      }
    },
  }),

  'query:get': (ctx) => ({
    id: 'query:get',
    category: SkillCategory.QUERY,
    name: 'get_query',
    description: '获取单个查询的详细信息。',
    parameters: {
      type: 'object',
      properties: { queryId: { type: 'number', description: '查询 ID' } },
      required: ['queryId'],
    },
    async execute(args) {
      try {
        const res = await listQueries(ctx.applicationId);
        const query = res.data.find((q: { id: number; name?: string }) => q.id === args.queryId);
        if (!query) return { success: false, message: `未找到查询 ${args.queryId}` };
        ctx.onQuerySelect?.({ id: query.id as number, name: query.name as string });
        return { success: true, message: '获取查询成功', data: query };
      } catch (e) {
        return { success: false, message: `获取查询失败: ${(e as Error).message}` };
      }
    },
  }),

  'query:execute': (ctx) => ({
    id: 'query:execute',
    category: SkillCategory.QUERY,
    name: 'execute_sql',
    description: `直接执行 SQL 语句，不经过模板解析。
用于插入数据（INSERT）、更新数据（UPDATE）、删除数据（DELETE）等操作。
⚠️ DDL 语句（CREATE/ALTER/DROP/TRUNCATE/RENAME）走用户确认门：调用本工具会挂起并弹出确认卡片，用户确认后系统自动执行并返回结果，用户取消则需降级为"输出完整 SQL 请用户在数据源管理面板手动执行"。挂起等待期间禁止重复调用或改写 SQL；任务被重新继续后，用完全相同的参数重新调用本工具执行同一条 DDL。
⚠️ 时间/日期时间参数值中的冒号会被模板引擎破坏（如 09:50:00 会变成 09NULLNULL）：时间请传 HHMMSS 紧凑格式（如 090000）配合 STR_TO_DATE 转换，或直接用数据库 NOW()；纯日期 YYYY-MM-DD 不受影响。
返回查询结果（SELECT）或影响行数（DML）。
支持批量执行：传入 multi=true 时，sql 中可用分号分隔多条语句，在同一事务中依次执行，全部成功则提交，任一失败则全部回滚。
批量模式返回每条语句的执行结果数组。
测试回滚模式：rollback=true 时语句在同一事务中执行后回滚（结果里每条带 rolledBack=true），用于验证写 SQL 效果（守卫是否命中、影响行数是否符合预期）而不污染数据——测试触发器回写/扣减语义必须用此模式，禁止用真实演示数据做测试后手工恢复。`,
    parameters: {
      type: 'object',
      properties: {
        datasourceId: { type: 'number', description: '数据源 ID' },
        sql: { type: 'string', description: '要执行的 SQL 语句。multi=true 时可用分号分隔多条语句' },
        multi: { type: 'boolean', description: '是否批量执行模式。true 时按分号分隔多条语句，在同一事务中执行' },
        rollback: { type: 'boolean', description: '测试回滚模式：执行后回滚不落库（验证写 SQL 效果专用）' },
      },
      required: ['datasourceId', 'sql'],
    },
    async execute(args, execCtx) {
      try {
        const sql = (args.sql as string || '').trim();
        const isDdl = /^\s*(CREATE|ALTER|DROP|TRUNCATE|RENAME)\b/i.test(sql);
        if (isDdl) {
          // DDL 确认门：首次调用经全局确认守卫挂起（danger-confirm），用户在确认卡片
          // 批准后内核精确重执行本调用。委派场景由 delegate_query 上浮同一张卡片，
          // 重新委派时 approvePendingApproval 放行守卫，子智能体用相同参数重调即命中批准。
          const kernelCall = (execCtx as { kernelCall?: { callId?: string; resume?: boolean } } | undefined)?.kernelCall;
          if (kernelCall?.resume) approvePendingApproval();
          const approved = kernelCall?.resume === true || consumeApproval('execute_sql', args) === 'approved';
          if (!approved) {
            const dsName = await resolveDatasourceName(ctx, args.datasourceId as number);
            return {
              success: false,
              _pause: true,
              message: `DDL 语句需要用户在确认卡片上批准后才会执行（本次未执行，目标数据源「${dsName}」）。请停止当前任务等待用户确认；任务被重新继续后，请用完全相同的参数重新调用 execute_sql 执行该 DDL，禁止改写 SQL、禁止改走其他方式。待确认 DDL：\n${sql}`,
              data: {
                suspendRequest: {
                  kind: 'danger-confirm',
                  callId: kernelCall?.callId || '',
                  toolName: 'execute_sql',
                  args,
                  argsKey: toolArgsKey(args),
                  message: `确认在数据源「${dsName}」执行以下 DDL？\n\n${sql}`,
                },
              },
            };
          }
        }
        const rollback = args.rollback === true;
        const res = await executeSql(args.datasourceId as number, sql, args.multi as boolean || rollback, isDdl || undefined, rollback);
        if (args.multi || rollback) {
          const results = res.data as any[];
          const summary = results.map((r: any, i: number) => `语句${i + 1}: ${r.totalCount ?? 0} 条结果`).join('；');
          return {
            success: true,
            message: rollback
              ? `回滚模式执行成功（${results.length} 条语句，已回滚不落库）：${summary}`
              : `批量 SQL 执行成功（${results.length} 条语句）：${summary}`,
            data: res.data,
          };
        }
        return { success: true, message: `SQL 执行成功，${res.data?.totalCount ?? 0} 条结果`, data: res.data };
      } catch (e) {
        return { success: false, message: `SQL 执行失败: ${(e as Error).message}` };
      }
    },
  }),

  'query:references': (ctx) => ({
    id: 'query:references',
    category: SkillCategory.QUERY,
    name: 'list_query_references',
    description: `查询指定查询被哪些页面引用。修改查询前必须调用此工具评估影响范围。
返回引用该查询的所有页面列表，DBA 据此判断修改查询是否会影响其他页面。`,
    parameters: {
      type: 'object',
      properties: {
        queryId: { type: 'number', description: '查询 ID' },
        queryName: { type: 'string', description: '查询名称（与 queryId 二选一）' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const pagesRes = await listPages(ctx.applicationId);
        const pages = pagesRes.data;
        const references: Array<{ pageId: number; pageName: string }> = [];
        const targetId = args.queryId as number | undefined;
        const targetName = args.queryName as string | undefined;

        for (const page of pages) {
          try {
            const codeRes = await getCodePage(page.id);
            const queryIds: number[] = codeRes.data.codePage?.queryIds || [];
            if (targetId !== undefined) {
              if (queryIds.includes(targetId)) {
                references.push({ pageId: page.id, pageName: page.name });
              }
            } else if (targetName) {
              const allQueries = await listQueries(ctx.applicationId);
              const matched = allQueries.data.find((q: { name: string }) => q.name === targetName);
              if (matched && queryIds.includes(matched.id)) {
                references.push({ pageId: page.id, pageName: page.name });
              }
            }
          } catch {
            // 页面可能没有代码页，跳过
          }
        }

        if (references.length === 0) {
          return { success: true, message: '该查询未被任何页面引用，可安全修改', data: { references: [] } };
        }
        return {
          success: true,
          message: `查询被 ${references.length} 个页面引用：${references.map((r) => r.pageName).join('、')}`,
          data: { references },
        };
      } catch (e) {
        return { success: false, message: `查询引用分析失败: ${(e as Error).message}` };
      }
    },
  }),

  'query:lint': (_ctx) => ({
    id: 'query:lint',
    category: SkillCategory.QUERY,
    name: 'lint_query',
    description: `对查询做静态检查（不执行）：身份域检查（"我的XX/当前用户"类查询必须用 {{ this.auth.* }} 过滤，禁止 this.params 传身份——否则所有账号看到同一份数据）与回写守卫检查（UPDATE/DELETE 建议带状态守卫防触发器重复派发重复执行）。
create_query/update_query 已自动执行 errors 级检查；本工具用于复核存量查询或检查委派产出的 SQL 草稿。`,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '查询名称' },
        body: { type: 'string', description: 'SQL 语句' },
        description: { type: 'string', description: '查询用途描述' },
        params: { type: 'array', items: { type: 'object' }, description: '参数定义列表（含 name/description），写查询的 [业务绑定] 参数据此豁免身份检查' },
      },
      required: ['body'],
    },
    async execute(args) {
      const lint = lintQuery({
        name: args.name as string | undefined,
        body: args.body as string,
        description: args.description as string | undefined,
        params: args.params as Array<{ name?: string; description?: string }> | undefined,
      });
      if (lint.errors.length === 0 && lint.warnings.length === 0) {
        return { success: true, message: '静态检查通过：无身份过滤问题，无回写守卫缺口' };
      }
      const parts: string[] = [];
      if (lint.errors.length > 0) {
        parts.push(`${lint.errors.length} 个错误：`);
        parts.push(...lint.errors.map((e) => `- ${e}`));
      }
      if (lint.warnings.length > 0) {
        parts.push(`${lint.warnings.length} 个警告：`);
        parts.push(...lint.warnings.map((w) => `- ${w}`));
      }
      return { success: lint.errors.length === 0, message: parts.join('\n'), data: lint };
    },
  }),
};