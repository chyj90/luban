package com.luban.workflow.repository;

import com.luban.workflow.entity.WorkflowTask;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.LocalDateTime;
import java.util.List;

public interface WorkflowTaskRepository extends JpaRepository<WorkflowTask, Long> {
    List<WorkflowTask> findByInstanceId(Long instanceId);
    List<WorkflowTask> findByAssigneeId(Long assigneeId);
    List<WorkflowTask> findByAssigneeIdAndStatus(Long assigneeId, String status);
    List<WorkflowTask> findByAssigneeIdAndApplicationId(Long assigneeId, Long applicationId);
    List<WorkflowTask> findByAssigneeIdAndStatusAndApplicationId(Long assigneeId, String status, Long applicationId);
    List<WorkflowTask> findByInstanceIdAndNodeId(Long instanceId, String nodeId);
    List<WorkflowTask> findByAssigneeIdAndInstanceId(Long assigneeId, Long instanceId);
    List<WorkflowTask> findByStatusAndDeadlineBefore(String status, LocalDateTime deadline);
    long countByAssigneeIdAndStatus(Long assigneeId, String status);

    @Query("SELECT t FROM WorkflowTask t WHERE t.assigneeId = :assigneeId AND t.status = :status AND t.instanceId IN (SELECT i.id FROM WorkflowInstance i WHERE i.isTest = :isTest)")
    List<WorkflowTask> findByAssigneeIdAndStatusAndIsTest(@Param("assigneeId") Long assigneeId, @Param("status") String status, @Param("isTest") Boolean isTest);

    @Query("SELECT t FROM WorkflowTask t WHERE t.assigneeId = :assigneeId AND t.status = :status AND t.applicationId = :applicationId AND t.instanceId IN (SELECT i.id FROM WorkflowInstance i WHERE i.isTest = :isTest)")
    List<WorkflowTask> findByAssigneeIdAndStatusAndApplicationIdAndIsTest(@Param("assigneeId") Long assigneeId, @Param("status") String status, @Param("applicationId") Long applicationId, @Param("isTest") Boolean isTest);

    @Query("SELECT t FROM WorkflowTask t WHERE t.assigneeId = :assigneeId AND t.instanceId IN (SELECT i.id FROM WorkflowInstance i WHERE i.isTest = :isTest)")
    List<WorkflowTask> findByAssigneeIdAndIsTest(@Param("assigneeId") Long assigneeId, @Param("isTest") Boolean isTest);

    @Query("SELECT t FROM WorkflowTask t WHERE t.assigneeId = :assigneeId AND t.applicationId = :applicationId AND t.instanceId IN (SELECT i.id FROM WorkflowInstance i WHERE i.isTest = :isTest)")
    List<WorkflowTask> findByAssigneeIdAndApplicationIdAndIsTest(@Param("assigneeId") Long assigneeId, @Param("applicationId") Long applicationId, @Param("isTest") Boolean isTest);

    @Query("SELECT t FROM WorkflowTask t WHERE t.assigneeId = :assigneeId AND t.status <> 'PENDING' AND t.instanceId IN (SELECT i.id FROM WorkflowInstance i WHERE i.isTest = :isTest)")
    List<WorkflowTask> findCompletedByAssigneeIdAndIsTest(@Param("assigneeId") Long assigneeId, @Param("isTest") Boolean isTest);

    @Query("SELECT t FROM WorkflowTask t WHERE t.assigneeId = :assigneeId AND t.status <> 'PENDING' AND t.applicationId = :applicationId AND t.instanceId IN (SELECT i.id FROM WorkflowInstance i WHERE i.isTest = :isTest)")
    List<WorkflowTask> findCompletedByAssigneeIdAndApplicationIdAndIsTest(@Param("assigneeId") Long assigneeId, @Param("applicationId") Long applicationId, @Param("isTest") Boolean isTest);
}