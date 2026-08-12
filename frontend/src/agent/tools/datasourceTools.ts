import type { ToolDefinition, ToolContext } from '@/types/agent';
import {
  createDatasource,
  testDatasource,
  getDatasourceStructure,
  createQuery,
  updateQuery,
  deleteQuery,
  runQuery,
  createJsFunction,
} from '@/api';

export function createDatasourceTools(context: ToolContext): ToolDefinition[] {
  return [
    {
      name: 'connect_datasource',
      description: `连接一个新的数据源。支持 MySQL、PostgreSQL、REST API。

## SQL 数据源（MySQL/PostgreSQL）
config 字段：
  - host: 主机地址（必填）
  - port: 端口号（MySQL 默认 3306，PostgreSQL 默认 5432）
  - database: 数据库名（必填）
  - username: 用户名（必填）
  - password: 密码（必填）

## REST API 数据源
config 字段：
  - baseUrl: API 基础地址，如 https://api.example.com（必填）
  - method: 默认请求方法，GET/POST/PUT/PATCH/DELETE（可选，默认 GET）
  - headers: 默认请求头，如 {"Authorization": "Bearer xxx"}（可选）`,
      category: 'datasource',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '数据源名称' },
          type: { type: 'string', enum: ['MySQL', 'PostgreSQL', 'REST_API'], description: '数据源类型' },
          config: {
            type: 'object',
            description: '连接配置，根据数据源类型填写不同字段。SQL 类：host/port/database/username/password；REST API：baseUrl/method/headers',
          },
        },
        required: ['name', 'type', 'config'],
      },
      async execute(args) {
        try {
          const res = await createDatasource({
            applicationId: context.applicationId,
            name: args.name as string,
            type: args.type as string,
            config: args.config as Record<string, unknown>,
          } as Parameters<typeof createDatasource>[0]);
          await testDatasource(res.data.id);
          return {
            success: true,
            message: `数据源 "${args.name}" 连接成功`,
            data: res.data,
          };
        } catch (e) {
          return { success: false, message: `连接数据源失败: ${(e as Error).message}` };
        }
      },
    },
    {
      name: 'fetch_datasource_structure',
      description: '获取数据源的数据库结构，包括所有表和字段信息。用于了解数据模型。',
      category: 'datasource',
      parameters: {
        type: 'object',
        properties: {
          datasourceId: { type: 'number', description: '数据源 ID' },
        },
        required: ['datasourceId'],
      },
      async execute(args) {
        try {
          const res = await getDatasourceStructure(args.datasourceId as number);
          return {
            success: true,
            message: '获取数据库结构成功',
            data: res.data,
          };
        } catch (e) {
          return { success: false, message: `获取结构失败: ${(e as Error).message}` };
        }
      },
    },
    {
      name: 'create_query',
      description: `创建一个新的查询。创建前请先调用 list_queries 检查是否已存在同名查询。

## SQL 查询
body 填写 SQL 语句，使用 {{ this.params.xxx }} 绑定参数：
  SELECT * FROM users WHERE name = {{ this.params.userName }}

支持动态 SQL 标签（<if>、<where>、<set>、<foreach>），标签内 > < 无需转义。详见下方完整示例。

## REST API 查询
body 填写端点路径（相对路径如 /users 或绝对路径如 https://...）：
  /users/{{ this.params.userId }}

参数通过 run_query 或 JS 调用时传入，支持以下特殊字段：
  - queryParams: URL 查询参数，如 { page: 1 } → ?page=1
  - headers: 额外请求头，如 { "X-Token": "xxx" }
  - body: 请求体（POST/PUT/PATCH），如 { name: "test" }
  - 其他字段：用于替换端点中的 {{ this.params.xxx }}

## SQL 动态标签完整示例
\`\`\`sql
SELECT * FROM users
<where>
  <if test="name != null">AND name = {{ this.params.name }}</if>
  <if test="status != null">AND status = {{ this.params.status }}</if>
  <if test="ageMin != null">AND age >= {{ this.params.ageMin }}</if>
  <if test="ids != null">AND id IN <foreach collection="ids" item="id" open="(" separator="," close=")">{{ this.params.id }}</foreach></if>
</where>
ORDER BY id
\`\`\`

## REST API 完整示例
body: /api/users
JS 调用: GetUsers.run({ queryParams: { page: 1, size: 20 }, headers: { "X-Trace": "abc" } })

body: /api/users/{{ this.params.userId }}
JS 调用: GetUser.run({ userId: 123 })

body: /api/users  (数据源 method 为 POST)
JS 调用: CreateUser.run({ body: { name: "张三", email: "test@test.com" } })

## 页面绑定语法
HTML 中使用 {{ QueryName.data }} 绑定查询结果，JS 中使用 QueryName.run(params) 传参调用。`,
      category: 'query',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '查询名称（用于页面绑定，如 {{ GetUsers.data }}）' },
          datasourceId: { type: 'number', description: '数据源 ID' },
          body: { type: 'string', description: 'SQL 查询语句 / REST API 端点路径' },
          params: { type: 'object', description: '默认查询参数' },
        },
        required: ['name', 'datasourceId', 'body'],
      },
      async execute(args) {
        try {
          const res = await createQuery({
            applicationId: context.applicationId,
            datasourceId: args.datasourceId as number,
            name: args.name as string,
            body: args.body as string,
            params: (args.params as Record<string, unknown>) || {},
          });
          context.onQueriesChange?.();
          return {
            success: true,
            message: `查询 "${args.name}" 创建成功`,
            data: res.data,
          };
        } catch (e) {
          return { success: false, message: `创建查询失败: ${(e as Error).message}` };
        }
      },
    },
    {
      name: 'update_query',
      description: '更新一个已有查询的语句或参数。支持动态 SQL 标签（<if>、<where>、<set>、<foreach>），语法见 create_query 工具描述。',
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
        try {
          const res = await updateQuery(args.queryId as number, {
            body: args.body as string | undefined,
            params: (args.params as Record<string, unknown>) || undefined,
          });
          return {
            success: true,
            message: '查询更新成功',
            data: res.data,
          };
        } catch (e) {
          return { success: false, message: `更新查询失败: ${(e as Error).message}` };
        }
      },
    },
    {
      name: 'delete_query',
      description: '删除一个查询。注意：此操作不可撤销，会影响到绑定了该查询的页面。',
      category: 'query',
      parameters: {
        type: 'object',
        properties: {
          queryId: { type: 'number', description: '要删除的查询 ID' },
        },
        required: ['queryId'],
      },
      isDangerous: true,
      requiresConfirmation: true,
      async execute(args) {
        try {
          await deleteQuery(args.queryId as number);
          return { success: true, message: '查询删除成功' };
        } catch (e) {
          return { success: false, message: `删除查询失败: ${(e as Error).message}` };
        }
      },
    },
    {
      name: 'run_query',
      description: `执行一个查询并返回结果。用于测试查询是否正确。

params 参数结构取决于数据源类型：
- SQL: 扁平对象，如 { name: "张三", age: 25 }，替换 {{ this.params.xxx }} 并用于动态标签条件
- REST API: 支持 queryParams/headers/body 特殊字段，如 { queryParams: { page: 1 }, body: { name: "test" } }`,
      category: 'query',
      parameters: {
        type: 'object',
        properties: {
          queryId: { type: 'number', description: '查询 ID' },
          params: { type: 'object', description: '查询参数（覆盖默认参数）' },
        },
        required: ['queryId'],
      },
      async execute(args) {
        try {
          const res = await runQuery(args.queryId as number, {
            params: (args.params as Record<string, unknown>) || undefined,
          });
          return {
            success: true,
            message: `查询执行成功，返回 ${res.data.totalCount} 条记录`,
            data: res.data,
          };
        } catch (e) {
          return { success: false, message: `执行查询失败: ${(e as Error).message}` };
        }
      },
    },
    {
      name: 'create_js_function',
      description: '创建一个 JS 函数，用于封装可复用的 JavaScript 逻辑。',
      category: 'query',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '函数名称' },
          body: { type: 'string', description: '函数体代码' },
        },
        required: ['name', 'body'],
      },
      async execute(args) {
        try {
          const res = await createJsFunction({
            pageId: context.pageId,
            name: args.name as string,
            body: args.body as string,
          });
          return {
            success: true,
            message: `JS 函数 "${args.name}" 创建成功`,
            data: res.data,
          };
        } catch (e) {
          return { success: false, message: `创建 JS 函数失败: ${(e as Error).message}` };
        }
      },
    },
  ];
}