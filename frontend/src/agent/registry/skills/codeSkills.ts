import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { createCodePage, getCodePage, updateCodePage, runQuery, listApplicationTools, runAppTool, listPages, listQueries } from '@/api';
import { validateCode, prioritizeFixable, type QueryRunResult, type ApiRunResult } from './codeValidate';
import { getLubanUIDesignSpec } from '../../prompts/systemPrompt';

function extractQueryNamesFromJS(js: string): string[] {
  const names = new Set<string>();
  const runPattern = /(\w+)\.run\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = runPattern.exec(js)) !== null) {
    names.add(match[1]);
  }
  const dqPattern = /DataQuery\.(\w+)\s*\(/g;
  while ((match = dqPattern.exec(js)) !== null) {
    names.add(match[1]);
  }
  return [...names];
}

function extractApiNamesFromJS(js: string): string[] {
  const names = new Set<string>();
  const callPattern = /window\.__LUBAN__\.callApi\s*\(\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(js)) !== null) {
    names.add(match[1]);
  }
  return [...names];
}

async function runPageQueries(
  queryNames: string[],
  applicationId: number,
): Promise<QueryRunResult[]> {
  const results: QueryRunResult[] = [];
  for (const name of queryNames) {
    try {
      const { listQueries } = await import('@/api/query');
      const allRes = await listQueries(applicationId);
      const allQueries = allRes.data || [];
      const query = allQueries.find((q: { name: string }) => q.name === name);
      if (!query) continue;

      const res = await runQuery(query.id, { params: {} });
      const { columns, rows, totalCount } = res.data;
      const sampleRow = rows.length > 0
        ? columns.reduce((obj: Record<string, unknown>, col: string, i: number) => {
            obj[col] = rows[0][i];
            return obj;
          }, {})
        : undefined;

      results.push({
        queryName: name,
        columns,
        sampleRow,
        totalCount,
      });
    } catch {
      // 查询执行失败，跳过（可能参数必填或数据源不可用）
    }
  }
  return results;
}

async function runPageApis(
  apiNames: string[],
  applicationId: number,
): Promise<ApiRunResult[]> {
  const results: ApiRunResult[] = [];
  try {
    const appToolsRes = await listApplicationTools(applicationId);
    const appTools = (appToolsRes.data || []) as Array<{ id: number; displayName: string }>;

    for (const name of apiNames) {
      const tool = appTools.find((t) => t.displayName === name);
      if (!tool) continue;

      try {
        const res = await runAppTool(applicationId, tool.id, {});
        results.push({
          apiName: name,
          status: res.data.status,
          body: res.data.body,
        });
      } catch {
        // API 执行失败，跳过
      }
    }
  } catch {
    // 获取 App Tools 列表失败
  }
  return results;
}

export const codeSkills: Record<string, SkillFactory> = {
  'code:create': (ctx) => ({
    id: 'code:create',
    category: SkillCategory.CODE,
    name: 'create_code_page',
    description: `创建新的代码页面（同时创建页面记录并写入 HTML/CSS/JS 代码），支持引入外部 CDN 库。

## 参数必须使用纯 JSON 格式，禁止使用 XML 标签（如 <parameter>）
## name 为必填参数，不传会导致 400 错误
## queryIds 必须填写实际查询 ID，不能留空数组，否则页面无法加载数据
## toolIds 必须填写实际 API 工具 ID，不能留空数组，否则页面无法调用 API
## 页面已存在时用 update_code_page，新建用 create_code_page

${getLubanUIDesignSpec()}`,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '【必填】页面名称，如"订单管理"。不填会导致 HTTP 400 错误' },
        html: { type: 'string', description: 'HTML 代码' },
        css: { type: 'string', description: 'CSS 样式代码' },
        js: { type: 'string', description: 'JavaScript 代码' },
        libraries: { type: 'array', items: { type: 'string' }, description: 'CDN 库 URL 列表' },
        queryIds: { type: 'array', items: { type: 'number' }, description: '关联的查询 ID 列表' },
        toolIds: { type: 'array', items: { type: 'number' }, description: '关联的 API 工具 ID 列表' },
      },
      required: ['name'],
    },
    async execute(args) {
      try {
        const name = (args.name as string)?.trim();
        if (!name) {
          if (Object.keys(args).length === 0) {
            return { success: false, message: '参数解析失败，请使用纯 JSON 格式，禁止 XML 标签' };
          }
          return { success: false, message: 'name 参数不能为空，请填写页面名称（如"订单管理"）后重试' };
        }

        const html = (args.html as string)?.trim() || '';
        const css = (args.css as string)?.trim() || '';
        const js = (args.js as string)?.trim() || '';

        if (!html && !css && !js) {
          if (Object.keys(args).length <= 1) {
            return { success: false, message: '参数解析失败，请使用纯 JSON 格式，禁止 XML 标签' };
          }
          return { success: false, message: '页面代码不能全为空，请提供 HTML/CSS/JS 代码后再调用 create_code_page' };
        }

        const queryNames = extractQueryNamesFromJS(js);
        const apiNames = extractApiNamesFromJS(js);

        const [queryResults, apiResults] = await Promise.all([
          queryNames.length > 0 ? runPageQueries(queryNames, ctx.applicationId) : Promise.resolve([]),
          apiNames.length > 0 ? runPageApis(apiNames, ctx.applicationId) : Promise.resolve([]),
        ]);

        const validation = await validateCode(html, css, js, {
          queryIds: (args.queryIds as number[]) || [],
          toolIds: (args.toolIds as number[]) || [],
          applicationId: ctx.applicationId,
          queryResults,
          apiResults,
        });
        if (!validation.valid) {
          let queryNameHint = '';
          try {
            const qIds = (args.queryIds as number[]) || [];
            if (qIds.length > 0) {
              const allQueries = await listQueries(ctx.applicationId);
              const boundQueries = (allQueries.data || []).filter((q: any) => qIds.includes(q.id));
              if (boundQueries.length > 0) {
                queryNameHint = `\n\n⚠️ 本页面绑定的查询及正确调用方式：\n${boundQueries.map((q: any) => {
                  const isWrite = /^(insert|update|delete|create|remove|add|save)/i.test(q.name);
                  const returnType = isWrite ? 'Promise<{affectedRows, success}>' : 'Promise<{rows, columns, totalCount}>';
                  return `  - DataQuery.${q.name}(params) → 返回 ${returnType}`;
                }).join('\n')}\n请使用 DataQuery.xxx() 调用，不要用 .run()、__前缀、QueryApi 等错误方式。`;
              }
            }
          } catch { /* ignore */ }
          return { success: false, message: `❌ 代码存在语法级错误，页面无法渲染，尚未创建。请修正后重新调用 create_code_page：\n${validation.errors.join('\n')}${queryNameHint}` };
        }
        if (validation.warnings.length > 0) {
          console.warn('[code:create]', validation.warnings.join('\n'));
        }

        const queryIds = (args.queryIds as number[]) || [];
        const toolIds = (args.toolIds as number[]) || [];
        if (queryNames.length > 0 && queryIds.length === 0) {
          return {
            success: false,
            message: `JS 代码中使用了查询（${queryNames.join('、')}），但 queryIds 为空。` +
              '请先通过 delegate_query 创建查询，获取查询 ID 后填入 queryIds 参数。' +
              '如果查询已存在，请从已有查询列表中获取 ID。',
          };
        }
        if (apiNames.length > 0 && toolIds.length === 0) {
          return {
            success: false,
            message: `JS 代码中使用了平台 API（${apiNames.join('、')}），但 toolIds 为空。` +
              '请填入对应的 API 工具 ID。',
          };
        }

        try {
          const pagesRes = await listPages(ctx.applicationId);
          const existing = (pagesRes.data || []).find((p: { name: string }) => p.name === name);
          if (existing) {
            return {
              success: false,
              message: `页面「${name}」已存在（id: ${existing.id}），请使用 update_code_page 更新该页面，而不是 create_code_page。调用示例：update_code_page({ pageId: ${existing.id}, html, css, js, ... })`,
              _noRetry: true,
            };
          }
        } catch {
          // listPages 失败不阻塞，继续走后端创建（后端仍有唯一约束兜底）
        }

        const res = await createCodePage({
          applicationId: ctx.applicationId,
          name,
          html,
          css,
          js,
          libraries: (args.libraries as string[]) || [],
          queryIds: (args.queryIds as number[]) || [],
          toolIds: (args.toolIds as number[]) || [],
        });
        ctx.onPagesChange?.();
        ctx.onPageChange?.(res.data.id);
        if (validation.fixable.length > 0) {
          const topFixes = validation.fixable.slice(0, 2);
          const remaining = validation.fixable.length - topFixes.length;
          let fixMsg = `✅ 代码页面 "${name}" 创建成功（id: ${res.data.id}），但存在 ${validation.fixable.length} 个待修问题。页面已可渲染，必须逐步用 update_code_page 修复，禁止在还有问题未修复时标记步骤完成：\n\n🔧 **先修这 ${topFixes.length} 个**（最影响功能）：\n${topFixes.join('\n')}`;
          if (remaining > 0) {
            fixMsg += `\n\n📋 还有 ${remaining} 个问题，修完上面后再修。`;
          }
          fixMsg += '\n\n⚠️ 每次只修 1-2 个问题，修完调用 update_code_page。修复所有问题后才能标记步骤完成。';
          return {
            success: true,
            message: fixMsg,
            data: res.data,
          };
        }
        return { success: true, message: `代码页面 "${name}" 创建成功`, data: res.data };
      } catch (e: any) {
        return { success: false, message: `创建代码页面失败: ${(e as Error).message}` };
      }
    },
  }),

  'code:get': (ctx) => ({
    id: 'code:get',
    category: SkillCategory.CODE,
    name: 'get_code_page',
    description: '获取指定页面的完整代码（HTML/CSS/JS），用于增量修改。',
    parameters: {
      type: 'object',
      properties: { pageId: { type: 'number', description: '页面 ID' } },
      required: ['pageId'],
    },
    async execute(args) {
      try {
        const pageId = (args.pageId as number) || ctx.pageId;
        const res = await getCodePage(pageId);
        return { success: true, message: '获取页面代码成功', data: res.data };
      } catch (e: any) {
        return { success: false, message: `获取页面代码失败: ${(e as Error).message}` };
      }
    },
  }),

  'code:update': (ctx) => ({
    id: 'code:update',
    category: SkillCategory.CODE,
    name: 'update_code_page',
    description: `更新代码页面的代码。支持增量修改（传入 changes）或全量替换（传入 html/css/js）。

## 参数必须使用纯 JSON 格式，禁止 XML 标签
## pageId 为必填参数
## queryIds/toolIds 为可选参数，不传时自动保留页面原有绑定

${getLubanUIDesignSpec()}`,
    parameters: {
      type: 'object',
      properties: {
        pageId: { type: 'number', description: '页面 ID' },
        html: { type: 'string', description: '全量替换：HTML 代码' },
        css: { type: 'string', description: '全量替换：CSS 代码' },
        js: { type: 'string', description: '全量替换：JS 代码' },
        changes: {
          type: 'array',
          description: '增量修改列表',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['replace', 'insert_before', 'insert_after', 'delete'] },
              target: { type: 'string', description: '目标代码片段' },
              newContent: { type: 'string', description: '新内容' },
              section: { type: 'string', enum: ['html', 'css', 'js'] },
            },
          },
        },
        libraries: { type: 'array', items: { type: 'string' } },
        queryIds: { type: 'array', items: { type: 'number' } },
        toolIds: { type: 'array', items: { type: 'number' } },
      },
      required: ['pageId'],
    },
    async execute(args) {
      try {
        const pageId = args.pageId as number;
        if (!pageId || pageId <= 0) {
          if (Object.keys(args).length === 0) {
            return { success: false, message: '参数解析失败，请使用纯 JSON 格式，禁止 XML 标签' };
          }
          return { success: false, message: 'pageId 参数不能为空，请提供要更新的页面 ID' };
        }

        const changes = args.changes as Array<{ action: string; target: string; newContent?: string; section: string }> | undefined;
        let html = args.html as string | undefined;
        let css = args.css as string | undefined;
        let js = args.js as string | undefined;

        let currentCode: { html?: string; css?: string; js?: string; queryIds?: number[]; toolIds?: number[] } | null = null;
        try {
          const currentPage = await getCodePage(pageId);
          currentCode = currentPage.data.codePage;
        } catch {
          currentCode = null;
        }

        if (changes && changes.length > 0 && currentCode) {
          html = currentCode.html ?? '';
          css = currentCode.css ?? '';
          js = currentCode.js ?? '';

          const sections: Record<string, string> = { html, css, js };

          for (const ch of changes) {
            const sec = sections[ch.section];
            if (sec === undefined) continue;

            switch (ch.action) {
              case 'replace': {
                const target = ch.target;
                const idx = sec.indexOf(target);
                if (idx !== -1) {
                  sections[ch.section] = sec.slice(0, idx) + (ch.newContent ?? '') + sec.slice(idx + target.length);
                } else {
                  console.warn(`[update_code_page] replace target not found in ${ch.section}: ${target.substring(0, 80)}...`);
                }
                break;
              }
              case 'insert_before': {
                const target = ch.target;
                const idx = sec.indexOf(target);
                if (idx !== -1) {
                  sections[ch.section] = sec.slice(0, idx) + (ch.newContent ?? '') + sec.slice(idx);
                } else {
                  console.warn(`[update_code_page] insert_before target not found in ${ch.section}: ${target.substring(0, 80)}...`);
                }
                break;
              }
              case 'insert_after': {
                const target = ch.target;
                const idx = sec.indexOf(target);
                if (idx !== -1) {
                  const endIdx = idx + target.length;
                  sections[ch.section] = sec.slice(0, endIdx) + (ch.newContent ?? '') + sec.slice(endIdx);
                } else {
                  console.warn(`[update_code_page] insert_after target not found in ${ch.section}: ${target.substring(0, 80)}...`);
                }
                break;
              }
              case 'delete': {
                const target = ch.target;
                const idx = sec.indexOf(target);
                if (idx !== -1) {
                  sections[ch.section] = sec.slice(0, idx) + sec.slice(idx + target.length);
                } else {
                  console.warn(`[update_code_page] delete target not found in ${ch.section}: ${target.substring(0, 80)}...`);
                }
                break;
              }
            }
          }

          html = sections.html;
          css = sections.css;
          js = sections.js;
        }

        const queryNames = extractQueryNamesFromJS(js);
        const apiNames = extractApiNamesFromJS(js);

        const effectiveQueryIds: number[] = (args.queryIds as number[] | undefined)?.length
          ? (args.queryIds as number[])
          : (currentCode?.queryIds || []);
        const effectiveToolIds: number[] = (args.toolIds as number[] | undefined)?.length
          ? (args.toolIds as number[])
          : (currentCode?.toolIds || []);

        const [queryResults, apiResults] = await Promise.all([
          queryNames.length > 0 ? runPageQueries(queryNames, ctx.applicationId) : Promise.resolve([]),
          apiNames.length > 0 ? runPageApis(apiNames, ctx.applicationId) : Promise.resolve([]),
        ]);

        const validation = await validateCode(html, css, js, {
          queryIds: effectiveQueryIds,
          toolIds: effectiveToolIds,
          applicationId: ctx.applicationId,
          queryResults,
          apiResults,
        });
        if (!validation.valid) {
          let queryNameHint = '';
          try {
            if (effectiveQueryIds.length > 0) {
              const allQueries = await listQueries(ctx.applicationId);
              const boundQueries = (allQueries.data || []).filter((q: any) => effectiveQueryIds.includes(q.id));
              if (boundQueries.length > 0) {
                queryNameHint = `\n\n⚠️ 本页面绑定的查询及正确调用方式：\n${boundQueries.map((q: any) => {
                  const isWrite = /^(insert|update|delete|create|remove|add|save)/i.test(q.name);
                  const returnType = isWrite ? 'Promise<{affectedRows, success}>' : 'Promise<{rows, columns, totalCount}>';
                  return `  - DataQuery.${q.name}(params) → 返回 ${returnType}`;
                }).join('\n')}\n请使用 DataQuery.xxx() 调用，不要用 .run()、__前缀、QueryApi 等错误方式。`;
              }
            }
          } catch { /* ignore */ }
          return { success: false, message: `❌ 代码存在语法级错误，页面代码未更新。请修正后重新调用 update_code_page：\n${validation.errors.join('\n')}${queryNameHint}` };
        }
        if (validation.warnings.length > 0) {
          console.warn('[code:update]', validation.warnings.join('\n'));
        }

        if (queryNames.length > 0 && effectiveQueryIds.length === 0) {
          return {
            success: false,
            message: `JS 代码中使用了查询（${queryNames.join('、')}），但 queryIds 为空。` +
              '请填入对应的查询 ID。如果查询已存在，请从已有查询列表中获取 ID。',
          };
        }
        if (apiNames.length > 0 && effectiveToolIds.length === 0) {
          return {
            success: false,
            message: `JS 代码中使用了平台 API（${apiNames.join('、')}），但 toolIds 为空。` +
              '请填入对应的 API 工具 ID。',
          };
        }

        const updateData: Record<string, unknown> = {};
        if (html !== undefined) updateData.html = html;
        if (css !== undefined) updateData.css = css;
        if (js !== undefined) updateData.js = js;
        if (args.libraries !== undefined) {
          updateData.libraries = args.libraries;
        }
        if (effectiveQueryIds.length > 0) {
          updateData.queryIds = effectiveQueryIds;
        }
        if (effectiveToolIds.length > 0) {
          updateData.toolIds = effectiveToolIds;
        }
        const res = await updateCodePage(pageId, updateData);
        ctx.onPageChange?.(pageId);
        if (validation.fixable.length > 0) {
          const topFixes = validation.fixable.slice(0, 2);
          const remaining = validation.fixable.length - topFixes.length;
          let fixMsg = `✅ 页面代码更新成功，还有 ${validation.fixable.length} 个待修问题。必须继续用 update_code_page 修复，禁止在还有问题未修复时标记步骤完成：\n\n🔧 **先修这 ${topFixes.length} 个**：\n${topFixes.join('\n')}`;
          if (remaining > 0) {
            fixMsg += `\n\n📋 还有 ${remaining} 个问题，修完上面后再修。`;
          }
          fixMsg += '\n\n⚠️ 每次只修 1-2 个问题，修完调用 update_code_page。修复所有问题后才能标记步骤完成。';
          return {
            success: true,
            message: fixMsg,
            data: res.data,
          };
        }
        return { success: true, message: '页面代码更新成功', data: res.data };
      } catch (e: any) {
        return { success: false, message: `更新代码失败: ${(e as Error).message}` };
      }
    },
  }),

  'code:scaffold': (ctx) => ({
    id: 'code:scaffold',
    category: SkillCategory.CODE,
    name: 'create_page_scaffold',
    description: `创建页面脚手架：生成符合平台规范的初始代码模板（正确的初始化模式、DataQuery 调用、LubanUI 组件），页面创建后通过 update_code_page 逐步完善业务逻辑。

## 推荐工作流
1. 调用 create_page_scaffold 生成脚手架 → 页面创建成功
2. 调用 update_code_page 补充表格列、表单字段等业务逻辑
3. 如有待修问题，每次修 1-2 个，逐步完善

## 参数必须使用纯 JSON 格式，禁止使用 XML 标签`,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '【必填】页面名称' },
        type: { type: 'string', enum: ['crud', 'dashboard', 'detail', 'custom'], description: '页面类型：crud=表格+表单+增删改查, dashboard=统计卡+图表, detail=详情展示, custom=空白模板' },
        readQueries: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, id: { type: 'number' } } }, description: '读查询列表（SELECT），如 [{name:"GetList", id:1}]' },
        writeQueries: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, id: { type: 'number' }, operation: { type: 'string', enum: ['insert', 'update', 'delete'] } } }, description: '写查询列表（INSERT/UPDATE/DELETE），如 [{name:"InsertData", id:2, operation:"insert"}]' },
        toolIds: { type: 'array', items: { type: 'number' }, description: '关联的 API 工具 ID 列表' },
        libraries: { type: 'array', items: { type: 'string' }, description: 'CDN 库 URL 列表' },
      },
      required: ['name', 'type'],
    },
    async execute(args) {
      try {
        const name = (args.name as string)?.trim();
        if (!name) {
          return { success: false, message: 'name 参数不能为空，请填写页面名称' };
        }

        const pageType = (args.type as string) || 'crud';
        const readQueries = (args.readQueries as Array<{ name: string; id: number }>) || [];
        const writeQueries = (args.writeQueries as Array<{ name: string; id: number; operation: string }>) || [];

        const primaryRead = readQueries[0];
        const insertQuery = writeQueries.find(q => q.operation === 'insert');
        const updateQuery = writeQueries.find(q => q.operation === 'update');
        const deleteQuery = writeQueries.find(q => q.operation === 'delete');

        const queryIds = [...readQueries.map(q => q.id), ...writeQueries.map(q => q.id)];
        const toolIds = (args.toolIds as number[]) || [];

        let html = '';
        let css = '';
        let js = '';

        if (pageType === 'crud') {
          const readName = primaryRead?.name || 'GetList';
          const insertName = insertQuery?.name || 'InsertData';
          const updateName = updateQuery?.name || 'UpdateData';
          const deleteName = deleteQuery?.name || 'DeleteData';

          html = `<div class="page-container">
  <div id="pageHeader"></div>
  <div class="content-container">
    <div class="luban-filter-bar">
      <div class="luban-filter-item">
        <label class="luban-filter-label">搜索</label>
        <input type="text" id="searchInput" class="luban-input" placeholder="请输入关键词">
      </div>
      <div class="luban-filter-actions">
        <button class="luban-btn luban-btn-primary" onclick="searchData()">查询</button>
        <button class="luban-btn" onclick="resetSearch()">重置</button>
      </div>
    </div>
    <table class="luban-table" id="dataTable">
      <thead><tr>
        <th>序号</th>
        <th>名称</th>
        <th>状态</th>
        <th>创建时间</th>
        <th>操作</th>
      </tr></thead>
      <tbody></tbody>
    </table>
  </div>
</div>

<div id="editModal" class="luban-modal-overlay" style="display:none">
  <div class="luban-modal">
    <div class="luban-modal-header">
      <h3 class="luban-modal-title" id="modalTitle">新增</h3>
      <button class="luban-modal-close" data-modal-close onclick="LubanUI.modal.close('editModal')">&times;</button>
    </div>
    <div class="luban-modal-body">
      <form id="editForm" class="luban-form">
        <div class="luban-form-item">
          <label class="luban-form-label luban-form-label-required">名称</label>
          <input type="text" name="name" class="luban-input" required>
        </div>
      </form>
    </div>
    <div class="luban-modal-footer">
      <button class="luban-btn luban-btn-primary" onclick="saveData()">保存</button>
      <button class="luban-btn" onclick="LubanUI.modal.close('editModal')">取消</button>
    </div>
  </div>
</div>`;

          css = `.page-container { padding: 20px; max-width: 1400px; margin: 0 auto; }
.content-container { background: #fff; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); padding: 20px; }`;

          js = `var tableInstance = null;
var currentEditId = null;

function initPage() {
  LubanUI.pageHeader('pageHeader', {
    title: '${name}',
    actions: [
      '<button class="luban-btn luban-btn-primary" onclick="openAdd()">新增</button>'
    ]
  });
  searchData();
}

function searchData() {
  var keyword = document.getElementById('searchInput').value;
  DataQuery.${readName}({ keyword: keyword }).then(function(result) {
    renderTable(result.rows);
  });
}

function resetSearch() {
  document.getElementById('searchInput').value = '';
  searchData();
}

function renderTable(rows) {
  var tbody = document.querySelector('#dataTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:#999;">暂无数据</td></tr>';
    return;
  }
  rows.forEach(function(row, index) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (index + 1) + '</td>' +
      '<td>' + (row.name || '') + '</td>' +
      '<td>' + (row.status || '') + '</td>' +
      '<td>' + (row.created_time || '') + '</td>' +
      '<td>' +
        '<button class="luban-btn luban-btn-text" onclick="openEdit(' + row.id + ')">编辑</button> ' +
        '<button class="luban-btn luban-btn-text luban-btn-danger" onclick="deleteData(' + row.id + ')">删除</button>' +
      '</td>';
    tbody.appendChild(tr);
  });
}

function openAdd() {
  currentEditId = null;
  document.getElementById('modalTitle').textContent = '新增';
  document.getElementById('editForm').reset();
  LubanUI.modal.open('editModal');
}

function openEdit(id) {
  currentEditId = id;
  document.getElementById('modalTitle').textContent = '编辑';
  var tbody = document.querySelector('#dataTable tbody');
  if (!tbody) return;
  var rows = tbody.querySelectorAll('tr');
  for (var i = 0; i < rows.length; i++) {
    var cells = rows[i].querySelectorAll('td');
    if (cells.length > 0 && cells[1].textContent) {
      document.getElementById('editForm').elements['name'].value = cells[1].textContent;
      break;
    }
  }
  LubanUI.modal.open('editModal');
}

function saveData() {
  var formData = LubanUI.getFormData('editForm');
  if (currentEditId) {
    DataQuery.${updateName}({ id: currentEditId, name: formData.name }).then(function(result) {
      LubanUI.toast.success('更新成功');
      LubanUI.modal.close('editModal');
      searchData();
    });
  } else {
    DataQuery.${insertName}({ name: formData.name }).then(function(result) {
      LubanUI.toast.success('新增成功');
      LubanUI.modal.close('editModal');
      searchData();
    });
  }
}

function deleteData(id) {
  if (!confirm('确认删除？')) return;
  DataQuery.${deleteName}({ id: id }).then(function(result) {
    LubanUI.toast.success('删除成功');
    searchData();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage, { once: true });
} else {
  initPage();
}`;

        } else if (pageType === 'dashboard') {
          const readName = primaryRead?.name || 'GetStats';

          html = `<div class="page-container">
  <div id="pageHeader"></div>
  <div class="luban-stats-grid">
    <div class="luban-stat-card luban-stat-card-primary">
      <div class="luban-stat-label">总数</div>
      <div class="luban-stat-value" id="statTotal">-</div>
    </div>
    <div class="luban-stat-card luban-stat-card-success">
      <div class="luban-stat-label">完成</div>
      <div class="luban-stat-value" id="statDone">-</div>
    </div>
    <div class="luban-stat-card luban-stat-card-warning">
      <div class="luban-stat-label">进行中</div>
      <div class="luban-stat-value" id="statPending">-</div>
    </div>
  </div>
  <div class="content-container" style="margin-top:20px;">
    <div class="luban-chart-item">
      <div class="luban-chart-title">趋势图</div>
      <div class="luban-chart" id="trendChart"></div>
    </div>
  </div>
</div>`;

          css = `.page-container { padding: 20px; max-width: 1400px; margin: 0 auto; }
.content-container { background: #fff; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); padding: 20px; }`;

          js = `function initPage() {
  LubanUI.pageHeader('pageHeader', {
    title: '${name}',
    description: '数据概览与趋势分析'
  });
  loadStats();
}

function loadStats() {
  DataQuery.${readName}({}).then(function(result) {
    var rows = result.rows;
    if (rows && rows.length > 0) {
      document.getElementById('statTotal').textContent = rows[0].total || '-';
      document.getElementById('statDone').textContent = rows[0].done_count || '-';
      document.getElementById('statPending').textContent = rows[0].pending_count || '-';
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage, { once: true });
} else {
  initPage();
}`;

        } else if (pageType === 'detail') {
          const readName = primaryRead?.name || 'GetDetail';

          html = `<div class="page-container">
  <div id="pageHeader"></div>
  <div class="content-container">
    <div class="luban-card">
      <div class="luban-card-header">
        <h3 class="luban-card-title">基本信息</h3>
      </div>
      <div class="luban-card-body" id="detailBody">
        <p style="color:#999;">加载中...</p>
      </div>
    </div>
  </div>
</div>`;

          css = `.page-container { padding: 20px; max-width: 1400px; margin: 0 auto; }
.content-container { background: #fff; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); padding: 20px; }
.detail-row { display: flex; padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
.detail-label { width: 120px; color: #666; flex-shrink: 0; }
.detail-value { flex: 1; color: #333; }`;

          js = `function initPage() {
  var params = window.__LUBAN__.getPageParams();
  LubanUI.pageHeader('pageHeader', {
    title: '${name}',
    breadcrumb: [
      { label: '列表', href: '#' },
      { label: '详情', active: true }
    ]
  });
  loadDetail(params);
}

function loadDetail(params) {
  DataQuery.${readName}(params).then(function(result) {
    var rows = result.rows;
    if (rows && rows.length > 0) {
      var row = rows[0];
      document.getElementById('detailBody').innerHTML =
        '<div class="detail-row"><span class="detail-label">ID</span><span class="detail-value">' + (row.id || '') + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">名称</span><span class="detail-value">' + (row.name || '') + '</span></div>';
    } else {
      document.getElementById('detailBody').innerHTML = '<p style="color:#999;">暂无数据</p>';
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage, { once: true });
} else {
  initPage();
}`;

        } else {
          html = `<div class="page-container">
  <div id="pageHeader"></div>
  <div class="content-container">
    <p>页面内容</p>
  </div>
</div>`;

          css = `.page-container { padding: 20px; max-width: 1400px; margin: 0 auto; }
.content-container { background: #fff; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); padding: 20px; }`;

          js = `function initPage() {
  LubanUI.pageHeader('pageHeader', {
    title: '${name}'
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage, { once: true });
} else {
  initPage();
}`;
        }

        const queryNames = extractQueryNamesFromJS(js);
        const apiNames = extractApiNamesFromJS(js);

        const [queryResults, apiResults] = await Promise.all([
          queryNames.length > 0 ? runPageQueries(queryNames, ctx.applicationId) : Promise.resolve([]),
          apiNames.length > 0 ? runPageApis(apiNames, ctx.applicationId) : Promise.resolve([]),
        ]);

        const validation = await validateCode(html, css, js, {
          queryIds,
          toolIds,
          applicationId: ctx.applicationId,
          queryResults,
          apiResults,
        });

        if (validation.warnings.length > 0) {
          console.warn('[code:scaffold]', validation.warnings.join('\n'));
        }

        try {
          const pagesRes = await listPages(ctx.applicationId);
          const existing = (pagesRes.data || []).find((p: { name: string }) => p.name === name);
          if (existing) {
            return {
              success: false,
              message: `页面「${name}」已存在（id: ${existing.id}），请使用 update_code_page 更新该页面。`,
              _noRetry: true,
            };
          }
        } catch { /* ignore */ }

        const res = await createCodePage({
          applicationId: ctx.applicationId,
          name,
          html,
          css,
          js,
          libraries: (args.libraries as string[]) || [],
          queryIds,
          toolIds,
        });
        ctx.onPagesChange?.();
        ctx.onPageChange?.(res.data.id);

        let msg = `✅ 页面脚手架 "${name}" 创建成功（id: ${res.data.id}）！\n\n`;
        msg += `📋 **下一步**：调用 update_code_page 补充业务逻辑：\n`;
        if (pageType === 'crud') {
          msg += `1. 补充表格列（添加更多 <th> 和对应 <td>）\n`;
          msg += `2. 补充表单字段（在 editForm 中添加更多输入项）\n`;
          msg += `3. 完善 openEdit 从表格行获取数据回填表单\n`;
          msg += `4. 调整 saveData 传递完整表单数据\n`;
        } else if (pageType === 'dashboard') {
          msg += `1. 补充统计卡片（添加更多 luban-stat-card）\n`;
          msg += `2. 添加图表初始化代码\n`;
          msg += `3. 完善 loadStats 数据映射\n`;
        } else if (pageType === 'detail') {
          msg += `1. 补充详情字段（添加更多 detail-row）\n`;
          msg += `2. 完善数据映射逻辑\n`;
        }
        if (validation.fixable.length > 0) {
          msg += `\n⚠️ 有 ${validation.fixable.length} 个待修问题，请逐步修复：\n`;
          msg += validation.fixable.slice(0, 2).join('\n');
          if (validation.fixable.length > 2) {
            msg += `\n...还有 ${validation.fixable.length - 2} 个`;
          }
        }

        return { success: true, message: msg, data: res.data };
      } catch (e: any) {
        return { success: false, message: `创建页面脚手架失败: ${(e as Error).message}` };
      }
    },
  }),
};