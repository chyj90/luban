package com.luban.util;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

public class AgentLogger {

    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("HH:mm:ss");

    /**
     * 写入调试日志到控制台和文件。文件位于项目根目录（与 pom.xml 同级）。
     * @param fileName 日志文件名，如 "bug-empty-tasks.log"
     * @param content  日志内容
     */
    public static void bug(String fileName, String content) {
        String line = "[" + LocalDateTime.now().format(FMT) + "] " + content;
        System.out.println("[BUG] " + line);
        try {
            Files.write(Paths.get(fileName), (line + "\n").getBytes(),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException ignored) {
        }
    }
}