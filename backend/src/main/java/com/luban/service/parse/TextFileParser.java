package com.luban.service.parse;

import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 纯文本解析器（txt/md/csv）。UTF-8 优先，解码失败降级 GBK；
 * CSV 额外提取首行表头（简单逗号切分，仅作元信息，不参与后续导库的列映射）。
 */
@Component
public class TextFileParser implements FileParser {

    static final int MAX_TEXT_CHARS = 4_000_000;

    @Override
    public boolean supports(String ext) {
        return "txt".equals(ext) || "md".equals(ext) || "csv".equals(ext);
    }

    @Override
    public ParsedFile parse(InputStream in, long size) throws IOException {
        byte[] bytes = in.readAllBytes();
        if (containsNullByte(bytes)) {
            throw new IllegalArgumentException("文本文件包含二进制内容，请确认文件格式");
        }
        String text = decode(bytes);
        boolean truncated = false;
        if (text.length() > MAX_TEXT_CHARS) {
            text = text.substring(0, MAX_TEXT_CHARS);
            truncated = true;
        }

        Map<String, Object> meta = new LinkedHashMap<>();
        int lines = countLines(text);
        meta.put("lines", lines);
        String summary = "共 " + lines + " 行";
        return new ParsedFile(text, truncated, meta, summary);
    }

    /** CSV 表头提取由 AgentFileService 按 ext 调用，解析器只负责文本本体 */
    public static java.util.List<String> csvHeaders(String text) {
        if (text == null || text.isEmpty()) {
            return java.util.List.of();
        }
        String firstLine = text.split("\r?\n", 2)[0];
        return Arrays.stream(firstLine.split(",", -1))
                .map(String::trim)
                .map(s -> s.replaceAll("^\"|\"$", ""))
                .toList();
    }

    private static boolean containsNullByte(byte[] bytes) {
        for (byte b : bytes) {
            if (b == 0) return true;
        }
        return false;
    }

    private static String decode(byte[] bytes) {
        int offset = 0;
        // UTF-8 BOM
        if (bytes.length >= 3 && (bytes[0] & 0xFF) == 0xEF && (bytes[1] & 0xFF) == 0xBB && (bytes[2] & 0xFF) == 0xBF) {
            return new String(bytes, 3, bytes.length - 3, StandardCharsets.UTF_8);
        }
        String utf8 = new String(bytes, offset, bytes.length - offset, StandardCharsets.UTF_8);
        if (!utf8.contains("\uFFFD")) {
            return utf8;
        }
        // 有替换符说明不是合法 UTF-8，尝试 GBK；再失败就带替换符返回
        String gbk = new String(bytes, Charset.forName("GBK"));
        return gbk.contains("\uFFFD") ? utf8 : gbk;
    }

    static int countLines(String text) {
        if (text.isEmpty()) return 0;
        int count = 1;
        ByteArrayInputStream buf = new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8));
        try (InputStream ignored = buf) {
            byte[] chunk = new byte[8192];
            int n;
            while ((n = buf.read(chunk)) > 0) {
                for (int i = 0; i < n; i++) {
                    if (chunk[i] == '\n') count++;
                }
            }
        } catch (IOException e) {
            // 内存流不会抛
        }
        return count;
    }
}
