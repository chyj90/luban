package com.luban.service.parse;

import org.apache.poi.xwpf.usermodel.IBodyElement;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFTable;
import org.apache.poi.xwpf.usermodel.XWPFTableRow;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Word(.docx) 解析器（POI XWPF）。段落顺序输出；
 * 表格线性化为「列1 | 列2 | …」行文本，保证表格信息进入提取文本。
 */
@Component
public class DocxFileParser implements FileParser {

    private static final int MAX_TEXT_CHARS = TextFileParser.MAX_TEXT_CHARS;
    private static final String CELL_SEP = " | ";

    @Override
    public boolean supports(String ext) {
        return "docx".equals(ext);
    }

    @Override
    public ParsedFile parse(InputStream in, long size) throws IOException {
        StringBuilder text = new StringBuilder();
        int paragraphs = 0;
        int tables = 0;
        int tableRows = 0;

        try (XWPFDocument doc = new XWPFDocument(in)) {
            for (IBodyElement el : doc.getBodyElements()) {
                if (el instanceof XWPFParagraph p) {
                    String line = p.getText();
                    if (line == null) continue;
                    line = line.strip();
                    if (line.isEmpty()) continue;
                    if (text.length() > 0) text.append('\n');
                    text.append(line);
                    paragraphs++;
                } else if (el instanceof XWPFTable t) {
                    tables++;
                    for (XWPFTableRow row : t.getRows()) {
                        String line = row.getTableCells().stream()
                                .map(c -> c.getText() == null ? "" : c.getText().strip())
                                .reduce((a, b) -> a + CELL_SEP + b)
                                .orElse("");
                        if (line.isEmpty()) continue;
                        if (text.length() > 0) text.append('\n');
                        text.append(line);
                        tableRows++;
                    }
                }
                if (text.length() > MAX_TEXT_CHARS) {
                    text.setLength(MAX_TEXT_CHARS);
                    break;
                }
            }
        }

        boolean truncated = text.length() >= MAX_TEXT_CHARS;
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("paragraphs", paragraphs);
        meta.put("tables", tables);
        meta.put("tableRows", tableRows);
        String summary = "正文约 " + text.length() + " 字，" + tables + " 个表格";
        return new ParsedFile(text.toString(), truncated, meta, summary);
    }
}
