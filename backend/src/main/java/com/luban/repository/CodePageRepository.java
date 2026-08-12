package com.luban.repository;

import com.luban.entity.CodePage;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface CodePageRepository extends JpaRepository<CodePage, Long> {
    Optional<CodePage> findByPageId(Long pageId);
    void deleteByPageId(Long pageId);
}