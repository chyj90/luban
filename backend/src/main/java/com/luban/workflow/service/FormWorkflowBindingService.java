package com.luban.workflow.service;

import com.luban.workflow.entity.FormWorkflowBinding;
import com.luban.workflow.entity.WorkflowDefinition;
import com.luban.workflow.repository.FormWorkflowBindingRepository;
import com.luban.workflow.repository.WorkflowDefinitionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class FormWorkflowBindingService {

    private final FormWorkflowBindingRepository bindingRepository;
    private final WorkflowDefinitionRepository workflowDefinitionRepository;

    public List<FormWorkflowBinding> listByFormId(Long formId) {
        return bindingRepository.findByFormId(formId);
    }

    public List<FormWorkflowBinding> listByWorkflowId(Long workflowId) {
        return bindingRepository.findByWorkflowId(workflowId);
    }

    public List<FormWorkflowBinding> listByApplicationId(Long applicationId) {
        List<WorkflowDefinition> workflows = workflowDefinitionRepository.findByApplicationId(applicationId);
        List<FormWorkflowBinding> result = new ArrayList<>();
        for (WorkflowDefinition wf : workflows) {
            result.addAll(bindingRepository.findByWorkflowId(wf.getId()));
        }
        return result;
    }

    public FormWorkflowBinding getDefaultForForm(Long formId) {
        return bindingRepository.findByFormIdAndIsDefaultTrue(formId)
                .orElse(null);
    }

    @Transactional
    public FormWorkflowBinding bind(Long formId, Long workflowId, Integer workflowVersion,
                                     String bindingType, Boolean isDefault) {
        // 检查是否已存在绑定
        bindingRepository.findByFormIdAndWorkflowId(formId, workflowId)
                .ifPresent(b -> {
                    throw new RuntimeException("表单与流程已存在绑定关系");
                });

        // 如果设为默认，先取消其他默认
        if (Boolean.TRUE.equals(isDefault)) {
            bindingRepository.findByFormIdAndIsDefaultTrue(formId)
                    .ifPresent(b -> {
                        b.setIsDefault(false);
                        bindingRepository.save(b);
                    });
        }

        FormWorkflowBinding binding = new FormWorkflowBinding();
        binding.setFormId(formId);
        binding.setWorkflowId(workflowId);
        binding.setWorkflowVersion(workflowVersion);
        binding.setBindingType(bindingType != null ? bindingType : "ONE_TO_ONE");
        binding.setIsDefault(isDefault != null ? isDefault : false);
        return bindingRepository.save(binding);
    }

    @Transactional
    public FormWorkflowBinding updateBinding(Long id, Integer workflowVersion, String bindingType, Boolean isDefault) {
        FormWorkflowBinding binding = bindingRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("绑定关系不存在: " + id));

        if (workflowVersion != null) {
            binding.setWorkflowVersion(workflowVersion);
        }
        if (bindingType != null) {
            binding.setBindingType(bindingType);
        }
        if (Boolean.TRUE.equals(isDefault)) {
            bindingRepository.findByFormIdAndIsDefaultTrue(binding.getFormId())
                    .ifPresent(b -> {
                        if (!b.getId().equals(id)) {
                            b.setIsDefault(false);
                            bindingRepository.save(b);
                        }
                    });
            binding.setIsDefault(true);
        }

        return bindingRepository.save(binding);
    }

    @Transactional
    public void unbind(Long id) {
        bindingRepository.deleteById(id);
    }

    @Transactional
    public void setDefault(Long id) {
        FormWorkflowBinding binding = bindingRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("绑定关系不存在: " + id));

        bindingRepository.findByFormIdAndIsDefaultTrue(binding.getFormId())
                .ifPresent(b -> {
                    if (!b.getId().equals(id)) {
                        b.setIsDefault(false);
                        bindingRepository.save(b);
                    }
                });

        binding.setIsDefault(true);
        bindingRepository.save(binding);
    }
}