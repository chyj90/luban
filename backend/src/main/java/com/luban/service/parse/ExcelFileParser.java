package com.luban.service.parse;

import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Excel(.xlsx/.xls) 解析器（POI）。提取各 sheet 维度、首行表头与前几行预览
 * 存入 meta；明细行不落库，file_sheet 请求时从原始文件重开工作簿按行读取。
 */
@Component
public class ExcelFileParser implements FileParser {

    static final int PREVIEW_ROWS = 3;
    static final int CELL_PREVIEW_LEN = 50;

    private final DataFormatter formatter = new DataFormatter();

    @Override
    public boolean supports(String ext) {
        return "xlsx".equals(ext) || "xls".equals(ext);
    }

    @Override
    public ParsedFile parse(InputStream in, long size) throws IOException {
        List<Map<String, Object>> sheets = new ArrayList<>();
        try (Workbook wb = WorkbookFactory.create(in)) {
            for (Sheet sheet : wb) {
                sheets.add(sheetMeta(sheet));
            }
        }

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("sheets", sheets);
        meta.put("previewRowCount", PREVIEW_ROWS);
        return new ParsedFile(null, false, meta, buildSummary(sheets));
    }

    private Map<String, Object> sheetMeta(Sheet sheet) {
        int lastRowNum = sheet.getLastRowNum();
        int rows = lastRowNum < 0 ? 0 : lastRowNum + 1;

        Row headerRow = findHeaderRow(sheet);
        List<String> headers = new ArrayList<>();
        int cols = 0;
        if (headerRow != null) {
            cols = headerRow.getLastCellNum() < 0 ? 0 : headerRow.getLastCellNum();
            for (int c = 0; c < cols; c++) {
                headers.add(cellValue(sheet, headerRow.getRowNum(), c));
            }
        }

        List<List<String>> previewRows = new ArrayList<>();
        if (headerRow != null) {
            int start = headerRow.getRowNum() + 1;
            for (int r = start; r <= lastRowNum && previewRows.size() < PREVIEW_ROWS; r++) {
                List<String> row = new ArrayList<>();
                for (int c = 0; c < cols; c++) {
                    row.add(cellValue(sheet, r, c));
                }
                previewRows.add(row);
            }
        }

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("name", sheet.getSheetName());
        meta.put("rows", rows);
        meta.put("cols", cols);
        meta.put("headerRowIndex", headerRow == null ? -1 : headerRow.getRowNum());
        meta.put("headers", headers);
        meta.put("previewRows", previewRows);
        return meta;
    }

    /**
     * 表头行 = 第一个非空单元格数 ≥2 的行。
     * 真实业务表常以合并单元格标题行开头（整行只有 1 个非空格），
     * 直接取首个非空行会把标题当表头、真表头掉进预览里。
     */
    private Row findHeaderRow(Sheet sheet) {
        Row firstNonEmpty = null;
        for (Row row : sheet) {
            int nonEmpty = 0;
            for (Cell cell : row) {
                if (cell != null && !formatter.formatCellValue(cell).isBlank()) {
                    nonEmpty++;
                    if (firstNonEmpty == null) firstNonEmpty = row;
                }
            }
            if (nonEmpty >= 2) {
                return row;
            }
        }
        return firstNonEmpty;
    }

    /** 单元格按显示值取文本并截断（预览/表头用），行读取复用同一格式化器 */
    String cellValue(Sheet sheet, int rowIdx, int colIdx) {
        Row row = sheet.getRow(rowIdx);
        if (row == null) return "";
        Cell cell = row.getCell(colIdx);
        if (cell == null) return "";
        String v = formatter.formatCellValue(cell).strip();
        if (v.length() > CELL_PREVIEW_LEN) {
            v = v.substring(0, CELL_PREVIEW_LEN) + "…";
        }
        return v;
    }

    private static String buildSummary(List<Map<String, Object>> sheets) {
        if (sheets.isEmpty()) return "空工作簿";
        StringBuilder sb = new StringBuilder(sheets.size() + " 个工作表：");
        int shown = 0;
        boolean omitted = false;
        for (Map<String, Object> s : sheets) {
            if (shown >= 3) {
                omitted = true;
                break;
            }
            if (shown > 0) sb.append("；");
            sb.append("「").append(s.get("name")).append("」")
              .append(s.get("rows")).append("行×").append(s.get("cols")).append("列");
            shown++;
        }
        if (omitted) sb.append(" 等");
        return sb.toString();
    }
}
