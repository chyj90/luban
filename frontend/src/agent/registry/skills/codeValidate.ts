import { parse as acornParse } from 'acorn';
import { listQueries } from '@/api/query';

interface QueryInfo {
  id: number;
  name: string;
  body: string;
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
}

async function validateFieldNames(
  js: string,
  options: ValidateFieldNamesOptions,
  errors: string[],
  warnings: string[],
) {
  const { queryIds, applicationId } = options;
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

  if (queries.length === 0) return;

  const allFieldNames = new Set<string>();
  for (const q of queries) {
    const fields = extractFieldNamesFromSQL(q.body);
    fields.forEach((f) => allFieldNames.add(f));
  }

  if (allFieldNames.size === 0) return;

  const mismatches = findFieldNameMismatches(js, allFieldNames);
  if (mismatches.length > 0) {
    const details = mismatches.slice(0, 5).map((m) =>
      `第 ${m.line} 行：使用了 \`${m.used}\`，应改为 \`${m.expected}\``
    ).join('；');

    errors.push(
      `[JS 字段名] 代码中使用了驼峰命名的字段名，但查询返回的是下划线命名。` +
      `请将以下字段名改为下划线格式：${details}` +
      (mismatches.length > 5 ? `（共 ${mismatches.length} 处，仅展示前 5 处）` : '')
    );
  }

  const unknownFields = findUnknownFieldNames(js, allFieldNames);
  if (unknownFields.length > 0) {
    const fieldList = [...allFieldNames].join('、');
    const details = unknownFields.slice(0, 5).map((f) =>
      `第 ${f.line} 行：\`${f.used}\`${f.suggestion ? `（是否指 \`${f.suggestion}\`？）` : ''}`
    ).join('；');

    errors.push(
      `[JS 字段名] 代码中使用了查询不存在的字段。可用字段：${fieldList}。` +
      `错误字段：${details}` +
      (unknownFields.length > 5 ? `（共 ${unknownFields.length} 处，仅展示前 5 处）` : '')
    );
  }
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

    const asMatch = trimmed.match(/^(.*?)\s+AS\s+(\w+)\s*$/i);
    if (asMatch) {
      const beforeAs = asMatch[1].trim();
      const alias = asMatch[2];
      const colMatch = beforeAs.match(/^(?:\w+\.)?(\w+)$/);
      if (colMatch) {
        fields.push(colMatch[1]);
      } else {
        fields.push(alias);
      }
    } else {
      const colMatch = trimmed.match(/(?:\w+\.)?(\w+)$/);
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

function findUnknownFieldNames(
  js: string,
  actualFieldNames: Set<string>,
): { line: number; used: string; suggestion?: string }[] {
  const unknownFields: { line: number; used: string; suggestion?: string }[] = [];

  const fieldPattern = /\brow\.(\w+)\b/g;
  let match: RegExpExecArray | null;
  while ((match = fieldPattern.exec(js)) !== null) {
    const fieldName = match[1];

    if (actualFieldNames.has(fieldName)) continue;
    if (!fieldName.includes('_')) continue;

    const exists = unknownFields.some((f) => f.used === fieldName);
    if (exists) continue;

    let suggestion: string | undefined;
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

    const lineNum = js.substring(0, match.index).split('\n').length;
    unknownFields.push({ line: lineNum, used: fieldName, suggestion });
  }

  return unknownFields;
}