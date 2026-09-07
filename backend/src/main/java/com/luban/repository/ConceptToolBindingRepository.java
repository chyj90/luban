package com.luban.repository;

import com.luban.constant.BindingType;
import com.luban.entity.ConceptToolBinding;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface ConceptToolBindingRepository extends JpaRepository<ConceptToolBinding, Long> {
    List<ConceptToolBinding> findByConceptId(Long conceptId);
    List<ConceptToolBinding> findByToolId(Long toolId);
    Optional<ConceptToolBinding> findByConceptIdAndToolIdAndBindingType(Long conceptId, Long toolId, BindingType bindingType);
    List<ConceptToolBinding> findByConceptIdAndBindingType(Long conceptId, BindingType bindingType);
    List<ConceptToolBinding> findByToolIdAndBindingType(Long toolId, BindingType bindingType);
    List<ConceptToolBinding> findByConceptIdIn(List<Long> conceptIds);
    void deleteByConceptIdIn(List<Long> conceptIds);
}