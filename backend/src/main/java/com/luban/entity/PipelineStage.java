package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "pipeline_stage", indexes = {
    @Index(name = "idx_ps_pipeline_stage", columnList = "pipeline_id, stage")
})
@Data
@NoArgsConstructor
@AllArgsConstructor
public class PipelineStage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "pipeline_id", nullable = false, length = 64)
    private String pipelineId;

    @Column(name = "stage", nullable = false)
    private Integer stage;

    @Column(name = "name", nullable = false, length = 32)
    private String name;

    @Column(name = "status", nullable = false, length = 16)
    private String status;

    @Column(name = "input_json", columnDefinition = "JSON")
    private String inputJson;

    @Column(name = "output_json", columnDefinition = "JSON")
    private String outputJson;

    @Column(name = "detail_json", columnDefinition = "JSON")
    private String detailJson;

    @Column(name = "duration_ms")
    private Integer durationMs;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}