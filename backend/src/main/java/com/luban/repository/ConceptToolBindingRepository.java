package com.luban.repository;

import com.luban.entity.ConceptToolBinding;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface ConceptToolBindingRepository extends JpaRepository<ConceptToolBinding, Long> {
    List<ConceptToolBinding> findByConceptId(Long conceptId);
    List<ConceptToolBinding> findByToolId(Long toolId);
    Optional<ConceptToolBinding> findByConceptIdAndToolIdAndBindingType(Long conceptId, Long toolId, String bindingType);
    List<ConceptToolBinding> findByConceptIdAndBindingType(Long conceptId, String bindingType);
    List<ConceptToolBinding> findByConceptIdIn(List<Long> conceptIds);
    void deleteByConceptIdIn(List<Long> conceptIds);
}