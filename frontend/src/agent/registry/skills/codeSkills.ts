import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { createCodePage, getCodePage, updateCodePage, runQuery, listAppTools, runAppTool } from '@/api';
import { validateCode, type QueryRunResult, type ApiRunResult } from './codeValidate';

function extractQueryNamesFromJS(js: string): string[] {
  const names = new Set<string>();
  const runPattern = /(\w+)\.run\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = runPattern.exec(js)) !== null) {
    names.add(match[1]);
  }
  return [...names];
}

function extractApiNamesFromJS(js: string): string[] {
  const names = new Set<string>();
  const callPattern = /(\w+)\.call\s*\(/g;
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
    const appToolsRes = await listAppTools(applicationId);
    const appTools = (appToolsRes.data || []) as Array<{ id: number; name: string }>;

    for (const name of apiNames) {
      const tool = appTools.find((t) => t.name === name);
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
## 页面已存在时用 update_code_page，新建用 create_code_page`,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '【必填】页面名称，如"订单管理"。不填会导致 HTTP 400 错误' },
        html: { type: 'string', description: 'HTML 代码' },
        css: { type: 'string', description: 'CSS 样式代码' },
        js: { type: 'string', description: 'JavaScript 代码' },
        libraries: { type: 'array', items: { type: 'string' }, description: 'CDN 库 URL 列表' },
        queryIds: { type: 'array', items: { type: 'number' }, description: '关联的查询 ID 列表' },
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
          applicationId: ctx.applicationId,
          queryResults,
          apiResults,
        });
        if (!validation.valid) {
          return { success: false, message: `代码语法校验不通过，请修正后重试（只修正报错部分，其余代码保持不变）：\n${validation.errors.join('\n')}` };
        }
        if (validation.warnings.length > 0) {
          console.warn('[code:create]', validation.warnings.join('\n'));
        }

        const res = await createCodePage({
          applicationId: ctx.applicationId,
          name,
          html,
          css,
          js,
          libraries: (args.libraries as string[]) || [],
          queryIds: (args.queryIds as number[]) || [],
        });
        ctx.onPagesChange?.();
        ctx.onPageChange?.(res.data.id);
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
## pageId 为必填参数`,
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

        if (changes && changes.length > 0) {
          const current = await getCodePage(pageId);
          const code = current.data.codePage;
          html = code.html ?? '';
          css = code.css ?? '';
          js = code.js ?? '';

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

        const [queryResults, apiResults] = await Promise.all([
          queryNames.length > 0 ? runPageQueries(queryNames, ctx.applicationId) : Promise.resolve([]),
          apiNames.length > 0 ? runPageApis(apiNames, ctx.applicationId) : Promise.resolve([]),
        ]);

        const validation = await validateCode(html, css, js, {
          queryIds: (args.queryIds as number[]) || [],
          applicationId: ctx.applicationId,
          queryResults,
          apiResults,
        });
        if (!validation.valid) {
          return { success: false, message: `代码语法校验不通过，请修正后重试（只修正报错部分，其余代码保持不变）：\n${validation.errors.join('\n')}` };
        }
        if (validation.warnings.length > 0) {
          console.warn('[code:update]', validation.warnings.join('\n'));
        }

        const res = await updateCodePage(pageId, {
          html,
          css,
          js,
          libraries: (args.libraries as string[]) || [],
          queryIds: (args.queryIds as number[]) || [],
        });
        ctx.onPageChange?.(pageId);
        return { success: true, message: '页面代码更新成功', data: res.data };
      } catch (e: any) {
        return { success: false, message: `更新代码失败: ${(e as Error).message}` };
      }
    },
  }),
};