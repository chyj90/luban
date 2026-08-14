package com.luban.workflow.service;

import com.luban.workflow.entity.FormDefinition;
import com.luban.workflow.repository.FormDefinitionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class FormService {

    private final FormDefinitionRepository formDefinitionRepository;

    public List<FormDefinition> listByApplication(Long applicationId) {
        return formDefinitionRepository.findByApplicationId(applicationId);
    }

    public FormDefinition getById(Long id) {
        return formDefinitionRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("表单定义不存在: " + id));
    }

    @Transactional
    public FormDefinition create(FormDefinition form) {
        form.setVersion(1);
        form.setStatus("DRAFT");
        return formDefinitionRepository.save(form);
    }

    @Transactional
    public FormDefinition update(Long id, FormDefinition updated) {
        FormDefinition existing = getById(id);
        existing.setName(updated.getName());
        existing.setDescription(updated.getDescription());
        existing.setCodePageId(updated.getCodePageId());
        existing.setFields(updated.getFields());
        return formDefinitionRepository.save(existing);
    }

    @Transactional
    public FormDefinition publish(Long id) {
        FormDefinition form = getById(id);
        form.setStatus("PUBLISHED");
        return formDefinitionRepository.save(form);
    }

    @Transactional
    public void delete(Long id) {
        FormDefinition form = getById(id);
        if ("PUBLISHED".equals(form.getStatus())) {
            throw new RuntimeException("已发布的表单不能删除，请先下线");
        }
        formDefinitionRepository.deleteById(id);
    }

    @Transactional
    public FormDefinition copy(Long id) {
        FormDefinition source = getById(id);
        FormDefinition copy = new FormDefinition();
        copy.setApplicationId(source.getApplicationId());
        copy.setName(source.getName() + " (副本)");
        copy.setDescription(source.getDescription());
        copy.setCodePageId(source.getCodePageId());
        copy.setFields(source.getFields());
        copy.setVersion(1);
        copy.setStatus("DRAFT");
        copy.setCreatedBy(source.getCreatedBy());
        return formDefinitionRepository.save(copy);
    }

    public Map<String, Object> getPreview(Long id) {
        FormDefinition form = getById(id);
        Map<String, Object> preview = new LinkedHashMap<>();
        preview.put("id", form.getId());
        preview.put("name", form.getName());
        preview.put("description", form.getDescription());
        preview.put("fields", form.getFields());
        preview.put("status", form.getStatus());
        preview.put("version", form.getVersion());
        return preview;
    }
}