package com.luban.service;

import com.luban.constant.OntologyOperationType.BuiltinRelation;
import com.luban.entity.*;
import com.luban.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class ContextBuilder {

    private final org.slf4j.Logger agentDebug = LoggerFactory.getLogger("agent-debug");

    private final FaissService faissService;
    private final OntologyService ontologyService;
    private final ConceptRepository conceptRepository;
    private final ConceptMappingRepository conceptMappingRepository;
    private final ConceptJoinMappingRepository conceptJoinMappingRepository;
    private final ToolConceptRepository toolConceptRepository;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final DatasourceService datasourceService;
    private final RoleConceptPermissionService roleConceptPermissionService;
    private final ToolEmbeddingService toolEmbeddingService;
    private final OntologyGroupRepository ontologyGroupRepository;
    private final IndustryService industryService;

    private static final int MAX_CONCEPT_EXPAND = 20;
    private static final int MAX_CONCEPT_IDS = 10;
    private static final int MAX_API_TOOLS = 15;
    private static final double CONCEPT_INTERSECTION_THRESHOLD = 0.5;

    public Map<String, Object> build(String sessionId, String userQuery,
            List<Map<String, Object>> messages, Long userId, String intent) {
        long t0 = System.currentTimeMillis();
        Map<String, Object> result = new LinkedHashMap<>();
        List<Map<String, Object>> conceptTrace = new ArrayList<>();
        List<Long> conceptIds = new ArrayList<>();
        List<ToolDefinition> apiTools = new ArrayList<>();
        List<ConceptMapping> tableMappings = new ArrayList<>();
        List<ConceptJoinMapping> joinMappings = new ArrayList<>();

        List<Map<String, Object>> faissResults = searchConcepts(userQuery);
        List<Long> matchedConceptIds = faissResults.stream()
                .map(r -> ((Number) r.get("conceptId")).longValue())
                .collect(Collectors.toList());
        log.info("ContextBuilder FAISS: {}ms, matched {} concepts",
                System.currentTimeMillis() - t0, matchedConceptIds.size());
        agentDebug.info("[CONTEXT] FAISS search: {}ms, matchedConceptIds={}, results={}",
                System.currentTimeMillis() - t0, matchedConceptIds,
                faissResults.stream().map(r -> r.get("conceptId") + "(" + r.get("confidence") + ")")
                        .collect(Collectors.joining(", ")));

        Set<Long> authorizedConceptIds = new HashSet<>(matchedConceptIds);
        if (userId != null && !matchedConceptIds.isEmpty()) {
            try {
                Map<Long, Boolean> perms = roleConceptPermissionService.batchCheckQueryPermission(
                        userId, new ArrayList<>(matchedConceptIds));
                authorizedConceptIds = matchedConceptIds.stream()
                        .filter(id -> perms.getOrDefault(id, true))
                        .collect(Collectors.toSet());
            } catch (Exception e) {
                log.warn("ContextBuilder FAISS: failed to check permissions: {}", e.getMessage());
            }
        }

        Map<String, Object> reuseContext = analyzeMultiTurnReuse(messages, matchedConceptIds);
        if (!reuseContext.isEmpty()) {
            @SuppressWarnings("unchecked")
            List<ConceptMapping> reusedMappings = (List<ConceptMapping>) reuseContext.get("tableMappings");
            @SuppressWarnings("unchecked")
            List<ConceptJoinMapping> reusedJoins = (List<ConceptJoinMapping>) reuseContext.get("joinMappings");
            @SuppressWarnings("unchecked")
            List<ToolDefinition> reusedTools = (List<ToolDefinition>) reuseContext.get("apiTools");

            if (reusedMappings != null) tableMappings.addAll(reusedMappings);
            if (reusedJoins != null) joinMappings.addAll(reusedJoins);
            if (reusedTools != null) apiTools.addAll(reusedTools);
            if (reusedMappings != null && !reusedMappings.isEmpty()) {
                conceptTrace.add(Map.of("type", "reuse", "message", "多轮对话复用上一轮概念映射"));
            }
        }

        List<Map<String, Object>> ontologyConcepts = new ArrayList<>();
        Map<Long, List<Map<String, Object>>> ontologyRelations = new LinkedHashMap<>();
        if (!matchedConceptIds.isEmpty() && !reuseContext.containsKey("fullReuse")) {
            conceptIds.addAll(matchedConceptIds);
            Map<Long, Double> faissConfidence = new LinkedHashMap<>();
            for (Map<String, Object> r : faissResults) {
                Long cid = ((Number) r.get("conceptId")).longValue();
                Object conf = r.get("confidence");
                faissConfidence.put(cid, conf instanceof Number ? ((Number) conf).doubleValue() : 0.0);
            }
            Map<String, Object> expanded = ontologyService.analyzeContext(matchedConceptIds, faissConfidence);
            @SuppressWarnings("unchecked")
            List<Long> expandedIds = (List<Long>) expanded.getOrDefault("conceptIds", List.of());
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> trace = (List<Map<String, Object>>) expanded.getOrDefault("conceptTrace", List.of());
            @SuppressWarnings("unchecked")
            List<ToolDefinition> apiToolsFromConcepts = (List<ToolDefinition>) expanded.getOrDefault("apiTools", List.of());
            @SuppressWarnings("unchecked")
            List<ConceptMapping> mappings = (List<ConceptMapping>) expanded.getOrDefault("tableMappings", List.of());
            @SuppressWarnings("unchecked")
            List<ConceptJoinMapping> joins = (List<ConceptJoinMapping>) expanded.getOrDefault("joinMappings", List.of());
            ontologyRelations = (Map<Long, List<Map<String, Object>>>) expanded.getOrDefault("relatedConcepts", Map.of());

            conceptIds.addAll(expandedIds);
            conceptTrace.addAll(trace);
            apiTools.addAll(apiToolsFromConcepts);
            tableMappings.addAll(mappings);
            joinMappings.addAll(joins);

            agentDebug.info("[CONTEXT] Ontology expanded: conceptIds {}->{} (+{}), mappings={}, joins={}, relations={}",
                    matchedConceptIds.size(), conceptIds.size(), expandedIds.size(),
                    mappings.size(), joins.size(), ontologyRelations.size());

            for (Map<String, Object> t : trace) {
                Object cid = t.get("conceptId");
                Object depth = t.get("depth");
                if (cid instanceof Number) {
                    Long id = ((Number) cid).longValue();
                    if ((depth instanceof Number && ((Number) depth).intValue() > 0)
                            || ontologyRelations.containsKey(id)) {
                        ontologyConcepts.add(t);
                    }
                }
            }
        } else if (!matchedConceptIds.isEmpty() && reuseContext.containsKey("fullReuse")) {
            conceptIds.addAll(matchedConceptIds);
            conceptTrace.addAll(faissResults);

            Map<Long, Double> faissConfidence = new LinkedHashMap<>();
            for (Map<String, Object> r : faissResults) {
                Long cid = ((Number) r.get("conceptId")).longValue();
                Object conf = r.get("confidence");
                faissConfidence.put(cid, conf instanceof Number ? ((Number) conf).doubleValue() : 0.0);
            }
            Map<String, Object> expanded = ontologyService.analyzeContext(matchedConceptIds, faissConfidence);
            List<Map<String, Object>> trace = (List<Map<String, Object>>) expanded.getOrDefault("conceptTrace", List.of());
            ontologyRelations = (Map<Long, List<Map<String, Object>>>) expanded.getOrDefault("relatedConcepts", Map.of());
            conceptTrace.addAll(trace);
            for (Map<String, Object> t : trace) {
                Object cid = t.get("conceptId");
                Object depth = t.get("depth");
                if (cid instanceof Number) {
                    Long id = ((Number) cid).longValue();
                    if ((depth instanceof Number && ((Number) depth).intValue() > 0)
                            || ontologyRelations.containsKey(id)) {
                        ontologyConcepts.add(t);
                    }
                }
            }
            @SuppressWarnings("unchecked")
            List<ConceptMapping> prevMappings = (List<ConceptMapping>) reuseContext.get("tableMappings");
            if (prevMappings != null) tableMappings.addAll(prevMappings);
            @SuppressWarnings("unchecked")
            List<ConceptJoinMapping> prevJoins = (List<ConceptJoinMapping>) reuseContext.get("joinMappings");
            if (prevJoins != null) joinMappings.addAll(prevJoins);
            @SuppressWarnings("unchecked")
            List<Long> prevToolIds = (List<Long>) reuseContext.get("toolIds");
            if (prevToolIds != null && !prevToolIds.isEmpty()) {
                List<ToolDefinition> prevTools = toolDefinitionRepository.findAllById(prevToolIds);
                apiTools.addAll(prevTools);
            }
        }

        if (conceptIds.size() > MAX_CONCEPT_IDS) {
            List<Long> limited = selectTopConcepts(conceptIds, conceptTrace, faissResults);
            conceptIds.clear();
            conceptIds.addAll(limited);
        }

        List<ToolDefinition> vectorTools = toolEmbeddingService.search(null, userQuery, 5);
        if (vectorTools != null) {
            for (ToolDefinition t : vectorTools) {
                if (apiTools.stream().noneMatch(e -> e.getId().equals(t.getId()))) {
                    apiTools.add(t);
                }
            }
        }
        if (apiTools.size() > MAX_API_TOOLS) {
            apiTools = apiTools.subList(0, MAX_API_TOOLS);
        }

        if (matchedConceptIds.isEmpty()) {
            List<Concept> accessibleConcepts = getAccessibleConcepts(userId);
            if (!accessibleConcepts.isEmpty()) {
                for (Concept c : accessibleConcepts) {
                    conceptIds.add(c.getId());
                    conceptTrace.add(Map.of("conceptId", c.getId(), "conceptName", c.getName(),
                            "description", c.getDescription() != null ? c.getDescription() : "", "depth", 0));
                }
            }
            if (!conceptIds.isEmpty()) {
                List<Long> toolIds = toolConceptRepository.findByConceptIdIn(conceptIds).stream()
                        .map(ToolConcept::getToolId).distinct().collect(Collectors.toList());
                if (!toolIds.isEmpty()) {
                    for (ToolDefinition t : toolDefinitionRepository.findAllById(toolIds)) {
                        if (apiTools.stream().noneMatch(e -> e.getId().equals(t.getId()))) {
                            apiTools.add(t);
                        }
                    }
                }
            } else if (apiTools.isEmpty()) {
                List<ToolDefinition> allTools = toolDefinitionRepository.findByScope("PLATFORM");
                if (allTools != null && !allTools.isEmpty()) apiTools.addAll(allTools);
            }
            if (!conceptIds.isEmpty()) {
                List<ConceptMapping> mappings = conceptMappingRepository.findAll().stream()
                        .filter(m -> conceptIds.contains(m.getConceptId())).collect(Collectors.toList());
                for (ConceptMapping m : mappings) {
                    boolean exists = tableMappings.stream().anyMatch(
                            e -> e.getTableName().equals(m.getTableName()) && e.getColumnName().equals(m.getColumnName()));
                    if (!exists) tableMappings.add(m);
                }
            }
        }

        Map<Long, String> groupNameMap = buildGroupNameMap(conceptTrace);
        Map<Long, List<Map<String, Object>>> drillDimensions = new LinkedHashMap<>();
        for (Long cid : conceptIds) {
            List<Map<String, Object>> dims = ontologyService.getDrillDimensions(cid);
            if (!dims.isEmpty()) drillDimensions.put(cid, dims);
        }
        agentDebug.info("[CONTEXT] Drill dimensions: {} concepts have drill paths, details={}",
                drillDimensions.size(),
                drillDimensions.entrySet().stream()
                        .map(e -> e.getKey() + "->" + e.getValue().stream()
                                .map(d -> String.valueOf(d.get("conceptName"))).collect(Collectors.joining(",")))
                        .collect(Collectors.joining("; ")));
        Map<Long, List<Map<String, Object>>> correlatedDimensions = new LinkedHashMap<>();
        for (Long cid : conceptIds) {
            List<Map<String, Object>> dims = ontologyService.getCorrelatedDimensions(cid);
            if (!dims.isEmpty()) correlatedDimensions.put(cid, dims);
        }

        List<Map<String, Object>> availableDatasources = datasourceService.getAvailableDatasources();
        String availableRelations = buildAvailableRelationsPrompt(conceptTrace);
        boolean isAdmin = userId != null && roleConceptPermissionService.isSuperAdmin(userId);
        String prompt = buildUnifiedContextPrompt(userQuery, conceptTrace, apiTools,
                tableMappings, joinMappings, authorizedConceptIds, groupNameMap,
                drillDimensions, correlatedDimensions, ontologyRelations,
                messages, availableDatasources,
                availableRelations, isAdmin, intent);

        // ===== 构建概念追踪管道 =====
        Map<String, Object> pipeline = new LinkedHashMap<>();

        Map<String, Object> faissStage = new LinkedHashMap<>();
        faissStage.put("matched", !faissResults.isEmpty());
        faissStage.put("concepts", faissResults);
        pipeline.put("faiss", faissStage);

        Map<String, Object> ontologyStage = new LinkedHashMap<>();
        ontologyStage.put("expanded", !ontologyConcepts.isEmpty() || !ontologyRelations.isEmpty());
        ontologyStage.put("concepts", ontologyConcepts);
        Map<String, List<Map<String, Object>>> relationsStr = new LinkedHashMap<>();
        for (Map.Entry<Long, List<Map<String, Object>>> e : ontologyRelations.entrySet()) {
            relationsStr.put(String.valueOf(e.getKey()), e.getValue());
        }
        ontologyStage.put("relations", relationsStr);
        pipeline.put("ontology", ontologyStage);

        Map<String, Object> submittedStage = new LinkedHashMap<>();
        Set<Long> submittedConceptIdSet = new LinkedHashSet<>(conceptIds);
        List<Map<String, Object>> submittedConcepts = conceptTrace.stream()
                .filter(t -> !"pipeline".equals(t.get("type")))
                .filter(t -> t.get("conceptName") != null && !"".equals(t.get("conceptName")))
                .filter(t -> t.get("conceptId") instanceof Number)
                .filter(t -> submittedConceptIdSet.contains(((Number) t.get("conceptId")).longValue()))
                .collect(Collectors.toMap(
                        t -> ((Number) t.get("conceptId")).longValue(),
                        t -> {
                            Map<String, Object> c = new LinkedHashMap<>();
                            c.put("conceptId", t.get("conceptId"));
                            c.put("conceptName", t.get("conceptName"));
                            c.put("depth", t.get("depth"));
                            return c;
                        },
                        (existing, replacement) -> existing,
                        LinkedHashMap::new))
                .values().stream()
                .collect(Collectors.toList());
        submittedStage.put("conceptCount", submittedConcepts.size());
        submittedStage.put("concepts", submittedConcepts);
        submittedStage.put("toolCount", apiTools.size());
        submittedStage.put("tools", apiTools.stream()
                .map(t -> Map.of("name", t.getName(), "description",
                        t.getDescription() != null ? t.getDescription() : ""))
                .collect(Collectors.toList()));
        submittedStage.put("tableMappingCount", tableMappings.size());
        submittedStage.put("tableMappings", tableMappings.stream()
                .map(m -> {
                    Map<String, Object> map = new LinkedHashMap<>();
                    map.put("tableName", m.getTableName());
                    map.put("columnName", m.getColumnName());
                    map.put("mappingType", m.getMappingType() != null ? m.getMappingType() : "");
                    if (m.getComputedExpr() != null && !m.getComputedExpr().isBlank()) {
                        map.put("computedExpr", m.getComputedExpr());
                    }
                    return map;
                })
                .collect(Collectors.toList()));
        submittedStage.put("joinMappingCount", joinMappings.size());
        submittedStage.put("joinMappings", joinMappings.stream()
                .map(j -> Map.of("joinType", j.getJoinType() != null ? j.getJoinType() : "",
                        "joinTable", j.getJoinTable() != null ? j.getJoinTable() : "",
                        "joinCondition", j.getJoinCondition() != null ? j.getJoinCondition() : ""))
                .collect(Collectors.toList()));
        pipeline.put("submitted", submittedStage);

        conceptTrace.add(0, Map.of("type", "pipeline", "pipeline", pipeline));

        agentDebug.info("[CONTEXT] Pipeline: faiss={}, ontologyExpanded={}, submittedConcepts={}, tools={}, tableMappings={}, joinMappings={}",
                !faissResults.isEmpty(), !ontologyConcepts.isEmpty() || !ontologyRelations.isEmpty(),
                submittedConcepts.size(), apiTools.size(), tableMappings.size(), joinMappings.size());

        log.info("ContextBuilder TOTAL: {}ms, concepts={}, tools={}, tables={}",
                System.currentTimeMillis() - t0, conceptIds.size(), apiTools.size(), tableMappings.size());

        result.put("conceptIds", conceptIds.stream().distinct().collect(Collectors.toList()));
        result.put("conceptTrace", conceptTrace);
        result.put("apiTools", apiTools);
        result.put("tableMappings", tableMappings);
        result.put("joinMappings", joinMappings);
        result.put("prompt", prompt);
        result.put("availableDatasources", availableDatasources);
        return result;
    }

    private Map<String, Object> analyzeMultiTurnReuse(List<Map<String, Object>> messages, List<Long> currentConceptIds) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (currentConceptIds == null || currentConceptIds.isEmpty()) return result;

        List<Long> prevConceptIds = new ArrayList<>();
        List<Map<String, Object>> prevMessages = new ArrayList<>();
        for (int i = messages.size() - 1; i >= 0; i--) {
            Map<String, Object> msg = messages.get(i);
            if ("user".equals(msg.get("role"))) {
                prevMessages.add(0, msg);
                if (prevMessages.size() >= 2) break;
            }
        }
        if (prevMessages.size() < 2) return result;

        String prevQuery = (String) prevMessages.get(0).get("content");
        if (prevQuery == null) return result;

        try {
            List<Float> prevEmbedding = faissService.getEmbedding(prevQuery);
            if (prevEmbedding != null && !prevEmbedding.isEmpty()) {
                List<Map<String, Object>> prevResults = faissService.search(prevEmbedding, 10);
                if (prevResults != null) {
                    for (Map<String, Object> r : prevResults) {
                        Object id = r.get("id");
                        if (id == null) id = r.get("concept_id");
                        if (id instanceof Number n) prevConceptIds.add(n.longValue());
                        else if (id instanceof String s) {
                            try { prevConceptIds.add(Long.parseLong(s)); }
                            catch (NumberFormatException ignored) {}
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.debug("Multi-turn concept intersection check failed: {}", e.getMessage());
        }

        if (!prevConceptIds.isEmpty()) {
            Set<Long> currentSet = new HashSet<>(currentConceptIds);
            long intersection = prevConceptIds.stream().filter(currentSet::contains).count();
            double ratio = (double) intersection / Math.max(prevConceptIds.size(), currentSet.size());
            if (ratio >= CONCEPT_INTERSECTION_THRESHOLD) {
                result.put("conceptIntersectionRatio", ratio);
                result.put("reuseLevel", "concept");
                result.put("fullReuse", true);
                List<ConceptMapping> mappings = conceptMappingRepository.findByConceptIdIn(new ArrayList<>(currentConceptIds));
                result.put("tableMappings", mappings);
                List<ConceptJoinMapping> joins = conceptJoinMappingRepository.findByConceptIdIn(new ArrayList<>(currentConceptIds));
                result.put("joinMappings", joins);
                List<Long> toolIds = toolConceptRepository.findByConceptIdIn(new ArrayList<>(currentConceptIds))
                        .stream().map(ToolConcept::getToolId).distinct().collect(Collectors.toList());
                if (!toolIds.isEmpty()) result.put("apiTools", toolDefinitionRepository.findAllById(toolIds));
                return result;
            }
        }

        String currentQuery = (String) messages.get(messages.size() - 1).get("content");
        if (currentQuery != null && checkTableReuse(prevQuery, currentQuery)) {
            result.put("reuseLevel", "table");
        }

        String latestQuery = (String) messages.get(messages.size() - 1).get("content");
        if (latestQuery != null) {
            String upper = latestQuery.toUpperCase();
            if (upper.contains("AVG") || upper.contains("平均") || upper.contains("SUM") || upper.contains("合计")
                    || upper.contains("总和") || upper.contains("COUNT") || upper.contains("数量")
                    || upper.contains("统计") || upper.contains("MAX") || upper.contains("最大")
                    || upper.contains("MIN") || upper.contains("最小")) {
                result.put("hasAggregation", true);
            }
        }
        return result;
    }

    private boolean checkTableReuse(String prevQuery, String currentQuery) {
        if (prevQuery == null || currentQuery == null) return false;
        String prevLower = prevQuery.toLowerCase();
        String currLower = currentQuery.toLowerCase();
        for (String kw : new String[]{"表", "table", "数据", "记录", "行", "列"}) {
            if (prevLower.contains(kw) && currLower.contains(kw)) return true;
        }
        return false;
    }

    private List<Concept> getAccessibleConcepts(Long userId) {
        List<Concept> allIndexed = conceptRepository.findAll().stream()
                .filter(c -> c.getEmbedding() != null && c.getEmbedding().length > 0)
                .collect(Collectors.toList());
        if (userId == null || allIndexed.isEmpty()) return allIndexed;
        try {
            List<Long> conceptIds = allIndexed.stream().map(Concept::getId).collect(Collectors.toList());
            Map<Long, Boolean> perms = roleConceptPermissionService.batchCheckQueryPermission(userId, conceptIds);
            return allIndexed.stream().filter(c -> perms.getOrDefault(c.getId(), true)).collect(Collectors.toList());
        } catch (Exception e) {
            log.warn("Failed to check RBAC permissions: {}", e.getMessage());
            return allIndexed;
        }
    }

    private List<Map<String, Object>> searchConcepts(String userQuery) {
        if (!faissService.isHealthy()) return List.of();
        try {
            List<Float> embedding = faissService.getEmbedding(userQuery);
            if (embedding == null || embedding.isEmpty()) return List.of();
            List<Map<String, Object>> results = faissService.search(embedding, 10);
            if (results == null || results.isEmpty()) return List.of();
            List<Map<String, Object>> enriched = new ArrayList<>();
            for (Map<String, Object> r : results) {
                Object id = r.get("id");
                if (id == null) id = r.get("concept_id");
                long conceptId;
                if (id instanceof Number n) conceptId = n.longValue();
                else if (id instanceof String s) {
                    try { conceptId = Long.parseLong(s); }
                    catch (NumberFormatException e) { continue; }
                } else continue;
                Concept concept = conceptRepository.findById(conceptId).orElse(null);
                if (concept == null) continue;
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("conceptId", conceptId);
                item.put("conceptName", concept.getName());
                Object score = r.get("score");
                if (score instanceof Number) item.put("confidence", ((Number) score).doubleValue());
                enriched.add(item);
            }
            return enriched;
        } catch (Exception e) {
            log.warn("FAISS concept search failed: {}", e.getMessage());
            return List.of();
        }
    }

    private List<Long> selectTopConcepts(List<Long> conceptIds, List<Map<String, Object>> conceptTrace,
            List<Map<String, Object>> faissResults) {
        Map<Long, Double> confidenceMap = new LinkedHashMap<>();
        for (Map<String, Object> t : conceptTrace) {
            Object cid = t.get("conceptId");
            Object conf = t.get("confidence");
            if (cid instanceof Number && conf instanceof Number) {
                confidenceMap.merge(((Number) cid).longValue(), ((Number) conf).doubleValue(), Math::max);
            }
        }
        for (Map<String, Object> r : faissResults) {
            Long cid = ((Number) r.get("conceptId")).longValue();
            Object conf = r.get("confidence");
            if (conf instanceof Number) confidenceMap.merge(cid, ((Number) conf).doubleValue(), Math::max);
        }
        List<Long> uniqueIds = conceptIds.stream().distinct().collect(Collectors.toList());
        List<Map.Entry<Long, Double>> scored = new ArrayList<>();
        for (Long id : uniqueIds) scored.add(Map.entry(id, confidenceMap.getOrDefault(id, 0.0)));
        scored.sort((a, b) -> Double.compare(b.getValue(), a.getValue()));
        List<Long> result = new ArrayList<>();
        for (int i = 0; i < Math.min(MAX_CONCEPT_IDS, scored.size()); i++) result.add(scored.get(i).getKey());
        return result;
    }

    private Map<Long, String> buildGroupNameMap(List<Map<String, Object>> conceptTrace) {
        Map<Long, String> map = new LinkedHashMap<>();
        if (conceptTrace == null) return map;
        for (Map<String, Object> c : conceptTrace) {
            if ("pipeline".equals(c.get("type")) || "reuse".equals(c.get("type"))) continue;
            Object gid = c.get("groupId");
            if (gid instanceof Number) map.putIfAbsent(((Number) gid).longValue(), null);
        }
        for (Long gid : map.keySet()) {
            try {
                ontologyGroupRepository.findById(gid).ifPresent(g -> {
                    String name = g.getDisplayName() != null ? g.getDisplayName() : g.getName();
                    map.put(gid, name != null ? name : "域" + gid);
                });
            } catch (Exception e) {
                map.put(gid, "域" + gid);
            }
        }
        return map;
    }

    private String buildPreviousAnalysisContext(List<Map<String, Object>> messages) {
        if (messages == null || messages.size() < 2) return "";
        StringBuilder sb = new StringBuilder();
        int queryNum = 0;
        for (Map<String, Object> msg : messages) {
            String role = (String) msg.get("role");
            String content = (String) msg.get("content");
            if ("tool".equals(role) && content != null && content.contains("SQL")) {
                queryNum++;
                sb.append("**查询 ").append(queryNum).append("**：\n");
                if (content.length() > 600) sb.append(content, 0, 600).append("...(截断)\n\n");
                else sb.append(content).append("\n\n");
            }
        }
        if (queryNum == 0) return "";
        return "已执行 **" + queryNum + "** 次 SQL 查询。请基于以上结果继续分析，**禁止重复已执行的查询**：\n\n" + sb;
    }

    private String buildAvailableRelationsPrompt(List<Map<String, Object>> conceptTrace) {
        if (conceptTrace == null || conceptTrace.isEmpty()) return "";
        Set<Long> groupIds = conceptTrace.stream()
                .filter(c -> c.get("groupId") instanceof Number)
                .map(c -> ((Number) c.get("groupId")).longValue())
                .collect(Collectors.toSet());
        if (groupIds.isEmpty()) return "";
        Set<Long> industryIds = new LinkedHashSet<>();
        for (Long gid : groupIds) {
            ontologyGroupRepository.findById(gid).ifPresent(g -> {
                if (g.getIndustryId() != null) industryIds.add(g.getIndustryId());
            });
        }
        if (industryIds.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (Long industryId : industryIds) {
            List<IndustryRelation> relations = industryService.getRelations(industryId);
            if (relations.isEmpty()) continue;
            for (IndustryRelation r : relations) {
                sb.append("     - ").append(r.getRelationType());
                if (r.getDescription() != null && !r.getDescription().isEmpty())
                    sb.append(": ").append(r.getDescription());
                if (r.getSourceRole() != null && r.getTargetRole() != null)
                    sb.append("。source=").append(r.getSourceRole())
                            .append(", target=").append(r.getTargetRole());
                sb.append("\n");
            }
        }
        return sb.toString();
    }

    public String buildUnifiedContextPrompt(String userQuery, List<Map<String, Object>> conceptTrace,
            List<ToolDefinition> apiTools, List<ConceptMapping> tableMappings,
            List<ConceptJoinMapping> joinMappings, Set<Long> authorizedConceptIds,
            Map<Long, String> groupNameMap, Map<Long, List<Map<String, Object>>> drillDimensions,
            Map<Long, List<Map<String, Object>>> correlatedDimensions,
            Map<Long, List<Map<String, Object>>> ontologyRelations,
            List<Map<String, Object>> messages,
            List<Map<String, Object>> availableDatasources, String availableRelations,
            boolean isAdmin, String intent) {

        StringBuilder sb = new StringBuilder();
        sb.append("## 用户问题\n").append(userQuery).append("\n\n");

        boolean isOntologyFlow = "ontology".equals(intent);
        if (isAdmin && isOntologyFlow) {
            sb.append("## 当前任务：本体管理\n");
            sb.append("用户想配置本体（添加概念、关系、映射、表连接）。请严格按照下方「本体创建思维链」操作，使用 ontology_action 输出。\n\n");
            sb.append(buildOntologyThinkingChain());
            String fullContext = buildFullOntologyContext();
            if (!fullContext.isEmpty()) sb.append(fullContext);
        } else {
            sb.append("## 当前任务：数据查询\n");
            sb.append("用户想查数据、分析指标、下钻根因。请使用 tool_call/nl2sql/code_mode/final_answer 完成查询。\n");
            sb.append("final_answer 必须展示证据链：先列出执行的 SQL 与关键查询结果，再给出结论。\n");
            sb.append("禁止不引用任何查询数据就直接输出答案。\n");
        }
        sb.append("\n");

        Map<String, Object> dsSelection = null;
        if (tableMappings != null && !tableMappings.isEmpty() && availableDatasources != null) {
            Set<Long> derivedDsIds = tableMappings.stream().map(ConceptMapping::getDatasourceId)
                    .filter(Objects::nonNull).collect(Collectors.toSet());
            if (!derivedDsIds.isEmpty()) {
                List<Map<String, Object>> selected = new ArrayList<>();
                for (Map<String, Object> ds : availableDatasources) {
                    Object dsId = ds.get("id");
                    if (dsId instanceof Number && derivedDsIds.contains(((Number) dsId).longValue())) {
                        Map<String, Object> sel = new LinkedHashMap<>();
                        sel.put("id", dsId);
                        sel.put("name", ds.get("name"));
                        Set<String> tables = tableMappings.stream()
                                .filter(m -> dsId.equals(m.getDatasourceId()))
                                .map(ConceptMapping::getTableName).filter(Objects::nonNull)
                                .collect(Collectors.toCollection(LinkedHashSet::new));
                        sel.put("tables", new ArrayList<>(tables));
                        selected.add(sel);
                    }
                }
                if (!selected.isEmpty()) dsSelection = Map.of("selected", selected);
            }
        }

        if (dsSelection != null) {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> selected = (List<Map<String, Object>>) dsSelection.get("selected");
            if (selected != null && !selected.isEmpty() && availableDatasources != null) {
                sb.append("## 数据源\n| 数据源ID | 名称 | 选择的数据表 |\n|----------|------|-------------|\n");
                for (Map<String, Object> sel : selected) {
                    Object selId = sel.get("id");
                    String selName = (String) sel.get("name");
                    @SuppressWarnings("unchecked")
                    List<String> selTables = (List<String>) sel.get("tables");
                    sb.append("| ").append(selId != null ? selId : "-")
                            .append(" | ").append(selName)
                            .append(" | ").append(selTables != null ? String.join(", ", selTables) : "全部")
                            .append(" |\n");
                }
                sb.append("\n");
                for (Map<String, Object> sel : selected) {
                    Object selId = sel.get("id");
                    String selName = (String) sel.get("name");
                    @SuppressWarnings("unchecked")
                    List<String> selTables = (List<String>) sel.get("tables");
                    Map<String, Object> ds = selId != null ? availableDatasources.stream()
                            .filter(d -> selId.equals(d.get("id"))).findFirst().orElse(null) : null;
                    if (ds != null) {
                        @SuppressWarnings("unchecked")
                        List<Map<String, Object>> tables = (List<Map<String, Object>>) ds.get("tables");
                        if (tables != null && !tables.isEmpty()) {
                            sb.append("### ").append(selName != null ? selName : ds.get("name")).append(" 表结构\n");
                            sb.append("| 表名 | 列名 | 类型 | 约束 | 注释 |\n|------|------|------|------|------|\n");
                            for (Map<String, Object> table : tables) {
                                String tableName = (String) table.get("name");
                                if (selTables != null && !selTables.isEmpty() && !selTables.contains(tableName)) continue;
                                @SuppressWarnings("unchecked")
                                Object columnsRaw = table.get("columns");
                                if (columnsRaw instanceof List<?> columnsList) {
                                    String first = "**" + tableName + "**";
                                    for (Object colObj : columnsList) {
                                        if (colObj instanceof Map) {
                                            @SuppressWarnings("unchecked")
                                            Map<String, Object> col = (Map<String, Object>) colObj;
                                            sb.append("| ").append(first).append(" | `").append(col.get("name")).append("`")
                                                    .append(" | ").append(col.getOrDefault("type", "-"))
                                                    .append(" | ").append(Boolean.TRUE.equals(col.getOrDefault("nullable", true)) ? "NULL" : "NOT NULL")
                                                    .append(" | ").append(Objects.toString(col.getOrDefault("comment", ""), "-"))
                                                    .append(" |\n");
                                            first = "";
                                        } else if (colObj instanceof String) {
                                            sb.append("| ").append(first).append(" | `").append(colObj).append("` | - | - | - |\n");
                                            first = "";
                                        }
                                    }
                                }
                            }
                            sb.append("\n");
                        }
                    }
                }
            }
        }

        if (conceptTrace != null && !conceptTrace.isEmpty()) {
            sb.append("## 语义层匹配的概念\n| 概念ID | 概念名 | 域ID | 域名 | 描述 | 深度 | 权限 |\n|--------|--------|------|------|------|------|------|\n");
            for (Map<String, Object> c : conceptTrace) {
                if ("pipeline".equals(c.get("type")) || "reuse".equals(c.get("type"))) continue;
                Object cid = c.get("conceptId");
                Object gid = c.get("groupId");
                String groupName = gid instanceof Number ? groupNameMap.getOrDefault(((Number) gid).longValue(), "-") : "-";
                boolean authorized = cid instanceof Number && (authorizedConceptIds == null || authorizedConceptIds.isEmpty()
                        || authorizedConceptIds.contains(((Number) cid).longValue()));
                sb.append("| ").append(c.get("conceptId")).append(" | ").append(c.get("conceptName"))
                        .append(" | ").append(gid != null ? gid : "-").append(" | ").append(groupName)
                        .append(" | ").append(c.getOrDefault("description", "-")).append(" | ").append(c.get("depth"))
                        .append(" | ").append(authorized ? "[可用]" : "[无权限]").append(" |\n");
            }
            sb.append("\n");
        }

        if (drillDimensions != null && !drillDimensions.isEmpty()) {
            sb.append("## 可下钻维度\n下方列出各概念可进一步下钻分析的子维度。\n\n");
            for (Map.Entry<Long, List<Map<String, Object>>> entry : drillDimensions.entrySet()) {
                Long conceptId = entry.getKey();
                String conceptName = conceptTrace.stream()
                        .filter(t -> conceptId.equals(t.get("conceptId")))
                        .map(t -> String.valueOf(t.get("conceptName"))).findFirst().orElse("概念" + conceptId);
                sb.append("### ").append(conceptName).append(" (ID: ").append(conceptId).append(") 的下钻维度\n");
                sb.append("| 维度ID | 维度名 | 描述 | 异常阈值 |\n|--------|--------|------|----------|\n");
                for (Map<String, Object> dim : entry.getValue()) {
                    sb.append("| ").append(dim.get("conceptId")).append(" | ").append(dim.get("conceptName"))
                            .append(" | ").append(dim.getOrDefault("description", "-"))
                            .append(" | ").append(dim.containsKey("anomalyThresholdExpr") ? dim.get("anomalyThresholdDesc") : "-")
                            .append(" |\n");
                }
                sb.append("\n");
            }
        }

        if (correlatedDimensions != null && !correlatedDimensions.isEmpty()) {
            sb.append("## 关联维度（交叉验证）\n下方列出各概念的关联维度，用于交叉验证根因。**在下钻分析过程中，必须同时检查关联维度以排除干扰因素。**\n\n");
            for (Map.Entry<Long, List<Map<String, Object>>> entry : correlatedDimensions.entrySet()) {
                Long conceptId = entry.getKey();
                String conceptName = conceptTrace.stream()
                        .filter(t -> conceptId.equals(t.get("conceptId")))
                        .map(t -> String.valueOf(t.get("conceptName"))).findFirst().orElse("概念" + conceptId);
                sb.append("### ").append(conceptName).append(" (ID: ").append(conceptId).append(") 的关联维度\n");
                sb.append("| 维度ID | 维度名 | 描述 | 用途 |\n|--------|--------|------|------|\n");
                for (Map<String, Object> dim : entry.getValue()) {
                    sb.append("| ").append(dim.get("conceptId")).append(" | ").append(dim.get("conceptName"))
                            .append(" | ").append(dim.getOrDefault("description", "-"))
                            .append(" | 交叉验证：确认根因是否由该维度变化导致 |\n");
                }
                sb.append("\n");
            }
        }

        if (ontologyRelations != null && !ontologyRelations.isEmpty()) {
            sb.append("## 计算关系（COMPUTED_FROM/DERIVED_FROM）\n");
            sb.append("以下概念由其他概念计算得出或派生。\n\n");
            sb.append("**查询规则（双通道验证）：**\n");
            sb.append("- 同时查询预计算字段和所有因子列，SQL 一条覆盖\n");
            sb.append("- 按公式从因子计算，与预计算字段交叉验证\n");
            sb.append("- 输出 final_answer 前自检：SQL 是否同时包含预计算字段和所有因子列？\n");
            sb.append("- final_answer 展示证据链：公式 → 各因子值 → 计算结果 → 预计算字段值 → 一致性判定\n\n");
            for (Map.Entry<Long, List<Map<String, Object>>> entry : ontologyRelations.entrySet()) {
                Long sourceConceptId = entry.getKey();
                String sourceName = conceptTrace.stream()
                        .filter(t -> sourceConceptId.equals(t.get("conceptId")))
                        .map(t -> String.valueOf(t.get("conceptName"))).findFirst().orElse("概念" + sourceConceptId);
                for (Map<String, Object> rel : entry.getValue()) {
                    String relType = String.valueOf(rel.getOrDefault("relation", ""));
                    boolean isComputed = "COMPUTED_FROM".equals(relType);
                    boolean isDerived = "DERIVED_FROM".equals(relType);
                    if (!isComputed && !isDerived) continue;
                    String targetName = String.valueOf(rel.getOrDefault("conceptName", "?"));
                    String expression = rel.get("expression") != null ? String.valueOf(rel.get("expression")) : null;
                    sb.append("- **").append(sourceName).append("** ").append(isComputed ? "由" : "派生自").append(" **").append(targetName).append("**");
                    if (expression != null && !expression.isEmpty()) {
                        String cleanExpr = expression.replaceFirst("^\\s*" + Pattern.quote(sourceName) + "\\s*=\\s*", "");
                        sb.append("：`").append(sourceName).append(" = ").append(cleanExpr).append("`");
                    }
                    sb.append("\n");
                }
            }
            sb.append("\n");
        }

        String previousAnalysis = buildPreviousAnalysisContext(messages);
        if (!previousAnalysis.isEmpty()) {
            sb.append("## 上轮分析回顾\n").append(previousAnalysis).append("\n");
        }

        if (tableMappings != null && !tableMappings.isEmpty()) {
            Map<Boolean, List<ConceptMapping>> partitioned = tableMappings.stream()
                    .collect(Collectors.partitioningBy(m -> authorizedConceptIds == null || authorizedConceptIds.isEmpty()
                            || authorizedConceptIds.contains(m.getConceptId())));
            List<ConceptMapping> authMappings = partitioned.getOrDefault(true, List.of());
            if (!authMappings.isEmpty()) {
                sb.append("## 可用的数据库表结构（✅ 已授权）\n");
                appendTableMappings(sb, authMappings);
            }
            List<ConceptMapping> unauthMappings = partitioned.getOrDefault(false, List.of());
            if (!unauthMappings.isEmpty()) {
                sb.append("## 数据库表结构（🔒 未授权，仅供分析参考）\n");
                sb.append("以下表结构存在但当前用户暂无查询权限，你不能对其生成 SQL，但可以在 final_answer 中告知用户需要申请权限。\n\n");
                appendTableMappings(sb, unauthMappings);
            }
        } else {
            sb.append("## 可用的数据库表结构\n（未找到与问题相关的表结构）\n\n");
        }

        if (joinMappings != null && !joinMappings.isEmpty()) {
            sb.append("## 表 JOIN 条件（禁止自行构造，只能用下列预定义 JOIN）\n");
            sb.append("**【强制】生成 SQL 时，只能使用下方列出的 JOIN 条件。如果预定义 JOIN 中没有你需要的表关联，必须通过预定义 JOIN 链间接到达目标表，禁止自行凭空构造任何 JOIN 路径或 ON 条件。**\n\n");
            for (ConceptJoinMapping join : joinMappings) {
                boolean authorized = authorizedConceptIds == null || authorizedConceptIds.isEmpty()
                        || authorizedConceptIds.contains(join.getConceptId());
                sb.append("- **").append(join.getRelationType() != null ? join.getRelationType() : "LEFT JOIN").append("**");
                if (!authorized) sb.append(" 🔒");
                sb.append("\n  - **JOIN 表**: `").append(join.getJoinTable()).append("`\n");
                sb.append("  - **JOIN 条件**: `").append(join.getJoinCondition()).append("`\n\n");
            }
        }

        if (apiTools != null && !apiTools.isEmpty()) {
            sb.append("## 可用的 API 工具\n");
            for (int i = 0; i < apiTools.size(); i++) {
                ToolDefinition tool = apiTools.get(i);
                sb.append("### ").append(i + 1).append(". ").append(tool.getDisplayName() != null ? tool.getDisplayName() : tool.getName()).append("\n");
                sb.append("- **名称**: `").append(tool.getName()).append("`\n");
                if (tool.getDescription() != null) sb.append("- **描述**: ").append(tool.getDescription()).append("\n");
                if (tool.getInputSchema() != null) sb.append("- **输入参数**: ").append(tool.getInputSchema()).append("\n");
                sb.append("\n");
            }
        }

        appendDecisionRules(sb, isAdmin, availableRelations);
        return sb.toString();
    }

    private void appendDecisionRules(StringBuilder sb, boolean isAdmin, String availableRelations) {
        sb.append("## 决策规则\n\n");
        sb.append("首先判断用户意图：如果用户是在咨询系统能力范围，请直接以 final_answer 介绍可用概念域，不要调用工具或生成 SQL。\n\n");
        sb.append("否则，你需要根据概念的权限状态做出判断，有以下三种情况：\n\n");
        sb.append("**情况 1 - 信息足够且全部有权限**：如果匹配的概念全部标记为 ✅，且表结构足够回答用户问题，请生成 SQL 或调用工具。\n\n");
        sb.append("**情况 2 - 信息足够但部分无权限**：如果匹配的概念中含有 🔒 标记，且这些概念对回答用户问题至关重要，请在 final_answer 中明确告知用户。不要对未授权概念生成 SQL。\n\n");
        sb.append("**情况 3 - 信息不足**：如果匹配的概念无法回答用户问题，请直接告知用户需要补充哪些信息。\n");
        sb.append("   - 如果上方「可用的数据库表结构」显示「未找到与问题相关的表结构」，说明当前系统没有配置对应的数据映射，请使用 final_answer 告知用户。\n\n");

        sb.append("1. **调用 API 工具**：\n   ```json\n   {\"type\": \"tool_call\", \"reasoning\": \"...\", \"tool_call\": {\"name\": \"工具名\", \"arguments\": {...}}}\n   ```\n\n");
        sb.append("2. **生成 SQL 查询**：只能对标记为 ✅ 的表生成 SQL。\n");
        sb.append("   ```json\n");
        sb.append("   {\"type\": \"nl2sql\", \"reasoning\": \"...\", \"sql\": \"SELECT ...\", \"concept_ids\": [1, 2, 3],\n");
        sb.append("    \"value_origins\": {\"OTN\": {\"origin\": \"table_column\", \"table\": \"dedicated_lines\", \"column\": \"type\"},\n");
        sb.append("                     \"1\": {\"origin\": \"previous_sql\", \"sql\": \"SELECT line_id FROM ...\"}}}\n");
        sb.append("   ```\n");
        sb.append("   - SQL 只能是 SELECT 查询\n");
        sb.append("   - **【强制】多表关联只能使用上方「表 JOIN 条件」中预定义的 JOIN，禁止自行构造任何 JOIN 路径或 ON 条件。如果预定义 JOIN 中没有直达目标表的路径，必须通过预定义 JOIN 链间接到达。**\n");
        sb.append("   - **【强制】value_origins 必须声明 SQL 中所有字符串等值条件的右值来源，缺失或声明不完整的 SQL 将被拒绝执行**\n");
        sb.append("     - origin=table_column：值来自某个表的实际枚举值，必须给出 table 和 column\n");
        sb.append("     - origin=previous_sql：值来自之前某条 SQL 的返回结果，必须引用该 SQL\n");
        sb.append("     - **禁止根据用户原始问题中的词语臆造右值。**例如用户说\"致命告警\"，数据库实际值可能是\"CRITICAL\"，不能将\"致命\"作为右值\n");
        sb.append("   - **【强制】任何涉及日期过滤的查询，必须先执行 `SELECT MIN(date_col), MAX(date_col) FROM table` 确认数据库中实际数据的日期范围**\n");
        sb.append("   - 用户说\"最近\"指的是数据库中最新数据，不是\"最近一个月\"。先查 MAX(date_col) 获取最新日期\n");
        sb.append("   - **【强制】计算比率类指标时，SQL 必须从分母表出发 LEFT JOIN 分子表**\n");
        sb.append("   - **【强制】按维度下钻分组时，GROUP BY 的列应从维度实际关联的表中选取**\n");
        sb.append("   - **【强制】分组结果中如果某个维度列全为 NULL，说明当前 JOIN 路径不通，应换路径重试**\n");
        sb.append("   - **禁止使用 CURDATE()、NOW() 等当前时间函数做日期过滤**\n");
        sb.append("   - **【强制】禁止重复执行相同的 SQL。每条 SQL 必须与之前执行过的 SQL 不同，如果之前已执行过某条 SQL，不要再次执行**\n");
        sb.append("   - 如果 SQL 返回 0 行，自行判断是否需要调整 SQL 重试；若判断数据确实不满足条件，直接输出 final_answer 告知用户\n\n");

        int opt = 3;
        sb.append(opt++).append(". **直接回答**：\n");
        sb.append("   ```json\n   {\"type\": \"final_answer\", \"reasoning\": \"...\", \"answer\": \"...\", \"concept_ids\": [...]}\n   ```\n");
        sb.append("   - concept_ids 必须填写\n\n");

        if (isAdmin) {
            sb.append(opt++).append(". **本体管理建议**：⚠️ 仅当用户意图明确为本体管理时才能使用。\n");
            sb.append("   - 如果上方没有表结构：先输出 get_table_schema 获取数据源表结构\n");
            sb.append("     ```json\n     {\"type\": \"get_table_schema\", \"datasourceIds\": [数据源ID], \"tableNames\": [\"表名\"], \"reasoning\": \"...\"}\n     ```\n");
            sb.append("     datasourceIds 从上方「可用数据源」表格中获取，tableNames 可选，不填则返回所有表。\n");
            sb.append("   - 获取表结构后，必须先输出 get_enum_values 声明 JOIN 条件中会用到的枚举列：\n");
            sb.append("     ```json\n     {\"type\": \"get_enum_values\", \"columns\": [{\"datasourceId\": 数据源ID, \"table\": \"表名\", \"column\": \"列名\"}], \"reasoning\": \"...\"}\n     ```\n");
            sb.append("     **【强制】JOIN 条件中使用的所有字符串值必须来自 get_enum_values 返回的实际值，禁止自行编造。**\n");
            sb.append("   - 获取枚举值后：使用 ontology_action 输出完整本体变更\n");
            sb.append("   ```json\n");
            sb.append("   {\"type\": \"ontology_action\", \"action\": \"suggest\", \"reasoning\": \"...\", \"trigger\": \"user_request\", \"changes\": [...]}\n");
            sb.append("   ```\n");
            sb.append("   - 可用关系类型：\n");
            if (availableRelations != null && !availableRelations.isEmpty()) {
                sb.append(availableRelations);
            } else {
                sb.append(BuiltinRelation.toPromptList());
            }
            sb.append("\n\n");
        }

        sb.append("## 根因分析输出规范（强制）\n\n");
        sb.append("**【强制】当用户意图为根因分析/故障分析时，完成所有下钻分析后，最后一条 final_answer 必须使用以下 root_cause JSON Schema，禁止输出纯文本总结。**\n\n");
        sb.append("```json\n");
        sb.append("{\"type\": \"final_answer\", \"answer_type\": \"root_cause\", \"reasoning\": \"完整推理链\",\n");
        sb.append(" \"answer\": \"根因结论（一句话概括）\",\n");
        sb.append(" \"evidence\": [{\"step\": 1, \"dimension\": \"下钻维度名\", \"sql\": \"执行的SQL\", \"finding\": \"该维度的分析发现\", \"anomaly\": true}],\n");
        sb.append(" \"root_cause\": {\"summary\": \"整体结论\", \"items\": [{\"entity\": \"受影响实体\", \"finding\": \"独立故障发现\", \"evidence_refs\": [1, 2], \"detail\": \"可选的详细说明\"}]},\n");
        sb.append(" \"suggestion\": \"修复建议\", \"concept_ids\": [1, 2]}\n");
        sb.append("```\n");
        sb.append("- evidence 数组必须包含每一轮下钻分析的关键发现，每项标注 anomaly=true/false\n");
        sb.append("- root_cause.items 中每个受影响实体独立描述，item 之间不得推断依赖关系\n");
        sb.append("- 跨实体的因果推断必须有 evidence 中明确的数据支撑，否则视为独立故障\n");
        sb.append("- 即使所有维度都未发现异常，也必须输出此格式，此时 root_cause.summary 写明\"未发现异常\"\n");
    }

    private void appendTableMappings(StringBuilder sb, List<ConceptMapping> mappings) {
        Map<String, List<ConceptMapping>> grouped = mappings.stream()
                .collect(Collectors.groupingBy(ConceptMapping::getTableName, LinkedHashMap::new, Collectors.toList()));
        for (Map.Entry<String, List<ConceptMapping>> entry : grouped.entrySet()) {
            sb.append("### 表: `").append(entry.getKey()).append("`\n");
            sb.append("| 列名 | 属性名 | 映射类型 | 计算表达式 |\n|------|--------|----------|------------|\n");
            for (ConceptMapping m : entry.getValue()) {
                sb.append("| `").append(m.getColumnName()).append("`")
                        .append(" | ").append(m.getAttributeName() != null ? m.getAttributeName() : "-")
                        .append(" | ").append(m.getMappingType() != null ? m.getMappingType() : "direct")
                        .append(" | ").append(m.getComputedExpr() != null ? m.getComputedExpr() : "-")
                        .append(" |\n");
            }
            sb.append("\n");
        }
    }

    public Set<String> collectKnownConceptNames(List<Map<String, Object>> changes) {
        Set<String> names = new LinkedHashSet<>();
        if (changes == null) return names;
        for (Map<String, Object> change : changes) {
            String op = (String) change.getOrDefault("operation", "");
            if ("ADD_CONCEPT".equals(op) || "UPDATE_CONCEPT".equals(op)) {
                @SuppressWarnings("unchecked")
                Map<String, Object> concept = (Map<String, Object>) change.get("concept");
                if (concept != null && concept.get("name") instanceof String s) names.add(s);
            }
        }
        return names;
    }

    private String buildFullOntologyContext() {
        StringBuilder sb = new StringBuilder();

        List<Industry> industries = industryService.list();
        if (!industries.isEmpty()) {
            sb.append("## 可用行业与域\n");
            sb.append("ADD_CONCEPT 的 industryId 和 groupName 必须从下表中选取，禁止凭空编造。\n\n");
            sb.append("| 行业ID | 行业名 | 域（groupName） |\n");
            sb.append("|--------|--------|-----------------|\n");
            for (Industry ind : industries) {
                List<OntologyGroup> groups = ontologyGroupRepository.findByIndustryId(ind.getId());
                List<String> groupNames = groups.stream()
                        .map(g -> g.getDisplayName() != null ? g.getDisplayName() : g.getName())
                        .collect(Collectors.toList());
                sb.append("| ").append(ind.getId()).append(" | ").append(ind.getDisplayName())
                        .append(" | ").append(groupNames.isEmpty() ? "-" : String.join("、", groupNames))
                        .append(" |\n");
            }
            sb.append("\n");
        }

        List<Map<String, Object>> datasources = datasourceService.getAvailableDatasources();
        if (!datasources.isEmpty()) {
            sb.append("## 可用数据源\n");
            sb.append("ADD_MAPPING / ADD_JOIN_MAPPING 的 dataSourceId 必须从下表中选取，禁止凭空编造。\n\n");
            sb.append("| 数据源ID | 名称 | 包含的表 |\n");
            sb.append("|----------|------|----------|\n");
            for (Map<String, Object> ds : datasources) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> tables = (List<Map<String, Object>>) ds.get("tables");
                List<String> tableNames = new ArrayList<>();
                if (tables != null) {
                    for (Map<String, Object> t : tables) {
                        tableNames.add((String) t.get("name"));
                    }
                }
                sb.append("| ").append(ds.get("id")).append(" | ").append(ds.get("name"))
                        .append(" | ").append(tableNames.isEmpty() ? "-" : String.join("、", tableNames))
                        .append(" |\n");
            }
            sb.append("\n");
        }

        List<Concept> allConcepts = conceptRepository.findAll();
        if (!allConcepts.isEmpty()) {
            Map<Long, String> groupNames = new LinkedHashMap<>();
            for (Concept c : allConcepts) {
                if (c.getGroupId() != null) groupNames.putIfAbsent(c.getGroupId(), null);
            }
            for (Long gid : groupNames.keySet()) {
                ontologyGroupRepository.findById(gid).ifPresent(g ->
                        groupNames.put(gid, g.getDisplayName() != null ? g.getDisplayName() : g.getName()));
            }
            sb.append("## 现有概念\n| 概念ID | 概念名 | 域 | 描述 |\n|--------|--------|-----|------|\n");
            for (Concept c : allConcepts) {
                String groupName = groupNames.getOrDefault(c.getGroupId(), "-");
                sb.append("| ").append(c.getId()).append(" | ").append(c.getName())
                        .append(" | ").append(groupName)
                        .append(" | ").append(c.getDescription() != null ? c.getDescription() : "-")
                        .append(" |\n");
            }
            sb.append("\n");
        }
        return sb.toString();
    }

    private String buildOntologyThinkingChain() {
        return "本体创建思维链：\n"
                + "1. 分析用户需求，确定需要创建的概念\n"
                + "2. 检查现有概念是否已覆盖需求\n"
                + "3. 如需要新概念，从上方「可用行业与域」表格中选择 industryId 和 groupName\n"
                + "4. 确定概念间的下钻和关联关系\n"
                + "5. 确定概念对应的数据表映射，dataSourceId 必须从上方「可用数据源」表格中选择\n"
                + "6. 使用 ontology_action 输出完整变更，industryId 和 dataSourceId 禁止编造\n";
    }

    public String buildMappingsForConcepts(List<String> conceptNames, String requestType) {
        StringBuilder sb = new StringBuilder();
        Set<Long> conceptIds = new HashSet<>();
        for (String name : conceptNames) {
            List<Concept> found = conceptRepository.findByName(name);
            for (Concept c : found) {
                conceptIds.add(c.getId());
            }
        }
        if (conceptIds.isEmpty()) {
            return "未找到指定概念的映射信息。";
        }
        boolean needMappings = "all".equals(requestType) || "mappings".equals(requestType);
        boolean needJoins = "all".equals(requestType) || "join_mappings".equals(requestType);
        if (needMappings) {
            List<ConceptMapping> mappings = conceptMappingRepository.findByConceptIdIn(new ArrayList<>(conceptIds));
            if (!mappings.isEmpty()) {
                sb.append("## 映射详情\n");
                sb.append("| 概念 | 表名 | 列名 | 映射类型 |\n");
                sb.append("|------|------|------|----------|\n");
                for (ConceptMapping m : mappings) {
                    String cname = conceptRepository.findById(m.getConceptId()).map(Concept::getName).orElse("?");
                    sb.append("| ").append(cname).append(" | ").append(m.getTableName())
                            .append(" | ").append(m.getColumnName())
                            .append(" | ").append(m.getMappingType() != null ? m.getMappingType() : "-").append(" |\n");
                }
                sb.append("\n");
            } else {
                sb.append("## 映射详情\n暂无映射。\n\n");
            }
        }
        if (needJoins) {
            List<ConceptJoinMapping> joins = conceptJoinMappingRepository.findByConceptIdIn(new ArrayList<>(conceptIds));
            if (!joins.isEmpty()) {
                sb.append("## 表连接详情\n");
                sb.append("| 概念 | 连接表 | 连接条件 | 连接类型 |\n");
                sb.append("|------|--------|----------|----------|\n");
                for (ConceptJoinMapping j : joins) {
                    String cname = conceptRepository.findById(j.getConceptId()).map(Concept::getName).orElse("?");
                    sb.append("| ").append(cname).append(" | ").append(j.getJoinTable())
                            .append(" | ").append(j.getJoinCondition())
                            .append(" | ").append(j.getRelationType() != null ? j.getRelationType() : "LEFT JOIN").append(" |\n");
                }
                sb.append("\n");
            } else {
                sb.append("## 表连接详情\n暂无表连接。\n\n");
            }
        }
        return sb.toString();
    }
}