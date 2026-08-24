package com.luban.service;

import com.luban.entity.Concept;
import com.luban.entity.OntologyGroup;
import com.luban.repository.ConceptRepository;
import com.luban.repository.OntologyGroupRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.NoSuchElementException;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class OntologyGroupService {

    private final OntologyGroupRepository groupRepository;
    private final ConceptRepository conceptRepository;
    private final ConceptService conceptService;

    @Transactional(readOnly = true)
    public List<OntologyGroup> list() {
        List<OntologyGroup> groups = groupRepository.findAll();
        groups.forEach(g -> g.setConceptCount(conceptRepository.countByGroupId(g.getId())));
        return groups;
    }

    @Transactional(readOnly = true)
    public List<OntologyGroup> listByIndustry(Long industryId) {
        List<OntologyGroup> groups;
        if (industryId == null) {
            groups = groupRepository.findAll();
        } else {
            groups = groupRepository.findByIndustryId(industryId);
        }
        groups.forEach(g -> g.setConceptCount(conceptRepository.countByGroupId(g.getId())));
        return groups;
    }

    @Transactional(readOnly = true)
    public OntologyGroup getById(Long id) {
        return groupRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("概念域不存在: " + id));
    }

    @Transactional
    public OntologyGroup create(OntologyGroup group) {
        if (groupRepository.existsByName(group.getName())) {
            throw new IllegalArgumentException("概念域名称已存在: " + group.getName());
        }
        return groupRepository.save(group);
    }

    @Transactional
    public OntologyGroup update(Long id, OntologyGroup updated) {
        OntologyGroup existing = getById(id);
        if (updated.getName() != null && !updated.getName().equals(existing.getName())
                && groupRepository.existsByName(updated.getName())) {
            throw new IllegalArgumentException("概念域名称已存在: " + updated.getName());
        }
        if (updated.getName() != null) existing.setName(updated.getName());
        if (updated.getDisplayName() != null) existing.setDisplayName(updated.getDisplayName());
        if (updated.getDescription() != null) existing.setDescription(updated.getDescription());
        if (updated.getIconUrl() != null) existing.setIconUrl(updated.getIconUrl());
        if (updated.getSortOrder() != null) existing.setSortOrder(updated.getSortOrder());
        if (updated.getIndustryId() != null) existing.setIndustryId(updated.getIndustryId());
        return groupRepository.save(existing);
    }

    @Transactional
    public void delete(Long id) {
        OntologyGroup group = getById(id);
        if (group.getIsSystem()) {
            throw new IllegalArgumentException("系统内置概念域不可删除");
        }
        List<Concept> concepts = conceptRepository.findByGroupId(id);
        if (!concepts.isEmpty()) {
            List<Long> conceptIds = concepts.stream().map(Concept::getId).collect(Collectors.toList());
            conceptService.deleteBatch(conceptIds);
        }
        groupRepository.deleteById(id);
    }
}