package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "async_task")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AsyncTask {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "task_type", nullable = false, length = 32)
    private String taskType;

    @Column(nullable = false, length = 16)
    private String status = "PENDING";

    @Column(name = "progress", nullable = false)
    private int progress = 0;

    @Column(name = "total_steps", nullable = false)
    private int totalSteps = 0;

    @Column(name = "current_step", length = 255)
    private String currentStep;

    @Column(name = "result", columnDefinition = "MEDIUMTEXT")
    private String result;

    @Column(name = "error_msg", columnDefinition = "TEXT")
    private String errorMsg;

    @Column(name = "user_id")
    private Long userId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "finished_at")
    private LocalDateTime finishedAt;

    @Column(nullable = false)
    private boolean processed = false;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }

    public static AsyncTask create(String taskType, int totalSteps, Long userId) {
        AsyncTask task = new AsyncTask();
        task.taskType = taskType;
        task.totalSteps = totalSteps;
        task.userId = userId;
        task.status = "PENDING";
        return task;
    }
}