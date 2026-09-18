package com.luban.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * Agent 附件文件：用户在前端开发 Agent 对话中上传的 Word/TXT/Excel。
 * 上传时后端解析一次，产出规范产物（提取文本 + 结构化元信息），
 * 对话上下文注入、按需读取、后续导入数据库/知识库都消费该产物。
 */
@Data
@NoArgsConstructor
@Entity
@Table(name = "agent_file")
public class AgentFile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 对外 ID（API/Skill 使用），UUID，不暴露自增主键 */
    @Column(name = "file_key", nullable = false, unique = true, length = 36)
    private String fileKey;

    /** 上传人 */
    @Column(name = "owner_user_id", nullable = false)
    private Long ownerUserId;

    /** 关联应用（可空 = 个人文件，暂存未来知识库场景） */
    @Column(name = "app_id")
    private Long appId;

    /** 原始文件名，仅展示用，绝不参与存储路径拼接 */
    @Column(name = "original_name", nullable = false, length = 500)
    private String originalName;

    /** 小写扩展名：docx/txt/md/csv/xlsx/xls */
    @Column(nullable = false, length = 16)
    private String ext;

    /** 业务归类：word/text/excel */
    @Column(name = "file_type", nullable = false, length = 16)
    private String fileType;

    @Column(name = "mime_type", length = 100)
    private String mimeType;

    @Column(name = "size_bytes", nullable = false)
    private Long sizeBytes;

    /** 相对存储路径（UUID 命名） */
    @Column(name = "storage_path", nullable = false, length = 500)
    private String storagePath;

    /** pending/success/failed */
    @Column(name = "parse_status", nullable = false, length = 16)
    private String parseStatus;

    @Column(name = "parse_error", length = 1000)
    private String parseError;

    /** 提取文本：Word 段落/表格线性化、TXT/CSV 原文 */
    @Column(name = "text_content", columnDefinition = "mediumtext")
    private String textContent;

    /** 提取文本长度（前端判断内联注入阈值用） */
    @Column(name = "content_chars", nullable = false)
    private Integer contentChars;

    /** 提取文本超上限被截断 */
    @Column(nullable = false)
    private Boolean truncated;

    /** 结构化元信息 JSON（excel: sheets/headers/previewRows；word: 段落/表格数） */
    @Column(name = "meta_json", columnDefinition = "mediumtext")
    private String metaJson;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
