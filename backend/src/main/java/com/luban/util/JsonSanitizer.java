package com.luban.util;

import lombok.extern.slf4j.Slf4j;

/**
 * LLM 输出的 JSON 容错修补：剥围栏、裁剪前后噪声、补未闭合引号与括号。
 * 原实现逐字复制在 ConceptMappingService 与 ConceptImportService 两处，收敛于此。
 * 注意：括号修补是启发式，字符串字面量内含 {/[ 时可能修补失败——
 * 调用方应保留严格解析失败后的重试路径，不要只依赖这里。
 */
@Slf4j
public final class JsonSanitizer {

    private JsonSanitizer() {}

    public static String sanitizeJson(String json) {
        if (json == null) return null;
        String s = json.trim();
        if (s.startsWith("```")) {
            s = s.replaceAll("```json\\s*", "").replaceAll("```\\s*", "").trim();
        }
        int start = s.indexOf('{');
        if (start < 0) start = s.indexOf('[');
        if (start > 0) s = s.substring(start);
        if (s.isEmpty()) return json;

        int quoteCount = 0;
        boolean escaped = false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (escaped) { escaped = false; continue; }
            if (c == '\\') { escaped = true; continue; }
            if (c == '"') quoteCount++;
        }
        if (quoteCount % 2 != 0) {
            s = s + "\"";
            log.warn("[sanitize-json] 修复未闭合的字符串引号");
        }

        int braceCount = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '{' || c == '[') braceCount++;
            else if (c == '}' || c == ']') braceCount--;
        }
        char firstChar = s.charAt(0);
        char closingChar = firstChar == '{' ? '}' : ']';
        for (int i = 0; i < braceCount; i++) {
            s += closingChar;
        }
        if (braceCount > 0) {
            log.warn("[sanitize-json] 修复 {} 个未闭合的花括号/方括号", braceCount);
        }

        return s;
    }
}
