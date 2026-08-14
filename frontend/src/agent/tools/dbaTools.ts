import type { ToolDefinition, ToolContext } from '@/types/agent';
import {
  createDatasource,
  testDatasource,
  getDatasourceStructure,
  createQuery,
  updateQuery,
  deleteQuery,
  runQuery,
} from '@/api';
import { listDatasources } from '@/api/datasource';
import { listQueries } from '@/api';

export function createDataAssistantTools(context: ToolContext): ToolDefinition[] {
  const testedDatasources = new Set<number>();

  async function ensureDatasourceConnected(datasourceId: number): Promise<string | null> {
    if (testedDatasources.has(datasourceId)) {
      return null;
    }
    try {
      await testDatasource(datasourceId);
      testedDatasources.add(datasourceId);
      return null;
    } catch (e: any) {
      const datasources = await listDatasources(context.applicationId).then(r => r.data).catch(() => []);
      const ds = datasources.find((d: any) => d.id === datasourceId);
      const dsName = ds ? `「${ds.name}」` : `ID:${datasourceId}`;
      return `数据源 ${dsName} 连接失败，请先在「数据源管理」中检查连接配置并确保测试通过后再继续。`;
    }
  }

  return [
    {
      name: 'list_datasources',
      description: '列出当前工作区中所有数据源，包含每个数据源的连接状态（connected/error/pending）。',
      category: 'observation',
      parameters: { type: 'object', properties: {} },
      async execute() {
        const res = await listDatasources(context.applicationId);
        return { success: true, message: `共 ${res.data.length} 个数据源`, data: res.data };
      },
    },
    {
      name: 'test_datasource',
      description: '测试指定数据源的连接是否正常。在创建查询或执行 SQL 之前，务必先调用此工具确认数据源连通。',
      category: 'datasource',
      parameters: {
        type: 'object',
        properties: { datasourceId: { type: 'number', description: '数据源 ID' } },
        required: ['datasourceId'],
      },
      async execute(args) {
        try {
          await testDatasource(args.datasourceId as number);
          return { success: true, message: '数据源连接正常' };
        } catch (e: any) {
          return { success: false, message: `数据源连接失败: ${e.message || '未知错误'}` };
        }
      },
    },
    {
      name: 'fetch_datasource_structure',
      description: '获取数据源的数据库结构，包括所有表和字段信息。调用前请确保数据源连接正常。',
      category: 'datasource',
      parameters: {
        type: 'object',
        properties: { datasourceId: { type: 'number', description: '数据源 ID' } },
        required: ['datasourceId'],
      },
      async execute(args) {
        const res = await getDatasourceStructure(args.datasourceId as number);
        return { success: true, message: '获取数据库结构成功', data: res.data };
      },
    },
    {
      name: 'list_queries',
      description: '列出当前应用中所有查询。',
      category: 'observation',
      parameters: { type: 'object', properties: {} },
      async execute() {
        const res = await listQueries(context.applicationId);
        return { success: true, message: `共 ${res.data.length} 个查询`, data: res.data };
      },
    },
    {
      name: 'create_query',
      description: `创建一个新的查询。首次使用某个数据源时会自动探测连通性，不通则暂停。后续操作不会重复探测。

## SQL 查询
body 填写 SQL 语句，使用 {{ this.params.xxx }} 绑定参数：
  SELECT * FROM users WHERE name = {{ this.params.userName }}

支持动态 SQL 标签（<if>、<where>、<set>、<foreach>），标签内 > < 无需转义：
  SELECT * FROM users
  <where>
    <if test="name != null">AND name = {{ this.params.name }}</if>
    <if test="status != null">AND status = {{ this.params.status }}</if>
  </where>

## REST API 查询
body 填写端点路径（相对路径如 /users 或绝对路径如 https://...）：
  /users/{{ this.params.userId }}

参数通过 run_query 或 JS 调用时传入，支持以下特殊字段：
  - queryParams: URL 查询参数，如 { page: 1 } → ?page=1
  - headers: 额外请求头，如 { "X-Token": "xxx" }
  - body: 请求体（POST/PUT/PATCH），如 { name: "test" }
  - 其他字段：用于替换端点中的 {{ this.params.xxx }}`,
      category: 'query',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '查询名称' },
          datasourceId: { type: 'number', description: '数据源 ID' },
          body: { type: 'string', description: 'SQL 语句或 API 端点' },
          params: { type: 'object', description: '默认查询参数' },
        },
        required: ['name', 'datasourceId', 'body'],
      },
      async execute(args) {
        const dsId = args.datasourceId as number;
        const pauseMsg = await ensureDatasourceConnected(dsId);
        if (pauseMsg) {
          return { success: false, message: pauseMsg, _pause: true };
        }
        const res = await createQuery({
          applicationId: context.applicationId,
          datasourceId: dsId,
          name: args.name as string,
          body: args.body as string,
          params: (args.params as Record<string, unknown>) || {},
        });
        context.onQuerySelect?.({ id: res.data.id, name: args.name as string });
        return { success: true, message: `查询 "${args.name}" 创建成功 (ID:${res.data.id})`, data: res.data };
      },
    },
    {
      name: 'update_query',
      description: '更新一个已有查询的语句或参数。',
      category: 'query',
      parameters: {
        type: 'object',
        properties: {
          queryId: { type: 'number', description: '查询 ID' },
          body: { type: 'string', description: '更新的查询语句' },
          params: { type: 'object', description: '更新的查询参数' },
        },
        required: ['queryId'],
      },
      async execute(args) {
        const res = await updateQuery(args.queryId as number, {
          body: args.body as string | undefined,
          params: (args.params as Record<string, unknown>) || undefined,
        });
        return { success: true, message: '查询更新成功', data: res.data };
      },
    },
    {
      name: 'delete_query',
      description: '删除一个查询。此操作不可撤销。',
      category: 'query',
      parameters: {
        type: 'object',
        properties: { queryId: { type: 'number', description: '查询 ID' } },
        required: ['queryId'],
      },
      async execute(args) {
        await deleteQuery(args.queryId as number);
        return { success: true, message: '查询已删除' };
      },
    },
    {
      name: 'run_query',
      description: '执行一个查询，用于测试查询是否正确。首次使用某个数据源时会自动探测连通性，不通则暂停。后续操作不会重复探测。params 传入扁平对象，如 { name: "张三", age: 25 }，对应 SQL 中的 {{ this.params.xxx }}。',
      category: 'query',
      parameters: {
        type: 'object',
        properties: {
          queryId: { type: 'number', description: '查询 ID' },
          params: { type: 'object', description: '测试参数' },
        },
        required: ['queryId'],
      },
      async execute(args) {
        const qId = args.queryId as number;
        const queries = await listQueries(context.applicationId);
        const query = queries.data.find((q: any) => q.id === qId);
        if (query?.datasourceId) {
          const pauseMsg = await ensureDatasourceConnected(query.datasourceId);
          if (pauseMsg) {
            return { success: false, message: pauseMsg, _pause: true };
          }
        }
        const res = await runQuery(qId, {
          params: (args.params as Record<string, unknown>) || undefined,
        });
        context.onQuerySelect?.({ id: qId, name: `查询 ${qId}` });
        const { columns, rows, totalCount, executionTime } = res.data;
        const displayRows = rows.slice(0, 20);
        const tableHeader = columns.join(' | ');
        const tableRows = displayRows
          .map((row) => row.map((cell) => (cell === null ? 'NULL' : String(cell))).join(' | '))
          .join('\n');
        const truncated = rows.length > 20 ? `\n...（仅显示前 20 条，共 ${totalCount} 条）` : '';
        return {
          success: true,
          message: `查询执行成功，返回 ${totalCount} 条记录（${executionTime}ms）\n\n| ${tableHeader} |\n|${columns.map(() => '---').join('|')}|\n${tableRows}${truncated}`,
          data: res.data,
        };
      },
    },
    {
      name: 'connect_datasource',
      description: '连接一个新的数据源。支持 MySQL、PostgreSQL、REST API。连接后会自动测试连通性。',
      category: 'datasource',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '数据源名称' },
          type: { type: 'string', enum: ['MySQL', 'PostgreSQL', 'REST_API'] },
          config: { type: 'object', description: '连接配置' },
        },
        required: ['name', 'type', 'config'],
      },
      async execute(args) {
        const res = await createDatasource({
          applicationId: context.applicationId,
          name: args.name as string,
          type: args.type as string,
          config: args.config as Record<string, unknown>,
        } as Parameters<typeof createDatasource>[0]);
        await testDatasource(res.data.id);
        return { success: true, message: `数据源 "${args.name}" 连接成功`, data: res.data };
      },
    },
  ];
}