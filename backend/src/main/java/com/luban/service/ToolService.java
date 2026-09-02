package com.luban.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.dto.CreateToolRequest;
import com.luban.entity.ToolDefinition;
import com.luban.repository.ToolDefinitionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class ToolService {

    private final ToolDefinitionRepository toolDefinitionRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public ToolService(ToolDefinitionRepository toolDefinitionRepository) {
        this.toolDefinitionRepository = toolDefinitionRepository;
    }

    public List<ToolDefinition> listByGroup(Long groupId) {
        return toolDefinitionRepository.findByGroupIdAndScope(groupId, "PLATFORM");
    }

    public List<ToolDefinition> listByType(String toolType) {
        return toolDefinitionRepository.findByToolTypeAndScope(toolType, "PLATFORM");
    }

    public List<ToolDefinition> listAll() {
        return toolDefinitionRepository.findByScope("PLATFORM");
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
        validateJson(request.getInputSchema(), "inputSchema");
        validateJson(request.getConfig(), "config");

        ToolDefinition tool = new ToolDefinition();
        tool.setName(request.getName());
        tool.setDisplayName(request.getDisplayName());
        tool.setDescription(request.getDescription());
        tool.setToolType(request.getToolType());
        tool.setGroupId(request.getGroupId());
        if (request.getScope() != null) {
            tool.setScope(request.getScope());
        }
        tool.setInputSchema(request.getInputSchema());
        tool.setOutputSchema(request.getOutputSchema());
        tool.setConfig(request.getConfig());
        tool.setCreatedBy(createdBy);

        return toolDefinitionRepository.save(tool);
    }

    @Transactional
    public ToolDefinition update(Long id, CreateToolRequest request) {
        ToolDefinition tool = getById(id);
        validateJson(request.getInputSchema(), "inputSchema");
        validateJson(request.getConfig(), "config");
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
        toolDefinitionRepository.delete(tool);
    }

    private void validateJson(String json, String fieldName) {
        if (json == null || json.isBlank()) {
            return;
        }
        try {
            objectMapper.readTree(json);
        } catch (Exception e) {
            throw new RuntimeException(fieldName + " 不是有效的 JSON: " + e.getMessage());
        }
    }
}