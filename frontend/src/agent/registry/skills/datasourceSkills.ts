import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { createDatasource, testDatasource, getDatasourceStructure } from '@/api';
import { listUnifiedDatasources } from '@/api/datasource';
import { getPlatformUsers, getPlatformDepartments } from '@/api/platform';

export const datasourceSkills: Record<string, SkillFactory> = {
  'platform:users': () => ({
    id: 'platform:users',
    category: SkillCategory.DATASOURCE,
    name: 'search_platform_users',
    description: `分页检索平台用户（最小字段集：id/姓名/账号/部门/直属领导 leaderId，不含手机号邮箱等 PII）。凡需求涉及"员工/用户/审批人/负责人/部门成员"的数据建模、选项枚举、测试数据绑定，必须先用本工具获取真实平台资产：业务表只存 user_id 绑定键，姓名/部门等身份属性运行时由平台解析（页面内置查询 PlatformUsers、SQL 变量 this.auth.*），禁止在业务表冗余身份列、禁止编造平台不存在的人员。按需搜索，禁止全量拉取。`,
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '按姓名/账号/邮箱模糊搜索' },
        deptId: { type: 'number', description: '按部门 ID 精确过滤' },
        ids: { type: 'array', items: { type: 'number' }, description: '按用户 ID 批量精确解析' },
        page: { type: 'number', description: '页码，默认 1' },
        pageSize: { type: 'number', description: '每页条数，默认 50，最大 200' },
      },
    },
    async execute(args) {
      const res = await getPlatformUsers({
        keyword: args.keyword as string | undefined,
        deptId: args.deptId as number | undefined,
        ids: args.ids as number[] | undefined,
        page: args.page as number | undefined,
        pageSize: args.pageSize as number | undefined,
      });
      return {
        success: true,
        message: `平台用户共 ${res.data.total} 个，本页返回 ${res.data.rows.length} 条（第 ${res.data.page} 页）`,
        data: res.data,
      };
    },
  }),

  'platform:departments': () => ({
    id: 'platform:departments',
    category: SkillCategory.DATASOURCE,
    name: 'get_platform_departments',
    description: `获取平台部门组织树（id/名称/上级部门 parentId/部门经理 managerId）。部门下拉选项、组织架构展示、"部门经理审批"等场景从这里取真实部门，禁止编造平台不存在的部门。`,
    parameters: { type: 'object', properties: {} },
    async execute() {
      const res = await getPlatformDepartments();
      return { success: true, message: `共 ${res.data.total} 个部门`, data: res.data };
    },
  }),

  'datasource:list': (ctx) => ({
    id: 'datasource:list',
    category: SkillCategory.DATASOURCE,
    name: 'list_datasources',
    description: `列出当前可用的数据源清单（一个平台一套）：slug=PLATFORM 的平台系统数据源（按所属系统的系统权限授权可见，accessStatus=PENDING 的申请中不可执行）+ slug=APPLICATION 的应用自建业务库。含连接状态（connected/error/pending）。SQL 建模时优先复用已有数据源，禁止为已连接的系统重复建库；看不到目标平台数据源时提示用户到数据源面板「申请平台数据源」。`,
    parameters: { type: 'object', properties: {} },
    async execute() {
      const data = await listUnifiedDatasources(ctx.applicationId);
      const platformCount = data.filter((d) => d.slug === 'PLATFORM').length;
      return {
        success: true,
        message: `共 ${data.length} 个数据源（平台系统 ${platformCount} 个、应用自建 ${data.length - platformCount} 个）`,
        data,
      };
    },
  }),

  'datasource:test': () => ({
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
        return { success: false, message: `数据源连接失败: ${(e as Error).message || '未知错误'}` };
      }
    },
  }),

  'datasource:structure': () => ({
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