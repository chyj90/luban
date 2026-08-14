package com.luban.workflow.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import java.io.InputStream;
import java.util.*;

@Service
public class ExcelImportService {

    private final ObjectMapper objectMapper = new ObjectMapper();

    public ExcelParseResult parse(MultipartFile file, List<Map<String, String>> columnMapping) {
        ExcelParseResult result = new ExcelParseResult();
        result.rows = new ArrayList<>();
        result.errors = new ArrayList<>();

        try (InputStream is = file.getInputStream();
             Workbook workbook = new XSSFWorkbook(is)) {

            Sheet sheet = workbook.getSheetAt(0);
            if (sheet.getPhysicalNumberOfRows() == 0) {
                result.errors.add(new ExcelError(0, "文件为空"));
                return result;
            }

            Row headerRow = sheet.getRow(0);
            if (headerRow == null) {
                result.errors.add(new ExcelError(0, "未找到表头行"));
                return result;
            }

            List<String> headers = new ArrayList<>();
            for (int i = 0; i < headerRow.getLastCellNum(); i++) {
                Cell cell = headerRow.getCell(i);
                headers.add(getCellValueAsString(cell));
            }
            result.headers = headers;
            result.totalRows = sheet.getPhysicalNumberOfRows() - 1;

            Map<String, String> columnMap = new HashMap<>();
            for (Map<String, String> mapping : columnMapping) {
                String excelColumn = mapping.get("excelColumn");
                String fieldKey = mapping.get("fieldKey");
                if (excelColumn != null && fieldKey != null) {
                    columnMap.put(excelColumn, fieldKey);
                }
            }

            for (int rowIdx = 1; rowIdx <= sheet.getLastRowNum(); rowIdx++) {
                Row row = sheet.getRow(rowIdx);
                if (row == null) continue;

                Map<String, Object> rowData = new LinkedHashMap<>();
                boolean hasData = false;

                for (int colIdx = 0; colIdx < headers.size(); colIdx++) {
                    Cell cell = row.getCell(colIdx);
                    String value = getCellValueAsString(cell);
                    if (value != null && !value.isEmpty()) {
                        hasData = true;
                    }
                    String fieldKey = columnMap.getOrDefault(headers.get(colIdx), headers.get(colIdx));
                    rowData.put(fieldKey, value);
                }

                if (hasData) {
                    result.rows.add(new ExcelRow(rowIdx, rowData));
                }
            }

            result.validRows = result.rows.size();
            result.errorRows = result.errors.size();
        } catch (Exception e) {
            result.errors.add(new ExcelError(0, "文件解析失败: " + e.getMessage()));
        }

        return result;
    }

    public List<Map<String, String>> guessColumnMapping(List<String> excelHeaders, List<String> fieldKeys) {
        List<Map<String, String>> mapping = new ArrayList<>();
        for (String excelHeader : excelHeaders) {
            String bestMatch = null;
            double bestScore = 0;
            for (String fieldKey : fieldKeys) {
                double score = similarity(excelHeader.toLowerCase(), fieldKey.toLowerCase());
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = fieldKey;
                }
            }

            Map<String, String> entry = new LinkedHashMap<>();
            entry.put("excelColumn", excelHeader);
            entry.put("fieldKey", bestScore > 0.5 ? bestMatch : "");
            mapping.add(entry);
        }
        return mapping;
    }

    private double similarity(String a, String b) {
        if (a.equals(b)) return 1.0;
        if (a.contains(b) || b.contains(a)) return 0.8;
        return 0.0;
    }

    private String getCellValueAsString(Cell cell) {
        if (cell == null) return "";
        return switch (cell.getCellType()) {
            case STRING -> cell.getStringCellValue().trim();
            case NUMERIC -> {
                if (DateUtil.isCellDateFormatted(cell)) {
                    yield cell.getLocalDateTimeCellValue().toString();
                }
                double val = cell.getNumericCellValue();
                if (val == Math.floor(val) && !Double.isInfinite(val)) {
                    yield String.valueOf((long) val);
                }
                yield String.valueOf(val);
            }
            case BOOLEAN -> String.valueOf(cell.getBooleanCellValue());
            case FORMULA -> {
                try {
                    yield cell.getStringCellValue().trim();
                } catch (Exception e) {
                    yield String.valueOf(cell.getNumericCellValue());
                }
            }
            default -> "";
        };
    }

    public static class ExcelParseResult {
        public List<String> headers;
        public List<ExcelRow> rows;
        public List<ExcelError> errors;
        public int totalRows;
        public int validRows;
        public int errorRows;
    }

    public record ExcelRow(int rowIndex, Map<String, Object> data) {}

    public record ExcelError(int rowIndex, String message) {}
}