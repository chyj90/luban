package com.luban.repository;

import com.luban.entity.Application;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;

public interface ApplicationRepository extends JpaRepository<Application, Long> {
    List<Application> findByCreatedBy(Long createdBy);

    @Query("SELECT DISTINCT a FROM Application a JOIN WorkflowDefinition wd ON a.id = wd.applicationId WHERE wd.status = 'PUBLISHED'")
    List<Application> findAllWithPublishedWorkflows();
}