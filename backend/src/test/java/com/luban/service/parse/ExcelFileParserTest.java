package com.luban.service.parse;

import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ExcelFileParserTest {

    private final ExcelFileParser parser = new ExcelFileParser();

    @SuppressWarnings("unchecked")
    private byte[] sampleXlsx() throws IOException {
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = wb.createSheet("订单明细");
            Row header = sheet.createRow(0);
            header.createCell(0).setCellValue("订单号");
            header.createCell(1).setCellValue("金额");
            for (int i = 1; i <= 5; i++) {
                Row row = sheet.createRow(i);
                row.createCell(0).setCellValue("SO-2026-" + i);
                row.createCell(1).setCellValue(i * 100.5);
            }

            Sheet emptySheet = wb.createSheet("空表");
            emptySheet.createRow(0);

            wb.write(out);
            return out.toByteArray();
        }
    }

    @Test
    void extractsSheetDimsHeadersAndPreview() throws IOException {
        byte[] xlsx = sampleXlsx();
        ParsedFile parsed = parser.parse(new ByteArrayInputStream(xlsx), xlsx.length);

        Object sheetsObj = parsed.meta().get("sheets");
        assertThat(sheetsObj).isInstanceOf(List.class);
        List<Map<String, Object>> sheets = (List<Map<String, Object>>) sheetsObj;
        assertThat(sheets).hasSize(2);

        Map<String, Object> orders = sheets.get(0);
        assertThat(orders.get("name")).isEqualTo("订单明细");
        assertThat(orders.get("rows")).isEqualTo(6);
        assertThat(orders.get("cols")).isEqualTo(2);
        assertThat(orders.get("headerRowIndex")).isEqualTo(0);
        assertThat((List<String>) orders.get("headers")).containsExactly("订单号", "金额");
        List<List<String>> preview = (List<List<String>>) orders.get("previewRows");
        assertThat(preview).hasSize(3);
        assertThat(preview.get(0)).containsExactly("SO-2026-1", "100.5");

        assertThat(parsed.summary()).contains("订单明细").contains("6行×2列");
    }

    @Test
    void treatsMergedTitleRowAsNotHeader() throws IOException {
        byte[] bytes;
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = wb.createSheet("清单");
            sheet.createRow(0).createCell(0).setCellValue("无线网元基本信息需求清单"); // 合并标题行
            Row header = sheet.createRow(1);
            header.createCell(0).setCellValue("序号");
            header.createCell(1).setCellValue("属性中文名称");
            Row data = sheet.createRow(2);
            data.createCell(0).setCellValue("1");
            data.createCell(1).setCellValue("gNodeB标识");
            wb.write(out);
            bytes = out.toByteArray();
        }
        ParsedFile parsed = parser.parse(new ByteArrayInputStream(bytes), bytes.length);

        @SuppressWarnings("unchecked")
        Map<String, Object> sheet = ((List<Map<String, Object>>) parsed.meta().get("sheets")).get(0);
        assertThat((List<String>) sheet.get("headers")).containsExactly("序号", "属性中文名称");
        @SuppressWarnings("unchecked")
        List<List<String>> preview = (List<List<String>>) sheet.get("previewRows");
        assertThat(preview.get(0)).containsExactly("1", "gNodeB标识");
    }

    @Test
    void rejectsCorruptedWorkbook() {
        byte[] garbage = new byte[]{'P', 'K', 3, 4, 0, 0, 0, 0};
        org.assertj.core.api.Assertions.assertThatThrownBy(
                        () -> parser.parse(new ByteArrayInputStream(garbage), garbage.length))
                .isNotNull();
    }
}
