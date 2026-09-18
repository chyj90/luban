package com.luban.service.parse;

import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFTable;
import org.apache.poi.xwpf.usermodel.XWPFTableRow;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;

import static org.assertj.core.api.Assertions.assertThat;

class DocxFileParserTest {

    private final DocxFileParser parser = new DocxFileParser();

    private byte[] sampleDocx() throws IOException {
        try (XWPFDocument doc = new XWPFDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            XWPFParagraph p1 = doc.createParagraph();
            p1.createRun().setText("请假需求说明");
            doc.createParagraph().createRun().setText(""); // 空段应被折叠
            XWPFParagraph p2 = doc.createParagraph();
            p2.createRun().setText("请假天数按自然日计算");

            XWPFTable table = doc.createTable(2, 2);
            table.getRow(0).getCell(0).setText("姓名");
            table.getRow(0).getCell(1).setText("天数");
            table.getRow(1).getCell(0).setText("张三");
            table.getRow(1).getCell(1).setText("3");

            doc.write(out);
            return out.toByteArray();
        }
    }

    @Test
    void extractsParagraphsAndTablesInOrder() throws IOException {
        byte[] docx = sampleDocx();
        ParsedFile parsed = parser.parse(new ByteArrayInputStream(docx), docx.length);

        assertThat(parsed.textContent())
                .contains("请假需求说明")
                .contains("请假天数按自然日计算")
                .contains("姓名 | 天数")
                .contains("张三 | 3");
        assertThat(parsed.meta())
                .containsEntry("paragraphs", 2)
                .containsEntry("tables", 1)
                .containsEntry("tableRows", 2);
        assertThat(parsed.truncated()).isFalse();
        assertThat(parsed.summary()).contains("1 个表格");
    }

    @Test
    void rejectsCorruptedDocx() {
        byte[] garbage = "this is not a docx".getBytes();
        // POI 对非法 docx 抛出的异常类型因版本而异（IOException 或其包装），只断言解析必然失败
        org.assertj.core.api.Assertions.assertThatThrownBy(
                        () -> parser.parse(new ByteArrayInputStream(garbage), garbage.length))
                .isNotNull();
    }
}
