package com.luban.repository;

import com.luban.entity.AsyncTask;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface AsyncTaskRepository extends JpaRepository<AsyncTask, Long> {

    List<AsyncTask> findAllByOrderByCreatedAtDesc();

    List<AsyncTask> findByTaskTypeOrderByCreatedAtDesc(String taskType);

    List<AsyncTask> findByStatusOrderByCreatedAtDesc(String status);

    List<AsyncTask> findByProcessedFalseOrderByCreatedAtDesc();

    Page<AsyncTask> findByProcessedTrueOrderByCreatedAtDesc(Pageable pageable);
}