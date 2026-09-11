import { SkillCategory, type SkillFactory } from '../skillRegistry';
import {
  createOrchestration, getOrchestration, listOrchestrations,
  lintOrchestration, testRunOrchestration, publishOrchestration,
  saveOrchestration, listOrchestrationExecutions,
} from '@/api/orchestration';
import type { ToolContext } from '@/types/agent';

/** 编排技能：供 orchestration-assistant 使用（调用方为已登录用户，AppAccess 天然生效） */
export const orchestrationSkills: Record<string, SkillFactory> = {
  'orchestration:create': (ctx) => ({
    id: 'orchestration:create',
    category: SkillCategory.ORCHESTRATION,
    name: 'create_orchestration',
    description: '创建 API 编排定义。需要 applicationId、name、dsl（节点/边 JSON，节点类型 start/http/query/python/transform/condition/parallel/workflow/output）。',
    parameters: {
      type: 'object',
      properties: {
        applicationId: { type: 'number', description: '应用 ID' },
        name: { type: 'string' },
        description: { type: 'string' },
        dsl: { type: 'string', description: '编排 DSL JSON 字符串' },
      },
      required: ['applicationId', 'name', 'dsl'],
    },
    async execute(args) {
      try {
        const res = await createOrchestration({
          name: args.name as string,
          description: args.description as string | undefined,
          applicationId: (args.applicationId as number) || ctx.applicationId,
          dsl: args.dsl as string,
        });
        return { success: true, message: `编排创建成功 (ID: ${res.data.id}, version: ${res.data.currentVersionId})`, data: res.data };
      } catch (e) {
        return { success: false, message: `创建失败: ${(e as { response?: { data?: { message?: string } } })?.response?.data?.message || (e as Error).message}` };
      }
    },
  }),

  'orchestration:get': () => ({
    id: 'orchestration:get',
    category: SkillCategory.ORCHESTRATION,
    name: 'get_orchestration',
    description: '查看编排定义详情（含当前 DSL）。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    },
    async execute(args) {
      try {
        const res = await getOrchestration(args.id as number);
        return { success: true, message: `编排 ${res.data.id}「${res.data.name}」状态 ${res.data.status}`, data: res.data };
      } catch (e) {
        return { success: false, message: `查看失败: ${(e as Error).message}` };
      }
    },
  }),

  'orchestration:save': () => ({
    id: 'orchestration:save',
    category: SkillCategory.ORCHESTRATION,
    name: 'save_orchestration',
    description: '保存编排新版本（DSL JSON 字符串）。保存前建议先 lint。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        dsl: { type: 'string' },
      },
      required: ['id', 'dsl'],
    },
    async execute(args) {
      try {
        const res = await saveOrchestration(args.id as number, args.dsl as string);
        return { success: true, message: `新版本保存成功 (versionId: ${res.data.versionId})`, data: res.data };
      } catch (e) {
        return { success: false, message: `保存失败: ${(e as { response?: { data?: { message?: string } } })?.response?.data?.message || (e as Error).message}` };
      }
    },
  }),

  'orchestration:lint': () => ({
    id: 'orchestration:lint',
    category: SkillCategory.ORCHESTRATION,
    name: 'lint_orchestration',
    description: '校验编排 DSL（结构/引用/Python 白名单/变量语法）。返回 passed 与 errors 列表。',
    parameters: {
      type: 'object',
      properties: { dsl: { type: 'string' } },
      required: ['dsl'],
    },
    async execute(args) {
      try {
        const res = await lintOrchestration(args.dsl as string);
        return { success: true, message: res.data.passed ? '校验通过' : `校验未通过: ${res.data.errors.join('；')}`, data: res.data };
      } catch (e) {
        return { success: false, message: `校验执行失败: ${(e as Error).message}` };
      }
    },
  }),

  'orchestration:testRun': (ctx) => ({
    id: 'orchestration:testRun',
    category: SkillCategory.ORCHESTRATION,
    name: 'test_run_orchestration',
    description: '试运行编排（单次执行，样例输入），返回节点级执行痕迹。仅编排 owner/DEVELOP 可用。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        inputs: { type: 'object', description: '样例输入（对应 start 节点声明的参数）' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        const res = await testRunOrchestration(args.id as number,
          (args.inputs as Record<string, unknown>) || {});
        const d = res.data;
        return {
          success: true,
          message: d.success
            ? `试运行成功（${d.durationMs}ms）：${JSON.stringify(d.data).slice(0, 400)}`
            : `试运行失败 [${d.errorCode}]：${d.errorMessage}`,
          data: d,
        };
      } catch (e) {
        return { success: false, message: `试运行失败: ${(e as { response?: { data?: { message?: string } } })?.response?.data?.message || (e as Error).message}` };
      }
    },
  }),

  'orchestration:publish': (ctx) => ({
    id: 'orchestration:publish',
    category: SkillCategory.ORCHESTRATION,
    name: 'publish_orchestration',
    description: '发布编排（固定当前版本并注册为平台工具）。发布需 MANAGE 权限；发布后外部可经授权 API Key 调用。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    },
    async execute(args) {
      try {
        const res = await publishOrchestration(args.id as number);
        return {
          success: true,
          message: `编排已发布（versionId: ${res.data.publishedVersionId}，工具 ID: ${res.data.toolDefinitionId}）`,
          data: res.data,
        };
      } catch (e) {
        return { success: false, message: `发布失败: ${(e as { response?: { data?: { message?: string } } })?.response?.data?.message || (e as Error).message}` };
      }
    },
  }),

  'orchestration:list': (ctx) => ({
    id: 'orchestration:list',
    category: SkillCategory.ORCHESTRATION,
    name: 'list_orchestrations',
    description: '列出应用内的编排定义。',
    parameters: {
      type: 'object',
      properties: { applicationId: { type: 'number' } },
      required: ['applicationId'],
    },
    async execute(args) {
      try {
        const res = await listOrchestrations((args.applicationId as number) || ctx.applicationId);
        return { success: true, message: `共 ${res.data.length} 个编排`, data: res.data };
      } catch (e) {
        return { success: false, message: `列表失败: ${(e as Error).message}` };
      }
    },
  }),

  'orchestration:executions': () => ({
    id: 'orchestration:executions',
    category: SkillCategory.ORCHESTRATION,
    name: 'list_orchestration_executions',
    description: '查看编排执行记录（审计）。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    },
    async execute(args) {
      try {
        const res = await listOrchestrationExecutions(args.id as number);
        return { success: true, message: `共 ${res.data.length} 条执行记录`, data: res.data };
      } catch (e) {
        return { success: false, message: `查看失败: ${(e as Error).message}` };
      }
    },
  }),
};
