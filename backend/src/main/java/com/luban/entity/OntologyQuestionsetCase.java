package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

/**
 * 运行时追加的回归问题（区别于 classpath 内置问题集）。
 *
 * 内置问题集 JSON 打包在 jar 里只读；问数流量挖出的缺口问题由本表承接，
 * loadPackages 时按 packageName 合并进对应问题集，随下一次回归一起跑。
 * question 在包内去重，避免同一流量缺口被反复加入。
 */
@Entity
@Table(name = "ontology_questionset_case",
        uniqueConstraints = @UniqueConstraint(columnNames = {"package_name", "question"}))
@Data
@NoArgsConstructor
@AllArgsConstructor
public class OntologyQuestionsetCase {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "package_name", nullable = false, length = 64)
    private String packageName;

    @Column(name = "question", nullable = false, length = 500)
    private String question;

    /** 断言 JSON：{"mustHitConcepts": [...]}；空对象表示只检查执行成功与回答可用性 */
    @Column(name = "expect", columnDefinition = "JSON")
    private String expect;

    /** 来源：gap-insight（问题洞察）/ concept-guide（建概念引导）/ manual */
    @Column(name = "source", nullable = false, length = 32)
    private String source;

    @Column(name = "created_by", length = 64)
    private String createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
