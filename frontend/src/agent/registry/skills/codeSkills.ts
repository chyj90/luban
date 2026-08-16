import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { createCodePage, getCodePage, updateCodePage } from '@/api';

const CODE_PAGE_DESCRIPTION = `创建一个新的代码页面，包含 HTML/CSS/JS 代码。支持引入外部 CDN 库。

## CDN 库
通过 libraries 参数传入 CDN URL 数组，脚本会自动注入到页面 <head> 中，在用户 JS 之前加载：
  libraries: ["https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"]

## 查询绑定
页面中通过 {{ QueryName.data }} 在 HTML 中展示查询结果，通过 QueryName.run({ param }) 在 JS 中调用查询：
  <!-- HTML: 直接绑定查询结果 -->
  <div id="list">{{ GetUsers.data }}</div>

  // JS: 调用查询并处理结果
  GetUsers.run({ name: '张三' }).then(function(res) {
    // res = { columns: ['id','name'], rows: [['1','张三']], totalCount: 1 }
    document.getElementById('list').textContent = JSON.stringify(res.rows);
  });

## 事件处理（必须）
按钮必须使用 onclick 属性绑定 JS 函数，并在 JS 中定义对应的函数。

## 平台内置能力
- 当前登录用户信息：window.__LUBAN_USER__ = { id, name, email }
- 页面跳转：window.__LUBAN__.navigateToPage(pageId)
- 页面跳转：window.__LUBAN__.navigateToPageByName('页面名称')`;

export const codeSkills: Record<string, SkillFactory> = {
  'code:create': (ctx) => ({
    id: 'code:create',
    category: SkillCategory.CODE,
    name: 'create_code_page',
    description: CODE_PAGE_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '页面名称' },
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
        const res = await createCodePage({
          applicationId: ctx.applicationId,
          name: args.name as string,
          html: args.html as string | undefined,
          css: args.css as string | undefined,
          js: args.js as string | undefined,
          libraries: (args.libraries as string[]) || [],
          queryIds: (args.queryIds as number[]) || [],
        });
        ctx.onPagesChange?.();
        ctx.onPageChange?.(res.data.id);
        return { success: true, message: `代码页面 "${args.name}" 创建成功`, data: res.data };
      } catch (e) {
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
      } catch (e) {
        return { success: false, message: `获取页面代码失败: ${(e as Error).message}` };
      }
    },
  }),

  'code:update': (ctx) => ({
    id: 'code:update',
    category: SkillCategory.CODE,
    name: 'update_code_page',
    description: `更新代码页面的代码。支持增量修改（传入 changes）或全量替换（传入 html/css/js）。
增量修改时，每项变更包含 action（replace/insert_before/insert_after/delete）和对应参数。`,
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

        const res = await updateCodePage(pageId, {
          html,
          css,
          js,
          libraries: (args.libraries as string[]) || [],
          queryIds: (args.queryIds as number[]) || [],
        });
        ctx.onPageChange?.(pageId);
        return { success: true, message: '页面代码更新成功', data: res.data };
      } catch (e) {
        return { success: false, message: `更新代码失败: ${(e as Error).message}` };
      }
    },
  }),
};