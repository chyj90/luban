package com.luban.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.AgentConfig;
import com.luban.entity.Concept;
import com.luban.entity.ConceptJoinMapping;
import com.luban.entity.ConceptMapping;
import com.luban.entity.Datasource;
import com.luban.entity.AsyncTask;
import com.luban.repository.AgentConfigRepository;
import com.luban.repository.ConceptJoinMappingRepository;
import com.luban.repository.ConceptMappingRepository;
import com.luban.repository.ConceptRepository;
import com.luban.repository.DatasourceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class ConceptMappingService {

    private final ConceptMappingRepository mappingRepository;
    private final ConceptJoinMappingRepository joinMappingRepository;
    private final ConceptRepository conceptRepository;
    private final DatasourceRepository datasourceRepository;
    private final AgentConfigRepository agentConfigRepository;
    private final AgentConfigService agentConfigService;
    private final DatasourceService datasourceService;
    private final AsyncTaskService asyncTaskService;

    private final ObjectMapper jsonMapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    @Transactional(readOnly = true)
    public List<ConceptMapping> listByConcept(Long conceptId) {
        return mappingRepository.findByConceptId(conceptId);
    }

    @Transactional(readOnly = true)
    public List<ConceptMapping> listByConceptAndDatasource(Long conceptId, Long datasourceId) {
        return mappingRepository.findByConceptIdAndDatasourceId(conceptId, datasourceId);
    }

    @Transactional(readOnly = true)
    public List<ConceptMapping> listByDatasource(Long datasourceId) {
        return mappingRepository.findByDatasourceId(datasourceId);
    }

    @Transactional(readOnly = true)
    public ConceptMapping getById(Long id) {
        return mappingRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("概念映射不存在: " + id));
    }

    @Transactional
    public ConceptMapping create(ConceptMapping mapping) {
        return mappingRepository.save(mapping);
    }

    @Transactional
    public ConceptMapping update(Long id, ConceptMapping updated) {
        ConceptMapping existing = getById(id);
        if (updated.getTableName() != null) existing.setTableName(updated.getTableName());
        if (updated.getColumnName() != null) existing.setColumnName(updated.getColumnName());
        if (updated.getAttributeName() != null) existing.setAttributeName(updated.getAttributeName());
        if (updated.getMappingType() != null) existing.setMappingType(updated.getMappingType());
        if (updated.getComputedExpr() != null) existing.setComputedExpr(updated.getComputedExpr());
        if (updated.getConfidence() != null) existing.setConfidence(updated.getConfidence());
        if (updated.getIsAuto() != null) existing.setIsAuto(updated.getIsAuto());
        if (updated.getIsRequired() != null) existing.setIsRequired(updated.getIsRequired());
        return mappingRepository.save(existing);
    }

    @Transactional
    public void delete(Long id) {
        mappingRepository.deleteById(id);
    }

    @Transactional
    public void deleteByConceptAndDatasource(Long conceptId, Long datasourceId) {
        mappingRepository.deleteByConceptIdAndDatasourceId(conceptId, datasourceId);
    }

    @Transactional
    public List<ConceptMapping> batchSave(List<ConceptMapping> mappings) {
        return mappingRepository.saveAll(mappings);
    }

    // ===== 自动映射（异步任务，按域批量处理） =====

    @SuppressWarnings("unchecked")
    public long submitAutoMatchByGroup(Long groupId, List<Long> datasourceIds, Long userId) {
        List<Concept> concepts = conceptRepository.findByGroupId(groupId);
        if (concepts.isEmpty()) {
            throw new IllegalArgumentException("该域下没有概念");
        }
        return submitAutoMatch(concepts, datasourceIds, userId, groupId);
    }

    public long submitAutoMatch(List<Long> conceptIds, List<Long> datasourceIds, Long userId) {
        List<Concept> concepts = conceptRepository.findAllById(conceptIds);
        if (concepts.isEmpty()) {
            throw new IllegalArgumentException("没有找到指定的概念");
        }
        return submitAutoMatch(concepts, datasourceIds, userId, null);
    }

    private long submitAutoMatch(List<Concept> concepts, List<Long> datasourceIds, Long userId, Long groupId) {

        AsyncTask task = asyncTaskService.createTask("AUTO_MATCH_MAPPINGS", concepts.size() + 2, userId);
        asyncTaskService.startTask(task.getId());

        Thread.startVirtualThread(() -> {
            try {
                asyncTaskService.updateProgress(task.getId(), 0, "正在获取数据源结构...");

                List<Datasource> datasources = datasourceRepository.findAllById(datasourceIds);
                if (datasources.isEmpty()) {
                    asyncTaskService.failTask(task.getId(), "没有可用的数据源");
                    return;
                }

                List<Map<String, Object>> dsStructures = new ArrayList<>();
                for (Datasource ds : datasources) {
                    try {
                        Map<String, Object> structure = datasourceService.getStructure(ds.getId());
                        Map<String, Object> dsInfo = new LinkedHashMap<>();
                        dsInfo.put("id", ds.getId());
                        dsInfo.put("name", ds.getName());
                        dsInfo.put("type", ds.getType());
                        dsInfo.put("structure", structure);
                        dsStructures.add(dsInfo);
                    } catch (Exception e) {
                        log.warn("[auto-match] 获取数据源 {} 结构失败: {}", ds.getName(), e.getMessage());
                    }
                }

                if (dsStructures.isEmpty()) {
                    asyncTaskService.failTask(task.getId(), "无法获取任何数据源的结构");
                    return;
                }

                List<Map<String, Object>> conceptResults = new ArrayList<>();
                List<Map<String, Object>> failedConcepts = new ArrayList<>();
                int processed = 0;

                for (Concept concept : concepts) {
                    asyncTaskService.updateProgress(task.getId(), processed + 1,
                            "正在匹配概念: " + concept.getName() + " (" + (processed + 1) + "/" + concepts.size() + ")");

                    String llmResponse = callLLMForAutoMatch(concept, dsStructures);
                    if (llmResponse != null) {
                        try {
                            Map<String, Object> parsed = jsonMapper.readValue(sanitizeJson(llmResponse), Map.class);
                            List<Map<String, Object>> candidates = (List<Map<String, Object>>) parsed.get("mappings");
                            List<Map<String, Object>> joinCandidates = (List<Map<String, Object>>) parsed.get("joinMappings");
                            if (candidates == null) candidates = Collections.emptyList();
                            if (joinCandidates == null) joinCandidates = Collections.emptyList();
                            // 补充数据源名称
                            for (Map<String, Object> candidate : candidates) {
                                Object dsIdObj = candidate.get("datasourceId");
                                if (dsIdObj instanceof Number) {
                                    long dsId = ((Number) dsIdObj).longValue();
                                    for (Datasource ds : datasources) {
                                        if (ds.getId().equals(dsId)) {
                                            candidate.put("datasourceName", ds.getName());
                                            break;
                                        }
                                    }
                                }
                            }
                            for (Map<String, Object> jc : joinCandidates) {
                                Object dsIdObj = jc.get("datasourceId");
                                if (dsIdObj instanceof Number) {
                                    long dsId = ((Number) dsIdObj).longValue();
                                    for (Datasource ds : datasources) {
                                        if (ds.getId().equals(dsId)) {
                                            jc.put("datasourceName", ds.getName());
                                            break;
                                        }
                                    }
                                }
                            }
                            Map<String, Object> cr = new LinkedHashMap<>();
                            cr.put("conceptId", concept.getId());
                            cr.put("conceptName", concept.getName());
                            cr.put("conceptDescription", concept.getDescription());
                            cr.put("candidates", candidates);
                            cr.put("joinCandidates", joinCandidates);
                            cr.put("total", candidates.size());
                            conceptResults.add(cr);
                        } catch (Exception e) {
                            log.warn("[auto-match] 解析概念 {} 的匹配结果失败: {}", concept.getName(), e.getMessage());
                            Map<String, Object> fc = new LinkedHashMap<>();
                            fc.put("conceptId", concept.getId());
                            fc.put("conceptName", concept.getName());
                            fc.put("reason", "解析失败: " + e.getMessage());
                            failedConcepts.add(fc);
                        }
                    } else {
                        log.warn("[auto-match] 概念 {} 匹配失败", concept.getName());
                        Map<String, Object> fc = new LinkedHashMap<>();
                        fc.put("conceptId", concept.getId());
                        fc.put("conceptName", concept.getName());
                        fc.put("reason", "LLM 调用失败");
                        failedConcepts.add(fc);
                    }
                    processed++;
                }

                asyncTaskService.updateProgress(task.getId(), concepts.size() + 1, "匹配完成");

                long matchedCount = conceptResults.stream().filter(cr -> {
                    Object total = cr.get("total");
                    return total instanceof Number n && n.intValue() > 0;
                }).count();
                long unmatchedCount = conceptResults.size() - matchedCount;

                Map<String, Object> result = new LinkedHashMap<>();
                if (groupId != null) {
                    result.put("groupId", groupId);
                }
                result.put("datasourceIds", datasourceIds);
                result.put("conceptResults", conceptResults);
                result.put("failedConcepts", failedConcepts);
                result.put("totalConcepts", concepts.size());
                result.put("matchedConcepts", (int) matchedCount);
                result.put("unmatchedConcepts", (int) unmatchedCount);
                asyncTaskService.completeTask(task.getId(), jsonMapper.writeValueAsString(result));
            } catch (Exception e) {
                log.error("[auto-match] 自动匹配失败: {}", e.getMessage(), e);
                asyncTaskService.failTask(task.getId(), "自动匹配失败: " + e.getMessage());
            }
        });

        return task.getId();
    }

    @SuppressWarnings("unchecked")
    @Transactional
    public Map<String, Object> applyAutoMatch(Long taskId, List<Map<String, Object>> selectedMappings, List<Map<String, Object>> selectedJoinMappings) {
        AsyncTask task = asyncTaskService.getTask(taskId);
        if (task == null || !"COMPLETED".equals(task.getStatus())) {
            return Map.of("error", "任务不存在或未完成");
        }

        try {
            List<ConceptMapping> allMappings = new ArrayList<>();
            for (Map<String, Object> item : selectedMappings) {
                ConceptMapping m = new ConceptMapping();
                m.setConceptId(item.get("conceptId") instanceof Number n ? n.longValue() : null);
                m.setDatasourceId(item.get("datasourceId") instanceof Number n ? n.longValue() : null);
                m.setTableName((String) item.get("tableName"));
                m.setColumnName((String) item.get("columnName"));
                m.setAttributeName((String) item.get("attributeName"));
                m.setMappingType((String) item.getOrDefault("mappingType", "direct"));
                m.setComputedExpr((String) item.get("computedExpr"));
                Object confidence = item.get("confidence");
                m.setConfidence(confidence instanceof Number n ? BigDecimal.valueOf(n.doubleValue()) : BigDecimal.valueOf(0.8));
                m.setIsAuto(true);
                m.setIsRequired(item.get("isRequired") instanceof Boolean b ? b : false);
                allMappings.add(m);
            }

            if (allMappings.isEmpty() && (selectedJoinMappings == null || selectedJoinMappings.isEmpty())) {
                return Map.of("error", "没有可应用的映射");
            }

            int createdMappings = 0;
            int skippedMappings = 0;
            if (!allMappings.isEmpty()) {
                Set<String> existingKeys = new HashSet<>();
                List<Long> conceptIds = allMappings.stream().map(ConceptMapping::getConceptId).filter(Objects::nonNull).distinct().toList();
                List<Long> dsIds = allMappings.stream().map(ConceptMapping::getDatasourceId).filter(Objects::nonNull).distinct().toList();
                if (!conceptIds.isEmpty() && !dsIds.isEmpty()) {
                    List<ConceptMapping> existing = mappingRepository.findByConceptIdInAndDatasourceIdIn(conceptIds, dsIds);
                    for (ConceptMapping em : existing) {
                        existingKeys.add(em.getConceptId() + ":" + em.getAttributeName() + ":" + em.getDatasourceId());
                    }
                }

                List<ConceptMapping> toSave = new ArrayList<>();
                for (ConceptMapping m : allMappings) {
                    String key = m.getConceptId() + ":" + m.getAttributeName() + ":" + m.getDatasourceId();
                    if (existingKeys.contains(key)) {
                        skippedMappings++;
                        continue;
                    }
                    toSave.add(m);
                    existingKeys.add(key);
                }

                if (!toSave.isEmpty()) {
                    mappingRepository.saveAll(toSave);
                    createdMappings = toSave.size();
                }
            }

            int createdJoins = 0;
            int skippedJoins = 0;
            if (selectedJoinMappings != null && !selectedJoinMappings.isEmpty()) {
                List<Long> joinConceptIds = selectedJoinMappings.stream()
                        .map(m -> m.get("conceptId") instanceof Number n ? n.longValue() : null)
                        .filter(Objects::nonNull).distinct().toList();
                List<Long> joinDsIds = selectedJoinMappings.stream()
                        .map(m -> m.get("datasourceId") instanceof Number n ? n.longValue() : null)
                        .filter(Objects::nonNull).distinct().toList();

                Set<String> existingJoinKeys = new HashSet<>();
                if (!joinConceptIds.isEmpty() && !joinDsIds.isEmpty()) {
                    List<ConceptJoinMapping> existingJoins = joinMappingRepository.findByConceptIdInAndDatasourceIdIn(joinConceptIds, joinDsIds);
                    for (ConceptJoinMapping ej : existingJoins) {
                        existingJoinKeys.add(ej.getConceptId() + ":" + ej.getTargetConcept() + ":" + ej.getRelationType() + ":" + ej.getDatasourceId());
                    }
                }

                List<ConceptJoinMapping> joinMappings = new ArrayList<>();
                for (Map<String, Object> item : selectedJoinMappings) {
                    Long cid = item.get("conceptId") instanceof Number n ? n.longValue() : null;
                    Long dsid = item.get("datasourceId") instanceof Number n ? n.longValue() : null;
                    String targetConcept = (String) item.get("targetConcept");
                    String relationType = (String) item.getOrDefault("relationType", "JOIN");
                    String key = cid + ":" + targetConcept + ":" + relationType + ":" + dsid;
                    if (existingJoinKeys.contains(key)) {
                        skippedJoins++;
                        continue;
                    }
                    ConceptJoinMapping jm = new ConceptJoinMapping();
                    jm.setConceptId(cid);
                    jm.setDatasourceId(dsid);
                    jm.setTargetConcept(targetConcept);
                    jm.setRelationType(relationType);
                    jm.setJoinTable((String) item.get("joinTable"));
                    jm.setJoinCondition((String) item.get("joinCondition"));
                    jm.setJoinType((String) item.getOrDefault("joinType", "LEFT"));
                    joinMappings.add(jm);
                    existingJoinKeys.add(key);
                }
                if (!joinMappings.isEmpty()) {
                    joinMappingRepository.saveAll(joinMappings);
                    createdJoins = joinMappings.size();
                }
            }

            return Map.of("created", createdMappings, "skipped", skippedMappings, "createdJoins", createdJoins,
                    "message", "已应用 " + createdMappings + " 条映射、 " + createdJoins + " 条 JOIN" + (skippedMappings > 0 ? "，跳过 " + skippedMappings + " 条已存在映射" : "") + (skippedJoins > 0 ? "，跳过 " + skippedJoins + " 条已存在JOIN" : ""));
        } catch (Exception e) {
            log.error("[auto-match] 应用映射失败: {}", e.getMessage(), e);
            return Map.of("error", "应用映射失败: " + e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    public long retryAutoMatch(Long taskId, List<Long> conceptIds, Long userId) {
        AsyncTask task = asyncTaskService.getTask(taskId);
        if (task == null || !"COMPLETED".equals(task.getStatus())) {
            throw new IllegalArgumentException("任务不存在或未完成");
        }

        Map<String, Object> originResult;
        try {
            originResult = jsonMapper.readValue(task.getResult(), Map.class);
        } catch (Exception e) {
            throw new IllegalArgumentException("无法解析任务结果");
        }

        List<Number> resolvedDsIds = resolveDatasourceIds(originResult);
        if (resolvedDsIds == null || resolvedDsIds.isEmpty()) {
            throw new IllegalArgumentException("原任务未记录数据源信息");
        }
        final List<Long> datasourceIds = resolvedDsIds.stream().map(Number::longValue).toList();

        List<Concept> concepts = conceptRepository.findAllById(conceptIds);
        if (concepts.isEmpty()) {
            throw new IllegalArgumentException("没有找到需要重试的概念");
        }

        AsyncTask newTask = asyncTaskService.createTask("AUTO_MATCH_MAPPINGS", concepts.size() + 2, userId);
        asyncTaskService.startTask(newTask.getId());

        Thread.startVirtualThread(() -> {
            try {
                asyncTaskService.updateProgress(newTask.getId(), 0, "正在获取数据源结构...");

                List<Datasource> datasources = datasourceRepository.findAllById(datasourceIds);
                if (datasources.isEmpty()) {
                    asyncTaskService.failTask(newTask.getId(), "没有可用的数据源");
                    return;
                }

                List<Map<String, Object>> dsStructures = new ArrayList<>();
                for (Datasource ds : datasources) {
                    try {
                        Map<String, Object> structure = datasourceService.getStructure(ds.getId());
                        Map<String, Object> dsInfo = new LinkedHashMap<>();
                        dsInfo.put("id", ds.getId());
                        dsInfo.put("name", ds.getName());
                        dsInfo.put("type", ds.getType());
                        dsInfo.put("structure", structure);
                        dsStructures.add(dsInfo);
                    } catch (Exception e) {
                        log.warn("[auto-match-retry] 获取数据源 {} 结构失败: {}", ds.getName(), e.getMessage());
                    }
                }

                if (dsStructures.isEmpty()) {
                    asyncTaskService.failTask(newTask.getId(), "无法获取任何数据源的结构");
                    return;
                }

                List<Map<String, Object>> conceptResults = new ArrayList<>();
                List<Map<String, Object>> failedConcepts = new ArrayList<>();
                int processed = 0;

                for (Concept concept : concepts) {
                    asyncTaskService.updateProgress(newTask.getId(), processed + 1,
                            "正在匹配概念: " + concept.getName() + " (" + (processed + 1) + "/" + concepts.size() + ")");

                    String llmResponse = callLLMForAutoMatch(concept, dsStructures);
                    if (llmResponse != null) {
                        try {
                            List<Map<String, Object>> candidates = jsonMapper.readValue(
                                    sanitizeJson(llmResponse), new TypeReference<List<Map<String, Object>>>() {});
                            for (Map<String, Object> candidate : candidates) {
                                Object dsIdObj = candidate.get("datasourceId");
                                if (dsIdObj instanceof Number) {
                                    long dsId = ((Number) dsIdObj).longValue();
                                    for (Datasource ds : datasources) {
                                        if (ds.getId().equals(dsId)) {
                                            candidate.put("datasourceName", ds.getName());
                                            break;
                                        }
                                    }
                                }
                            }
                            Map<String, Object> cr = new LinkedHashMap<>();
                            cr.put("conceptId", concept.getId());
                            cr.put("conceptName", concept.getName());
                            cr.put("conceptDescription", concept.getDescription());
                            cr.put("candidates", candidates);
                            cr.put("total", candidates.size());
                            conceptResults.add(cr);
                        } catch (Exception e) {
                            log.warn("[auto-match-retry] 解析概念 {} 的匹配结果失败: {}", concept.getName(), e.getMessage());
                            Map<String, Object> fc = new LinkedHashMap<>();
                            fc.put("conceptId", concept.getId());
                            fc.put("conceptName", concept.getName());
                            fc.put("reason", "解析失败: " + e.getMessage());
                            failedConcepts.add(fc);
                        }
                    } else {
                        log.warn("[auto-match-retry] 概念 {} 匹配失败", concept.getName());
                        Map<String, Object> fc = new LinkedHashMap<>();
                        fc.put("conceptId", concept.getId());
                        fc.put("conceptName", concept.getName());
                        fc.put("reason", "LLM 调用失败");
                        failedConcepts.add(fc);
                    }
                    processed++;
                }

                asyncTaskService.updateProgress(newTask.getId(), concepts.size() + 1, "重试匹配完成");

                long matchedCount = conceptResults.stream().filter(cr -> {
                    Object total = cr.get("total");
                    return total instanceof Number n && n.intValue() > 0;
                }).count();
                long unmatchedCount = conceptResults.size() - matchedCount;

                Map<String, Object> result = new LinkedHashMap<>();
                result.put("groupId", originResult.get("groupId"));
                result.put("datasourceIds", datasourceIds);
                result.put("retryFromTaskId", taskId);
                result.put("conceptResults", conceptResults);
                result.put("failedConcepts", failedConcepts);
                result.put("totalConcepts", concepts.size());
                result.put("matchedConcepts", (int) matchedCount);
                result.put("unmatchedConcepts", (int) unmatchedCount);
                asyncTaskService.completeTask(newTask.getId(), jsonMapper.writeValueAsString(result));
            } catch (Exception e) {
                log.error("[auto-match-retry] 重试失败: {}", e.getMessage(), e);
                asyncTaskService.failTask(newTask.getId(), "重试失败: " + e.getMessage());
            }
        });

        return newTask.getId();
    }

    @SuppressWarnings("unchecked")
    private List<Number> resolveDatasourceIds(Map<String, Object> originResult) {
        List<Number> dsIdNumbers = (List<Number>) originResult.get("datasourceIds");
        if (dsIdNumbers != null && !dsIdNumbers.isEmpty()) {
            return dsIdNumbers;
        }
        // 兼容旧任务：从候选结果中提取数据源 ID
        List<Map<String, Object>> conceptResults = (List<Map<String, Object>>) originResult.get("conceptResults");
        if (conceptResults == null) return null;
        Set<Long> dsIdSet = new LinkedHashSet<>();
        for (Map<String, Object> cr : conceptResults) {
            List<Map<String, Object>> candidates = (List<Map<String, Object>>) cr.get("candidates");
            if (candidates == null) continue;
            for (Map<String, Object> c : candidates) {
                Object dsId = c.get("datasourceId");
                if (dsId instanceof Number) {
                    dsIdSet.add(((Number) dsId).longValue());
                }
            }
        }
        return dsIdSet.isEmpty() ? null : new ArrayList<>(dsIdSet);
    }

    @SuppressWarnings("unchecked")
    private String callLLMForAutoMatch(Concept concept, List<Map<String, Object>> dsStructures) {
        try {
            AgentConfig config = agentConfigRepository.findByIsDefaultTrue().orElse(null);
            if (config == null) {
                log.warn("[auto-match] 无默认AgentConfig");
                return null;
            }

            String apiKey = agentConfigService.decrypt(config.getSecretKeyEnc());
            String baseUrl = config.getModelEndpoint();
            if (!baseUrl.endsWith("/v1")) {
                baseUrl = baseUrl.replaceAll("/+$", "") + "/v1";
            }

            StringBuilder dsDesc = new StringBuilder();
            for (Map<String, Object> ds : dsStructures) {
                dsDesc.append("数据源: ").append(ds.get("name"))
                        .append(" (ID: ").append(ds.get("id")).append(", 类型: ").append(ds.get("type")).append(")\n");
                Map<String, Object> structure = (Map<String, Object>) ds.get("structure");
                List<Map<String, Object>> tables = (List<Map<String, Object>>) structure.get("tables");
                if (tables != null) {
                    for (Map<String, Object> table : tables) {
                        dsDesc.append("  表: ").append(table.get("name")).append("\n");
                        List<Map<String, Object>> columns = (List<Map<String, Object>>) table.get("columns");
                        if (columns != null) {
                            for (Map<String, Object> col : columns) {
                                dsDesc.append("    - ").append(col.get("name"))
                                        .append(" (").append(col.get("type")).append(")")
                                        .append(Boolean.TRUE.equals(col.get("primaryKey")) ? " [主键]" : "")
                                        .append("\n");
                            }
                        }
                    }
                }
                // 追加表间关系推断提示
                dsDesc.append("\n");
            }

            String prompt = "你是一个数据库映射专家。请将概念与数据源的表字段进行智能匹配。\n\n"
                    + "概念信息：\n"
                    + "- 名称: " + concept.getName() + "\n"
                    + "- 描述: " + (concept.getDescription() != null ? concept.getDescription() : "无") + "\n\n"
                    + "数据源结构：\n" + dsDesc + "\n"
                    + "请分析概念的含义，从数据源表结构中找出最匹配的字段映射和跨表 JOIN 关系。\n\n"
                    + "返回一个 JSON 对象，包含两个数组：\n"
                    + "{\n"
                    + "  \"mappings\": [\n"
                    + "    {\n"
                    + "      \"datasourceId\": 数据源ID（数字）,\n"
                    + "      \"tableName\": \"表名\",\n"
                    + "      \"columnName\": \"列名\",\n"
                    + "      \"attributeName\": \"属性名（中文，如'姓名'、'编号'）\",\n"
                    + "      \"mappingType\": \"direct（直接映射）或 computed（计算字段）\",\n"
                    + "      \"confidence\": 0.0-1.0,\n"
                    + "      \"isRequired\": true/false\n"
                    + "    }\n"
                    + "  ],\n"
                    + "  \"joinMappings\": [\n"
                    + "    {\n"
                    + "      \"datasourceId\": 数据源ID（数字）,\n"
                    + "      \"targetConcept\": \"目标概念名（可选，如'课程'）\",\n"
                    + "      \"joinTable\": \"要JOIN的表名\",\n"
                    + "      \"joinCondition\": \"JOIN条件（如 students.id = enrollments.student_id）\",\n"
                    + "      \"joinType\": \"LEFT/RIGHT/INNER\"\n"
                    + "    }\n"
                    + "  ]\n"
                    + "}\n\n"
                    + "规则：\n"
                    + "1. 根据概念名称和描述推断它有哪些属性，然后匹配表字段\n"
                    + "2. 优先匹配语义相近的字段\n"
                    + "3. 所有字段映射用 mappingType=direct，除非是明确的计算字段\n"
                    + "4. 如果概念字段分散在多张表，字段映射中 tableName 填实际所在表名，同时在 joinMappings 中定义表间 JOIN 关系\n"
                    + "5. 外键推断：列名以 _id 结尾且不是主键的列，很可能是外键，如 student_id → students 表\n"
                    + "6. JOIN 条件规则：主表.主键 = 关联表.外键，如 \"students.id = enrollments.student_id\"\n"
                    + "7. id 类字段通常映射到主键，confidence 设为 0.95\n"
                    + "8. 名称完全匹配的字段 confidence 设为 0.9，语义相近的 0.7-0.8\n"
                    + "9. 只返回有把握的匹配（confidence >= 0.6）\n"
                    + "10. 只输出 JSON 对象，不要任何解释文字";

            List<Map<String, String>> messages = new ArrayList<>();
            messages.add(Map.of("role", "system", "content", "你是一个数据库映射专家。只输出 JSON，不要任何解释。"));
            messages.add(Map.of("role", "user", "content", prompt));

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", config.getModelName());
            body.put("messages", messages);
            body.put("temperature", 0.2);
            body.put("max_tokens", 8192);
            body.put("response_format", Map.of("type", "json_object"));

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/chat/completions"))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + apiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(jsonMapper.writeValueAsString(body)))
                    .timeout(Duration.ofSeconds(120))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() != 200) {
                log.warn("[auto-match] LLM响应异常: HTTP {}, body={}", response.statusCode(), response.body());
                return null;
            }

            Map<String, Object> respBody = jsonMapper.readValue(response.body(), Map.class);
            List<Map<String, Object>> choices = (List<Map<String, Object>>) respBody.get("choices");
            if (choices == null || choices.isEmpty()) return null;

            Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
            String content = (String) message.get("content");
            if (content == null || content.isEmpty()) return null;

            content = content.trim();
            if (content.startsWith("```")) {
                content = content.replaceAll("```json\\s*", "").replaceAll("```\\s*", "");
            }

            log.info("[auto-match] LLM响应: {} chars", content.length());
            return content;
        } catch (Exception e) {
            log.error("[auto-match] LLM调用异常: {}", e.getMessage(), e);
            return null;
        }
    }

    private String sanitizeJson(String json) {
        if (json == null) return null;
        String s = json.trim();
        if (s.startsWith("```")) {
            s = s.replaceAll("```json\\s*", "").replaceAll("```\\s*", "").trim();
        }
        int start = s.indexOf('{');
        if (start < 0) start = s.indexOf('[');
        if (start > 0) s = s.substring(start);
        if (s.isEmpty()) return json;

        int quoteCount = 0;
        boolean escaped = false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (escaped) { escaped = false; continue; }
            if (c == '\\') { escaped = true; continue; }
            if (c == '"') quoteCount++;
        }
        if (quoteCount % 2 != 0) {
            s = s + "\"";
            log.warn("[sanitize-json] 修复未闭合的字符串引号");
        }

        int braceCount = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '{' || c == '[') braceCount++;
            else if (c == '}' || c == ']') braceCount--;
        }
        char firstChar = s.charAt(0);
        char closingChar = firstChar == '{' ? '}' : ']';
        for (int i = 0; i < braceCount; i++) {
            s += closingChar;
        }
        if (braceCount > 0) {
            log.warn("[sanitize-json] 修复 {} 个未闭合的花括号/方括号", braceCount);
        }

        return s;
    }
}