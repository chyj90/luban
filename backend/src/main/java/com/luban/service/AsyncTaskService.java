package com.luban.service;

import com.luban.entity.AsyncTask;
import com.luban.repository.AsyncTaskRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class AsyncTaskService {

    private final AsyncTaskRepository taskRepository;

    public AsyncTask createTask(String taskType, int totalSteps, Long userId) {
        AsyncTask task = AsyncTask.create(taskType, totalSteps, userId);
        return taskRepository.save(task);
    }

    public AsyncTask getTask(Long id) {
        return taskRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("任务不存在: " + id));
    }

    public List<AsyncTask> listPendingTasks() {
        return taskRepository.findByProcessedFalseOrderByCreatedAtDesc();
    }

    public Page<AsyncTask> listProcessedTasks(int page, int size) {
        return taskRepository.findByProcessedTrueOrderByCreatedAtDesc(PageRequest.of(page, size));
    }

    public void markProcessed(Long taskId) {
        AsyncTask task = getTask(taskId);
        task.setProcessed(true);
        taskRepository.save(task);
    }

    public void startTask(Long taskId) {
        AsyncTask task = getTask(taskId);
        task.setStatus("RUNNING");
        taskRepository.save(task);
    }

    public void updateProgress(Long taskId, int progress, String currentStep) {
        AsyncTask task = getTask(taskId);
        task.setProgress(progress);
        task.setCurrentStep(currentStep);
        taskRepository.save(task);
    }

    public void completeTask(Long taskId, String result) {
        AsyncTask task = getTask(taskId);
        task.setStatus("COMPLETED");
        task.setProgress(task.getTotalSteps());
        task.setResult(result);
        task.setFinishedAt(LocalDateTime.now());
        taskRepository.save(task);
    }

    public void failTask(Long taskId, String errorMsg) {
        AsyncTask task = getTask(taskId);
        task.setStatus("FAILED");
        task.setErrorMsg(errorMsg);
        task.setFinishedAt(LocalDateTime.now());
        taskRepository.save(task);
    }

    public List<AsyncTask> getTasksByType(String taskType) {
        return taskRepository.findByTaskTypeOrderByCreatedAtDesc(taskType);
    }
}