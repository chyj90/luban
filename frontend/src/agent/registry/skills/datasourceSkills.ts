import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { createDatasource, testDatasource, getDatasourceStructure } from '@/api';
import { listDatasources } from '@/api/datasource';

export const datasourceSkills: Record<string, SkillFactory> = {
  'datasource:list': (ctx) => ({
    id: 'datasource:list',
    category: SkillCategory.DATASOURCE,
    name: 'list_datasources',
    description: '列出当前工作区中所有数据源，包含每个数据源的连接状态（connected/error/pending）。',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const res = await listDatasources('APPLICATION', ctx.applicationId);
      return { success: true, message: `共 ${res.data.length} 个数据源`, data: res.data };
    },
  }),

  'datasource:test': (ctx) => ({
    id: 'datasource:test',
    category: SkillCategory.DATASOURCE,
    name: 'test_datasource',
    description: '测试指定数据源的连接是否正常。在创建查询或执行 SQL 之前，务必先调用此工具确认数据源连通。',
    parameters: {
      type: 'object',
      properties: { datasourceId: { type: 'number', description: '数据源 ID' } },
      required: ['datasourceId'],
    },
    async execute(args) {
      try {
        await testDatasource(args.datasourceId as number);
        return { success: true, message: '数据源连接正常' };
      } catch (e: unknown) {
        return { success: false, message: `数据源连接失败: ${e.message || '未知错误'}` };
      }
    },
  }),

  'datasource:structure': (ctx) => ({
    id: 'datasource:structure',
    category: SkillCategory.DATASOURCE,
    name: 'fetch_datasource_structure',
    description: '获取数据源的数据库结构，包括所有表和字段信息。调用前请确保数据源连接正常。',
    parameters: {
      type: 'object',
      properties: { datasourceId: { type: 'number', description: '数据源 ID' } },
      required: ['datasourceId'],
    },
    async execute(args) {
      const res = await getDatasourceStructure(args.datasourceId as number);
      return { success: true, message: '获取数据库结构成功', data: res.data };
    },
  }),

  'datasource:connect': (ctx) => ({
    id: 'datasource:connect',
    category: SkillCategory.DATASOURCE,
    name: 'connect_datasource',
    description: `连接一个新的数据源。支持 MySQL、PostgreSQL 及通过驱动扩展的数据源类型。

## SQL 数据源（MySQL/PostgreSQL）
config 字段：host（必填）、port（默认 3306/5432）、database（必填）、username（必填）、password（必填）

注意：REST API 类型已从数据源中独立，请使用 API 页签管理外部 API 连接。`,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '数据源名称' },
        type: { type: 'string', enum: ['MySQL', 'PostgreSQL'], description: '数据源类型' },
        config: { type: 'object', description: '连接配置' },
      },
      required: ['name', 'type', 'config'],
    },
    async execute(args) {
      try {
        const res = await createDatasource({
          ownerId: ctx.applicationId,
          slug: 'APPLICATION' as const,
          name: args.name as string,
          type: args.type as string,
          config: args.config as Record<string, unknown>,
        });
        await testDatasource(res.data.id);
        ctx.onDatasourceChange?.();
        return { success: true, message: `数据源 "${args.name}" 连接成功`, data: res.data };
      } catch (e: unknown) {
        return { success: false, message: `连接数据源失败: ${(e as Error).message}` };
      }
    },
  }),
};