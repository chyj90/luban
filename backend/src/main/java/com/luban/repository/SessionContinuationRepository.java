package com.luban.repository;

import com.luban.entity.SessionContinuation;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SessionContinuationRepository extends JpaRepository<SessionContinuation, String> {
}