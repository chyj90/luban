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

    async function ensureConnected(datasourceId: number): Promise<string | null> {
      if (testedDatasources.has(datasourceId)) return null;
      try {
        await testDatasource(datasourceId);
        testedDatasources.add(datasourceId);
        return null;
      } catch (e) {
        const datasources = await listDatasources(ctx.applicationId).then(r => r.data).catch(() => []);
        const ds = datasources.find((d: unknown) => d.id === datasourceId);
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
正确：<if test="this.params.status != null and this.params.status != ''">AND o.status = '{{ this.params.status }}'</if>
OGNL 运算符：and、or、!、==、!=、<、>、<=、>=（不能用 &&、||，必须用 and、or）`,
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
        const connError = await ensureConnected(datasourceId);
        if (connError) return { success: false, message: connError, _pause: true };
        try {
          const paramsArray = (args.params as unknown[]) || [];
          const params = paramsArray.length > 0
            ? Object.fromEntries(paramsArray.map((p: unknown) => [p.name || p.key, p]))
            : undefined;

          const res = await createQuery({
            applicationId: ctx.applicationId,
            name: args.name as string,
            datasourceId,
            body: args.body as string,
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
            ? Object.fromEntries(paramsArray.map((p: unknown) => [p.name || p.key, p]))
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
        const res = await runQuery(args.queryId as number, { params: (args.params as Record<string, unknown>) || {} });
        ctx.onQuerySelect?.({ id: args.queryId as number, name: '' });
        const columns = (res.data?.columns as string[]) || [];
        const totalCount = res.data?.totalCount ?? 0;
        const colInfo = columns.length > 0 ? `，列名：${columns.join('、')}` : '';
        return { success: true, message: `查询执行成功，返回 ${totalCount} 条数据${colInfo}`, data: res.data };
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
        const query = res.data.find((q: unknown) => q.id === args.queryId);
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
    description: `直接执行任意 SQL 语句（SELECT/INSERT/UPDATE/DELETE/DDL），不经过模板解析。
用于建表（CREATE TABLE/ALTER TABLE）、插入数据（INSERT）、更新数据（UPDATE）等操作。
返回查询结果（SELECT）或影响行数（DML/DDL）。`,
    parameters: {
      type: 'object',
      properties: {
        datasourceId: { type: 'number', description: '数据源 ID' },
        sql: { type: 'string', description: '要执行的 SQL 语句' },
      },
      required: ['datasourceId', 'sql'],
    },
    async execute(args) {
      try {
        const res = await executeSql(args.datasourceId as number, args.sql as string);
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