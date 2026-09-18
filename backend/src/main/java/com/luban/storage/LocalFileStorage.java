package com.luban.storage;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/**
 * 本地磁盘存储。存储根目录可配置（默认 ./luban-files），Docker 部署时挂 volume 持久化。
 * relativeName 由调用方用 UUID 生成，绝不使用用户原始文件名，规避路径穿越。
 */
@Component
public class LocalFileStorage implements FileStorage {

    private final Path rootDir;

    public LocalFileStorage(@Value("${luban.file.storage-dir:./luban-files}") String storageDir) {
        this.rootDir = Path.of(storageDir).toAbsolutePath().normalize();
    }

    @Override
    public String store(InputStream in, long size, String relativeName) {
        Path target = resolve(relativeName);
        try {
            Files.createDirectories(target.getParent());
            try (in) {
                Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
            }
            return relativeName;
        } catch (IOException e) {
            throw new IllegalStateException("文件存储失败: " + e.getMessage(), e);
        }
    }

    @Override
    public Path resolve(String relativePath) {
        Path p = rootDir.resolve(relativePath).normalize();
        // 防御性校验：任何解析结果都必须落在根目录内
        if (!p.startsWith(rootDir)) {
            throw new IllegalArgumentException("非法存储路径: " + relativePath);
        }
        return p;
    }

    @Override
    public void delete(String relativePath) {
        try {
            Files.deleteIfExists(resolve(relativePath));
        } catch (IOException e) {
            // 删除失败不阻断主流程，孤儿文件可由运维清理
        }
    }
}
