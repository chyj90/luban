package com.luban.workflow.repository;

import com.luban.workflow.entity.FormWorkflowBinding;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface FormWorkflowBindingRepository extends JpaRepository<FormWorkflowBinding, Long> {
    List<FormWorkflowBinding> findByFormId(Long formId);
    List<FormWorkflowBinding> findByWorkflowId(Long workflowId);
    Optional<FormWorkflowBinding> findByFormIdAndIsDefaultTrue(Long formId);
    Optional<FormWorkflowBinding> findByFormIdAndWorkflowId(Long formId, Long workflowId);
    void deleteByWorkflowIdIn(List<Long> workflowIds);
}