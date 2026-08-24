package com.luban.service;

import com.luban.entity.ConceptJoinMapping;
import com.luban.repository.ConceptJoinMappingRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.NoSuchElementException;

@Slf4j
@Service
@RequiredArgsConstructor
public class ConceptJoinMappingService {

    private final ConceptJoinMappingRepository joinMappingRepository;

    @Transactional(readOnly = true)
    public List<ConceptJoinMapping> listByConcept(Long conceptId) {
        return joinMappingRepository.findByConceptId(conceptId);
    }

    @Transactional(readOnly = true)
    public List<ConceptJoinMapping> listByConceptAndDatasource(Long conceptId, Long datasourceId) {
        return joinMappingRepository.findByConceptIdAndDatasourceId(conceptId, datasourceId);
    }

    @Transactional(readOnly = true)
    public ConceptJoinMapping getById(Long id) {
        return joinMappingRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("JOIN 映射不存在: " + id));
    }

    @Transactional
    public ConceptJoinMapping create(ConceptJoinMapping mapping) {
        return joinMappingRepository.save(mapping);
    }

    @Transactional
    public ConceptJoinMapping update(Long id, ConceptJoinMapping updated) {
        ConceptJoinMapping existing = getById(id);
        if (updated.getTargetConcept() != null) existing.setTargetConcept(updated.getTargetConcept());
        if (updated.getRelationType() != null) existing.setRelationType(updated.getRelationType());
        if (updated.getJoinTable() != null) existing.setJoinTable(updated.getJoinTable());
        if (updated.getJoinCondition() != null) existing.setJoinCondition(updated.getJoinCondition());
        if (updated.getJoinType() != null) existing.setJoinType(updated.getJoinType());
        if (updated.getConfidence() != null) existing.setConfidence(updated.getConfidence());
        return joinMappingRepository.save(existing);
    }

    @Transactional
    public void delete(Long id) {
        joinMappingRepository.deleteById(id);
    }
}