package com.luban.service;

import com.luban.entity.Industry;
import com.luban.entity.IndustryRelation;
import com.luban.repository.IndustryRelationRepository;
import com.luban.repository.IndustryRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.NoSuchElementException;

@Slf4j
@Service
@RequiredArgsConstructor
public class IndustryService {

    private final IndustryRepository industryRepository;
    private final IndustryRelationRepository industryRelationRepository;

    @Transactional(readOnly = true)
    public List<Industry> list() {
        return industryRepository.findAll();
    }

    @Transactional(readOnly = true)
    public Industry getById(Long id) {
        return industryRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("行业不存在: " + id));
    }

    @Transactional
    public Industry create(Industry industry) {
        if (industryRepository.existsByName(industry.getName())) {
            throw new IllegalArgumentException("行业名称已存在: " + industry.getName());
        }
        return industryRepository.save(industry);
    }

    @Transactional
    public Industry update(Long id, Industry updated) {
        Industry existing = getById(id);
        if (updated.getName() != null && !updated.getName().equals(existing.getName())
                && industryRepository.existsByName(updated.getName())) {
            throw new IllegalArgumentException("行业名称已存在: " + updated.getName());
        }
        if (updated.getName() != null) existing.setName(updated.getName());
        if (updated.getDisplayName() != null) existing.setDisplayName(updated.getDisplayName());
        if (updated.getDescription() != null) existing.setDescription(updated.getDescription());
        return industryRepository.save(existing);
    }

    @Transactional
    public void delete(Long id) {
        Industry industry = getById(id);
        industryRelationRepository.deleteByIndustryId(id);
        industryRepository.delete(industry);
        log.info("删除行业 '{}' 及其关系清单", industry.getName());
    }

    @Transactional(readOnly = true)
    public List<IndustryRelation> getRelations(Long industryId) {
        return industryRelationRepository.findByIndustryIdOrderBySortOrder(industryId);
    }

    @Transactional
    public List<IndustryRelation> saveRelations(Long industryId, List<IndustryRelation> relations) {
        industryRelationRepository.deleteByIndustryId(industryId);
        industryRelationRepository.flush();
        for (int i = 0; i < relations.size(); i++) {
            relations.get(i).setIndustryId(industryId);
            if (relations.get(i).getSortOrder() == null) {
                relations.get(i).setSortOrder(i);
            }
        }
        return industryRelationRepository.saveAll(relations);
    }

    @Transactional
    public IndustryRelation addRelation(Long industryId, IndustryRelation relation) {
        relation.setIndustryId(industryId);
        if (relation.getSortOrder() == null) {
            List<IndustryRelation> existing = getRelations(industryId);
            relation.setSortOrder(existing.size());
        }
        return industryRelationRepository.save(relation);
    }

    @Transactional
    public void deleteRelation(Long relationId) {
        industryRelationRepository.deleteById(relationId);
    }

    public String toPromptString(Long industryId) {
        List<IndustryRelation> relations = getRelations(industryId);
        if (relations.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (IndustryRelation r : relations) {
            sb.append(r.getRelationType())
                    .append("(").append(r.getDescription() != null ? r.getDescription() : "").append("), ");
        }
        if (sb.length() > 2) {
            sb.setLength(sb.length() - 2);
        }
        return sb.toString();
    }
}