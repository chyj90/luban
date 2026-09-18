package com.luban.storage;

import java.io.InputStream;
import java.nio.file.Path;

/**
 * 文件存储抽象。当前实现为本地磁盘（luban.file.storage-dir），
 * 未来可替换为 OSS/MinIO 等对象存储，上传方与读取方无感知。
 */
public interface FileStorage {

    /** 保存文件，返回相对存储路径（如 2026/09/uuid.docx） */
    String store(InputStream in, long size, String relativeName);

    /** 解析相对存储路径为可读 Path（本地实现） */
    Path resolve(String relativePath);

    /** 删除文件；文件不存在时静默返回 */
    void delete(String relativePath);
}
