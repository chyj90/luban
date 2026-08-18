package com.luban.service;

import com.luban.dto.CreateToolRequest;
import com.luban.entity.ToolDefinition;
import com.luban.repository.ToolDefinitionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class ToolService {

    private final ToolDefinitionRepository toolDefinitionRepository;

    public ToolService(ToolDefinitionRepository toolDefinitionRepository) {
        this.toolDefinitionRepository = toolDefinitionRepository;
    }

    public List<ToolDefinition> listByGroup(Long groupId) {
        return toolDefinitionRepository.findByGroupId(groupId);
    }

    public List<ToolDefinition> listByType(String toolType) {
        return toolDefinitionRepository.findByToolType(toolType);
    }

    public ToolDefinition getById(Long id) {
        return toolDefinitionRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("工具不存在: " + id));
    }

    @Transactional
    public ToolDefinition create(CreateToolRequest request, Long createdBy) {
        if (toolDefinitionRepository.findByName(request.getName()).isPresent()) {
            throw new RuntimeException("工具名称已存在: " + request.getName());
        }

        ToolDefinition tool = new ToolDefinition();
        tool.setName(request.getName());
        tool.setDisplayName(request.getDisplayName());
        tool.setDescription(request.getDescription());
        tool.setToolType(request.getToolType());
        tool.setGroupId(request.getGroupId());
        tool.setInputSchema(request.getInputSchema());
        tool.setOutputSchema(request.getOutputSchema());
        tool.setConfig(request.getConfig());
        tool.setCreatedBy(createdBy);

        return toolDefinitionRepository.save(tool);
    }

    @Transactional
    public ToolDefinition update(Long id, CreateToolRequest request) {
        ToolDefinition tool = getById(id);
        tool.setDisplayName(request.getDisplayName());
        tool.setDescription(request.getDescription());
        tool.setInputSchema(request.getInputSchema());
        tool.setOutputSchema(request.getOutputSchema());
        tool.setConfig(request.getConfig());
        return toolDefinitionRepository.save(tool);
    }

    @Transactional
    public void delete(Long id) {
        ToolDefinition tool = getById(id);
        tool.setStatus("DISABLED");
        toolDefinitionRepository.save(tool);
    }
}