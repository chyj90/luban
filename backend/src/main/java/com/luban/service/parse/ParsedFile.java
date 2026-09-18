package com.luban.service.parse;

import java.util.Map;

/**
 * 解析产物：提取文本 + 结构化元信息。这是文件上传的"规范产物"，
 * 对话注入、按需读取、后续导入数据库/知识库都以此为准。
 *
 * @param textContent 提取文本（Word 段落/表格线性化、TXT/CSV 原文）
 * @param truncated   提取文本超上限被截断
 * @param meta        结构化元信息（excel: sheets；word: paragraphs/tables；text: lines）
 * @param summary     一句话概要（供上下文注入与附件卡展示）
 */
public record ParsedFile(String textContent, boolean truncated, Map<String, Object> meta, String summary) {
}
