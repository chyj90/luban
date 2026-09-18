/**
 * 平台内置 DataQuery 查询（单一事实源）。
 *
 * 这些查询不存于应用查询列表（listQueries 查不到），由页面运行时
 * （useQueryBridge）无条件注册、直查平台身份/组织资产。所有需要内置
 * 查询名单的场景——运行时注册、页面代码校验白名单、提示词文案——
 * 必须引用本常量，禁止各自硬编码。
 *
 * 2026-09-17 事故教训：代码校验器的 DataQuery 名称白名单漏了内置查询，
 * 导致按官方指南编写的合法页面代码被拒（"PlatformDepartments 不存在，
 * 需委派 DBA 创建"），agent 被引向"在业务库复制平台部门表"的错误修复
 * 路径，正面违反"平台资产不落业务库"的建模原则。
 */

export interface BuiltinQueryDef {
  /** DataQuery 调用名（区分大小写，页面 JS 必须逐字符一致） */
  name: string;
  /** 返回字段集（页面代码字段名校验注入用） */
  fields: string[];
}

export const BUILTIN_QUERIES: BuiltinQueryDef[] = [
  {
    name: 'PlatformUsers',
    fields: ['id', 'name', 'account', 'deptId', 'deptName', 'leaderId'],
  },
  {
    name: 'PlatformDepartments',
    fields: ['id', 'name', 'parentId', 'managerId', 'path'],
  },
];

export const BUILTIN_QUERY_NAMES: string[] = BUILTIN_QUERIES.map((q) => q.name);

/** 该 DataQuery 名是否为平台内置查询（内置查询无需绑定、每个页面自动注册） */
export function isBuiltinQueryName(name: string): boolean {
  return BUILTIN_QUERY_NAMES.includes(name);
}

/** 内置查询的返回字段集；非内置查询返回 undefined */
export function getBuiltinQueryFields(name: string): string[] | undefined {
  return BUILTIN_QUERIES.find((q) => q.name === name)?.fields;
}
