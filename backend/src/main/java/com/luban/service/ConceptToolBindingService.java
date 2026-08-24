package com.luban.service;

import com.luban.entity.ConceptToolBinding;
import com.luban.repository.ConceptToolBindingRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.NoSuchElementException;

@Slf4j
@Service
@RequiredArgsConstructor
public class ConceptToolBindingService {

    private final ConceptToolBindingRepository bindingRepository;

    @Transactional(readOnly = true)
    public List<ConceptToolBinding> listByConcept(Long conceptId) {
        return bindingRepository.findByConceptId(conceptId);
    }

    @Transactional(readOnly = true)
    public List<ConceptToolBinding> listByTool(Long toolId) {
        return bindingRepository.findByToolId(toolId);
    }

    @Transactional(readOnly = true)
    public List<ConceptToolBinding> listByConceptAndType(Long conceptId, String bindingType) {
        return bindingRepository.findByConceptIdAndBindingType(conceptId, bindingType);
    }

    @Transactional
    public ConceptToolBinding create(ConceptToolBinding binding) {
        return bindingRepository.save(binding);
    }

    @Transactional
    public void delete(Long id) {
        bindingRepository.deleteById(id);
    }

    @Transactional
    public List<ConceptToolBinding> batchSave(List<ConceptToolBinding> bindings) {
        return bindingRepository.saveAll(bindings);
    }
}