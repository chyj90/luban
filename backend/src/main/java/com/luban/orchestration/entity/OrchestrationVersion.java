package com.luban.orchestration.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

/** 不可变编排版本：每次保存生成新版本，发布即固定该版本供消费方使用。 */
@Data
@Entity
@Table(name = "orchestration_versions",
       uniqueConstraints = @UniqueConstraint(name = "uk_orch_def_ver",
               columnNames = {"definition_id", "version"}))
public class OrchestrationVersion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "definition_id", nullable = false)
    private Long definitionId;

    @Column(nullable = false)
    private Integer version;

    @Column(nullable = false, columnDefinition = "JSON")
    private String dsl;

    @Column(nullable = false, length = 64)
    private String checksum; // sha256(dsl)，变更检测

    /** 发布固化目标清单（capability manifest）：["QUERY:1","TOOL:3","ORCHESTRATION:8","FLOW:2"]；发布时写入 */
    @Column(name = "targets", columnDefinition = "JSON")
    private String targets;

    @Column(name = "created_by", nullable = false)
    private Long createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;
}
