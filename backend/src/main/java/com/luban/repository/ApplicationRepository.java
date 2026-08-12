package com.luban.repository;

import com.luban.entity.Application;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ApplicationRepository extends JpaRepository<Application, Long> {
    List<Application> findByWorkspaceId(Long workspaceId);
}