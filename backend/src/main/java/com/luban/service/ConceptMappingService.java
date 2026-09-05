package com.luban.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import net.sf.jsqlparser.JSQLParserException;
import net.sf.jsqlparser.parser.CCJSqlParserUtil;
import net.sf.jsqlparser.schema.Column;
import net.sf.jsqlparser.schema.Table;
import com.luban.entity.AgentConfig;
import com.luban.entity.Concept;
import com.luban.entity.ConceptJoinMapping;
import com.luban.entity.ConceptMapping;
import com.luban.entity.Datasource;
import com.luban.entity.AsyncTask;
import com.luban.entity.ConceptRelation;
import com.luban.constant.OntologyOperationType;
import com.luban.repository.AgentConfigRepository;
import com.luban.repository.ConceptJoinMappingRepository;
import com.luban.repository.ConceptMappingRepository;
import com.luban.repository.ConceptRelationRepository;
import com.luban.repository.ConceptRepository;
import com.luban.repository.DatasourceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class ConceptMappingService {

    private final ConceptMappingRepository mappingRepository;
    private final ConceptJoinMappingRepository joinMappingRepository;
    private final ConceptRelationRepository relationRepository;
    private final ConceptRepository conceptRepository;
    private final DatasourceRepository datasourceRepository;
    private final AgentConfigRepository agentConfigRepository;
    private final AgentConfigService agentConfigService;
    private final DatasourceService datasourceService;
    private final AsyncTaskService asyncTaskService;
    private final FaissService faissService;
    private final OntologyService ontologyService;
    private final TransactionTemplate transactionTemplate;

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

                Map<String, Set<String>> tableColumnIndex = buildTableColumnIndex(dsStructures);

                buildColumnIndexIfNeeded(dsStructures, datasources);

                List<Map<String, Object>> conceptResults = new ArrayList<>();
                List<Map<String, Object>> failedConcepts = new ArrayList<>();
                int processed = 0;

                for (Concept concept : concepts) {
                    asyncTaskService.updateProgress(task.getId(), processed + 1,
                            "正在匹配概念: " + concept.getName() + " (" + (processed + 1) + "/" + concepts.size() + ")");

                    Map<String, Object> matchResult = matchConceptWithRetry(concept, dsStructures, tableColumnIndex, datasources);
                    if (matchResult.containsKey("candidates")) {
                        conceptResults.add(matchResult);
                    } else {
                        failedConcepts.add(matchResult);
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

    // ===== V2: 规则优先 + LLM 兜底 =====

    public long submitAutoMatchV2(List<Long> conceptIds, List<Long> datasourceIds, Long userId) {
        List<Concept> concepts = conceptRepository.findAllById(conceptIds);
        if (concepts.isEmpty()) {
            throw new IllegalArgumentException("没有找到指定的概念");
        }
        AsyncTask task = asyncTaskService.createTask("AUTO_MATCH_MAPPINGS_V2", concepts.size() + 3, userId);
        asyncTaskService.startTask(task.getId());
        Thread.startVirtualThread(() -> {
            try {
                asyncTaskService.updateProgress(task.getId(), 0, "正在获取数据源结构...");
                List<Datasource> datasources = datasourceRepository.findAllById(datasourceIds);
                if (datasources.isEmpty()) { asyncTaskService.failTask(task.getId(), "没有可用的数据源"); return; }
                List<Map<String, Object>> dsStructures = new ArrayList<>();
                for (Datasource ds : datasources) {
                    try {
                        Map<String, Object> structure = datasourceService.getStructure(ds.getId());
                        Map<String, Object> dsInfo = new LinkedHashMap<>();
                        dsInfo.put("id", ds.getId()); dsInfo.put("name", ds.getName()); dsInfo.put("type", ds.getType());
                        dsInfo.put("structure", structure); dsStructures.add(dsInfo);
                    } catch (Exception e) { log.warn("[v2] 获取数据源 {} 结构失败: {}", ds.getName(), e.getMessage()); }
                }
                if (dsStructures.isEmpty()) { asyncTaskService.failTask(task.getId(), "无法获取任何数据源的结构"); return; }
                Map<String, Set<String>> tableColumnIndex = buildTableColumnIndex(dsStructures);
                buildColumnIndexIfNeeded(dsStructures, datasources);
                asyncTaskService.updateProgress(task.getId(), 1, "正在执行规则匹配...");
                List<Concept> uncoveredConcepts = new ArrayList<>();
                Map<Long, List<Map<String, Object>>> conceptRuleMappings = new LinkedHashMap<>();
                Map<Long, List<Map<String, Object>>> conceptRuleJoinMappings = new LinkedHashMap<>();
                int processed = 0;
                for (Concept concept : concepts) {
                    processed++;
                    asyncTaskService.updateProgress(task.getId(), processed + 1, "规则匹配: " + concept.getName() + " (" + processed + "/" + concepts.size() + ")");
                    List<Map<String, Object>> prunedDs = pruneDatasourceForConcept(concept, dsStructures);
                    Map<String, Object> ruleMatch = ruleMatchConcept(concept, prunedDs, tableColumnIndex, datasources);
                    List<Map<String, Object>> ruleMappings = (List<Map<String, Object>>) ruleMatch.get("mappings");
                    List<Map<String, Object>> ruleJoins = (List<Map<String, Object>>) ruleMatch.get("joinMappings");
                    conceptRuleMappings.put(concept.getId(), ruleMappings != null ? ruleMappings : new ArrayList<>());
                    conceptRuleJoinMappings.put(concept.getId(), ruleJoins != null ? ruleJoins : new ArrayList<>());
                    boolean hasDirect = ruleMappings != null && ruleMappings.stream().anyMatch(m -> "direct".equals(m.get("mappingType")));
                    boolean hasComputed = ruleMappings != null && ruleMappings.stream().anyMatch(m -> "computed".equals(m.get("mappingType")));
                    if (!hasDirect && !hasComputed) { uncoveredConcepts.add(concept); }
                }
                long ruleCoveredCount = concepts.size() - uncoveredConcepts.size();
                log.info("[v2] 规则覆盖 {}/{} 概念，{} 个需 LLM 兜底", ruleCoveredCount, concepts.size(), uncoveredConcepts.size());
                asyncTaskService.updateProgress(task.getId(), concepts.size() + 2, "规则匹配完成，准备 LLM 兜底...");
                List<Map<String, Object>> llmResults = new ArrayList<>();
                if (!uncoveredConcepts.isEmpty()) {
                    llmResults = llmFallbackBatch(uncoveredConcepts, dsStructures, tableColumnIndex, datasources, conceptRuleMappings, conceptRuleJoinMappings);
                }
                Map<Long, List<Map<String, Object>>> finalMappings = new LinkedHashMap<>(conceptRuleMappings);
                Map<Long, List<Map<String, Object>>> finalJoinMappings = new LinkedHashMap<>(conceptRuleJoinMappings);
                for (Map<String, Object> lr : llmResults) {
                    Long cId = ((Number) lr.get("conceptId")).longValue();
                    List<Map<String, Object>> lm = (List<Map<String, Object>>) lr.get("mappings");
                    List<Map<String, Object>> lj = (List<Map<String, Object>>) lr.get("joinMappings");
                    finalMappings.merge(cId, lm != null ? lm : new ArrayList<>(), (a, b) -> { var m = new ArrayList<>(a); m.addAll(b); return m; });
                    finalJoinMappings.merge(cId, lj != null ? lj : new ArrayList<>(), (a, b) -> { var m = new ArrayList<>(a); m.addAll(b); return m; });
                }
                List<Map<String, Object>> conceptResults = new ArrayList<>();
                List<Map<String, Object>> failedConcepts = new ArrayList<>();
                for (Concept concept : concepts) {
                    List<Map<String, Object>> mappings = finalMappings.getOrDefault(concept.getId(), new ArrayList<>());
                    List<Map<String, Object>> joins = finalJoinMappings.getOrDefault(concept.getId(), new ArrayList<>());
                    Map<String, Object> cr = new LinkedHashMap<>();
                    cr.put("conceptId", concept.getId()); cr.put("conceptName", concept.getName());
                    cr.put("conceptDescription", concept.getDescription());
                    cr.put("candidates", mappings); cr.put("joinCandidates", joins); cr.put("total", mappings.size());
                    cr.put("source", uncoveredConcepts.stream().anyMatch(c -> c.getId().equals(concept.getId())) ? "rule+llm" : "rule");
                    if (mappings.isEmpty() && joins.isEmpty()) {
                        Map<String, Object> fc = new LinkedHashMap<>();
                        fc.put("conceptId", concept.getId()); fc.put("conceptName", concept.getName());
                        fc.put("reason", uncoveredConcepts.stream().anyMatch(c -> c.getId().equals(concept.getId())) ? "规则和LLM均未匹配到字段" : "规则未匹配到字段且无需LLM兜底");
                        failedConcepts.add(fc);
                    }
                    conceptResults.add(cr);
                }
                long matchedCount = conceptResults.stream().filter(cr -> cr.get("total") instanceof Number n && n.intValue() > 0).count();
                Long groupId = concepts.stream().map(Concept::getGroupId).filter(g -> g != null).findFirst().orElse(null);
                Map<String, Object> result = new LinkedHashMap<>();
                if (groupId != null) result.put("groupId", groupId);
                result.put("datasourceIds", datasourceIds); result.put("conceptResults", conceptResults);
                result.put("totalConcepts", concepts.size()); result.put("matchedConcepts", (int) matchedCount);
                result.put("unmatchedConcepts", (int) (concepts.size() - matchedCount));
                result.put("ruleCoveredConcepts", (int) ruleCoveredCount); result.put("llmFallbackConcepts", uncoveredConcepts.size());
                result.put("failedConcepts", failedConcepts);
                asyncTaskService.completeTask(task.getId(), jsonMapper.writeValueAsString(result));
            } catch (Exception e) { log.error("[v2] 自动匹配失败: {}", e.getMessage(), e); asyncTaskService.failTask(task.getId(), "自动匹配失败: " + e.getMessage()); }
        });
        return task.getId();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> ruleMatchConcept(Concept concept, List<Map<String, Object>> prunedDsStructures,
                                                  Map<String, Set<String>> tableColumnIndex, List<Datasource> datasources) {
        List<Map<String, Object>> mappings = new ArrayList<>();
        List<Map<String, Object>> joinMappings = new ArrayList<>();
        Map<String, Object> expansion = expandConceptViaJena(concept);
        Set<String> conceptKeywords = (Set<String>) expansion.get("keywords");
        Set<String> embeddingHitColumns = new LinkedHashSet<>();
        List<Float> conceptEmbedding = null;
        try {
            Set<String> embeddingTexts = (Set<String>) expansion.get("embeddingText");
            conceptEmbedding = faissService.getEmbedding(String.join(" ", embeddingTexts));
        } catch (Exception e) { log.warn("[rule] 获取概念 embedding 失败: {}", e.getMessage()); }
        if (conceptEmbedding != null) {
            try {
                for (Map<String, Object> r : faissService.searchColumns(conceptEmbedding, 30)) {
                    double score = r.get("score") instanceof Number n ? n.doubleValue() : 0.0;
                    if (score >= 0.5) embeddingHitColumns.add((String) r.get("id"));
                }
            } catch (Exception e) { log.warn("[rule] 列 embedding 搜索失败: {}", e.getMessage()); }
        }
        for (Map<String, Object> ds : prunedDsStructures) {
            long dsId = ((Number) ds.get("id")).longValue();
            String dsName = (String) ds.get("name");
            Map<String, Object> structure = (Map<String, Object>) ds.get("structure");
            List<Map<String, Object>> tables = (List<Map<String, Object>>) structure.get("tables");
            if (tables == null) continue;
            for (Map<String, Object> table : tables) {
                String tableName = (String) table.get("name");
                List<Map<String, Object>> cols = (List<Map<String, Object>>) table.get("columns");
                if (cols == null) continue;
                for (Map<String, Object> col : cols) {
                    String colName = (String) col.get("name");
                    String colComment = (String) col.getOrDefault("comment", "");
                    boolean exactMatch = false;
                    for (String kw : conceptKeywords) {
                        if (colComment.equals(kw) || colComment.startsWith(kw + "(") || colComment.startsWith(kw + "（")) { exactMatch = true; break; }
                    }
                    if (exactMatch) {
                        Map<String, Object> m = new LinkedHashMap<>();
                        m.put("datasourceId", dsId); m.put("datasourceName", dsName);
                        m.put("tableName", tableName); m.put("columnName", colName);
                        m.put("attributeName", concept.getName()); m.put("mappingType", "direct");
                        m.put("confidence", 0.95); m.put("rule", "exact_comment_match");
                        mappings.add(m); continue;
                    }
                    if (embeddingHitColumns.contains(tableName + "." + colName)) {
                        boolean commentContainsKw = false;
                        for (String kw : conceptKeywords) { if (kw.length() >= 2 && colComment.contains(kw)) { commentContainsKw = true; break; } }
                        if (commentContainsKw) {
                            Map<String, Object> m = new LinkedHashMap<>();
                            m.put("datasourceId", dsId); m.put("datasourceName", dsName);
                            m.put("tableName", tableName); m.put("columnName", colName);
                            m.put("attributeName", concept.getName()); m.put("mappingType", "direct");
                            m.put("confidence", 0.85); m.put("rule", "embedding_and_comment_match");
                            mappings.add(m);
                        }
                    }
                }
            }
            if (tables.size() >= 2) {
                for (int i = 0; i < tables.size(); i++) {
                    for (int j = i + 1; j < tables.size(); j++) {
                        ruleJoinBySameNamePK(tables.get(i), tables.get(j), dsId, dsName, joinMappings);
                    }
                }
            }
        }
        List<ConceptRelation> computedFromRels = relationRepository.findBySourceConceptIdAndRelationType(
                concept.getId(), OntologyOperationType.BuiltinRelation.COMPUTED_FROM.name());
        if (!computedFromRels.isEmpty() && !mappings.isEmpty()) {
            for (ConceptRelation rel : computedFromRels) {
                if (rel.getExpression() != null && !rel.getExpression().isBlank()) {
                    List<ConceptMapping> factorMappings = mappingRepository.findByConceptId(rel.getTargetConceptId());
                    if (!factorMappings.isEmpty()) {
                        Map<String, Object> cm = new LinkedHashMap<>();
                        cm.put("datasourceId", mappings.get(0).get("datasourceId")); cm.put("datasourceName", mappings.get(0).get("datasourceName"));
                        cm.put("tableName", mappings.get(0).get("tableName")); cm.put("columnName", concept.getName());
                        cm.put("attributeName", concept.getName()); cm.put("mappingType", "computed");
                        cm.put("computedExpr", rel.getExpression()); cm.put("confidence", 0.7);
                        cm.put("rule", "computed_from_relation"); cm.put("factorConceptId", rel.getTargetConceptId());
                        mappings.add(cm);
                    }
                }
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("mappings", mappings); result.put("joinMappings", joinMappings);
        return result;
    }

    @SuppressWarnings("unchecked")
    private void ruleJoinBySameNamePK(Map<String, Object> t1, Map<String, Object> t2,
                                       long dsId, String dsName, List<Map<String, Object>> joinMappings) {
        String t1Name = (String) t1.get("name"); String t2Name = (String) t2.get("name");
        List<Map<String, Object>> t1Cols = (List<Map<String, Object>>) t1.get("columns");
        List<Map<String, Object>> t2Cols = (List<Map<String, Object>>) t2.get("columns");
        if (t1Cols == null || t2Cols == null) return;
        Set<String> t1ColNames = t1Cols.stream().map(c -> (String) c.get("name")).collect(Collectors.toSet());
        Set<String> t2ColNames = t2Cols.stream().map(c -> (String) c.get("name")).collect(Collectors.toSet());
        Set<String> t2PkCols = t2Cols.stream().filter(c -> Boolean.TRUE.equals(c.get("primaryKey"))).map(c -> (String) c.get("name")).collect(Collectors.toSet());
        Set<String> t1PkCols = t1Cols.stream().filter(c -> Boolean.TRUE.equals(c.get("primaryKey"))).map(c -> (String) c.get("name")).collect(Collectors.toSet());
        Set<String> sharedWithT2Pk = new LinkedHashSet<>(t1ColNames); sharedWithT2Pk.retainAll(t2PkCols);
        if (!sharedWithT2Pk.isEmpty() && sharedWithT2Pk.size() == t2PkCols.size()) {
            String joinCond = sharedWithT2Pk.stream().map(col -> t1Name + "." + col + " = " + t2Name + "." + col).collect(Collectors.joining(" AND "));
            Map<String, Object> jm = new LinkedHashMap<>();
            jm.put("datasourceId", dsId); jm.put("datasourceName", dsName); jm.put("joinTable", t2Name);
            jm.put("joinCondition", joinCond); jm.put("joinType", "LEFT"); jm.put("confidence", 0.85); jm.put("rule", "same_name_pk");
            joinMappings.add(jm); return;
        }
        Set<String> sharedWithT1Pk = new LinkedHashSet<>(t2ColNames); sharedWithT1Pk.retainAll(t1PkCols);
        if (!sharedWithT1Pk.isEmpty() && sharedWithT1Pk.size() == t1PkCols.size()) {
            String joinCond = sharedWithT1Pk.stream().map(col -> t1Name + "." + col + " = " + t2Name + "." + col).collect(Collectors.joining(" AND "));
            Map<String, Object> jm = new LinkedHashMap<>();
            jm.put("datasourceId", dsId); jm.put("datasourceName", dsName); jm.put("joinTable", t2Name);
            jm.put("joinCondition", joinCond); jm.put("joinType", "LEFT"); jm.put("confidence", 0.85); jm.put("rule", "same_name_pk");
            joinMappings.add(jm);
        }
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> llmFallbackBatch(List<Concept> uncoveredConcepts, List<Map<String, Object>> dsStructures,
                                                        Map<String, Set<String>> tableColumnIndex, List<Datasource> datasources,
                                                        Map<Long, List<Map<String, Object>>> existingMappings, Map<Long, List<Map<String, Object>>> existingJoins) {
        List<Map<String, Object>> results = new ArrayList<>();
        Map<Long, List<Map<String, Object>>> conceptPrunedDs = new LinkedHashMap<>();
        for (Concept concept : uncoveredConcepts) { conceptPrunedDs.put(concept.getId(), pruneDatasourceForConcept(concept, dsStructures)); }

        String errorHint = null;
        List<Map<String, Object>> validMappings = new ArrayList<>();
        List<Map<String, Object>> validJoins = new ArrayList<>();

        for (int attempt = 0; attempt <= MAX_AUTO_MATCH_RETRIES; attempt++) {
            validMappings.clear(); validJoins.clear();
            String llmResponse = callLLMForBatchMatch(uncoveredConcepts, conceptPrunedDs, existingMappings, existingJoins, errorHint);
            if (llmResponse == null) {
                if (attempt == 0) {
                    log.warn("[v2] LLM 批量兜底调用失败");
                    for (Concept c : uncoveredConcepts) { results.add(Map.of("conceptId", c.getId(), "conceptName", c.getName(), "mappings", new ArrayList<>(), "joinMappings", new ArrayList<>())); }
                    return results;
                }
                break;
            }
            try {
                Map<String, Object> parsed = jsonMapper.readValue(sanitizeJson(llmResponse), Map.class);
                List<Map<String, Object>> allMappings = (List<Map<String, Object>>) parsed.getOrDefault("mappings", new ArrayList<>());
                List<Map<String, Object>> allJoins = (List<Map<String, Object>>) parsed.getOrDefault("joinMappings", new ArrayList<>());
                List<String> errors = new ArrayList<>();
                for (Map<String, Object> m : allMappings) {
                    String mappingType = (String) m.getOrDefault("mappingType", "direct");
                    String tbl = (String) m.get("tableName"); String col = (String) m.get("columnName"); String expr = (String) m.get("computedExpr");
                    if ("computed".equals(mappingType)) {
                        if (expr == null || expr.isBlank()) { errors.add("mapping(tableName=" + tbl + "): computed 缺少 computedExpr"); continue; }
                        if (tbl == null || tbl.isBlank()) { errors.add("mapping(columnName=" + col + "): computed 缺少 tableName"); continue; }
                        if (col == null || col.isBlank()) { errors.add("mapping(tableName=" + tbl + "): computed 缺少 columnName"); continue; }
                    } else {
                        if (tbl == null || col == null) { errors.add("mapping: direct 缺少 tableName 或 columnName"); continue; }
                        if (!tableColumnIndex.containsKey(tbl)) { errors.add("mapping(tableName=" + tbl + "): 表不存在"); continue; }
                        if (!tableColumnIndex.get(tbl).contains(col)) { errors.add("mapping(tableName=" + tbl + ", columnName=" + col + "): 列不存在"); continue; }
                    }
                    validMappings.add(m);
                }
                for (Map<String, Object> jc : allJoins) {
                    String joinTbl = (String) jc.get("joinTable");
                    if (joinTbl != null && !tableColumnIndex.containsKey(joinTbl)) { errors.add("joinMapping(joinTable=" + joinTbl + "): 表不存在"); continue; }
                    String joinCond = (String) jc.get("joinCondition");
                    if (joinCond != null) errors.addAll(validateJoinCondition(joinCond, tableColumnIndex));
                    validJoins.add(jc);
                }
                if (!errors.isEmpty() && attempt < MAX_AUTO_MATCH_RETRIES) {
                    errorHint = "你上次的返回包含以下错误，请修正后重新输出：\n" + String.join("\n", errors)
                            + "\n\n注意：只能使用数据源结构中实际存在的表和列，不要捏造。computed 映射必须包含 tableName、columnName 和 computedExpr。";
                    log.warn("[v2] LLM 批量第{}次返回有{}处错误，将重试。错误明细: {}", attempt + 1, errors.size(), String.join("; ", errors));
                    continue;
                }
                if (!errors.isEmpty()) {
                    log.warn("[v2] LLM 批量重试耗尽，过滤掉{}处无效映射。错误明细: {}", errors.size(), String.join("; ", errors));
                }
                break;
            } catch (Exception e) {
                log.warn("[v2] 解析 LLM 批量结果失败: {}", e.getMessage());
                if (attempt < MAX_AUTO_MATCH_RETRIES) { errorHint = "上次的 JSON 解析失败，请确保返回合法 JSON。"; continue; }
                break;
            }
        }

        for (Concept concept : uncoveredConcepts) {
            List<Map<String, Object>> cMappings = validMappings.stream().filter(m -> concept.getName().equals(m.get("conceptName"))).collect(Collectors.toList());
            List<Map<String, Object>> cJoins = validJoins.stream().filter(j -> concept.getName().equals(j.get("conceptName"))).collect(Collectors.toList());
            for (Map<String, Object> m : cMappings) {
                if (m.get("datasourceId") instanceof Number n) { long dsId = n.longValue(); for (Datasource ds : datasources) { if (ds.getId().equals(dsId)) { m.put("datasourceName", ds.getName()); break; } } }
            }
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("conceptId", concept.getId()); r.put("conceptName", concept.getName());
            r.put("mappings", cMappings); r.put("joinMappings", cJoins);
            results.add(r);
        }
        return results;
    }

    @SuppressWarnings("unchecked")
    private String callLLMForBatchMatch(List<Concept> concepts, Map<Long, List<Map<String, Object>>> conceptPrunedDs,
                                         Map<Long, List<Map<String, Object>>> existingMappings, Map<Long, List<Map<String, Object>>> existingJoins, String errorHint) {
        try {
            AgentConfig config = agentConfigRepository.findByIsDefaultTrue().orElse(null);
            if (config == null) { log.warn("[v2] 无默认AgentConfig"); return null; }
            String apiKey = agentConfigService.decrypt(config.getSecretKeyEnc());
            String chatUrl = agentConfigService.normalizeChatUrl(config.getModelEndpoint());
            StringBuilder prompt = new StringBuilder();
            prompt.append("你是一个数据库映射专家。请将以下概念与数据源的表字段进行匹配。\n\n## 待映射概念\n");
            for (Concept c : concepts) { prompt.append("- ").append(c.getName()); if (c.getDescription() != null && !c.getDescription().isBlank()) prompt.append("：").append(c.getDescription()); prompt.append("\n"); }
            prompt.append("\n## 已有规则映射（请勿重复生成）\n");
            for (Concept c : concepts) {
                List<Map<String, Object>> em = existingMappings.getOrDefault(c.getId(), new ArrayList<>());
                List<Map<String, Object>> ej = existingJoins.getOrDefault(c.getId(), new ArrayList<>());
                if (!em.isEmpty() || !ej.isEmpty()) {
                    prompt.append("概念 '").append(c.getName()).append("':\n");
                    for (Map<String, Object> m : em) prompt.append("  - ").append(m.get("mappingType")).append(": ").append(m.get("tableName")).append(".").append(m.get("columnName")).append(" (confidence=").append(m.get("confidence")).append(")\n");
                    for (Map<String, Object> j : ej) prompt.append("  - JOIN: ").append(j.get("joinTable")).append(" ON ").append(j.get("joinCondition")).append("\n");
                }
            }
            prompt.append("\n## 可用表结构\n");
            Set<String> seenTables = new HashSet<>();
            for (Concept c : concepts) {
                List<Map<String, Object>> prunedDs = conceptPrunedDs.get(c.getId());
                if (prunedDs == null) continue;
                for (Map<String, Object> ds : prunedDs) {
                    Map<String, Object> structure = (Map<String, Object>) ds.get("structure");
                    List<Map<String, Object>> tables = (List<Map<String, Object>>) structure.get("tables");
                    if (tables == null) continue;
                    for (Map<String, Object> table : tables) {
                        String tableName = (String) table.get("name");
                        if (!seenTables.add(tableName)) continue;
                        String tableComment = (String) table.getOrDefault("comment", "");
                        prompt.append("### ").append(tableName); if (!tableComment.isEmpty()) prompt.append(" [").append(tableComment).append("]"); prompt.append("\n");
                        List<Map<String, Object>> columns = (List<Map<String, Object>>) table.get("columns");
                        if (columns != null) {
                            List<Map<String, Object>> keyCols = new ArrayList<>(), otherCols = new ArrayList<>();
                            for (Map<String, Object> col : columns) { if (Boolean.TRUE.equals(col.get("primaryKey"))) keyCols.add(col); else otherCols.add(col); }
                            if (!keyCols.isEmpty()) prompt.append("  [键列] ").append(keyCols.stream().map(kc -> (String) kc.get("name")).collect(Collectors.joining(", "))).append("\n");
                            for (Map<String, Object> col : otherCols) { String cc = (String) col.getOrDefault("comment", ""); prompt.append("  - ").append(col.get("name")).append(" (").append(col.get("type")).append(")"); if (!cc.isEmpty()) prompt.append(" -- ").append(cc); prompt.append("\n"); }
                        }
                        if (table.get("omittedColumnCount") instanceof Number n && n.intValue() > 0) prompt.append("  ... 另有 ").append(n).append(" 列省略（不可使用）\n");
                        prompt.append("\n");
                    }
                }
            }
            prompt.append("\n## 本体 COMPUTED_FROM 关系（供参考）\n");
            List<ConceptRelation> allComputed = relationRepository.findBySourceConceptIdInAndRelationTypeIn(concepts.stream().map(Concept::getId).toList(), List.of(OntologyOperationType.BuiltinRelation.COMPUTED_FROM.name()));
            for (ConceptRelation rel : allComputed) {
                prompt.append("- ").append(conceptRepository.findById(rel.getSourceConceptId()).map(Concept::getName).orElse("?"))
                        .append(" COMPUTED_FROM ").append(conceptRepository.findById(rel.getTargetConceptId()).map(Concept::getName).orElse("?"));
                if (rel.getExpression() != null) prompt.append("  expression: ").append(rel.getExpression());
                prompt.append("\n");
            }
            prompt.append("\n## 输出格式\n返回 JSON，每个 mapping 和 joinMapping 都要包含 conceptName 字段：\n{\"mappings\":[{\"conceptName\":\"...\",\"datasourceId\":1,\"tableName\":\"...\",\"columnName\":\"...\",\"attributeName\":\"...\",\"mappingType\":\"direct\",\"computedExpr\":null,\"confidence\":0.8}],\"joinMappings\":[{\"conceptName\":\"...\",\"datasourceId\":1,\"joinTable\":\"...\",\"joinCondition\":\"...\",\"joinType\":\"LEFT\"}]}\n\n规则：\n1. 只映射规则未覆盖的概念和属性\n2. 只使用数据源中实际存在的表和列，禁止捏造\n3. confidence >= 0.6\n4. computed 类型映射：mappingType=\"computed\"，必须同时填写 tableName（结果所在表）、columnName（结果列名）和 computedExpr（计算公式，引用其他表的列用 表名.列名 格式）\n5. 只输出 JSON\n");
            if (errorHint != null) prompt.append("\n").append(errorHint);
            List<Map<String, String>> messages = new ArrayList<>();
            messages.add(Map.of("role", "system", "content", "你是数据库映射专家。只输出 JSON，禁止捏造不存在的表或列。"));
            messages.add(Map.of("role", "user", "content", prompt.toString()));
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", config.getModelName()); body.put("messages", messages);
            body.put("temperature", 0.2); body.put("max_tokens", 8192); body.put("response_format", Map.of("type", "json_object"));
            HttpRequest request = HttpRequest.newBuilder().uri(URI.create(chatUrl)).header("Content-Type", "application/json").header("Authorization", "Bearer " + apiKey).POST(HttpRequest.BodyPublishers.ofString(jsonMapper.writeValueAsString(body))).timeout(Duration.ofSeconds(180)).build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) { log.warn("[v2] LLM响应异常: HTTP {}", response.statusCode()); return null; }
            Map<String, Object> respBody = jsonMapper.readValue(response.body(), Map.class);
            List<Map<String, Object>> choices = (List<Map<String, Object>>) respBody.get("choices");
            if (choices == null || choices.isEmpty()) return null;
            String content = (String) ((Map<String, Object>) choices.get(0).get("message")).get("content");
            if (content == null || content.isEmpty()) return null;
            content = content.trim(); if (content.startsWith("```")) content = content.replaceAll("```json\\s*", "").replaceAll("```\\s*", "");
            log.info("[v2] LLM批量响应: {} chars", content.length());
            return content;
        } catch (Exception e) { log.error("[v2] LLM批量调用异常: {}", e.getMessage(), e); return null; }
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> applyAutoMatch(Long taskId) {
        AsyncTask task = asyncTaskService.getTask(taskId);
        if (task == null || !"COMPLETED".equals(task.getStatus())) {
            return Map.of("error", "任务不存在或未完成");
        }

        try {
            Map<String, Object> taskResult = jsonMapper.readValue(task.getResult(), Map.class);
            List<Map<String, Object>> conceptResults = (List<Map<String, Object>>) taskResult.get("conceptResults");
            if (conceptResults == null || conceptResults.isEmpty()) {
                return Map.of("error", "任务结果中没有可应用的映射");
            }

            List<Map<String, Object>> allRawMappings = new ArrayList<>();
            List<Map<String, Object>> allRawJoinMappings = new ArrayList<>();
            for (Map<String, Object> cr : conceptResults) {
                Long conceptId = cr.get("conceptId") instanceof Number n ? n.longValue() : null;
                List<Map<String, Object>> candidates = (List<Map<String, Object>>) cr.get("candidates");
                if (candidates != null) {
                    for (Map<String, Object> c : candidates) {
                        Map<String, Object> m = new LinkedHashMap<>(c);
                        m.putIfAbsent("conceptId", conceptId);
                        allRawMappings.add(m);
                    }
                }
                List<Map<String, Object>> joinCandidates = (List<Map<String, Object>>) cr.get("joinCandidates");
                if (joinCandidates != null) {
                    for (Map<String, Object> jc : joinCandidates) {
                        Map<String, Object> m = new LinkedHashMap<>(jc);
                        m.putIfAbsent("conceptId", conceptId);
                        allRawJoinMappings.add(m);
                    }
                }
            }

            List<Long> allConceptIds = conceptResults.stream()
                    .map(cr -> cr.get("conceptId") instanceof Number n ? n.longValue() : null)
                    .filter(Objects::nonNull).distinct().toList();

            if (!allConceptIds.isEmpty()) {
                transactionTemplate.executeWithoutResult(status -> {
                    long deletedMappings = mappingRepository.findByConceptIdIn(allConceptIds).size();
                    long deletedJoins = joinMappingRepository.findByConceptIdIn(allConceptIds).size();
                    mappingRepository.deleteByConceptIdIn(allConceptIds);
                    joinMappingRepository.deleteByConceptIdIn(allConceptIds);
                    log.info("[apply-auto-match] 清理旧映射: conceptIds={}, 删除 {} 条映射, {} 条 JOIN", allConceptIds, deletedMappings, deletedJoins);
                });
            }

            List<ConceptMapping> allMappings = new ArrayList<>();
            Set<String> mappingKeys = new HashSet<>();
            for (Map<String, Object> item : allRawMappings) {
                String mappingType = (String) item.getOrDefault("mappingType", "direct");
                String tbl = (String) item.get("tableName");
                String col = (String) item.get("columnName");
                String expr = (String) item.get("computedExpr");

                if ("computed".equals(mappingType)) {
                    if (expr == null || expr.isBlank()) {
                        log.warn("[apply-auto-match] 跳过 computed 映射: 缺少 computedExpr, conceptId={}", item.get("conceptId"));
                        continue;
                    }
                    String attrName = (String) item.get("attributeName");
                    if (col == null || col.isBlank()) col = attrName != null ? attrName : "computed";
                    if (tbl == null || tbl.isBlank()) tbl = "COMPUTED";
                } else {
                    if (tbl == null || col == null) {
                        log.warn("[apply-auto-match] 跳过 direct 映射: 缺少 tableName 或 columnName, conceptId={}", item.get("conceptId"));
                        continue;
                    }
                }

                ConceptMapping m = new ConceptMapping();
                m.setConceptId(item.get("conceptId") instanceof Number n ? n.longValue() : null);
                m.setDatasourceId(item.get("datasourceId") instanceof Number n ? n.longValue() : null);
                m.setTableName(tbl);
                m.setColumnName(col);
                m.setAttributeName((String) item.get("attributeName"));
                m.setMappingType(mappingType);
                m.setComputedExpr(expr);
                Object confidence = item.get("confidence");
                m.setConfidence(confidence instanceof Number n ? BigDecimal.valueOf(n.doubleValue()) : BigDecimal.valueOf(0.8));
                m.setIsAuto(true);
                m.setIsRequired(item.get("isRequired") instanceof Boolean b ? b : false);
                String key = m.getConceptId() + "-" + m.getAttributeName() + "-" + m.getDatasourceId();
                if (mappingKeys.add(key)) {
                    allMappings.add(m);
                } else {
                    log.warn("[apply-auto-match] 跳过重复映射: conceptId={}, attributeName={}, datasourceId={}", m.getConceptId(), m.getAttributeName(), m.getDatasourceId());
                }
            }

            if (allMappings.isEmpty() && allRawJoinMappings.isEmpty()) {
                return Map.of("error", "没有可应用的映射");
            }

            List<Map<String, Object>> savedDetails = new ArrayList<>();
            List<Map<String, Object>> skippedDetails = new ArrayList<>();

            int createdMappings = 0;
            int skippedMappings = 0;
            if (!allMappings.isEmpty()) {
                for (ConceptMapping m : allMappings) {
                    try {
                        mappingRepository.save(m);
                        createdMappings++;
                        savedDetails.add(Map.of(
                                "conceptId", m.getConceptId() != null ? m.getConceptId() : 0,
                                "tableName", m.getTableName() != null ? m.getTableName() : "",
                                "columnName", m.getColumnName() != null ? m.getColumnName() : "",
                                "mappingType", m.getMappingType() != null ? m.getMappingType() : "direct"
                        ));
                    } catch (Exception e) {
                        log.warn("[apply-auto-match] 保存映射失败，跳过: conceptId={}, table={}, col={}, error={}",
                                m.getConceptId(), m.getTableName(), m.getColumnName(), e.getMessage());
                        skippedMappings++;
                        skippedDetails.add(Map.of(
                                "conceptId", m.getConceptId() != null ? m.getConceptId() : 0,
                                "tableName", m.getTableName() != null ? m.getTableName() : "",
                                "columnName", m.getColumnName() != null ? m.getColumnName() : "",
                                "reason", e.getMessage() != null ? e.getMessage() : "保存失败"
                        ));
                    }
                }
            }

            int createdJoins = 0;
            int skippedJoins = 0;
            if (!allRawJoinMappings.isEmpty()) {
                List<ConceptJoinMapping> joinMappings = new ArrayList<>();
                for (Map<String, Object> item : allRawJoinMappings) {
                    Long cid = item.get("conceptId") instanceof Number n ? n.longValue() : null;
                    Long dsid = item.get("datasourceId") instanceof Number n ? n.longValue() : null;
                    String targetConcept = (String) item.get("targetConcept");
                    String relationType = (String) item.getOrDefault("relationType", "JOIN");
                    ConceptJoinMapping jm = new ConceptJoinMapping();
                    jm.setConceptId(cid);
                    jm.setDatasourceId(dsid);
                    jm.setTargetConcept(targetConcept);
                    jm.setRelationType(relationType);
                    jm.setJoinTable((String) item.get("joinTable"));
                    jm.setJoinCondition((String) item.get("joinCondition"));
                    jm.setJoinType((String) item.getOrDefault("joinType", "LEFT"));
                    joinMappings.add(jm);
                }
                for (ConceptJoinMapping jm : joinMappings) {
                    try {
                        joinMappingRepository.save(jm);
                        createdJoins++;
                        savedDetails.add(Map.of(
                                "conceptId", jm.getConceptId() != null ? jm.getConceptId() : 0,
                                "joinTable", jm.getJoinTable() != null ? jm.getJoinTable() : "",
                                "joinType", jm.getJoinType() != null ? jm.getJoinType() : "LEFT",
                                "mappingType", "join"
                        ));
                    } catch (Exception e) {
                        log.warn("[apply-auto-match] 保存JOIN映射失败，跳过: conceptId={}, joinTable={}, error={}",
                                jm.getConceptId(), jm.getJoinTable(), e.getMessage());
                        skippedJoins++;
                        skippedDetails.add(Map.of(
                                "conceptId", jm.getConceptId() != null ? jm.getConceptId() : 0,
                                "joinTable", jm.getJoinTable() != null ? jm.getJoinTable() : "",
                                "reason", e.getMessage() != null ? e.getMessage() : "保存失败"
                        ));
                    }
                }
            }

            return Map.of(
                    "created", createdMappings,
                    "skipped", skippedMappings,
                    "createdJoins", createdJoins,
                    "skippedJoins", skippedJoins,
                    "savedDetails", savedDetails,
                    "skippedDetails", skippedDetails,
                    "message", "已应用 " + createdMappings + " 条映射、" + createdJoins + " 条 JOIN"
                            + (skippedMappings > 0 ? "，跳过 " + skippedMappings + " 条映射" : "")
                            + (skippedJoins > 0 ? "，跳过 " + skippedJoins + " 条 JOIN" : "")
            );
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

                Map<String, Set<String>> tableColumnIndex = buildTableColumnIndex(dsStructures);

                buildColumnIndexIfNeeded(dsStructures, datasources);

                List<Map<String, Object>> conceptResults = new ArrayList<>();
                List<Map<String, Object>> failedConcepts = new ArrayList<>();
                int processed = 0;

                for (Concept concept : concepts) {
                    asyncTaskService.updateProgress(newTask.getId(), processed + 1,
                            "正在匹配概念: " + concept.getName() + " (" + (processed + 1) + "/" + concepts.size() + ")");

                    Map<String, Object> matchResult = matchConceptWithRetry(concept, dsStructures, tableColumnIndex, datasources);
                    if (matchResult.containsKey("candidates")) {
                        conceptResults.add(matchResult);
                    } else {
                        failedConcepts.add(matchResult);
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

    private static final int MAX_AUTO_MATCH_RETRIES = 2;

    @SuppressWarnings("unchecked")
    private Map<String, Set<String>> buildTableColumnIndex(List<Map<String, Object>> dsStructures) {
        Map<String, Set<String>> index = new LinkedHashMap<>();
        for (Map<String, Object> ds : dsStructures) {
            Map<String, Object> structure = (Map<String, Object>) ds.get("structure");
            List<Map<String, Object>> tables = (List<Map<String, Object>>) structure.get("tables");
            if (tables == null) continue;
            for (Map<String, Object> table : tables) {
                String tableName = (String) table.get("name");
                if (tableName == null) continue;
                Set<String> columns = new LinkedHashSet<>();
                List<Map<String, Object>> cols = (List<Map<String, Object>>) table.get("columns");
                if (cols != null) {
                    for (Map<String, Object> col : cols) {
                        if (col.get("name") != null) columns.add((String) col.get("name"));
                    }
                }
                index.put(tableName, columns);
            }
        }
        return index;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> matchConceptWithRetry(Concept concept,
                                                       List<Map<String, Object>> dsStructures,
                                                       Map<String, Set<String>> tableColumnIndex,
                                                       List<Datasource> datasources) {
        String errorHint = null;
        List<Map<String, Object>> prunedDsStructures = pruneDatasourceForConcept(concept, dsStructures);
        for (int attempt = 0; attempt <= MAX_AUTO_MATCH_RETRIES; attempt++) {
            String llmResponse = callLLMForAutoMatch(concept, prunedDsStructures, errorHint);
            if (llmResponse == null) {
                if (attempt == 0) {
                    Map<String, Object> fc = new LinkedHashMap<>();
                    fc.put("conceptId", concept.getId());
                    fc.put("conceptName", concept.getName());
                    fc.put("reason", "LLM 调用失败");
                    return fc;
                }
                break;
            }

            try {
                Map<String, Object> parsed = jsonMapper.readValue(sanitizeJson(llmResponse), Map.class);
                List<Map<String, Object>> candidates = (List<Map<String, Object>>) parsed.get("mappings");
                List<Map<String, Object>> joinCandidates = (List<Map<String, Object>>) parsed.get("joinMappings");
                if (candidates == null) candidates = new ArrayList<>();
                if (joinCandidates == null) joinCandidates = new ArrayList<>();

                List<String> errors = new ArrayList<>();
                List<Map<String, Object>> validCandidates = new ArrayList<>();
                for (Map<String, Object> m : candidates) {
                    String mappingType = (String) m.getOrDefault("mappingType", "direct");
                    String tbl = (String) m.get("tableName");
                    String col = (String) m.get("columnName");
                    String expr = (String) m.get("computedExpr");

                    if ("computed".equals(mappingType)) {
                        if (expr == null || expr.isBlank()) {
                            errors.add("mapping(tableName=" + tbl + ", columnName=" + col + "): computed 映射缺少 computedExpr");
                            continue;
                        }
                        if (tbl != null && !tbl.isBlank() && !tableColumnIndex.containsKey(tbl)) {
                            errors.add("mapping(tableName=" + tbl + "): computed 映射中表不存在，数据源中无此表");
                            continue;
                        }
                        if (tbl == null || tbl.isBlank()) {
                            errors.add("mapping(columnName=" + col + "): computed 映射缺少 tableName");
                            continue;
                        }
                    } else {
                        if (tbl == null || col == null) {
                            errors.add("mapping: direct 映射缺少 tableName 或 columnName");
                            continue;
                        }
                        if (!tableColumnIndex.containsKey(tbl)) {
                            errors.add("mapping(tableName=" + tbl + "): 表不存在，数据源中无此表");
                            continue;
                        }
                        Set<String> cols = tableColumnIndex.get(tbl);
                        if (!cols.contains(col)) {
                            List<String> suggestions = findSimilarColumns(col, cols, 5);
                            errors.add("mapping(tableName=" + tbl + ", columnName=" + col + "): 列不存在"
                                    + (suggestions.isEmpty() ? "" : "，相近列: " + suggestions)
                                    + "，该表共" + cols.size() + "列");
                            continue;
                        }
                    }
                    validCandidates.add(m);
                }

                List<Map<String, Object>> validJoinCandidates = new ArrayList<>();
                for (Map<String, Object> jc : joinCandidates) {
                    String joinTbl = (String) jc.get("joinTable");
                    if (joinTbl != null && !tableColumnIndex.containsKey(joinTbl)) {
                        errors.add("joinMapping(joinTable=" + joinTbl + "): 表不存在，数据源中无此表");
                        continue;
                    }
                    String joinCond = (String) jc.get("joinCondition");
                    if (joinCond != null) {
                        List<String> condErrors = validateJoinCondition(joinCond, tableColumnIndex);
                        errors.addAll(condErrors);
                    }
                    validJoinCandidates.add(jc);
                }

                if (!errors.isEmpty() && attempt < MAX_AUTO_MATCH_RETRIES) {
                    errorHint = "你上次的返回包含以下错误，请修正后重新输出：\n" + String.join("\n", errors)
                            + "\n\n注意：只能使用数据源结构中实际存在的表和列，不要捏造。";
                    log.warn("[auto-match] 概念 '{}' 第{}次返回有捏造({}处错误)，将重试。错误明细:\n{}", concept.getName(), attempt + 1, errors.size(), String.join("\n  ", errors));
                    continue;
                }

                if (!errors.isEmpty()) {
                    log.warn("[auto-match] 概念 '{}' 重试耗尽，过滤掉{}处无效映射。错误明细:\n{}", concept.getName(), errors.size(), String.join("\n  ", errors));
                }

                for (Map<String, Object> candidate : validCandidates) {
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
                for (Map<String, Object> jc : validJoinCandidates) {
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
                cr.put("candidates", validCandidates);
                cr.put("joinCandidates", validJoinCandidates);
                cr.put("total", validCandidates.size());
                if (!errors.isEmpty()) {
                    cr.put("validationWarnings", errors);
                }
                return cr;
            } catch (Exception e) {
                log.warn("[auto-match] 解析概念 {} 的匹配结果失败: {}", concept.getName(), e.getMessage());
                Map<String, Object> fc = new LinkedHashMap<>();
                fc.put("conceptId", concept.getId());
                fc.put("conceptName", concept.getName());
                fc.put("reason", "解析失败: " + e.getMessage());
                return fc;
            }
        }

        Map<String, Object> fc = new LinkedHashMap<>();
        fc.put("conceptId", concept.getId());
        fc.put("conceptName", concept.getName());
        fc.put("reason", "重试耗尽仍无法生成有效映射");
        return fc;
    }

    private List<String> findSimilarColumns(String target, Set<String> candidates, int maxResults) {
        String lower = target.toLowerCase();
        return candidates.stream()
                .sorted((a, b) -> {
                    int distA = levenshtein(lower, a.toLowerCase());
                    int distB = levenshtein(lower, b.toLowerCase());
                    return Integer.compare(distA, distB);
                })
                .limit(maxResults)
                .collect(Collectors.toList());
    }

    private int levenshtein(String a, String b) {
        int[] prev = new int[b.length() + 1];
        int[] curr = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) prev[j] = j;
        for (int i = 1; i <= a.length(); i++) {
            curr[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                curr[j] = Math.min(Math.min(prev[j] + 1, curr[j - 1] + 1), prev[j - 1] + cost);
            }
            int[] tmp = prev; prev = curr; curr = tmp;
        }
        return prev[b.length()];
    }

    private List<String> validateJoinCondition(String joinCondition, Map<String, Set<String>> tableColumnIndex) {
        List<String> errors = new ArrayList<>();
        try {
            var expr = CCJSqlParserUtil.parseExpression(joinCondition);
            expr.accept(new net.sf.jsqlparser.expression.ExpressionVisitorAdapter() {
                @Override
                public void visit(Column column) {
                    Table table = column.getTable();
                    if (table == null || table.getName() == null) return;
                    String tbl = table.getName();
                    String col = column.getColumnName();
                    if (!tableColumnIndex.containsKey(tbl)) {
                        errors.add("JOIN 条件中表 '" + tbl + "' 不存在");
                    } else if (!tableColumnIndex.get(tbl).contains(col)) {
                        errors.add("JOIN 条件中表 '" + tbl + "' 的列 '" + col + "' 不存在");
                    }
                }
            });
        } catch (JSQLParserException e) {
            log.warn("[validate] JSqlParser 无法解析 JOIN 条件，跳过校验: {}", joinCondition);
        }
        return errors;
    }

    @SuppressWarnings("unchecked")
    private String callLLMForAutoMatch(Concept concept, List<Map<String, Object>> dsStructures, String errorHint) {
        try {
            AgentConfig config = agentConfigRepository.findByIsDefaultTrue().orElse(null);
            if (config == null) {
                log.warn("[auto-match] 无默认AgentConfig");
                return null;
            }

            String apiKey = agentConfigService.decrypt(config.getSecretKeyEnc());
            String chatUrl = agentConfigService.normalizeChatUrl(config.getModelEndpoint());

            StringBuilder dsDesc = new StringBuilder();
            for (Map<String, Object> ds : dsStructures) {
                dsDesc.append("数据源: ").append(ds.get("name"))
                        .append(" (ID: ").append(ds.get("id")).append(", 类型: ").append(ds.get("type")).append(")\n");
                Map<String, Object> structure = (Map<String, Object>) ds.get("structure");
                List<Map<String, Object>> tables = (List<Map<String, Object>>) structure.get("tables");
                if (tables != null) {
                    for (Map<String, Object> table : tables) {
                        String tableComment = (String) table.getOrDefault("comment", "");
                        dsDesc.append("  表: ").append(table.get("name"));
                        if (!tableComment.isEmpty()) {
                            dsDesc.append(" (").append(tableComment).append(")");
                        }
                        dsDesc.append("\n");
                        List<Map<String, Object>> columns = (List<Map<String, Object>>) table.get("columns");
                        if (columns != null) {
                            List<Map<String, Object>> keyCols = new ArrayList<>();
                            List<Map<String, Object>> otherCols = new ArrayList<>();
                            for (Map<String, Object> col : columns) {
                                if (Boolean.TRUE.equals(col.get("primaryKey"))) {
                                    keyCols.add(col);
                                } else {
                                    otherCols.add(col);
                                }
                            }
                            if (!keyCols.isEmpty()) {
                                dsDesc.append("    [键列] ");
                                dsDesc.append(keyCols.stream()
                                        .map(c -> (String) c.get("name"))
                                        .collect(Collectors.joining(", ")));
                                dsDesc.append("\n");
                            }
                            for (Map<String, Object> col : otherCols) {
                                String colComment = (String) col.getOrDefault("comment", "");
                                dsDesc.append("    - ").append(col.get("name"))
                                        .append(" (").append(col.get("type")).append(")");
                                if (!colComment.isEmpty()) {
                                    dsDesc.append(" -- ").append(colComment);
                                }
                                dsDesc.append("\n");
                            }
                        }
                    }
                }
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
                    + "      \"computedExpr\": \"计算表达式（mappingType=computed时必填，如SUM(金额*数量)、营收/人数）\",\n"
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
                    + "3. 所有字段映射用 mappingType=direct，除非是明确的计算字段；computed 类型必须同时填写 tableName（结果所在表）、columnName（结果列名）和 computedExpr（计算公式，引用其他表的列用 表名.列名 格式）\n"
                    + "4. 如果概念字段分散在多张表，字段映射中 tableName 填实际所在表名，同时在 joinMappings 中定义表间 JOIN 关系\n"
                    + "5. 外键推断：列名以 _id 结尾且不是主键的列，很可能是外键，如 student_id → students 表\n"
                    + "6. JOIN 条件规则：主表.主键 = 关联表.外键，如 \"students.id = enrollments.student_id\"\n"
                    + "7. id 类字段通常映射到主键，confidence 设为 0.95\n"
                    + "8. 名称完全匹配的字段 confidence 设为 0.9，语义相近的 0.7-0.8\n"
                    + "9. 只返回有把握的匹配（confidence >= 0.6）\n"
                    + "10. 只输出 JSON 对象，不要任何解释文字\n"
                    + "11. 【严格约束】tableName 和 columnName 必须从上方数据源结构中选取，禁止使用数据源中不存在的表名或列名，即使你认为该表/列在SAP/ERP中存在也不允许"
                    + (errorHint != null ? "\n\n" + errorHint : "");

            List<Map<String, String>> messages = new ArrayList<>();
            messages.add(Map.of("role", "system", "content", "你是一个数据库映射专家。只输出 JSON，不要任何解释。严格只使用数据源中实际存在的表和列，禁止捏造不存在的表名或列名。"));
            messages.add(Map.of("role", "user", "content", prompt));

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", config.getModelName());
            body.put("messages", messages);
            body.put("temperature", 0.2);
            body.put("max_tokens", 8192);
            body.put("response_format", Map.of("type", "json_object"));

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(chatUrl))
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

    // ===== 沿本体关系展开概念（通过 Jena OWL 推理） =====

    @SuppressWarnings("unchecked")
    private Map<String, Object> expandConceptViaJena(Concept concept) {
        Set<String> conceptNames = new LinkedHashSet<>();
        Set<String> embeddingTexts = new LinkedHashSet<>();
        conceptNames.add(concept.getName());
        embeddingTexts.add(concept.getName());
        if (concept.getDescription() != null && !concept.getDescription().isBlank()) {
            embeddingTexts.add(concept.getDescription());
        }

        Map<String, Object> jenaContext = null;
        try {
            jenaContext = ontologyService.analyzeContext(
                    List.of(concept.getId()), Map.of(concept.getId(), 1.0));
            List<Number> expandedIds = (List<Number>) jenaContext.get("conceptIds");
            if (expandedIds != null) {
                for (Number id : expandedIds) {
                    conceptRepository.findById(id.longValue()).ifPresent(c -> {
                        conceptNames.add(c.getName());
                        embeddingTexts.add(c.getName());
                        if (c.getDescription() != null && !c.getDescription().isBlank()) {
                            embeddingTexts.add(c.getDescription());
                        }
                    });
                }
            }
        } catch (Exception e) {
            log.warn("[prune] Jena 推理展开失败，仅使用概念自身关键词: {}", e.getMessage());
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("keywords", conceptNames);
        result.put("embeddingText", embeddingTexts);
        result.put("jenaContext", jenaContext);
        return result;
    }

    // ===== 数据源裁剪：按概念相关性筛选表和列 =====

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> pruneDatasourceForConcept(
            Concept concept, List<Map<String, Object>> dsStructures) {
        Map<String, Object> expansion = expandConceptViaJena(concept);
        Set<String> conceptKeywords = (Set<String>) expansion.get("keywords");
        Set<String> embeddingTexts = (Set<String>) expansion.get("embeddingText");
        Map<String, Object> jenaContext = (Map<String, Object>) expansion.get("jenaContext");
        log.info("[prune] 概念 '{}' 概念名关键词: {}", concept.getName(), conceptKeywords);

        List<Float> conceptEmbedding = null;
        try {
            String combinedText = String.join(" ", embeddingTexts);
            conceptEmbedding = faissService.getEmbedding(combinedText);
        } catch (Exception e) {
            log.warn("[prune] 获取概念 embedding 失败，将仅用本地匹配: {}", e.getMessage());
        }

        Set<String> embeddingHitColumns = new LinkedHashSet<>();
        if (conceptEmbedding != null) {
            try {
                List<Map<String, Object>> results = faissService.searchColumns(conceptEmbedding, 30);
                for (Map<String, Object> r : results) {
                    double score = r.get("score") instanceof Number n ? n.doubleValue() : 0.0;
                    if (score >= 0.5) {
                        embeddingHitColumns.add((String) r.get("id"));
                    }
                }
                log.info("[prune] embedding 命中 {} 列 (score>=0.5): {}", embeddingHitColumns.size(), embeddingHitColumns);
            } catch (Exception e) {
                log.warn("[prune] 列 embedding 搜索失败: {}", e.getMessage());
            }
        }

        Set<String> factorTables = new LinkedHashSet<>();
        if (jenaContext != null) {
            try {
                Object rawTableMappings = jenaContext.get("tableMappings");
                if (rawTableMappings instanceof List<?> list) {
                    for (Object item : list) {
                        if (item instanceof ConceptMapping cm) {
                            if (cm.getTableName() != null && !cm.getTableName().isBlank()) factorTables.add(cm.getTableName());
                        } else if (item instanceof Map<?, ?> m) {
                            Object tbl = m.get("tableName");
                            if (tbl instanceof String s && !s.isBlank()) factorTables.add(s);
                        }
                    }
                }
            } catch (Exception e) {
                log.warn("[prune] 查询因子映射表失败: {}", e.getMessage());
            }
        }
        if (!factorTables.isEmpty()) {
            log.info("[prune] COMPUTED_FROM 因子已映射表: {}", factorTables);
        }

        int maxTables = 10;
        List<Map<String, Object>> prunedDs = new ArrayList<>();
        for (Map<String, Object> ds : dsStructures) {
            Map<String, Object> prunedDsInfo = new LinkedHashMap<>();
            prunedDsInfo.put("id", ds.get("id"));
            prunedDsInfo.put("name", ds.get("name"));
            prunedDsInfo.put("type", ds.get("type"));

            Map<String, Object> structure = (Map<String, Object>) ds.get("structure");
            List<Map<String, Object>> tables = (List<Map<String, Object>>) structure.get("tables");
            if (tables == null) {
                prunedDsInfo.put("structure", structure);
                prunedDs.add(prunedDsInfo);
                continue;
            }

            List<Object[]> scoredTables = new ArrayList<>();
            for (Map<String, Object> table : tables) {
                String tableName = (String) table.get("name");
                List<Map<String, Object>> allCols = (List<Map<String, Object>>) table.get("columns");
                if (allCols == null) allCols = new ArrayList<>();

                if (factorTables.contains(tableName)) {
                    scoredTables.add(new Object[]{table, 100.0});
                    continue;
                }

                double score = 0;
                int embHits = 0;
                Set<String> matchedKws = new HashSet<>();
                for (Map<String, Object> col : allCols) {
                    String colName = (String) col.get("name");
                    if (embeddingHitColumns.contains(tableName + "." + colName)) {
                        embHits++;
                    }
                    String colComment = (String) col.getOrDefault("comment", "");
                    for (String kw : conceptKeywords) {
                        if (kw.length() >= 2 && colComment.contains(kw)) {
                            matchedKws.add(kw);
                        }
                    }
                }
                score += embHits * 3.0;
                score += matchedKws.size() * 1.0;
                if (score > 0) {
                    scoredTables.add(new Object[]{table, score});
                }
            }

            scoredTables.sort((a, b) -> Double.compare((Double) b[1], (Double) a[1]));
            List<Map<String, Object>> prunedTables = new ArrayList<>();
            for (int i = 0; i < Math.min(scoredTables.size(), maxTables); i++) {
                Map<String, Object> table = (Map<String, Object>) scoredTables.get(i)[0];
                String tableName = (String) table.get("name");
                List<Map<String, Object>> allCols = (List<Map<String, Object>>) table.get("columns");
                if (allCols == null) allCols = new ArrayList<>();

                List<Map<String, Object>> prunedCols = new ArrayList<>();
                int omittedCols = 0;
                for (Map<String, Object> col : allCols) {
                    String colName = (String) col.get("name");
                    boolean isPk = Boolean.TRUE.equals(col.get("primaryKey"));
                    boolean embHit = embeddingHitColumns.contains(tableName + "." + colName);
                    boolean kwHit = false;
                    String colComment = (String) col.getOrDefault("comment", "");
                    for (String kw : conceptKeywords) {
                        if (kw.length() >= 2 && colComment.contains(kw)) {
                            kwHit = true;
                            break;
                        }
                    }
                    if (isPk || embHit || kwHit) {
                        prunedCols.add(col);
                    } else {
                        omittedCols++;
                    }
                }

                Map<String, Object> prunedTable = new LinkedHashMap<>(table);
                prunedTable.put("columns", prunedCols);
                prunedTable.put("omittedColumnCount", omittedCols);
                prunedTables.add(prunedTable);
            }

            if (!prunedTables.isEmpty()) {
                Map<String, Object> prunedStructure = new LinkedHashMap<>(structure);
                prunedStructure.put("tables", prunedTables);
                prunedDsInfo.put("structure", prunedStructure);
                prunedDs.add(prunedDsInfo);
            }
        }

        int totalTables = prunedDs.stream()
                .mapToInt(ds -> ((List<?>) ((Map<?, ?>) ds.get("structure")).get("tables")).size())
                .sum();
        int totalCols = prunedDs.stream()
                .flatMap(ds -> ((List<?>) ((Map<?, ?>) ds.get("structure")).get("tables")).stream())
                .mapToInt(t -> ((List<?>) ((Map<?, ?>) t).get("columns")).size())
                .sum();
        log.info("[prune] 概念 '{}' 裁剪结果: {} 数据源, {} 表, {} 列", concept.getName(), prunedDs.size(), totalTables, totalCols);

        return prunedDs;
    }

    // ===== 构建列注释 embedding 索引（如未构建） =====

    @SuppressWarnings("unchecked")
    private void buildColumnIndexIfNeeded(List<Map<String, Object>> dsStructures, List<Datasource> datasources) {
        if (datasources.isEmpty()) return;
        String dsId = String.valueOf(datasources.get(0).getId());

        try {
            if (faissService.isColumnIndexBuiltFor(dsId)) {
                log.info("[column-index] 数据源 {} 列索引已构建，跳过", dsId);
                return;
            }
        } catch (Exception e) {
            log.warn("[column-index] 检查列索引状态失败，将尝试构建: {}", e.getMessage());
        }

        List<Map<String, Object>> columnEntries = new ArrayList<>();
        for (Map<String, Object> ds : dsStructures) {
            Map<String, Object> structure = (Map<String, Object>) ds.get("structure");
            List<Map<String, Object>> tables = (List<Map<String, Object>>) structure.get("tables");
            if (tables == null) continue;
            for (Map<String, Object> table : tables) {
                String tableName = (String) table.get("name");
                List<Map<String, Object>> cols = (List<Map<String, Object>>) table.get("columns");
                if (cols == null) continue;
                for (Map<String, Object> col : cols) {
                    String colName = (String) col.get("name");
                    String colComment = (String) col.getOrDefault("comment", "");

                    String text;
                    if (!colComment.isBlank()) {
                        text = colComment;
                    } else {
                        text = colName;
                    }

                    try {
                        List<Float> embedding = faissService.getEmbedding(text);
                        Map<String, Object> entry = new LinkedHashMap<>();
                        entry.put("id", tableName + "." + colName);
                        entry.put("text", text);
                        entry.put("embedding", embedding);
                        columnEntries.add(entry);
                    } catch (Exception e) {
                        log.warn("[column-index] 获取列 {}.{} embedding 失败: {}", tableName, colName, e.getMessage());
                    }
                }
            }
        }

        if (!columnEntries.isEmpty()) {
            try {
                faissService.buildColumnIndex(dsId, columnEntries);
                log.info("[column-index] 列索引构建完成: {} 条", columnEntries.size());
            } catch (Exception e) {
                log.warn("[column-index] 列索引构建失败: {}", e.getMessage());
            }
        }
    }
}