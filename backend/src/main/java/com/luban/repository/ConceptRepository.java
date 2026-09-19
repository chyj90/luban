package com.luban.repository;

import com.luban.entity.Concept;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.time.LocalDateTime;
import java.util.List;

public interface ConceptRepository extends JpaRepository<Concept, Long> {

    /** 本体图对账指纹用：概念内容最后一次更新时间 */
    @Query("select max(c.updatedAt) from Concept c")
    LocalDateTime maxUpdatedAt();
    List<Concept> findByGroupId(Long groupId);
    List<Concept> findByGroupIdOrGroupIdIsNull(Long groupId);
    List<Concept> findByName(String name);
    List<Concept> findByNameContaining(String keyword);
    List<Concept> findByIdIn(List<Long> ids);
    long countByGroupId(Long groupId);
    void deleteByGroupId(Long groupId);
    long countByEmbeddingIsNotNull();
}