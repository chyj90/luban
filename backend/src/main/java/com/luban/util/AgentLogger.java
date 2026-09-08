package com.luban.util;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

public class AgentLogger {

    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("HH:mm:ss");

    public static void bug(String fileName, String content) {
        String line = "[" + LocalDateTime.now().format(FMT) + "] " + content;
        System.out.println("[BUG] " + line);
        try {
            Files.write(Paths.get(fileName), (line + "\n").getBytes(),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException ignored) {
        }
    }

    public static void debug(String fileName, String content) {
        String line = "[" + LocalDateTime.now().format(FMT) + "] " + content;
        try {
            Files.write(Paths.get(fileName), (line + "\n").getBytes(),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException ignored) {
        }
    }
}