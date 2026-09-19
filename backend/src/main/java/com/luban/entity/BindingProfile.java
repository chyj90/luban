package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

/**
 * 绑定集（Binding Profile）：一个数据源一套"这张物理库如何映射到通用概念"的绑定。
 * 概念（concept）保持与表无关的集团级口径；本表承载该数据源专属的语义资产：
 * 术语词典（方言同义词 → 概念/规范值）与枚举字典（列的已知枚举值，供 value_origins 校验免实连）。
 * 映射本身仍存于 concept_mapping / concept_join_mapping（按 datasource_id 归属本 profile）。
 */
@Entity
@Table(name = "binding_profile", uniqueConstraints = @UniqueConstraint(columnNames = "datasource_id"))
@Data
@NoArgsConstructor
@AllArgsConstructor
public class BindingProfile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "datasource_id", nullable = false)
    private Long datasourceId;

    @Column(nullable = false, length = 128)
    private String name;

    @Column(columnDefinition = "TEXT")
    private String description;

    /** ACTIVE = 已有映射覆盖；EMPTY = 尚未绑定任何概念 */
    @Column(nullable = false, length = 16)
    private String status = "EMPTY";

    /**
     * 术语词典 JSON：[{"term":"立账组织","synonyms":["公司代码"],"conceptName":"公司","note":"用友叫法"}]
     * 问数 prompt 注入，帮助 LLM 把分公司方言对齐到集团概念口径。
     */
    @Column(name = "synonym_dict", columnDefinition = "TEXT")
    private String synonymDict;

    /**
     * 枚举字典 JSON：[{"table":"orders","column":"status","values":["PAID","NEW"],"syncedAt":"..."}]
     * value_origins 校验优先查此字典，未建条目才实连数据源。
     */
    @Column(name = "enum_dict", columnDefinition = "TEXT")
    private String enumDict;

    @Column(name = "created_by", length = 64)
    private String createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
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
