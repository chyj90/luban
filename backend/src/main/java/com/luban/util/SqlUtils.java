package com.luban.util;

import java.util.ArrayList;
import java.util.List;

/**
 * SQL 语句级工具：按分号拆分批量 SQL、提取首关键词。
 * 拆分时跳过字符串字面量（'...'、"..."）、标识符引用（`...`）与注释（-- / # / /* *\/），
 * 避免 INSERT 值中含分号或语句前带注释时被错误切断。
 */
public final class SqlUtils {

    private SqlUtils() {}

    /** 将批量 SQL 拆分为单条语句列表（已 trim，丢弃空语句）。 */
    public static List<String> splitStatements(String sql) {
        List<String> statements = new ArrayList<>();
        if (sql == null || sql.isEmpty()) return statements;

        StringBuilder current = new StringBuilder();
        int n = sql.length();
        int i = 0;
        while (i < n) {
            char c = sql.charAt(i);
            // 行注释：-- 与 #
            if ((c == '-' && i + 1 < n && sql.charAt(i + 1) == '-') || c == '#') {
                int eol = sql.indexOf('\n', i);
                if (eol < 0) eol = n;
                current.append(sql, i, eol);
                i = eol;
                continue;
            }
            // 块注释：/* ... */
            if (c == '/' && i + 1 < n && sql.charAt(i + 1) == '*') {
                int end = sql.indexOf("*/", i + 2);
                end = end < 0 ? n : end + 2;
                current.append(sql, i, end);
                i = end;
                continue;
            }
            // 字符串/标识符引用：'...'、"..."、`...`
            if (c == '\'' || c == '"' || c == '`') {
                char quote = c;
                current.append(c);
                i++;
                while (i < n) {
                    char ch = sql.charAt(i);
                    current.append(ch);
                    i++;
                    // 反斜杠转义（仅对字符串有效）
                    if (ch == '\\' && quote != '`' && i < n) {
                        current.append(sql.charAt(i));
                        i++;
                        continue;
                    }
                    if (ch == quote) {
                        // 双写转义（'' / "" / ``）
                        if (i < n && sql.charAt(i) == quote) {
                            current.append(quote);
                            i++;
                            continue;
                        }
                        break;
                    }
                }
                continue;
            }
            // 语句分隔符
            if (c == ';') {
                String stmt = current.toString().trim();
                if (!stmt.isEmpty()) statements.add(stmt);
                current.setLength(0);
                i++;
                continue;
            }
            current.append(c);
            i++;
        }
        String last = current.toString().trim();
        if (!last.isEmpty()) statements.add(last);
        return statements;
    }

    /** 提取首条语句的关键词（跳过前导空白与注释），统一大写；无关键词返回空串。 */
    public static String firstKeyword(String sql) {
        if (sql == null) return "";
        int n = sql.length();
        int i = 0;
        while (i < n) {
            char c = sql.charAt(i);
            if (Character.isWhitespace(c)) { i++; continue; }
            if ((c == '-' && i + 1 < n && sql.charAt(i + 1) == '-') || c == '#') {
                int eol = sql.indexOf('\n', i);
                if (eol < 0) return "";
                i = eol + 1;
                continue;
            }
            if (c == '/' && i + 1 < n && sql.charAt(i + 1) == '*') {
                int end = sql.indexOf("*/", i + 2);
                if (end < 0) return "";
                i = end + 2;
                continue;
            }
            break;
        }
        StringBuilder sb = new StringBuilder();
        while (i < n && (Character.isLetterOrDigit(sql.charAt(i)) || sql.charAt(i) == '_')) {
            sb.append(sql.charAt(i));
            i++;
        }
        return sb.toString().toUpperCase();
    }

    /** 是否属于 DDL 关键词。 */
    public static boolean isDdlKeyword(String keyword) {
        return switch (keyword) {
            case "CREATE", "ALTER", "DROP", "TRUNCATE", "RENAME" -> true;
            default -> false;
        };
    }
}
