package com.luban.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@Entity
@Table(name = "queries")
public class Query {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long applicationId;

    @Column(nullable = false)
    private Long datasourceId;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(columnDefinition = "text")
    private String body;

    @Column(columnDefinition = "text")
    private String params;

    /** 查询说明（洞察沉淀时记录原始问题） */
    @Column(columnDefinition = "text")
    private String description;

    /** 查询来源：INSIGHT=智能洞察沉淀，空=应用开发创建 */
    @Column(length = 20)
    private String source;

    /**
     * 平台发布标记：非空 = 已发布为平台资产，值为所属系统（ToolGroup）id。
     * 发布不复制行——源应用保留编辑/删除权，订阅方按系统权限运行；
     * 工具定义（qry_{id}）里的 queryId 引用本行，修改 SQL 平台侧即时生效。
     */
    @Column(name = "published_group_id")
    private Long publishedGroupId;

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