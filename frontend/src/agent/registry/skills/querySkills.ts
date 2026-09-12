import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { createQuery, updateQuery, deleteQuery, runQuery, executeSql, testDatasource } from '@/api';
import { listDatasources } from '@/api/datasource';
import { listQueries, listPages, getCodePage } from '@/api';

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
        const datasources = await listDatasources('APPLICATION', ctx.applicationId).then(r => r.data).catch(() => []);
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
  LIKE 场景：LIKE CONCAT('%', {{ this.params.name }}, '%')（不要写 '%{{}}%'）`,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '查询名称，英文驼峰命名' },
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
          return { success: true, message: `查询 "${args.name}" 创建成功`, data: res.data };
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
        params: { type: 'array', items: { type: 'object' }, description: '参数定义' },
        description: { type: 'string', description: '查询描述' },
      },
      required: ['queryId'],
    },
    async execute(args) {
      try {
        const paramsArray = (args.params as unknown[]) || [];
          const params = paramsArray.length > 0
            ? Object.fromEntries(paramsArray.map((p: any) => [p.name || p.key, p]))
            : undefined;

          const res = await updateQuery(args.queryId as number, {
            body: args.body as string | undefined,
            name: args.name as string | undefined,
            params,
            description: (args.description as string) || '',
          });
        ctx.onQueriesChange?.();
        ctx.onQuerySelect?.({ id: args.queryId as number, name: (args.name as string) || '' });
        return { success: true, message: '查询更新成功', data: res.data };
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

  'query:execute': () => ({
    id: 'query:execute',
    category: SkillCategory.QUERY,
    name: 'execute_sql',
    description: `直接执行 SQL 语句，不经过模板解析。
用于插入数据（INSERT）、更新数据（UPDATE）、删除数据（DELETE）等操作。
⚠️ DDL 语句（CREATE/ALTER/DROP/TRUNCATE/RENAME）会被后端拦截并返回失败，但可以先尝试执行。若被拦截，需生成 SQL 供用户手动执行。
返回查询结果（SELECT）或影响行数（DML）。
支持批量执行：传入 multi=true 时，sql 中可用分号分隔多条语句，在同一事务中依次执行，全部成功则提交，任一失败则全部回滚。
批量模式返回每条语句的执行结果数组。`,
    parameters: {
      type: 'object',
      properties: {
        datasourceId: { type: 'number', description: '数据源 ID' },
        sql: { type: 'string', description: '要执行的 SQL 语句。multi=true 时可用分号分隔多条语句' },
        multi: { type: 'boolean', description: '是否批量执行模式。true 时按分号分隔多条语句，在同一事务中执行' },
      },
      required: ['datasourceId', 'sql'],
    },
    async execute(args) {
      try {
        const sql = (args.sql as string || '').trim();
        if (/^\s*(CREATE|ALTER|DROP|TRUNCATE|RENAME)\b/i.test(sql)) {
          return { success: false, message: 'DDL 操作不允许通过 Agent 执行，请前往数据源管理面板手动操作' };
        }
        const res = await executeSql(args.datasourceId as number, sql, args.multi as boolean);
        if (args.multi) {
          const results = res.data as any[];
          const summary = results.map((r: any, i: number) => `语句${i + 1}: ${r.totalCount ?? 0} 条结果`).join('；');
          return { success: true, message: `批量 SQL 执行成功（${results.length} 条语句）：${summary}`, data: res.data };
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
};