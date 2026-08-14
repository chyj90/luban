package com.luban.workflow.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@Entity
@Table(name = "form_workflow_bindings")
public class FormWorkflowBinding {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long formId;

    @Column(nullable = false)
    private Long workflowId;

    private Integer workflowVersion;

    @Column(nullable = false, length = 20)
    private String bindingType;

    @Column(nullable = false)
    private Boolean isDefault = false;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        if (bindingType == null) bindingType = "ONE_TO_ONE";
        if (isDefault == null) isDefault = false;
    }
}