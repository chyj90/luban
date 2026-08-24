package com.luban.service;

import com.luban.entity.ConceptEmbeddingTask;
import com.luban.repository.ConceptEmbeddingTaskRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class ConceptEmbeddingTaskService {

    private final ConceptEmbeddingTaskRepository taskRepository;

    public List<ConceptEmbeddingTask> listTasks() {
        return taskRepository.findAllByOrderByCreatedAtDesc();
    }

    public ConceptEmbeddingTask getTask(Long id) {
        return taskRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("任务不存在"));
    }
}