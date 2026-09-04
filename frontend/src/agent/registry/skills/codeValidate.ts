import { parse as acornParse } from 'acorn';
import { listQueries } from '@/api/query';
import { LIBRARY_RULES } from './libraryRules';

interface QueryInfo {
  id: number;
  name: string;
  body: string;
  params: Record<string, unknown>;
}

export interface QueryRunResult {
  queryName: string;
  columns: string[];
  sampleRow?: Record<string, unknown>;
  totalCount?: number;
}

export interface ApiRunResult {
  apiName: string;
  status: number;
  body: unknown;
}

export interface ValidateResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ValidateFieldNamesOptions {
  js?: string;
  queryIds?: number[];
  toolIds?: number[];
  applicationId: number;
  queryResults?: QueryRunResult[];
  apiResults?: ApiRunResult[];
}

export async function validateCode(
  html?: string,
  css?: string,
  js?: string,
  validateOptions?: ValidateFieldNamesOptions,
): Promise<ValidateResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try { if (html) validateHtml(html, errors, warnings); } catch (e: any) { errors.push(`[HTML] 校验器异常: ${e?.message || e}`); }
  try { if (css) validateCss(css, errors, warnings); } catch (e: any) { errors.push(`[CSS] 校验器异常: ${e?.message || e}`); }
  try { if (js) validateJs(js, errors, warnings); } catch (e: any) { errors.push(`[JS] 校验器异常: ${e?.message || e}`); }
  try { if (js) validateDomInit(js, errors); } catch (e: any) { errors.push(`[DOM初始化] 校验异常: ${e?.message || e}`); }
  try { if (js) validateCrossPageParams(js, errors, warnings); } catch (e: any) { errors.push(`[跨页面参数校验] 异常: ${e?.message || e}`); }
  try { if (js && validateOptions) await validateMockData(js, validateOptions, errors); } catch (e: any) { errors.push(`[Mock数据] 校验异常: ${e?.message || e}`); }
  try { if (js && validateOptions) await validateFieldNames(js, validateOptions, errors, warnings); } catch (e: any) { errors.push(`[字段校验] 异常: ${e?.message || e}`); }
  try { if (html || js) validateLubanUIUsage(html, js, errors, warnings); } catch (e: any) { errors.push(`[LubanUI] 校验异常: ${e?.message || e}`); }
  try { if (js) validateTableEmptyState(js, warnings); } catch (e: any) { errors.push(`[表格空态] 校验异常: ${e?.message || e}`); }
  try { if (css) validateCssComponentOverride(css, errors); } catch (e: any) { errors.push(`[CSS组件覆盖] 校验异常: ${e?.message || e}`); }
  try { if (html && js) validateFormContainer(html, js, errors); } catch (e: any) { errors.push(`[表单容器] 校验异常: ${e?.message || e}`); }

  return { valid: errors.length === 0, errors, warnings };
}

function validateHtml(code: string, errors: string[], warnings: string[]) {
  const lines = code.split('\n');

  // 检查 Vue 指令（页面是纯原生 HTML，不允许 Vue 语法）
  const vueDirectives = [
    { pattern: /\bv-for\b[=:]/g, name: 'v-for' },
    { pattern: /\bv-if\b[=:]/g, name: 'v-if' },
    { pattern: /\bv-else-if\b[=:]/g, name: 'v-else-if' },
    { pattern: /\bv-else\b/g, name: 'v-else' },
    { pattern: /\bv-show\b[=:]/g, name: 'v-show' },
    { pattern: /\bv-bind\b[=:]/g, name: 'v-bind' },
    { pattern: /\bv-model\b[=:]/g, name: 'v-model' },
    { pattern: /\bv-on\b[=:]/g, name: 'v-on' },
    { pattern: /\bv-html\b[=:]/g, name: 'v-html' },
    { pattern: /\bv-text\b[=:]/g, name: 'v-text' },
    { pattern: /\bv-cloak\b/g, name: 'v-cloak' },
    { pattern: /\bv-once\b/g, name: 'v-once' },
    { pattern: /\bv-pre\b/g, name: 'v-pre' },
    { pattern: /@click\b/g, name: '@click' },
    { pattern: /@change\b/g, name: '@change' },
    { pattern: /@input\b/g, name: '@input' },
    { pattern: /@submit\b/g, name: '@submit' },
    { pattern: /:[a-z-]+="[^"]*"/g, name: 'v-bind 简写（:prop="..."）' },
  ];

  for (const { pattern, name } of vueDirectives) {
    const matchedLines: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        matchedLines.push(i + 1);
        pattern.lastIndex = 0; // 重置正则状态
      }
    }
    if (matchedLines.length > 0) {
      const locations = matchedLines.slice(0, 3).map((l) => `第 ${l} 行`).join('、');
      errors.push(
        `[HTML] 第 ${matchedLines[0]} 行：禁止使用 Vue 语法「${name}」（共 ${matchedLines.length} 处，${locations}）。` +
        '页面是纯原生 HTML，请使用 onclick 属性绑定事件，用 DOM API 操作节点。'
      );
      break; // 只报第一个指令类型，避免刷屏
    }
  }

  // 检测 {{ }} 模板语法（非 QueryName.data 格式）
  // 合法：{{ GetOrders.data }}、{{ GetOrders.data.totalCount }}
  // 非法：{{ order[0] }}、{{ item.name }}、{{ someVar }}
  const templateRegex = /\{\{[^}]*\}\}/g;
  let match: RegExpExecArray | null;
  const invalidTemplates: { content: string; line: number }[] = [];
  while ((match = templateRegex.exec(code)) !== null) {
    const inner = match[0].replace(/^\{\{|\}\}$/g, '').trim();
    if (!/^[A-Z]\w*\.data(\.\w+)?$/.test(inner)) {
      const lineNum = code.substring(0, match.index).split('\n').length;
      invalidTemplates.push({ content: match[0], line: lineNum });
    }
  }
  if (invalidTemplates.length > 0) {
    const sample = invalidTemplates.slice(0, 3).map((t) => `第 ${t.line} 行「${t.content}」`).join('、');
    errors.push(
      `[HTML] 第 ${invalidTemplates[0].line} 行：非法的模板语法（${sample}）。` +
      'HTML 中只支持 {{ QueryName.data }} 绑定查询结果，不支持 Vue 插值语法。'
    );
  }

  // 使用 DOMParser 检查 HTML 结构
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${code}</div>`, 'text/html');

  const parseErrors = doc.querySelectorAll('parsererror');
  parseErrors.forEach((el) => {
    errors.push(`[HTML] ${el.textContent?.replace(/\n\s*/g, ' ').trim()}`);
  });
}

function validateCss(code: string, errors: string[], warnings: string[]) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(code);
  } catch (e) {
    const msg = (e as Error).message;
    // 提取关键错误信息
    const lines = code.split('\n');
    const match = msg.match(/at (\d+):(\d+)/);
    if (match) {
      const lineNum = parseInt(match[1], 10);
      const colNum = parseInt(match[2], 10);
      const context = lines[lineNum] ? `\n  ${lines[lineNum].trim()}` : '';
      errors.push(`[CSS] 第 ${lineNum} 行第 ${colNum} 列: ${msg.split('at')[0].trim()}${context}`);
    } else {
      errors.push(`[CSS] ${msg}`);
    }
  }
}

function validateJs(code: string, errors: string[], warnings: string[]) {
  try {
    acornParse(code, { ecmaVersion: 2022, sourceType: 'script' });
  } catch (e: any) {
    // acorn 错误格式：SyntaxError: message (line:col)
    const msg: string = e.message || '';
    const lines = code.split('\n');
    const match = msg.match(/\((\d+):(\d+)\)/);
    if (match) {
      const lineNum = parseInt(match[1], 10);
      const colNum = parseInt(match[2], 10);
      const context = lines[lineNum - 1] ? `\n  ${lines[lineNum - 1].trim()}` : '';
      errors.push(`[JS] 第 ${lineNum} 行第 ${colNum} 列: ${msg.replace(/\s*\(\d+:\d+\)/, '').trim()}${context}`);
    } else {
      errors.push(`[JS] ${msg}`);
    }
  }

  // 检查查询结果访问模式：查询返回 {columns, rows, totalCount}，数据在 rows 数组中
  // 错误：c[0].field、c[i].field、c.length
  // 正确：c.rows[0].field、c.rows[i].field、c.rows.length
  const thenVars = new Set<string>();
  const thenFnPattern = /\.then\s*\(\s*function\s*\(\s*(\w+)\s*\)/g;
  const thenArrowPattern = /\.then\s*\(\s*\(?\s*(\w+)\s*\)?\s*=>/g;
  let m: RegExpExecArray | null;
  while ((m = thenFnPattern.exec(code)) !== null) { thenVars.add(m[1]); }
  while ((m = thenArrowPattern.exec(code)) !== null) { thenVars.add(m[1]); }

  for (const varName of thenVars) {
    const correctAccess = new RegExp('\\b' + varName + '\\.rows\\[');
    if (correctAccess.test(code)) continue; // 正确用法，跳过

    const directAccess = new RegExp('\\b' + varName + '\\[\\d+\\]');
    const varAccess = new RegExp('\\b' + varName + '\\[[a-zA-Z_\\$]\\w*\\]');
    const lenAccess = new RegExp('\\b' + varName + '\\.length\\b');

    const hasDirectAccess = directAccess.test(code);
    const hasVarAccess = varAccess.test(code);
    const hasLenAccess = lenAccess.test(code);

    if (hasDirectAccess || hasVarAccess || hasLenAccess) {
      const searchPatterns = [directAccess, varAccess, lenAccess];
      let firstIdx = Infinity;
      for (const p of searchPatterns) {
        p.lastIndex = 0;
        const r = p.exec(code);
        if (r && r.index < firstIdx) firstIdx = r.index;
      }
      const lineNum = code.substring(0, firstIdx).split('\n').length;
      errors.push(
        `[JS] 第 ${lineNum} 行：查询结果 \`${varName}\` 是对象 {columns, rows, totalCount}，` +
        `数据在 \`${varName}.rows\` 数组里。` +
        `请将 \`${varName}[0]\` 改为 \`${varName}.rows[0]\`，` +
        `\`${varName}.length\` 改为 \`${varName}.rows.length\`。`
      );
    }
  }

  // 检查常见问题：使用数组索引访问查询结果
  const rowIndexMatch = /row\[\d+\]/g;
  let idxMatch: RegExpExecArray | null;
  while ((idxMatch = rowIndexMatch.exec(code)) !== null) {
    const lineNum = code.substring(0, idxMatch.index).split('\n').length;
    warnings.push(
      `[JS] 第 ${lineNum} 行：检测到 \`${idxMatch[0]}\` 数组索引取值。` +
      '查询返回的 rows 是对象数组，请使用字段名访问（如 row.order_no），不要用索引。'
    );
  }

  // 检查 __LUBAN__ API 调用：只允许文档中列出的方法
  const VALID_LUBAN_METHODS = new Set([
    'navigateToPage', 'navigateToPageByName', 'getPageParams', 'getAllPages', 'callApi', 'startWorkflow',
  ]);
  const lubanApiPattern = /window\.__LUBAN__\.(\w+)\s*\(/g;
  let lubanMatch: RegExpExecArray | null;
  while ((lubanMatch = lubanApiPattern.exec(code)) !== null) {
    const methodName = lubanMatch[1];
    if (!VALID_LUBAN_METHODS.has(methodName)) {
      const lineNum = code.substring(0, lubanMatch.index).split('\n').length;
      const validList = [...VALID_LUBAN_METHODS].join('、');
      errors.push(
        `[JS] 第 ${lineNum} 行：\`window.__LUBAN__.${methodName}()\` 不存在。` +
        `可用方法：${validList}。请使用 navigateToPageByName 按名称跳转，或 getAllPages 获取页面列表。`
      );
    }
  }

  // 检查第三方库使用规范
  if (/new\s+Chart\s*\(/.test(code)) {
    const hasDestroy = /\.destroy\s*\(\s*\)/.test(code);
    const destroyIdx = code.search(/\.destroy\s*\(\s*\)/);
    const hasNullifyAfterDestroy = destroyIdx >= 0 && /=\s*null\s*;/.test(code.substring(destroyIdx));
    if (!hasDestroy || !hasNullifyAfterDestroy) {
      const lineNum = code.substring(0, code.search(/new\s+Chart\s*\(/)).split('\n').length;
      errors.push(
        `[JS] 第 ${lineNum} 行：${LIBRARY_RULES['chart.js']}`
      );
    }
  }

  // 检查 addEventListener 缺少 { once: true }，SPA 中会导致多次初始化
  const loadListenerMatch = /addEventListener\s*\(\s*['"](?:load|DOMContentLoaded)['"]/g;
  if (loadListenerMatch.test(code) && !/\{\s*once\s*:\s*true\s*\}/.test(code)) {
    const lineNum = code.substring(0, code.search(/addEventListener\s*\(\s*['"](?:load|DOMContentLoaded)['"]/)).split('\n').length;
    warnings.push(
      `[JS] 第 ${lineNum} 行：addEventListener 在 SPA 中可能多次触发，` +
      `请使用 addEventListener('load', fn, { once: true }) 确保只执行一次。`
    );
  }
}

function validateDomInit(js: string, errors: string[]) {
  const hasDOMContentLoaded = /addEventListener\s*\(\s*['"](?:load|DOMContentLoaded)['"]/.test(js);
  if (!hasDOMContentLoaded) return;

  const hasReadyState = /document\.readyState\s*===?\s*['"]loading['"]/.test(js);
  if (hasReadyState) return;

  const lineNum = js.substring(0, js.search(/addEventListener\s*\(\s*['"](?:load|DOMContentLoaded)['"]/)).split('\n').length;
  errors.push(
    `[JS 初始化] 第 ${lineNum} 行：使用 addEventListener('DOMContentLoaded', ...) 但缺少 readyState 兼容处理。` +
    '平台在 about:srcdoc 中注入 JS 时 DOMContentLoaded 可能已触发，导致回调中 DOM 元素为 null。' +
    '请改用以下模式：\n' +
    'function init() { /* 原有初始化逻辑 */ }\n' +
    'if (document.readyState === \'loading\') {\n' +
    '  document.addEventListener(\'DOMContentLoaded\', init, { once: true });\n' +
    '} else {\n' +
    '  init();\n' +
    '}'
  );
}

async function validateMockData(
  js: string,
  options: ValidateFieldNamesOptions,
  errors: string[],
) {
  const { queryIds, toolIds } = options;
  const hasQueryIds = queryIds && queryIds.length > 0;
  const hasToolIds = toolIds && toolIds.length > 0;

  if (hasQueryIds || hasToolIds) return;

  const hasArrayIteration = /(?:forEach|map|filter|reduce)\s*\(/.test(js);
  if (!hasArrayIteration) return;

  const hasMathRandom = /Math\.random\s*\(\s*\)/.test(js);
  const hasSimulatedAsync = /setTimeout\s*\([^)]*,\s*\d+\s*\)/.test(js);

  let mockPattern = '';
  let details = '';

  if (hasMathRandom && hasSimulatedAsync) {
    mockPattern = 'Math.random() 和 setTimeout 模拟数据';
    details = '检测到 Math.random() 生成随机数据和 setTimeout 模拟异步数据返回。';
  } else if (hasMathRandom) {
    mockPattern = 'Math.random() 模拟数据';
    details = '检测到 Math.random() 生成随机数据。';
  } else if (hasSimulatedAsync) {
    mockPattern = 'setTimeout 模拟异步数据';
    details = '检测到 setTimeout 模拟异步数据返回。';
  }

  if (mockPattern) {
    const lineNum = js.substring(0, js.search(/Math\.random|setTimeout/)).split('\n').length;
    errors.push(
      `[JS Mock数据] 第 ${lineNum} 行：页面未绑定任何数据源（queryIds 和 toolIds 均为空），` +
      `但检测到 ${mockPattern}。${details}` +
      '禁止使用 mock 数据创建页面。请先确认数据来源（查询或 API），绑定后再创建页面。'
    );
  }
}

async function validateFieldNames(
  js: string,
  options: ValidateFieldNamesOptions,
  errors: string[],
  warnings: string[],
) {
  const { queryIds, applicationId, queryResults } = options;
  if (!js) return;

  let queries: QueryInfo[] = [];

  if (queryIds && queryIds.length > 0) {
    queries = await fetchQueriesByIds(queryIds, applicationId);
  }

  if (queries.length === 0) {
    const queryNames = extractQueryNamesFromJS(js);
    if (queryNames.length > 0) {
      queries = await fetchQueriesByNames(queryNames, applicationId);
    }
  }

  if (queries.length === 0 && (!queryResults || queryResults.length === 0)) return;

  const allFieldNames = new Set<string>();
  const queryFieldMap = new Map<string, Set<string>>();

  if (queryResults && queryResults.length > 0) {
    for (const qr of queryResults) {
      const fields = new Set(qr.columns);
      queryFieldMap.set(qr.queryName, fields);
      qr.columns.forEach((f) => allFieldNames.add(f));
    }
  } else {
    for (const q of queries) {
      const fields = extractFieldNamesFromSQL(q.body);
      const fieldSet = new Set(fields);
      queryFieldMap.set(q.name, fieldSet);
      fields.forEach((f) => allFieldNames.add(f));
    }
  }

  if (allFieldNames.size > 0) {
    const mismatches = findFieldNameMismatches(js, allFieldNames);
    if (mismatches.length > 0) {
      const details = mismatches.slice(0, 5).map((m) =>
        `第 ${m.line} 行：使用了 \`${m.used}\`，应改为 \`${m.expected}\``
      ).join('；');

      const structInfo = buildStructureInfo(queryResults, queryFieldMap);
      errors.push(
        `[JS 字段名] 代码中使用了驼峰命名的字段名，但查询返回的是下划线命名。` +
        `请将以下字段名改为下划线格式：${details}` +
        (mismatches.length > 5 ? `（共 ${mismatches.length} 处，仅展示前 5 处）` : '') +
        structInfo
      );
    }

    const knownQueryNames = queryResults
      ? queryResults.map((qr) => qr.queryName)
      : queries.map((q) => q.name);
    const unknownFields = findUnknownFieldNames(js, allFieldNames, knownQueryNames);
    if (unknownFields.length > 0) {
      const fieldList = [...allFieldNames].join('、');

      const chineseFields = unknownFields.filter((f) => /[\u4e00-\u9fff]/.test(f.used));
      const nonChineseFields = unknownFields.filter((f) => !/[\u4e00-\u9fff]/.test(f.used));

      if (chineseFields.length > 0) {
        const details = chineseFields.slice(0, 5).map((f) =>
          `第 ${f.line} 行：\`${f.used}\``
        ).join('、');
        const structInfo = buildStructureInfo(queryResults, queryFieldMap);
        errors.push(
          `[JS 字段名] 代码中使用了中文字段名，但查询返回的是英文字段名。` +
          `可用字段：${fieldList}。` +
          `错误字段：${details}。` +
          `请使用英文字段名（如 row.order_no 而非 row.订单号）` +
          (chineseFields.length > 5 ? `（共 ${chineseFields.length} 处，仅展示前 5 处）` : '') +
          structInfo
        );
      }

      if (nonChineseFields.length > 0) {
        const details = nonChineseFields.slice(0, 5).map((f) =>
          `第 ${f.line} 行：\`${f.used}\`${f.suggestion ? `（是否指 \`${f.suggestion}\`？）` : ''}`
        ).join('；');
        const structInfo = buildStructureInfo(queryResults, queryFieldMap);
        errors.push(
          `[JS 字段名] 代码中使用了查询不存在的字段。可用字段：${fieldList}。` +
          `错误字段：${details}` +
          (nonChineseFields.length > 5 ? `（共 ${nonChineseFields.length} 处，仅展示前 5 处）` : '') +
          structInfo
        );
      }
    }
  }

  validateQueryParameterNames(js, queries, errors);

  validateApiCalls(js, options.apiResults, errors);
}

function buildStructureInfo(
  queryResults: QueryRunResult[] | undefined,
  queryFieldMap: Map<string, Set<string>>,
): string {
  if (!queryResults || queryResults.length === 0) return '';

  const parts: string[] = [];
  for (const qr of queryResults) {
    const fields = queryFieldMap.get(qr.queryName);
    const fieldList = fields ? [...fields].join(', ') : qr.columns.join(', ');
    let part = `\n  ${qr.queryName}.run() 返回 {columns, rows, totalCount}，数据在 rows 数组中`;
    part += `\n  ${qr.queryName} 可用字段：${fieldList}`;
    if (qr.totalCount !== undefined) {
      part += `\n  ${qr.queryName} 总行数：${qr.totalCount}`;
    }
    parts.push(part);
  }
  return '\n查询返回结构：' + parts.join('');
}

function extractQueryNamesFromJS(js: string): string[] {
  const names = new Set<string>();
  const runPattern = /(\w+)\.run\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = runPattern.exec(js)) !== null) {
    names.add(match[1]);
  }
  return [...names];
}

function fetchQueriesByIds(queryIds: number[], applicationId: number): Promise<QueryInfo[]> {
  return fetchAllQueries(applicationId).then((queries) =>
    queries.filter((q) => queryIds.includes(q.id))
  );
}

function fetchQueriesByNames(queryNames: string[], applicationId: number): Promise<QueryInfo[]> {
  return fetchAllQueries(applicationId).then((queries) =>
    queries.filter((q) => queryNames.includes(q.name))
  );
}

function fetchAllQueries(applicationId: number): Promise<QueryInfo[]> {
  return listQueries(applicationId)
    .then((res) => res.data || [])
    .catch((e) => {
      console.warn('[codeValidate] 获取查询列表失败，跳过字段名校验', e);
      return [];
    });
}

function validateQueryParameterNames(
  js: string,
  queries: QueryInfo[],
  errors: string[],
) {
  const queryMap = new Map<string, QueryInfo>();
  for (const q of queries) {
    queryMap.set(q.name, q);
  }

  const callPattern = /(\w+)\.run\s*\(\s*\{([^}]*)\}\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(js)) !== null) {
    const queryName = match[1];
    const paramsStr = match[2] || '';
    const query = queryMap.get(queryName);
    if (!query) continue;

    const jsParamNames = extractJSObjectKeys(paramsStr);

    const sqlParamNames = extractSQLParamNames(query.body);

    const unknownParams = jsParamNames.filter((p) => !sqlParamNames.has(p));
    if (unknownParams.length > 0) {
      const lineNum = js.substring(0, match.index).split('\n').length;
      const sqlParamList = sqlParamNames.size > 0
        ? [...sqlParamNames].join('、')
        : '无（查询不接受参数）';
      errors.push(
        `[JS 查询参数] 第 ${lineNum} 行：\`${queryName}.run()\` 传入了参数 \`${unknownParams.join('、')}\`，` +
        `但查询 SQL 中未定义该参数。SQL 中定义的参数：${sqlParamList}。` +
        `请检查 SQL 的 WHERE 条件是否使用了 \`{{ this.params.${unknownParams[0]} }}\` 格式的参数绑定`
      );
    }
  }
}

function extractJSObjectKeys(paramsStr: string): string[] {
  const keys: string[] = [];
  const keyPattern = /(\w+)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = keyPattern.exec(paramsStr)) !== null) {
    keys.push(match[1]);
  }
  return keys;
}

function extractSQLParamNames(sql: string): Set<string> {
  const names = new Set<string>();
  const paramPattern = /\{\{\s*this\.params\.(\w+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = paramPattern.exec(sql)) !== null) {
    names.add(match[1]);
  }
  return names;
}

function extractFieldNamesFromSQL(sql: string): string[] {
  const fields: string[] = [];

  const selectMatch = sql.match(/SELECT\s+(.*?)\s+FROM\s/is);
  if (!selectMatch) return fields;

  let selectClause = selectMatch[1];
  selectClause = selectClause.replace(/<[^>]+>/g, '');

  const parts = selectClause.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === '*') continue;

    const asMatch = trimmed.match(/^(.*?)\s+AS\s+(.+?)\s*$/i);
    if (asMatch) {
      const beforeAs = asMatch[1].trim();
      const alias = asMatch[2].trim();
      const isAliasChinese = /[\u4e00-\u9fff]/.test(alias);
      if (isAliasChinese) {
        const colMatch = beforeAs.match(/(\w+)$/);
        if (colMatch) {
          fields.push(colMatch[1]);
        }
      } else {
        const colMatch = beforeAs.match(/^(?:\w+\.)?(\w+)$/);
        if (colMatch && /^[a-zA-Z_]/.test(colMatch[1])) {
          fields.push(colMatch[1]);
        } else {
          fields.push(alias);
        }
      }
    } else {
      const colMatch = trimmed.match(/(\w+)$/);
      if (colMatch) {
        const name = colMatch[1];
        if (/^(COUNT|SUM|AVG|MAX|MIN|GROUP_CONCAT)\s*\(/i.test(trimmed)) continue;
        if (/\bCASE\b/i.test(trimmed)) continue;
        if (!/^(AS|DISTINCT|ALL|NULL|TRUE|FALSE|AND|OR|NOT|IN|IS|LIKE|BETWEEN|EXISTS|ASC|DESC|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|ON|WHERE|FROM|SELECT|INSERT|UPDATE|DELETE|SET|VALUES|INTO|CREATE|ALTER|DROP|TABLE|INDEX|VIEW|UNION|EXCEPT|INTERSECT)$/i.test(name)) {
          fields.push(name);
        }
      }
    }
  }

  return fields;
}

function snakeToCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function findFieldNameMismatches(
  js: string,
  actualFieldNames: Set<string>,
): { line: number; used: string; expected: string }[] {
  const mismatches: { line: number; used: string; expected: string }[] = [];

  const snakeToCamelMap = new Map<string, string>();
  const camelToSnakeMap = new Map<string, string>();
  for (const name of actualFieldNames) {
    if (name.includes('_')) {
      const camel = snakeToCamel(name);
      snakeToCamelMap.set(name, camel);
      camelToSnakeMap.set(camel, name);
    }
  }

  if (camelToSnakeMap.size === 0) return mismatches;

  const camelPattern = new RegExp(
    `\\.(${[...camelToSnakeMap.keys()].join('|')})\\b`,
    'g',
  );
  let match: RegExpExecArray | null;
  while ((match = camelPattern.exec(js)) !== null) {
    const camelName = match[1];
    const snakeName = camelToSnakeMap.get(camelName)!;

    if (js.includes(`.${snakeName}`)) {
      continue;
    }

    const lineNum = js.substring(0, match.index).split('\n').length;
    mismatches.push({ line: lineNum, used: camelName, expected: snakeName });
  }

  return mismatches;
}

let _builtins: Set<string> | null = null;

function validateCrossPageParams(js: string, errors: string[], warnings: string[]) {
  const navigateParams = new Set<string>();
  const getPageParamsAccess = new Set<string>();

  const navPattern = /navigateToPage(?:ByName)?\s*\(\s*(?:'[^']*'|"[^"]*"|\d+)\s*,\s*\{([^}]*)\}\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = navPattern.exec(js)) !== null) {
    const paramsStr = m[1];
    const keys = extractObjectKeys(paramsStr);
    keys.forEach((k) => navigateParams.add(k));
  }

  const getParamsVarPattern = /(?:const|let|var)\s+(\w+)\s*=\s*window\.__LUBAN__\.getPageParams\s*\(\s*\)/g;
  let gpm: RegExpExecArray | null;
  while ((gpm = getParamsVarPattern.exec(js)) !== null) {
    const varName = gpm[1];
    const accessPattern = new RegExp('\\b' + varName + '\\.(\\w+)', 'g');
    let am: RegExpExecArray | null;
    while ((am = accessPattern.exec(js)) !== null) {
      getPageParamsAccess.add(am[1]);
    }
  }

  const directAccessPattern = /window\.__LUBAN__\.getPageParams\s*\(\s*\)\.(\w+)/g;
  let dam: RegExpExecArray | null;
  while ((dam = directAccessPattern.exec(js)) !== null) {
    getPageParamsAccess.add(dam[1]);
  }

  if (getPageParamsAccess.size === 0 && navigateParams.size === 0) return;

  if (navigateParams.size > 0 && getPageParamsAccess.size > 0) {
    const missing = [...navigateParams].filter((p) => !getPageParamsAccess.has(p));
    const extra = [...getPageParamsAccess].filter((p) => !navigateParams.has(p));
    if (missing.length > 0 || extra.length > 0) {
      const msgs: string[] = [];
      if (missing.length > 0) {
        msgs.push(`navigateToPage 传了 ${missing.join('、')}，但 getPageParams 未使用`);
      }
      if (extra.length > 0) {
        msgs.push(`getPageParams 使用了 ${extra.join('、')}，但 navigateToPage 未传入`);
      }
      errors.push(`[跨页面参数] ${msgs.join('；')}。请确保参数名完全一致`);
    }
    return;
  }

  if (getPageParamsAccess.size > 0 && navigateParams.size === 0) {
    warnings.push(
      `[跨页面参数] 页面使用了 getPageParams() 获取参数 ${[...getPageParamsAccess].join('、')}，` +
      '请用 get_code_page 读取源页面代码，确认其 navigateToPage 传入了完全相同的 key'
    );
  }

  if (navigateParams.size > 0 && getPageParamsAccess.size === 0) {
    warnings.push(
      `[跨页面参数] 页面调用了 navigateToPage 传入参数 ${[...navigateParams].join('、')}，` +
      '请用 get_code_page 读取目标页面代码，确认其 getPageParams() 以相同 key 接收'
    );
  }
}

function extractObjectKeys(objStr: string): string[] {
  const keys: string[] = [];
  const keyPattern = /(\w+)\s*:/g;
  let km: RegExpExecArray | null;
  while ((km = keyPattern.exec(objStr)) !== null) {
    keys.push(km[1]);
  }
  return keys;
}

function getBuiltins(): Set<string> {
  if (_builtins) return _builtins;

  _builtins = new Set(Object.getOwnPropertyNames(Object.prototype));
  for (const name of Object.getOwnPropertyNames(Array.prototype)) {
    _builtins.add(name);
  }
  return _builtins;
}

function collectQueryDataVars(js: string): Set<string> {
  const queryDataVars = new Set<string>();
  const queryResultVars = new Set<string>();

  let ast: acorn.Node;
  try {
    ast = acornParse(js, { ecmaVersion: 2022, sourceType: 'script' }) as acorn.Node;
  } catch {
    return queryDataVars;
  }

  function isRunCall(node: any): boolean {
    return node?.type === 'CallExpression' &&
      node.callee?.type === 'MemberExpression' &&
      node.callee.property?.name === 'run';
  }

  function walk(node: any): void {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
      if (node.callee.property?.name === 'then' && isRunCall(node.callee.object)) {
        const callback = node.arguments[0];
        if (callback) {
          const paramName = getFirstParamName(callback);
          if (paramName) {
            queryResultVars.add(paramName);
          }
        }
      }
    }

    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      if (node.init) {
        if (node.init.type === 'AwaitExpression' && isRunCall(node.init.argument)) {
          queryResultVars.add(node.id.name);
        }
        if (node.init.type === 'MemberExpression' &&
            node.init.property?.name === 'rows' &&
            node.init.object?.type === 'Identifier' &&
            queryResultVars.has(node.init.object.name)) {
          queryDataVars.add(node.id.name);
        }
      }
    }

    if (node.type === 'AssignmentExpression' && node.left?.type === 'Identifier') {
      if (node.right?.type === 'AwaitExpression' && isRunCall(node.right.argument)) {
        queryResultVars.add(node.left.name);
      }
      if (node.right?.type === 'MemberExpression' &&
          node.right.property?.name === 'rows' &&
          node.right.object?.type === 'Identifier' &&
          queryResultVars.has(node.right.object.name)) {
        queryDataVars.add(node.left.name);
      }
    }

    for (const key of Object.keys(node)) {
      const child = (node as any)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object') walk(item);
        }
      } else if (child && typeof child === 'object' && child.type) {
        walk(child);
      }
    }
  }

  walk(ast);

  for (const v of queryResultVars) {
    queryDataVars.add(v);
  }

  return queryDataVars;
}

function findUnknownFieldNames(
  js: string,
  actualFieldNames: Set<string>,
  _queryNames: string[] = [],
): { line: number; used: string; suggestion?: string }[] {
  const unknownFields: { line: number; used: string; suggestion?: string }[] = [];

  const queryDataVars = collectQueryDataVars(js);
  const iterVars = collectAllIterParamNames(js, queryDataVars);
  if (iterVars.size === 0) return unknownFields;

  const varPattern = [...iterVars].join('|');
  const fieldPattern = new RegExp(
    `\\b(${varPattern})\\.([\\u4e00-\\u9fff\\w]+)\\b`,
    'g',
  );
  let match: RegExpExecArray | null;
  while ((match = fieldPattern.exec(js)) !== null) {
    const fieldName = match[2];

    if (actualFieldNames.has(fieldName)) continue;
    if (getBuiltins().has(fieldName)) continue;

    const exists = unknownFields.some((f) => f.used === fieldName);
    if (exists) continue;

    const isChinese = /[\u4e00-\u9fff]/.test(fieldName);

    let suggestion: string | undefined;
    if (isChinese) {
      suggestion = undefined;
    } else {
      for (const actual of actualFieldNames) {
        if (actual.toLowerCase() === fieldName.toLowerCase()) {
          suggestion = actual;
          break;
        }

        const normalizedUsed = fieldName.replace(/[_\s]/g, '').toLowerCase();
        const normalizedActual = actual.replace(/[_\s]/g, '').toLowerCase();
        if (normalizedUsed === normalizedActual) {
          suggestion = actual;
          break;
        }
      }
    }

    const lineNum = js.substring(0, match.index).split('\n').length;
    unknownFields.push({ line: lineNum, used: fieldName, suggestion });
  }

  return unknownFields;
}

function getRootIdentifier(node: any): string | null {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return getRootIdentifier(node.object);
  if (node.type === 'CallExpression') return getRootIdentifier(node.callee);
  return null;
}

function collectAllIterParamNames(js: string, queryDataVars?: Set<string>): Set<string> {
  const iterVars = new Set<string>();
  let ast: acorn.Node;
  try {
    ast = acornParse(js, { ecmaVersion: 2022, sourceType: 'script' }) as acorn.Node;
  } catch {
    return iterVars;
  }

  const ITER_METHODS = new Set(['forEach', 'map', 'filter', 'reduce', 'some', 'every', 'find', 'sort']);
  const hasQueryDataVars = queryDataVars && queryDataVars.size > 0;

  function walk(node: any): void {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'CallExpression') {
      const callee = node.callee;
      if (callee?.type === 'MemberExpression' && ITER_METHODS.has(callee.property?.name)) {
        if (hasQueryDataVars) {
          const rootId = getRootIdentifier(callee.object);
          if (!rootId || !queryDataVars!.has(rootId)) {
            return;
          }
        }

        const callback = node.arguments[0];
        if (callback) {
          const paramName = getFirstParamName(callback);
          if (paramName) {
            iterVars.add(paramName);
          }
          if (callee.property?.name === 'reduce' || callee.property?.name === 'sort') {
            const secondParam = getSecondParamName(callback);
            if (secondParam) {
              iterVars.add(secondParam);
            }
          }
        }
      }
    }

    for (const key of Object.keys(node)) {
      const child = (node as any)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object') walk(item);
        }
      } else if (child && typeof child === 'object' && child.type) {
        walk(child);
      }
    }
  }

  walk(ast);
  return iterVars;
}

function getFirstParamName(node: any): string | null {
  if (
    (node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration') &&
    node.params?.length > 0 &&
    node.params[0].type === 'Identifier'
  ) {
    return node.params[0].name;
  }
  if (
    node.type === 'ArrowFunctionExpression' &&
    node.params?.length > 0 &&
    node.params[0].type === 'Identifier'
  ) {
    return node.params[0].name;
  }
  return null;
}

function getSecondParamName(node: any): string | null {
  if (
    (node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration') &&
    node.params?.length > 1 &&
    node.params[1].type === 'Identifier'
  ) {
    return node.params[1].name;
  }
  if (
    node.type === 'ArrowFunctionExpression' &&
    node.params?.length > 1 &&
    node.params[1].type === 'Identifier'
  ) {
    return node.params[1].name;
  }
  return null;
}

function validateApiCalls(
  js: string,
  apiResults: ApiRunResult[] | undefined,
  errors: string[],
) {
  if (!apiResults || apiResults.length === 0) return;

  const apiNames = new Set(apiResults.map((r) => r.apiName));

  const callPattern = /window\.__LUBAN__\.callApi\s*\(\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(js)) !== null) {
    const apiName = match[1];
    if (!apiNames.has(apiName)) {
      const lineNum = js.substring(0, match.index).split('\n').length;
      const available = [...apiNames].join('、');
      errors.push(
        `[JS API] 第 ${lineNum} 行：调用不存在的 API「${apiName}」。` +
        `可用 API：${available}。请检查 API 名称是否拼写正确`
      );
    }
  }

  const runPattern = /(\w+)\.run\s*\(/g;
  while ((match = runPattern.exec(js)) !== null) {
    const name = match[1];
    if (apiNames.has(name)) {
      const lineNum = js.substring(0, match.index).split('\n').length;
      errors.push(
        `[JS API] 第 ${lineNum} 行：\`${name}.run()\` 调用方式错误。` +
        `「${name}」是外部 API 工具，不是 SQL 查询，应改用 \`window.__LUBAN__.callApi('${name}')\` 调用`
      );
    }
  }

  for (const result of apiResults) {
    if (result.status >= 400) {
      const refs = findApiRefLines(js, result.apiName);
      if (refs.length > 0) {
        const lineInfo = refs.slice(0, 3).map((l) => `第 ${l} 行`).join('、');
        errors.push(
          `[JS API] ${lineInfo}：API「${result.apiName}」测试返回 HTTP ${result.status}，` +
          `请检查 API 配置是否正确或使用其他 API 替代`
        );
      }
    }
  }
}

function findApiRefLines(js: string, apiName: string): number[] {
  const lines: number[] = [];
  const pattern = new RegExp(`callApi\\s*\\(\\s*['"]${apiName}['"]`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(js)) !== null) {
    lines.push(js.substring(0, match.index).split('\n').length);
  }
  return lines;
}

// ==========================================
// LubanUI 组件使用校验
// ==========================================

function validateLubanUIUsage(
  html: string | undefined,
  js: string | undefined,
  errors: string[],
  warnings: string[],
) {
  if (html) validateLubanUIHtml(html, warnings);
  if (js) validateLubanUIJs(js, errors, warnings);
}

/**
 * 检查 HTML 中是否使用了原生元素替代 LubanUI 组件 → 警告
 */
function validateLubanUIHtml(html: string, warnings: string[]) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const container = doc.querySelector('div');
  if (!container) return;

  const warningItems: string[] = [];

  // 1. 原生 button 未使用 luban-btn → 排除 tab 按钮、modal 关闭按钮、clearable 按钮
  const buttons = container.querySelectorAll('button');
  const nativeButtons: string[] = [];
  for (const btn of buttons) {
    const cls = btn.getAttribute('class') || '';
    if (cls.includes('luban-btn')) continue;
    if (cls.includes('luban-tab-item')) continue;
    if (cls.includes('luban-modal-close')) continue;
    if (btn.hasAttribute('data-modal-close')) continue;
    if (cls.includes('luban-input-clear')) continue;
    nativeButtons.push(btn.outerHTML.substring(0, 60));
  }
  if (nativeButtons.length > 0) {
    warningItems.push(`${nativeButtons.length} 个原生 <button> 未使用 luban-btn 样式（建议添加 class="luban-btn luban-btn-primary" 等）`);
  }

  // 2. 原生 table 未使用 luban-table
  const tables = container.querySelectorAll('table:not([class*="luban-table"])');
  if (tables.length > 0) {
    warningItems.push(`${tables.length} 个原生 <table> 未使用 class="luban-table"（建议使用 LubanUI.table() 初始化）`);
  }

  // 3. 原生 select 未使用 luban-select
  const selects = container.querySelectorAll('select:not([class*="luban-select"])');
  if (selects.length > 0) {
    warningItems.push(`${selects.length} 个原生 <select> 未使用 class="luban-select"（建议使用 LubanUI.select() 初始化）`);
  }

  // 4. 原生 input[type=text] 或 input:not([type]) 未使用 luban-input
  const textInputs = container.querySelectorAll('input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="tel"], input[type="url"], input[type="password"]');
  const nativeInputs: string[] = [];
  for (const inp of textInputs) {
    const cls = inp.getAttribute('class') || '';
    if (cls.includes('luban-input')) continue;
    if (cls.includes('luban-input-number')) continue;
    const parent = inp.closest('.luban-input-clearable, .luban-input-affix, .luban-checkbox, .luban-radio, .luban-switch');
    if (parent) continue;
    nativeInputs.push(inp.outerHTML.substring(0, 60));
  }
  if (nativeInputs.length > 0) {
    warningItems.push(`${nativeInputs.length} 个原生输入框未使用 class="luban-input"（建议添加）`);
  }

  // 5. 原生 textarea 未使用 luban-textarea
  const textareas = container.querySelectorAll('textarea:not([class*="luban-textarea"])');
  if (textareas.length > 0) {
    warningItems.push(`${textareas.length} 个原生 <textarea> 未使用 class="luban-textarea"（建议添加）`);
  }

  // 6. 原生 input[type=number] 未使用 luban-input-number
  const numInputs = container.querySelectorAll('input[type="number"]:not([class*="luban-input-number"])');
  if (numInputs.length > 0) {
    warningItems.push(`${numInputs.length} 个原生 <input type="number"> 未使用 class="luban-input-number"（建议添加）`);
  }

  // 7. 原生 input[type=date] 未使用 luban-datepicker
  const dateInputs = container.querySelectorAll('input[type="date"]:not([class*="luban-datepicker"])');
  if (dateInputs.length > 0) {
    warningItems.push(`${dateInputs.length} 个原生 <input type="date"> 未使用 class="luban-datepicker"（建议添加）`);
  }

  // 8. 原生 checkbox 未包裹在 luban-checkbox 中
  const checkboxes = container.querySelectorAll('input[type="checkbox"]');
  const nativeCheckboxes: string[] = [];
  for (const cb of checkboxes) {
    const parent = cb.closest('.luban-checkbox, .luban-switch');
    if (parent) continue;
    const cls = cb.getAttribute('class') || '';
    if (cls.includes('luban-checkbox')) continue;
    nativeCheckboxes.push(cb.outerHTML.substring(0, 60));
  }
  if (nativeCheckboxes.length > 0) {
    warningItems.push(`${nativeCheckboxes.length} 个原生复选框未包裹在 <label class="luban-checkbox"> 中（建议使用）`);
  }

  // 9. 原生 radio 未包裹在 luban-radio 中
  const radios = container.querySelectorAll('input[type="radio"]');
  const nativeRadios: string[] = [];
  for (const r of radios) {
    const parent = r.closest('.luban-radio');
    if (parent) continue;
    nativeRadios.push(r.outerHTML.substring(0, 60));
  }
  if (nativeRadios.length > 0) {
    warningItems.push(`${nativeRadios.length} 个原生单选框未包裹在 <label class="luban-radio"> 中（建议使用）`);
  }

  // 10. 表单结构 — 有 label+input 配对但未使用 luban-form
  const labels = container.querySelectorAll('label');
  let formWithoutLuban = 0;
  for (const label of labels) {
    const hasInput = label.querySelector('input, select, textarea') || label.nextElementSibling?.matches('input, select, textarea');
    if (hasInput && !label.closest('.luban-form') && !label.closest('.luban-filter-bar') && !label.closest('.luban-checkbox') && !label.closest('.luban-radio')) {
      formWithoutLuban++;
    }
  }
  if (formWithoutLuban > 0) {
    warningItems.push(`检测到 ${formWithoutLuban} 个 label+input 表单结构，未使用 class="luban-form" 包裹（建议使用 <div class="luban-form">）`);
  }

  // 11. 卡片 — 带有 inline shadow/border 样式的 div 未使用 luban-card
  const styledDivs = container.querySelectorAll('div[style]');
  let cardLikeDivs = 0;
  for (const div of styledDivs) {
    const style = div.getAttribute('style') || '';
    const cls = div.getAttribute('class') || '';
    if (cls.includes('luban-card') || cls.includes('luban-stat-card') || cls.includes('luban-modal') || cls.includes('luban-chart-item')) continue;
    if ((style.includes('box-shadow') || style.includes('border-radius')) && (style.includes('background') || style.includes('padding'))) {
      cardLikeDivs++;
    }
  }
  if (cardLikeDivs > 0) {
    warningItems.push(`检测到 ${cardLikeDivs} 个使用 inline style 的卡片容器，未使用 class="luban-card"（建议使用 <div class="luban-card">）`);
  }

  // 12. 标签 Badge — 小尺寸彩色文字标签未使用 luban-badge
  const badgeSpans = container.querySelectorAll('span');
  let badgeLike = 0;
  const statusKeywords = /成功|失败|进行中|已完成|待处理|已取消|已关闭|正常|异常|警告|启用|禁用|在线|离线|已审核|未审核|草稿|已发布|待审批/;
  for (const span of badgeSpans) {
    const cls = span.getAttribute('class') || '';
    const style = span.getAttribute('style') || '';
    if (cls.includes('luban-badge') || cls.includes('luban-stat') || cls.includes('luban-tab-item')) continue;
    if (span.closest('.luban-badge, .luban-stat-card, .luban-tabs')) continue;
    const text = span.textContent?.trim() || '';
    if (statusKeywords.test(text) && (style.includes('background') || style.includes('color') || style.includes('padding') || style.includes('border-radius'))) {
      badgeLike++;
    }
  }
  if (badgeLike > 0) {
    warningItems.push(`检测到 ${badgeLike} 个 inline style 状态标签，未使用 class="luban-badge"（建议使用 <span class="luban-badge luban-badge-success">）`);
  }

  // 13. 标签页 Tabs — 有 data-tab 或 tab 类结构但未使用 luban-tabs
  const tabTriggers = container.querySelectorAll('[data-tab], .tab, .tab-item, .tab-btn');
  let tabWithoutLuban = 0;
  for (const el of tabTriggers) {
    const cls = el.getAttribute('class') || '';
    if (cls.includes('luban-tab-item') || cls.includes('luban-tab-content')) continue;
    if (el.closest('.luban-tabs')) continue;
    tabWithoutLuban++;
  }
  if (tabWithoutLuban > 0) {
    warningItems.push(`检测到 ${tabWithoutLuban} 个标签页结构，未使用 class="luban-tabs"（建议使用 LubanUI.initTabs()）`);
  }

  // 14. 弹窗 Modal — 有 overlay 或 display:none 的弹窗结构未使用 luban-modal
  const overlays = container.querySelectorAll('[style*="display:none"], [style*="display: none"], [style*="position:fixed"], [style*="position: fixed"]');
  let modalWithoutLuban = 0;
  for (const el of overlays) {
    const cls = el.getAttribute('class') || '';
    if (cls.includes('luban-modal') || cls.includes('luban-loading')) continue;
    if (el.closest('.luban-modal-overlay')) continue;
    const hasHeader = el.querySelector('[class*="title"], [class*="header"], h1, h2, h3, h4');
    const hasClose = el.querySelector('[class*="close"], button');
    if (hasHeader && hasClose) {
      modalWithoutLuban++;
    }
  }
  if (modalWithoutLuban > 0) {
    warningItems.push(`检测到 ${modalWithoutLuban} 个自定义弹窗结构，未使用 class="luban-modal-overlay"（建议使用 LubanUI.modal.open()）`);
  }

  // 15. 空状态 Empty — 有"暂无数据"文字但未使用 luban-empty
  const emptyTexts = container.querySelectorAll('*');
  let emptyWithoutLuban = 0;
  const emptyPattern = /暂无数据|暂无内容|无数据|没有数据|空空如也|暂无记录|无搜索结果/;
  for (const el of emptyTexts) {
    if (el.children.length > 0) continue; // 只检查叶子节点
    const text = el.textContent?.trim() || '';
    if (emptyPattern.test(text) && text.length < 20) {
      if (!el.closest('.luban-empty') && !el.closest('.luban-table')) {
        emptyWithoutLuban++;
      }
    }
  }
  if (emptyWithoutLuban > 0) {
    warningItems.push(`检测到 ${emptyWithoutLuban} 个空状态提示，未使用 class="luban-empty"（建议使用 <div class="luban-empty">）`);
  }

  // 16. 加载 Loading — 有 spinner 或"加载中"文字但未使用 luban-loading
  const loadingTexts = container.querySelectorAll('*');
  let loadingWithoutLuban = 0;
  const loadingPattern = /加载中|loading|Loading|拼命加载|努力加载/;
  for (const el of loadingTexts) {
    if (el.children.length > 0) continue;
    const text = el.textContent?.trim() || '';
    const cls = el.getAttribute('class') || '';
    if (loadingPattern.test(text) && text.length < 20) {
      if (!el.closest('.luban-loading') && !cls.includes('luban-loading')) {
        loadingWithoutLuban++;
      }
    }
  }
  // 也检查 spinner 动画（有 animation 且 border-radius:50% 的 div）
  const spinnerDivs = container.querySelectorAll('div[style*="animation"]');
  for (const div of spinnerDivs) {
    const style = div.getAttribute('style') || '';
    const cls = div.getAttribute('class') || '';
    if (cls.includes('luban-spinner') || cls.includes('luban-loading')) continue;
    if (div.closest('.luban-loading') || div.closest('.luban-btn-loading')) continue;
    if (style.includes('border-radius') && (style.includes('50%') || style.includes('999'))) {
      loadingWithoutLuban++;
    }
  }
  if (loadingWithoutLuban > 0) {
    warningItems.push(`检测到 ${loadingWithoutLuban} 个加载状态结构，未使用 class="luban-loading"（建议使用 <div class="luban-loading"><div class="luban-spinner">）`);
  }

  // 17. 筛选栏 FilterBar — 有 input+select+button 组合但未使用 luban-filter-bar
  const filterRows = container.querySelectorAll('div');
  let filterBarWithoutLuban = 0;
  for (const div of filterRows) {
    const cls = div.getAttribute('class') || '';
    if (cls.includes('luban-filter-bar') || cls.includes('luban-form') || cls.includes('luban-card')) continue;
    const style = div.getAttribute('style') || '';
    const hasInput = div.querySelector('input, select');
    const hasButton = div.querySelector('button');
    const isFlex = style.includes('display:flex') || style.includes('display: flex') || cls.includes('flex');
    if (hasInput && hasButton && isFlex && div.children.length >= 2 && div.children.length <= 8) {
      filterBarWithoutLuban++;
    }
  }
  if (filterBarWithoutLuban > 0) {
    warningItems.push(`检测到 ${filterBarWithoutLuban} 个筛选栏结构，未使用 class="luban-filter-bar"（建议使用 <div class="luban-filter-bar">）`);
  }

  // 18. 统计卡 Stats — 有 grid + 数值+标签 结构但未使用 luban-stats-grid
  const statGrids = container.querySelectorAll('div[style*="grid"], div[style*="display:grid"], div[class*="grid"]');
  let statsWithoutLuban = 0;
  for (const grid of statGrids) {
    const cls = grid.getAttribute('class') || '';
    if (cls.includes('luban-stats-grid') || cls.includes('luban-form')) continue;
    const children = grid.children;
    if (children.length >= 2 && children.length <= 6) {
      let statCount = 0;
      for (const child of children) {
        const hasNumber = /\d+/.test(child.textContent || '');
        const hasLabel = child.querySelector('*') && child.textContent!.length > 3;
        if (hasNumber && hasLabel) statCount++;
      }
      if (statCount >= 2) {
        statsWithoutLuban++;
      }
    }
  }
  if (statsWithoutLuban > 0) {
    warningItems.push(`检测到 ${statsWithoutLuban} 个统计卡网格结构，未使用 class="luban-stats-grid"（建议使用 <div class="luban-stats-grid">）`);
  }

  // 19. 图表 Chart — 有 canvas 或 chart ID 但未使用 luban-chart-item
  const chartContainers = container.querySelectorAll('div[id]');
  let chartWithoutLuban = 0;
  for (const div of chartContainers) {
    const id = div.getAttribute('id') || '';
    const cls = div.getAttribute('class') || '';
    if (cls.includes('luban-chart') || cls.includes('luban-chart-item')) continue;
    if (div.closest('.luban-chart-item')) continue;
    const hasChart = /chart|echart|graph|pie|bar|line/i.test(id);
    const hasCanvas = div.querySelector('canvas');
    if (hasChart || hasCanvas) {
      chartWithoutLuban++;
    }
  }
  if (chartWithoutLuban > 0) {
    warningItems.push(`检测到 ${chartWithoutLuban} 个图表容器，未使用 class="luban-chart-item"（建议使用 <div class="luban-chart-item"><div class="luban-chart">）`);
  }

  // 20. 分页 Pagination — 有分页结构但未使用 luban-pagination
  const paginationPattern = /上一页|下一页|首页|末页|第\s*\d+\s*页|共\s*\d+\s*页|共\s*\d+\s*条/;
  const pageElements = container.querySelectorAll('*');
  let paginationWithoutLuban = 0;
  const paginationContainers = new Set<Element>();
  for (const el of pageElements) {
    if (el.children.length > 0) continue;
    if (el.closest('.luban-pagination') || el.closest('.luban-table')) continue;
    const text = el.textContent?.trim() || '';
    if (paginationPattern.test(text) && text.length < 30) {
      const parent = el.parentElement;
      if (parent && !paginationContainers.has(parent)) {
        paginationContainers.add(parent);
        paginationWithoutLuban++;
      }
    }
  }
  if (paginationWithoutLuban > 0) {
    warningItems.push(`检测到 ${paginationWithoutLuban} 个分页结构，未使用 class="luban-pagination"（建议使用 LubanUI.table() 内置分页）`);
  }

  if (warningItems.length > 0) {
    warnings.push(
      `[LubanUI] 以下元素未使用 LubanUI 组件库，建议替换以保持风格一致：\n` +
      warningItems.map((w) => `  - ${w}`).join('\n')
    );
  }
}

/**
 * 检查 JS 中 LubanUI API 调用是否正确 → 错误
 */
function validateLubanUIJs(js: string, errors: string[], _warnings: string[]) {
  // 1. LubanUI.table() — 第一个参数必须是字符串（元素 ID）
  const tableCalls = js.matchAll(/LubanUI\.table\s*\(\s*(['"])?(\w+)\1?\s*,/g);
  for (const m of tableCalls) {
    const lineNum = js.substring(0, m.index!).split('\n').length;
    const id = m[2];
    if (!m[1]) {
      // 第一个参数不是字符串字面量
      errors.push(
        `[LubanUI] 第 ${lineNum} 行：LubanUI.table() 第一个参数必须是表格元素 ID 字符串，如 LubanUI.table('myTable', {...})`
      );
    }
  }

  // 2. LubanUI.modal.open() — 第一个参数必须是字符串（弹窗 ID）
  const modalOpenCalls = js.matchAll(/LubanUI\.modal\.open\s*\(\s*/g);
  for (const m of modalOpenCalls) {
    const lineNum = js.substring(0, m.index!).split('\n').length;
    const afterOpen = js.substring(m.index! + m[0].length);
    const firstArgMatch = afterOpen.match(/^\s*(['"])(\w+)\1/);
    if (!firstArgMatch) {
      errors.push(
        `[LubanUI] 第 ${lineNum} 行：LubanUI.modal.open() 第一个参数必须是弹窗 ID 字符串，如 LubanUI.modal.open('myModal')`
      );
    }
  }

  // 3. LubanUI.modal.close() — 第一个参数必须是字符串
  const modalCloseCalls = js.matchAll(/LubanUI\.modal\.close\s*\(\s*/g);
  for (const m of modalCloseCalls) {
    const lineNum = js.substring(0, m.index!).split('\n').length;
    const afterClose = js.substring(m.index! + m[0].length);
    const firstArgMatch = afterClose.match(/^\s*(['"])(\w+)\1/);
    if (!firstArgMatch) {
      errors.push(
        `[LubanUI] 第 ${lineNum} 行：LubanUI.modal.close() 第一个参数必须是弹窗 ID 字符串，如 LubanUI.modal.close('myModal')`
      );
    }
  }

  // 4. LubanUI.toast.xxx() — 方法名必须合法
  const VALID_TOAST_METHODS = ['success', 'error', 'warning', 'info'];
  const toastCalls = js.matchAll(/LubanUI\.toast\.(\w+)\s*\(/g);
  for (const m of toastCalls) {
    const method = m[1];
    if (!VALID_TOAST_METHODS.includes(method)) {
      const lineNum = js.substring(0, m.index!).split('\n').length;
      errors.push(
        `[LubanUI] 第 ${lineNum} 行：LubanUI.toast.${method}() 不存在。可用方法：${VALID_TOAST_METHODS.join('、')}`
      );
    }
  }

  // 5. LubanUI.select() — 参数必须是 CSS 选择器字符串
  const selectCalls = js.matchAll(/LubanUI\.select\s*\(\s*/g);
  for (const m of selectCalls) {
    const lineNum = js.substring(0, m.index!).split('\n').length;
    const afterCall = js.substring(m.index! + m[0].length);
    const firstArgMatch = afterCall.match(/^\s*(['"])([#.]?\w+)\1/);
    if (!firstArgMatch) {
      errors.push(
        `[LubanUI] 第 ${lineNum} 行：LubanUI.select() 参数必须是 CSS 选择器字符串，如 LubanUI.select('#mySelect')`
      );
    }
  }

  // 6. LubanUI.chart() — 第一个参数必须是字符串，第二个参数必须是对象
  const chartCalls = js.matchAll(/LubanUI\.chart\s*\(\s*/g);
  for (const m of chartCalls) {
    const lineNum = js.substring(0, m.index!).split('\n').length;
    const afterCall = js.substring(m.index! + m[0].length);
    const firstArgMatch = afterCall.match(/^\s*(['"])(\w+)\1/);
    if (!firstArgMatch) {
      errors.push(
        `[LubanUI] 第 ${lineNum} 行：LubanUI.chart() 第一个参数必须是图表容器 ID 字符串，如 LubanUI.chart('myChart', {...})`
      );
    }
  }

  // 7. LubanUI.initTabs() — 参数必须是字符串
  const initTabsCalls = js.matchAll(/LubanUI\.initTabs\s*\(\s*/g);
  for (const m of initTabsCalls) {
    const lineNum = js.substring(0, m.index!).split('\n').length;
    const afterCall = js.substring(m.index! + m[0].length);
    const firstArgMatch = afterCall.match(/^\s*(['"])(\w+)\1/);
    if (!firstArgMatch) {
      errors.push(
        `[LubanUI] 第 ${lineNum} 行：LubanUI.initTabs() 参数必须是标签页容器 ID 字符串，如 LubanUI.initTabs('myTabs')`
      );
    }
  }

  // 8. LubanUI.getFormData() — 参数必须是字符串
  const formDataCalls = js.matchAll(/LubanUI\.getFormData\s*\(\s*/g);
  for (const m of formDataCalls) {
    const lineNum = js.substring(0, m.index!).split('\n').length;
    const afterCall = js.substring(m.index! + m[0].length);
    const firstArgMatch = afterCall.match(/^\s*(['"])(\w+)\1/);
    if (!firstArgMatch) {
      errors.push(
        `[LubanUI] 第 ${lineNum} 行：LubanUI.getFormData() 参数必须是表单 ID 字符串，如 LubanUI.getFormData('myForm')`
      );
    }
  }

  // 9. 检查 JS 字符串中是否使用了不存在的 luban-* 类名
  const ALL_VALID_LUBAN_CLASSES = new Set([
    'luban-btn', 'luban-btn-primary', 'luban-btn-secondary', 'luban-btn-danger',
    'luban-btn-success', 'luban-btn-text', 'luban-btn-sm', 'luban-btn-lg',
    'luban-btn-block', 'luban-btn-loading', 'luban-btn-group',
    'luban-table', 'luban-table-sort', 'luban-table-pagination',
    'luban-form', 'luban-form-inline', 'luban-form-horizontal',
    'luban-form-item', 'luban-form-label', 'luban-form-label-required',
    'luban-form-help', 'luban-form-error',
    'luban-input', 'luban-input-sm', 'luban-input-lg', 'luban-input-error',
    'luban-input-clearable', 'luban-input-clear', 'luban-input-affix',
    'luban-input-prefix', 'luban-input-suffix',
    'luban-textarea', 'luban-input-number', 'luban-datepicker',
    'luban-select', 'luban-select-option', 'luban-select-expand',
    'luban-checkbox', 'luban-checkbox-group', 'luban-checkbox-group-vertical',
    'luban-radio', 'luban-radio-group',
    'luban-switch',
    'luban-stats-grid', 'luban-stat-card', 'luban-stat-card-primary',
    'luban-stat-card-success', 'luban-stat-card-warning', 'luban-stat-card-danger',
    'luban-stat-loading', 'luban-stat-label', 'luban-stat-value', 'luban-stat-change',
    'luban-stat-up', 'luban-stat-down',
    'luban-card', 'luban-card-hoverable', 'luban-card-bordered', 'luban-card-shadow',
    'luban-card-header', 'luban-card-title', 'luban-card-body',
    'luban-modal-overlay', 'luban-modal', 'luban-modal-narrow', 'luban-modal-wide',
    'luban-modal-header', 'luban-modal-title', 'luban-modal-close',
    'luban-modal-body', 'luban-modal-footer',
    'luban-tabs', 'luban-tabs-card', 'luban-tabs-nav', 'luban-tab-item',
    'luban-tab-content', 'luban-tab-content',
    'luban-badge', 'luban-badge-success', 'luban-badge-warning',
    'luban-badge-danger', 'luban-badge-primary', 'luban-badge-info',
    'luban-badge-dot', 'luban-badge-count',
    'luban-filter-bar', 'luban-filter-item', 'luban-filter-label',
    'luban-filter-actions',
    'luban-toast', 'luban-toast-success', 'luban-toast-error',
    'luban-toast-warning', 'luban-toast-info',
    'luban-empty', 'luban-empty-action', 'luban-empty-simple',
    'luban-empty-icon', 'luban-empty-text', 'luban-empty-description',
    'luban-loading', 'luban-loading-inline', 'luban-loading-fullscreen',
    'luban-loading-overlay', 'luban-loading-skeleton',
    'luban-spinner', 'luban-loading-text',
    'luban-chart-item', 'luban-chart-title', 'luban-chart',
    'luban-pagination',
  ]);

  // 在 JS 字符串中查找 class="luban-xxx" 或 className 中出现的 luban- 类名
  const classInJs = js.matchAll(/["']luban-(\w+(?:-\w+)*)["']/g);
  for (const m of classInJs) {
    const fullClass = 'luban-' + m[1];
    if (!ALL_VALID_LUBAN_CLASSES.has(fullClass)) {
      const lineNum = js.substring(0, m.index!).split('\n').length;
      errors.push(
        `[LubanUI] 第 ${lineNum} 行：类名 "${fullClass}" 不是有效的 LubanUI 组件类名，请检查拼写`
      );
    }
  }

  // 10. 禁止 result.data.xxx — QueryName.run() 直接返回 { columns, rows, totalCount }
  const dataAccessPattern = /(\w+)\.data\.(rows|columns|totalCount)\b/g;
  for (const m of js.matchAll(dataAccessPattern)) {
    const lineNum = js.substring(0, m.index!).split('\n').length;
    const varName = m[1];
    const prop = m[2];
    errors.push(
      `[LubanUI] 第 ${lineNum} 行：${varName}.data.${prop} 写法错误。QueryName.run() 返回的就是 { columns, rows, totalCount }，没有 .data 包装，请改为 ${varName}.${prop}`
    );
  }
}

function validateTableEmptyState(js: string, warnings: string[]) {
  const hasLubanTable = /LubanUI\.table\s*\(/.test(js);
  if (hasLubanTable) return;

  const handWrittenPatterns: { pattern: RegExp; name: string }[] = [
    { pattern: /function\s+renderEmpty\s*\(/g, name: 'renderEmpty()' },
    { pattern: /function\s+renderTable\s*\(/g, name: 'renderTable()' },
    { pattern: /\.innerHTML\s*=\s*['"`][^'"`]*colspan[^'"`]*暂无/gi, name: 'innerHTML 中手写空态' },
    { pattern: /\.textContent\s*=\s*['"`][^'"`]*(?:暂无|没有|无数据)/gi, name: 'textContent 手写空态文案' },
  ];

  const detected: string[] = [];
  let firstLine = 0;

  for (const { pattern, name } of handWrittenPatterns) {
    pattern.lastIndex = 0;
    const m = pattern.exec(js);
    if (m) {
      detected.push(name);
      const lineNum = js.substring(0, m.index).split('\n').length;
      if (firstLine === 0 || lineNum < firstLine) firstLine = lineNum;
    }
  }

  if (detected.length > 0) {
    warnings.push(
      `[表格空态] 第 ${firstLine} 行：检测到手写表格空态模式（${detected.join('、')}），` +
      '未使用 LubanUI.table() 组件。LubanUI.table() 内置空态渲染（图标+文字+描述+操作按钮），' +
      '配置 emptyText / emptyDescription / emptyAction 即可。' +
      '如手写方案有更好的用户体验，可保持现状；否则建议改用 LubanUI.table()。'
    );
  }
}

function validateCssComponentOverride(css: string, errors: string[]) {
  const LUBAN_COMPONENT_SELECTORS = [
    '.luban-table', '.luban-btn', '.luban-badge', '.luban-card',
    '.luban-modal', '.luban-tabs', '.luban-form', '.luban-input',
    '.luban-select', '.luban-checkbox', '.luban-radio', '.luban-switch',
    '.luban-pagination', '.luban-toast', '.luban-empty', '.luban-loading',
    '.luban-spinner', '.luban-stat-card', '.luban-filter-bar', '.luban-chart',
  ];

  const lines = css.split('\n');
  const violations: { line: number; selector: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    for (const selector of LUBAN_COMPONENT_SELECTORS) {
      if (line === selector + '{' || line === selector + ' {' || line.startsWith(selector + ',') || line.startsWith(selector + ' ')) {
        violations.push({ line: i + 1, selector });
        break;
      }
    }
  }

  if (violations.length > 0) {
    const details = violations.slice(0, 5).map((v) => `第 ${v.line} 行：${v.selector}`).join('、');
    errors.push(
      `[CSS 组件覆盖] 禁止重新定义 LubanUI 组件样式，组件样式由组件库统一管理。` +
      `检测到 ${violations.length} 处覆盖（${details}${violations.length > 5 ? ' 等' : ''}）。` +
      '如需定制样式，请使用自定义类名（如 .my-table），不要直接修改 .luban-table 等组件类。'
    );
  }
}

function validateFormContainer(html: string, js: string, errors: string[]) {
  const divFormPattern = /<div[^>]*class="[^"]*luban-form[^"]*"[^>]*>/g;
  const divFormMatches: { line: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = divFormPattern.exec(html)) !== null) {
    const lineNum = html.substring(0, m.index).split('\n').length;
    divFormMatches.push({ line: lineNum });
  }

  if (divFormMatches.length === 0) return;

  const formDotNamePattern = /(\w+)\.\w+\.value\b/g;
  const formDotNameInBrackets = /(\w+)\[['"]\w+['"]\]\.value\b/g;
  const getElementByIdForm = /getElementById\s*\(\s*['"](\w+)['"]\s*\)/g;

  const formVarNames = new Set<string>();
  let gm: RegExpExecArray | null;
  while ((gm = getElementByIdForm.exec(js)) !== null) {
    formVarNames.add(gm[1]);
  }

  const dangerousAccess: { line: number; code: string }[] = [];

  for (const match of js.matchAll(formDotNamePattern)) {
    const lineNum = js.substring(0, match.index!).split('\n').length;
    const code = match[0];
    const varName = match[1];

    const isFormVar = formVarNames.has(varName) || /form/i.test(varName);
    if (isFormVar) {
      const existing = dangerousAccess.find((d) => d.line === lineNum);
      if (!existing) {
        dangerousAccess.push({ line: lineNum, code });
      }
    }
  }

  if (divFormMatches.length > 0 && dangerousAccess.length > 0) {
    const htmlLines = divFormMatches.slice(0, 3).map((d) => `第 ${d.line} 行`).join('、');
    const jsLines = dangerousAccess.slice(0, 3).map((d) => `第 ${d.line} 行：\`${d.code}\``).join('、');
    errors.push(
      `[表单容器] HTML 中使用了 <div class="luban-form">（${htmlLines}），` +
      `但 JS 中使用了 \`form.name.value\` 风格的属性访问（${jsLines}）。` +
      '`<div>` 不是 `<form>` 元素，`div.name` 返回 undefined，访问 `.value` 会抛 TypeError。' +
      '请将 `<div class="luban-form">` 改为 `<form class="luban-form">`，' +
      '或使用 `LubanUI.getFormData(\'formId\')` 获取表单数据。'
    );
  }
}