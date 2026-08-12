import type { ToolDefinition, ToolContext } from '@/types/agent';
import { createCodePage, getCodePage, updateCodePage } from '@/api';

export function createCodePageTools(context: ToolContext): ToolDefinition[] {
  return [
    {
      name: 'create_code_page',
      description: `创建一个新的代码页面，包含 HTML/CSS/JS 代码。支持引入外部 CDN 库。

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
按钮必须使用 onclick 属性绑定 JS 函数，并在 JS 中定义对应的函数：
  <!-- HTML: 按钮绑定 -->
  <button class="btn" onclick="handleSave()">保存</button>

  // JS: 定义函数
  function handleSave() {
    QueryName.run({ name: document.getElementById('nameInput').value }).then(function(res) {
      alert('保存成功');
    });
  }

## 平台内置能力
- 当前登录用户信息：window.__LUBAN_USER__ = { id, name, email }
- 页面跳转：window.__LUBAN__.navigateToPage(pageId) 跳转到指定页面
- 页面跳转：window.__LUBAN__.navigateToPageByName('页面名称') 按名称跳转`,
      category: 'code',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '页面名称' },
          html: { type: 'string', description: 'HTML 代码' },
          css: { type: 'string', description: 'CSS 样式代码' },
          js: { type: 'string', description: 'JavaScript 代码' },
          libraries: {
            type: 'array',
            items: { type: 'string' },
            description: 'CDN 库 URL 列表，如 ["https://cdn.jsdelivr.net/npm/chart.js"]',
          },
          queryIds: {
            type: 'array',
            items: { type: 'number' },
            description: '关联的查询 ID 列表',
          },
        },
        required: ['name'],
      },
      async execute(args) {
        try {
          const res = await createCodePage({
            applicationId: context.applicationId,
            name: args.name as string,
            html: args.html as string | undefined,
            css: args.css as string | undefined,
            js: args.js as string | undefined,
            libraries: (args.libraries as string[]) || [],
            queryIds: (args.queryIds as number[]) || [],
          });
          context.onPagesChange?.();
          context.onPageChange?.(res.data.id);
          return {
            success: true,
            message: `代码页面 "${args.name}" 创建成功`,
            data: res.data,
          };
        } catch (e) {
          return { success: false, message: `创建代码页面失败: ${(e as Error).message}` };
        }
      },
    },
    {
      name: 'get_code_page',
      description: '获取指定页面的完整代码（HTML/CSS/JS），用于增量修改。',
      category: 'code',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'number', description: '页面 ID' },
        },
        required: ['pageId'],
      },
      async execute(args) {
        try {
          const pageId = (args.pageId as number) || context.pageId;
          const res = await getCodePage(pageId);
          return {
            success: true,
            message: '获取页面代码成功',
            data: res.data,
          };
        } catch (e) {
          return { success: false, message: `获取页面代码失败: ${(e as Error).message}` };
        }
      },
    },
    {
      name: 'update_code_page',
      description: '更新页面的代码。只传入需要修改的字段，未传入的字段保持不变。',
      category: 'code',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'number', description: '页面 ID' },
          html: { type: 'string', description: '更新的 HTML 代码' },
          css: { type: 'string', description: '更新的 CSS 代码' },
          js: { type: 'string', description: '更新的 JavaScript 代码' },
          libraries: {
            type: 'array',
            items: { type: 'string' },
            description: '更新的 CDN 库列表',
          },
          queryIds: {
            type: 'array',
            items: { type: 'number' },
            description: '更新的关联查询 ID 列表',
          },
        },
        required: ['pageId'],
      },
      async execute(args) {
        try {
          const pageId = (args.pageId as number) || context.pageId;
          const res = await updateCodePage(pageId, {
            html: args.html as string | undefined,
            css: args.css as string | undefined,
            js: args.js as string | undefined,
            libraries: (args.libraries as string[]) || undefined,
            queryIds: (args.queryIds as number[]) || undefined,
          });
          context.onPageChange?.(pageId);
          return {
            success: true,
            message: '页面代码更新成功',
            data: res.data,
          };
        } catch (e) {
          return { success: false, message: `更新页面代码失败: ${(e as Error).message}` };
        }
      },
    },
  ];
}

export function getCodePageSkillSummary(): string {
  return `## 代码页面
- HTML/CSS/JS 使用纯原生技术，不依赖任何框架
- 使用 CSS Grid/Flexbox 布局，响应式设计，支持手机/平板/桌面
- 外部库通过 CDN 引入，在创建页面时指定 libraries 参数
- 页面中使用 {{ QueryName.data }} 绑定查询结果
- 调用查询使用 QueryName.run({ 参数 }) 返回 Promise，结果结构 { columns, rows, totalCount }
- 按钮点击事件必须使用 onclick="函数名()" 属性，并在 JS 中定义对应函数
- 修改页面前先调用 get_code_page 获取完整代码，增量修改
- 平台注入 window.__LUBAN_USER__ = { id, name, email } 获取当前登录用户
- 平台注入 window.__LUBAN__.navigateToPage(pageId) 实现页面跳转`;
}