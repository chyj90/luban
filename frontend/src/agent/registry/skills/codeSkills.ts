import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { createCodePage, getCodePage, updateCodePage, runQuery, listApplicationTools, runAppTool, listPages, listQueries } from '@/api';
import { validateCode, type QueryRunResult, type ApiRunResult } from './codeValidate';
import { getComponentSpecByName, getComponentCatalog } from '@/luban-ui/componentSpecs';
import { getAnalysisExamples, getDataQueryGuide } from './promptFragments';
import type { ToolExecuteResult } from '@/types/agent';

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
## 组件库用法通过 get_component_spec 工具按需获取
## ⚠️ 大屏/多模块页面（预计 HTML+JS 超过 150 行）：建议改用 create_page_scaffold 生成骨架后 update_code_page 分步完善——一次性生成大段代码容易引入多个待修问题且修复往返耗时成倍增加`,
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
## 组件库用法通过 get_component_spec 工具按需获取`,
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
        let js = (args.js as string) || '';

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

## ⚠️ dashboard 骨架只是质感基线的示例排布，不是固定模板
骨架演示的是大屏质感基线（screen-tech 底座 + decor.frame 边框 + 科技面板 + screenPalette 配色 + luban-num 数码字）。
区块构成和布局必须按需求分析第 4 章 UI 分析自由组织——面板数量、栅格比例、有无地图、KPI 行数随需求变化；
需求结构与骨架差异大时，用 decor.panel 等组件按分析结果重新排布（面板可任意数量），禁止硬套骨架。

## 参数必须使用纯 JSON 格式，禁止使用 XML 标签`,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '【必填】页面名称' },
        type: { type: 'string', enum: ['crud', 'dashboard', 'detail', 'custom'], description: '页面类型：crud=表格+表单+增删改查, dashboard=统计卡+图表, detail=详情展示, custom=空白模板' },
        theme: { type: 'string', enum: ['dark', 'light'], description: 'dashboard 页面主题：dark=深色大屏，light=浅色大屏。必须按用户需求选择（用户要浅色就必须传 light），模板会自动调用 LubanUI.setTheme' },
        primaryColor: { type: 'string', description: 'dashboard 主色（#RRGGBB，可选）。用户提出配色/风格需求时传入（如"绿色系"传 #22C55E），页面会通过 LubanUI.setPalette 程序化派生整套配色' },
        density: { type: 'string', enum: ['compact', 'normal', 'large'], description: 'dashboard 信息密度（可选）。用户要求"高密度/一屏多个面板"传 compact，"大字展示屏"传 large，默认 normal。通过 LubanUI.setDensity 生效' },
        canvasWidth: { type: 'number', description: '画布宽度 px（可选，默认 1920）。用户给出明确显示尺寸/分辨率时传入，如 LED 屏 2560、拼接屏 3840、超宽条屏 4864、竖屏 1080。非 16:9 比例时布局必须按画布比例重新组织' },
        canvasHeight: { type: 'number', description: '画布高度 px（可选，默认 1080）。与 canvasWidth 成对传入' },
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
          const theme = args.theme === 'light' ? 'light' : 'dark';
          // 画布：默认 1920×1080；用户给出明确尺寸时按用户的来（640-7680 合法范围）
          const clampCanvas = (v: unknown, fallback: number) => {
            const n = Number(v);
            return Number.isFinite(n) && n >= 640 && n <= 7680 ? Math.round(n) : fallback;
          };
          const cw = clampCanvas(args.canvasWidth, 1920);
          const chh = clampCanvas(args.canvasHeight, 1080);

          // 指挥中心级大屏骨架：统一蓝青色相（色板取样自高端指挥中心设计稿）
          // screen-tech 底座 + 全屏科技边框 + 梯形标题栏 + 科技面板 + KPI 数码字 + 中央3D地图 + 底部图标导航
          // 模型在其上填数据和图表，不自己写容器样式
          html = `<div class="luban-screen-tech luban-hex-bg">
  <div id="screenHeader"></div>

  <div class="my-kpi-row">
    <div class="luban-kpi-tech">
      <div class="luban-kpi-label">指标一</div>
      <div class="luban-kpi-value luban-num" id="kpi1">--</div>
      <div class="luban-kpi-spark" id="kpi1Spark"></div>
    </div>
    <div class="luban-kpi-tech">
      <div class="luban-kpi-label">指标二</div>
      <div class="luban-kpi-value luban-num" id="kpi2">--</div>
      <div class="luban-kpi-spark" id="kpi2Spark"></div>
    </div>
    <div class="luban-kpi-tech">
      <div class="luban-kpi-label">指标三</div>
      <div class="luban-kpi-value luban-num" id="kpi3">--</div>
      <div class="luban-kpi-spark" id="kpi3Spark"></div>
    </div>
    <div class="luban-kpi-tech">
      <div class="luban-kpi-label">指标四</div>
      <div class="luban-kpi-value luban-num" id="kpi4">--</div>
      <div class="luban-kpi-spark" id="kpi4Spark"></div>
    </div>
  </div>

  <div class="my-screen-grid">
    <div class="my-panel-col">
      <div class="my-panel-flex" id="chart1Panel"></div>
      <div class="my-panel-flex" id="chart2Panel"></div>
    </div>

    <div class="my-map-wrap">
      <div class="luban-halo" style="width:62%;height:62%;"></div>
      <div id="mapChart" class="my-map-fill"></div>
    </div>

    <div class="my-panel-col">
      <div class="my-panel-flex" id="chart3Panel"></div>
      <div class="my-panel-flex" id="chart4Panel"></div>
    </div>
  </div>

  <div id="bottomNav"></div>
</div>`;

          css = `body { margin: 0; overflow: hidden; }
/* KPI 行：4 等分，间距跟随密度档位（--scr-gap 由 LubanUI.setDensity 控制） */
.my-kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--scr-gap, 12px); margin-bottom: var(--scr-gap, 12px); }
/* 三栏主体：左右面板列 3fr，中央地图 5fr */
.my-screen-grid { flex: 1; display: grid; grid-template-columns: 3fr 5fr 3fr; gap: var(--scr-gap, 12px); min-height: 0; }
.my-panel-col { display: flex; flex-direction: column; gap: var(--scr-gap, 12px); min-height: 0; }
.my-panel-flex { flex: 1; min-height: 0; display: flex; }
.my-panel-flex .luban-panel-body { flex: 1; }
/* 中央地图区：相对定位承载光环装饰 */
.my-map-wrap { position: relative; min-height: 0; display: flex; }
.my-map-fill { flex: 1; min-height: 0; }`;

          js = `function initPage() {
  // 主题（大屏质感按 dark 设计；用户明确要浅色时传 light，面板自动切浅色底）
  LubanUI.setTheme('${theme}');${args.primaryColor ? `\n  // 用户指定主色：整套配色（背景/发光/图表序列）由 LubanUI 程序化派生\n  LubanUI.setPalette({ primary: '${args.primaryColor}' });` : ''}${args.density && args.density !== 'normal' ? `\n  // 用户指定信息密度：组件尺寸（面板头/KPI 数值/导航等）按档位缩放\n  LubanUI.setDensity('${args.density}');` : ''}
  // 画布设计稿：${cw}×${chh}${cw === 1920 && chh === 1080 ? '（默认，等比缩放适配任意分辨率）' : '（按用户要求的尺寸）'}，预览/大屏投放自动等比缩放居中
  LubanUI.screenScaler({ width: ${cw}, height: ${chh}, target: '.luban-screen-tech' });
  // 全屏科技边框（四角装饰 + 边线扫光）
  LubanUI.decor.frame('.luban-screen-tech');
  // 大屏标题栏（clock 传时钟容器 id，右侧自动出现时区槽位）
  LubanUI.decor.header('screenHeader', { title: '${name}', clock: 'worldClock' });
  // 图表面板（icon 可选值: LubanUI.iconList()，如 radar/alert/chart-bar/chart-pie/database/gauge）
  LubanUI.decor.panel('chart1Panel', { title: '面板标题一', icon: 'chart-bar' });
  LubanUI.decor.panel('chart2Panel', { title: '面板标题二', icon: 'chart-pie' });
  LubanUI.decor.panel('chart3Panel', { title: '面板标题三', icon: 'radar' });
  LubanUI.decor.panel('chart4Panel', { title: '面板标题四', icon: 'gauge' });
  // 多时区时钟（数码字体）
  LubanUI.worldClock('worldClock', { zones: [
    { label: '北京', offset: 8 }, { label: '伦敦', offset: 1 }, { label: '纽约', offset: -4 }
  ]});
  // 底部图标导航
  LubanUI.decor.iconNav('bottomNav', [
    { icon: 'dashboard', label: '数据名称', active: true },
    { icon: 'shield', label: '数据名称' },
    { icon: 'database', label: '数据名称' },
    { icon: 'alert', label: '数据名称' }
  ]);
  // 中央 3D 地图（echarts-gl 已内置；真实卫星影像改用 LubanUI.gis('mapChart', { style:'satellite', ... })）
  LubanUI.loadChinaMap(function() {
    LubanUI.map3d('mapChart', {
      mapType: 'china', regionHeight: 3, showLabels: true,
      markers: [{ name: '北京', lng: 116.4, lat: 39.9, color: LubanUI.screenPalette.orange }]
    });
  });
  loadStats();
}

function loadStats() {
  DataQuery.${readName}({}).then(function(result) {
    var rows = result.rows || [];
    if (rows.length === 0) return;
    // TODO: 按 result.columns 中的真实列名填充本骨架，配色统一取 LubanUI.screenPalette：
    // 1) KPI：LubanUI.countUp('kpi1', 值, { separator: true }) + LubanUI.chartPresets.spark('kpi1Spark', { data: 趋势数组, type: 'bar' })
    // 2) 左右面板：LubanUI.chartPresets.combo / barGlow / lineGlow / pieGlow / gauge / radar 初始化
    //    柱状渐变 color 用 LubanUI.screenPalette.barGradient()，面积图 areaStyle 用 areaGradient()
    // 3) 中央地图：GIS 卫星影像 LubanUI.gis('mapChart', { style: 'satellite', center: [lng,lat], zoom: 7, markers: [...], lines: [...] })
  }).catch(function() {
    LubanUI.toast.error('数据加载失败');
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
          msg += `1. 按需求分析第 4 章核对区块构成：骨架的 4KPI+三栏+中央地图只是示例排布，模块不同就用 decor.panel 重新组织布局\n`;
          msg += `2. 画布比例不是 16:9 时（超宽/竖屏/拼接屏），栅格必须按画布比例重新设计（超宽多列横排、竖屏纵向堆叠），并按画布大小配 setDensity（4K+ 优先 large，高密度小画布优先 compact）\n`;
          msg += `3. 用 LubanUI.countUp 填充 KPI，配 chartPresets.spark 迷你趋势\n`;
          msg += `4. 初始化各面板图表（chartPresets 或 LubanUI.chart + LubanUI.screenPalette 配色）\n`;
          msg += `5. 中央地图：默认已有 3D 中国地图，需要真实地理时改用 LubanUI.gis\n`;
          msg += `6. 完善 loadStats 数据映射，禁止留空面板（校验会拦截未初始化的图表容器）\n`;
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

  'code:component-spec': (_ctx) => ({
    id: 'code:component-spec',
    category: SkillCategory.CODE,
    name: 'get_component_spec',
    description: `按需获取 LubanUI 组件的详细用法。创建/修改页面时调用此工具获取所需组件的 API、HTML 结构和 JS 用法，避免猜测组件用法。不传 components 参数则返回组件目录。`,
    parameters: {
      type: 'object',
      properties: {
        components: {
          type: 'array',
          items: { type: 'string' },
          description: '组件名列表，如 ["Table", "Modal", "Toast"]。不传则返回组件目录',
        },
      },
    },
    async execute(args): Promise<ToolExecuteResult> {
      const names = (args.components as string[] | undefined) || [];
      if (names.length === 0) {
        return { success: true, message: getComponentCatalog() };
      }
      return { success: true, message: getComponentSpecByName(names) };
    },
  }),

  'code:analysis-examples': (_ctx) => ({
    id: 'code:analysis-examples',
    category: SkillCategory.CODE,
    name: 'get_analysis_examples',
    description: `获取需求分析报告的完整示例（客户管理页面、监控大屏、审批流程），包含 8 章节格式和 submit_analysis 参数。L4 新建页面时建议先查看示例再写分析报告。`,
    parameters: { type: 'object', properties: {} },
    async execute(): Promise<ToolExecuteResult> {
      return { success: true, message: getAnalysisExamples() };
    },
  }),

  'code:dataquery-guide': (_ctx) => ({
    id: 'code:dataquery-guide',
    category: SkillCategory.CODE,
    name: 'get_dataquery_guide',
    description: `获取 DataQuery 完整使用指南，包含读/写操作示例、禁止用法和常见错误修复。写页面代码前建议先查看。`,
    parameters: { type: 'object', properties: {} },
    async execute(): Promise<ToolExecuteResult> {
      return { success: true, message: getDataQueryGuide() };
    },
  }),
};