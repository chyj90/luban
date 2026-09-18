package com.luban.service.parse;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TextFileParserTest {

    private final TextFileParser parser = new TextFileParser();

    private ParsedFile parse(String content, Charset charset) throws IOException {
        return parser.parse(new ByteArrayInputStream(content.getBytes(charset)), content.length());
    }

    @Test
    void supportsTextAndMarkdownAndCsvOnly() {
        assertThat(parser.supports("txt")).isTrue();
        assertThat(parser.supports("md")).isTrue();
        assertThat(parser.supports("csv")).isTrue();
        assertThat(parser.supports("docx")).isFalse();
        assertThat(parser.supports("exe")).isFalse();
    }

    @Test
    void parsesUtf8WithBom() throws IOException {
        String content = "第一行\n第二行";
        byte[] bom = new byte[]{(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};
        byte[] bytes = concat(bom, content.getBytes(StandardCharsets.UTF_8));
        ParsedFile parsed = parser.parse(new ByteArrayInputStream(bytes), bytes.length);
        assertThat(parsed.textContent()).isEqualTo("第一行\n第二行");
        assertThat(parsed.meta()).containsEntry("lines", 2);
    }

    @Test
    void fallsBackToGbkWhenNotUtf8() throws IOException {
        String content = "订单明细表\n金额统计";
        ParsedFile parsed = parse(content, Charset.forName("GBK"));
        assertThat(parsed.textContent()).isEqualTo(content);
        assertThat(parsed.meta()).containsEntry("lines", 2);
    }

    @Test
    void rejectsBinaryContent() {
        byte[] binary = new byte[]{0x00, 0x01, 0x02, 0x03};
        assertThatThrownBy(() -> parser.parse(new ByteArrayInputStream(binary), binary.length))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("二进制");
    }

    @Test
    void csvHeadersSimpleAndQuoted() {
        List<String> headers = TextFileParser.csvHeaders("\"订单号\", 日期,金额\n1,2026-01-01,100");
        assertThat(headers).containsExactly("订单号", "日期", "金额");
    }

    private static byte[] concat(byte[] a, byte[] b) {
        byte[] out = new byte[a.length + b.length];
        System.arraycopy(a, 0, out, 0, a.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }
}
