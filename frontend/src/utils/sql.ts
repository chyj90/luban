/**
 * SQL 语句级工具（与后端 SqlUtils 逻辑一致）：
 * 按分号拆分批量 SQL 时跳过字符串字面量、标识符引用与注释，
 * 避免 INSERT 值中含分号或语句前带注释时被误判。
 */

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  if (!sql) return statements;

  let current = '';
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql[i];
    // 行注释：-- 与 #
    if ((c === '-' && sql[i + 1] === '-') || c === '#') {
      let eol = sql.indexOf('\n', i);
      if (eol < 0) eol = n;
      current += sql.slice(i, eol);
      i = eol;
      continue;
    }
    // 块注释：/* ... */
    if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // 字符串/标识符引用：'...'、"..."、`...`
    if (c === '\'' || c === '"' || c === '`') {
      const quote = c;
      current += c;
      i++;
      while (i < n) {
        const ch = sql[i];
        current += ch;
        i++;
        // 反斜杠转义（仅对字符串有效）
        if (ch === '\\' && quote !== '`' && i < n) {
          current += sql[i];
          i++;
          continue;
        }
        if (ch === quote) {
          // 双写转义（'' / "" / ``）
          if (sql[i] === quote) {
            current += quote;
            i++;
            continue;
          }
          break;
        }
      }
      continue;
    }
    // 语句分隔符
    if (c === ';') {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = '';
      i++;
      continue;
    }
    current += c;
    i++;
  }
  const last = current.trim();
  if (last) statements.push(last);
  return statements;
}

/** 提取首条语句的关键词（跳过前导空白与注释），统一大写。 */
export function firstSqlKeyword(sql: string): string {
  if (!sql) return '';
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if ((c === '-' && sql[i + 1] === '-') || c === '#') {
      const eol = sql.indexOf('\n', i);
      if (eol < 0) return '';
      i = eol + 1;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) return '';
      i = end + 2;
      continue;
    }
    break;
  }
  let kw = '';
  while (i < n && /[A-Za-z0-9_]/.test(sql[i])) {
    kw += sql[i];
    i++;
  }
  return kw.toUpperCase();
}

const DDL_KEYWORDS = new Set(['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME']);

/** 拆分后任一语句为 DDL 时返回 true。 */
export function containsDdlStatement(sql: string): boolean {
  return splitSqlStatements(sql).some((s) => DDL_KEYWORDS.has(firstSqlKeyword(s)));
}
