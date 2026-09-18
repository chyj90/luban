import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { listPages, getCodePage } from '@/api';
import { listQueries as listAllQueries } from '@/api/query';
import { listApplicationTools } from '@/api/tool';
import { formApi, workflowApi, bindingApi } from '@/api/workflow';

export const observationSkills: Record<string, SkillFactory> = {
  'observation:list_pages': (ctx) => ({
    id: 'observation:list_pages',
    category: SkillCategory.OBSERVATION,
    name: 'list_pages',
    description: '列出当前应用中所有页面。',
    parameters: { type: 'object', properties: {} },
    async execute() {
      try {
        const res = await listPages(ctx.applicationId);
        return {
          success: true,
          message: `共 ${res.data.length} 个页面，当前页面 ID 为 ${ctx.pageId}`,
          data: { pages: res.data, currentPageId: ctx.pageId },
        };
      } catch (e) {
        return { success: false, message: `获取页面列表失败: ${(e as Error).message}` };
      }
    },
  }),

  'observation:list_queries': (ctx) => ({
    id: 'observation:list_queries',
    category: SkillCategory.OBSERVATION,
    name: 'list_queries',
    description: '列出当前应用中所有查询，返回查询名称和ID列表。',
    parameters: { type: 'object', properties: {} },
    async execute() {
      try {
        const res = await listAllQueries(ctx.applicationId);
        return {
          success: true,
          message: `共 ${res.data.length} 个查询`,
          data: { queries: (res.data as Array<{ id: number; name: string }>).map((q) => ({ id: q.id, name: q.name })) },
        };
      } catch {
        return { success: false, message: '获取查询列表失败' };
      }
    },
  }),

  'observation:list_apis': (ctx) => ({
    id: 'observation:list_apis',
    category: SkillCategory.OBSERVATION,
    name: 'list_apis',
    description: '列出当前应用中所有已连接的 API 工具，返回 API 名称和ID列表。',
    parameters: { type: 'object', properties: {} },
    async execute() {
      try {
        const res = await listApplicationTools(ctx.applicationId);
        const tools = (res.data as Array<{ id: number; displayName: string; name: string }>) || [];
        return { success: true, message: `共 ${tools.length} 个 API`, data: { apis: tools.map((t) => ({ id: t.id, name: t.displayName || t.name })) } };
      } catch {
        return { success: false, message: '获取 API 列表失败' };
      }
    },
  }),

  'observation:record': () => ({
    id: 'observation:record',
    category: SkillCategory.OBSERVATION,
    name: 'record_observation',
    description: '记录观察结果，用于告知用户当前状态。',
    parameters: {
      type: 'object',
      properties: { message: { type: 'string', description: '观察内容' } },
      required: ['message'],
    },
    async execute(args) {
      return { success: true, message: args.message as string };
    },
  }),

  'observation:stale-resources': (ctx) => ({
    id: 'observation:stale-resources',
    category: SkillCategory.OBSERVATION,
    name: 'list_stale_resources',
    description: `扫描当前应用的遗留/悬空资源（只读，不删除）：未被任何页面绑定的查询、未绑定表单的 DRAFT 流程、未被流程引用的表单。创建新计划前建议先扫描一遍：同类存量资源要么复用（先 lint_query 验证符合当前建模规范）要么在计划中显式清理，避免"残留 DRAFT 流程被误绑/旧查询未按新规范复用"。清理动作需走 delete_query 等删除工具并经用户确认。`,
    parameters: { type: 'object', properties: {} },
    async execute() {
      const stale: string[] = [];
      try {
        const [pagesRes, queriesRes] = await Promise.all([listPages(ctx.applicationId), listAllQueries(ctx.applicationId)]);
        const pages = pagesRes.data || [];
        const queries = queriesRes.data || [];
        // 每个页面取一次 queryIds 构建引用集合（避免 查询×页面 笛卡尔调用）
        const referencedQueryIds = new Set<number>();
        for (const page of pages) {
          try {
            const codeRes = await getCodePage(page.id);
            for (const qid of codeRes.data.codePage?.queryIds || []) referencedQueryIds.add(qid);
          } catch { /* 页面可能没有代码页，跳过 */ }
        }
        for (const q of queries) {
          if (!referencedQueryIds.has(q.id)) stale.push(`查询「${q.name}」(ID: ${q.id}) 未被任何页面绑定`);
        }

        const [workflows, bindings, formsRes] = await Promise.all([
          workflowApi.listDefinitions({ applicationId: ctx.applicationId }).catch(() => []),
          bindingApi.list({ applicationId: ctx.applicationId }).catch(() => []),
          formApi.list({ applicationId: ctx.applicationId }).catch(() => []),
        ]);
        const boundWorkflowIds = new Set((bindings || []).map((b: { workflowId?: number }) => b.workflowId).filter((v): v is number => v != null));
        const boundFormIds = new Set((bindings || []).map((b: { formId?: number }) => b.formId).filter((v): v is number => v != null));
        for (const wf of workflows || []) {
          const w = wf as { id: number; name?: string; status?: string; publishedVersionId?: number | null };
          // 发布时平台会新建一条 DRAFT 作为下一版编辑草稿（publishedVersionId 指回发布版），
          // 这是健康的版本机制产物，不是悬空资源——跳过，避免把发布副本当垃圾资源
          const isNextVersionDraft = w.publishedVersionId != null;
          if (String(w.status || '').toUpperCase() === 'DRAFT' && !isNextVersionDraft && !boundWorkflowIds.has(w.id)) {
            stale.push(`DRAFT 流程「${w.name}」(ID: ${w.id}) 未绑定任何表单——同类旧流程易被误绑，建议清理或显式复用`);
          }
        }
        for (const f of formsRes || []) {
          const fm = f as { id: number; name?: string };
          if (!boundFormIds.has(fm.id)) {
            stale.push(`表单「${fm.name}」(ID: ${fm.id}) 未被任何流程绑定`);
          }
        }
      } catch (e) {
        return { success: false, message: `扫描失败: ${(e as Error).message}` };
      }
      if (stale.length === 0) {
        return { success: true, message: '扫描完成：未发现遗留/悬空资源' };
      }
      return {
        success: true,
        message: `发现 ${stale.length} 个遗留/悬空资源：\n${stale.map((s) => `- ${s}`).join('\n')}\n处理原则：复用需先验证其符合当前建模规范（lint_query / get_code_page）；清理需经用户确认后执行删除。`,
        data: { stale },
      };
    },
  }),
};