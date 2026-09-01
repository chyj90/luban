import { parse as acornParse } from 'acorn';
import { listQueries } from '@/api/query';

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
  try { if (js) validateCrossPageParams(js, errors, warnings); } catch (e: any) { errors.push(`[跨页面参数校验] 异常: ${e?.message || e}`); }
  try { if (js && validateOptions) await validateFieldNames(js, validateOptions, errors, warnings); } catch (e: any) { errors.push(`[字段校验] 异常: ${e?.message || e}`); }

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
    'navigateToPage', 'navigateToPageByName', 'getPageParams', 'getAllPages', 'callApi',
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

    const unknownFields = findUnknownFieldNames(js, allFieldNames);
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

const DOM_SKIP_NAMES = [
  'innerHTML', 'outerHTML', 'textContent', 'innerText', 'outerText',
  'parentNode', 'parentElement', 'childNodes', 'children',
  'firstChild', 'lastChild', 'firstElementChild', 'lastElementChild',
  'nextSibling', 'previousSibling', 'nextElementSibling', 'previousElementSibling',
  'classList', 'dataset', 'style',
  'offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'offsetParent',
  'clientWidth', 'clientHeight', 'clientTop', 'clientLeft',
  'scrollWidth', 'scrollHeight', 'scrollTop', 'scrollLeft',
  'tagName', 'nodeName', 'nodeType', 'nodeValue',
  'appendChild', 'removeChild', 'replaceChild', 'insertBefore',
  'append', 'prepend', 'remove', 'replaceWith', 'before', 'after',
  'querySelector', 'querySelectorAll', 'getElementById', 'getElementsByClassName', 'getElementsByTagName',
  'getAttribute', 'setAttribute', 'removeAttribute', 'hasAttribute', 'toggleAttribute',
  'addEventListener', 'removeEventListener', 'dispatchEvent',
  'focus', 'blur', 'click', 'scrollIntoView', 'scrollBy', 'scrollTo',
  'cloneNode', 'contains', 'matches', 'closest',
  'animate', 'getAnimations', 'getBoundingClientRect',
  'insertAdjacentHTML', 'insertAdjacentElement', 'insertAdjacentText',
];

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
  for (const name of DOM_SKIP_NAMES) {
    _builtins.add(name);
  }
  for (const name of Object.getOwnPropertyNames(Array.prototype)) {
    _builtins.add(name);
  }
  for (const name of QUERY_RESULT_STRUCTURE) {
    _builtins.add(name);
  }
  return _builtins;
}

const QUERY_RESULT_STRUCTURE = ['rows', 'columns', 'totalCount'];

const DATA_VAR_PATTERNS = [
  'row', 'rows', 'item', 'orderData', 'order', 'result',
  'info', 'record', 'detail', 'entry', 'obj', 'r', 'd', 'o', 'it',
  'product', 'customer', 'user', 'orderItem', 'line',
];

function findUnknownFieldNames(
  js: string,
  actualFieldNames: Set<string>,
): { line: number; used: string; suggestion?: string }[] {
  const unknownFields: { line: number; used: string; suggestion?: string }[] = [];

  const varNames = DATA_VAR_PATTERNS.join('|');
  const fieldPattern = new RegExp(
    `\\b(?:${varNames})\\.([\\u4e00-\\u9fff\\w]+)\\b`,
    'g',
  );
  let match: RegExpExecArray | null;
  while ((match = fieldPattern.exec(js)) !== null) {
    const fieldName = match[1];

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