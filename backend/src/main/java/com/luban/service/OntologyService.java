package com.luban.service;

import com.luban.constant.BindingType;
import com.luban.constant.OntologyOperationType.BuiltinRelation;
import com.luban.entity.Concept;
import com.luban.entity.ConceptJoinMapping;
import com.luban.entity.ConceptMapping;
import com.luban.entity.ConceptRelation;
import com.luban.entity.IndustryRelation;
import com.luban.entity.OntologyGroup;
import com.luban.entity.ConceptToolBinding;
import com.luban.entity.ToolDefinition;
import com.luban.repository.ConceptJoinMappingRepository;
import com.luban.repository.ConceptMappingRepository;
import com.luban.repository.ConceptRelationRepository;
import com.luban.repository.ConceptRepository;
import com.luban.repository.IndustryRelationRepository;
import com.luban.repository.OntologyGroupRepository;
import com.luban.repository.ConceptToolBindingRepository;
import com.luban.repository.ToolDefinitionRepository;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 本体运行时：把概念关系构建为不可变内存图（快照式整体替换，读无锁）。
 *
 * 历史上这里用 Apache Jena OWL 推理机承载同一套语义，但实际用到的能力只有
 * 三项——父子层级遍历、transitive 传递闭包、symmetric 双向展开——用邻接表
 * BFS 即可实现，还顺带修掉了 Jena 方案的固有缺陷：
 * - 跨行业/跨域的关系此前被按 source 行业分模型而静默丢弃，图中按 conceptId 建边天然支持；
 * - 同名关系类型在不同行业的 transitive/symmetric 元数据按 source 概念所属行业解析，不再全局串味。
 */
@Slf4j
@Service
public class OntologyService {

    private final org.slf4j.Logger agentDebug = LoggerFactory.getLogger("agent-debug");

    private final ConceptRepository conceptRepository;
    private final ConceptRelationRepository conceptRelationRepository;
    private final ConceptMappingRepository conceptMappingRepository;
    private final ConceptJoinMappingRepository conceptJoinMappingRepository;
    private final ConceptToolBindingRepository conceptToolBindingRepository;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final OntologyGroupRepository groupRepository;
    private final IndustryRelationRepository industryRelationRepository;

    private static final int MAX_CONCEPT_EXPAND = 20;
    private static final int MAX_API_TOOLS = 15;
    private static final int MAX_DRILL_PATH_DEPTH = 5;

    /** 单条语义关系边 */
    private record RelationEdge(Long sourceId, Long targetId, String relationType) {}

    private record RelationMeta(boolean transitive, boolean symmetric) {}

    /**
     * 不可变语义图快照。volatile 整体替换，读方无需加锁；
     * 关系 expression 一并缓存（key: source|target|type），消除遍历中的逐边 DB 查询。
     */
    private record OntologyGraph(
            Map<Long, List<RelationEdge>> outgoing,
            Map<Long, List<RelationEdge>> incoming,
            Map<Long, Set<Long>> parentsByChild,
            Map<Long, Set<Long>> childrenByParent,
            Map<Long, Map<String, RelationMeta>> metaByIndustry,
            Map<Long, Long> industryByConcept,
            Map<Long, String> nameByConcept,
            Map<String, String> expressions) {

        boolean isEmpty() {
            return nameByConcept.isEmpty();
        }

        RelationMeta meta(Long conceptId, String relationType) {
            Long industryId = industryByConcept.get(conceptId);
            if (industryId == null) return null;
            return metaByIndustry.getOrDefault(industryId, Map.of()).get(relationType);
        }

        /**
         * 关系的直接邻居：出边 + 对称关系的入边（对称由 source 概念所属行业的元数据决定）。
         * 返回的边统一以 targetId 为"邻居"，入边在此翻转方向。
         */
        List<RelationEdge> neighbors(Long conceptId, String relationType) {
            List<RelationEdge> result = new ArrayList<>();
            for (RelationEdge e : outgoing.getOrDefault(conceptId, List.of())) {
                if (e.relationType().equals(relationType)) result.add(e);
            }
            for (RelationEdge e : incoming.getOrDefault(conceptId, List.of())) {
                if (!e.relationType().equals(relationType)) continue;
                RelationMeta meta = meta(e.sourceId(), relationType);
                if (meta != null && meta.symmetric()) {
                    result.add(new RelationEdge(e.targetId(), e.sourceId(), relationType));
                }
            }
            return result;
        }

        Set<Long> typedClosure(Long conceptId, String relationType) {
            Set<Long> result = new LinkedHashSet<>();
            Deque<Long> queue = new ArrayDeque<>();
            for (RelationEdge e : neighbors(conceptId, relationType)) {
                if (result.add(e.targetId())) queue.add(e.targetId());
            }
            if (!isTransitive(conceptId, relationType)) return result;
            while (!queue.isEmpty()) {
                Long cur = queue.poll();
                for (RelationEdge e : neighbors(cur, relationType)) {
                    if (result.add(e.targetId())) queue.add(e.targetId());
                }
            }
            return result;
        }

        private boolean isTransitive(Long conceptId, String relationType) {
            RelationMeta meta = meta(conceptId, relationType);
            return meta != null && meta.transitive();
        }

        /** 子类闭包（原 OWL subClass 推理的等价实现） */
        Set<Long> subclassClosure(Long conceptId) {
            return closure(conceptId, childrenByParent);
        }

        /** 父类闭包 */
        Set<Long> superclassClosure(Long conceptId) {
            return closure(conceptId, parentsByChild);
        }

        private Set<Long> closure(Long conceptId, Map<Long, Set<Long>> adjacency) {
            Set<Long> result = new LinkedHashSet<>();
            Deque<Long> queue = new ArrayDeque<>();
            for (Long next : adjacency.getOrDefault(conceptId, Set.of())) {
                if (result.add(next)) queue.add(next);
            }
            while (!queue.isEmpty()) {
                Long cur = queue.poll();
                for (Long next : adjacency.getOrDefault(cur, Set.of())) {
                    if (result.add(next)) queue.add(next);
                }
            }
            return result;
        }
    }

    private volatile OntologyGraph graph = emptyGraph();

    private static OntologyGraph emptyGraph() {
        return new OntologyGraph(Map.of(), Map.of(), Map.of(), Map.of(), Map.of(), Map.of(), Map.of(), Map.of());
    }

    public OntologyService(ConceptRepository conceptRepository,
                           ConceptRelationRepository conceptRelationRepository,
                           ConceptMappingRepository conceptMappingRepository,
                           ConceptJoinMappingRepository conceptJoinMappingRepository,
                           ConceptToolBindingRepository conceptToolBindingRepository,
                           ToolDefinitionRepository toolDefinitionRepository,
                           OntologyGroupRepository groupRepository,
                           IndustryRelationRepository industryRelationRepository) {
        this.conceptRepository = conceptRepository;
        this.conceptRelationRepository = conceptRelationRepository;
        this.conceptMappingRepository = conceptMappingRepository;
        this.conceptJoinMappingRepository = conceptJoinMappingRepository;
        this.conceptToolBindingRepository = conceptToolBindingRepository;
        this.toolDefinitionRepository = toolDefinitionRepository;
        this.groupRepository = groupRepository;
        this.industryRelationRepository = industryRelationRepository;
    }

    @PostConstruct
    public void init() {
        try {
            buildGraph();
            log.info("Ontology graph initialized: {} concepts, {} relation edges",
                    graph.nameByConcept.size(), graph.outgoing.values().stream().mapToInt(List::size).sum());
        } catch (Exception e) {
            log.error("Failed to initialize ontology graph: {}", e.getMessage(), e);
            graph = emptyGraph();
        }
    }

    public boolean isEnabled() {
        return !graph.isEmpty();
    }

    public void reload() {
        try {
            buildGraph();
            log.info("Ontology graph reloaded: {} concepts, {} relation edges",
                    graph.nameByConcept.size(), graph.outgoing.values().stream().mapToInt(List::size).sum());
        } catch (Exception e) {
            log.error("Failed to reload ontology graph: {}", e.getMessage(), e);
        }
    }

    private static final Object RELOAD_REGISTERED_KEY = new Object();

    /**
     * 事务提交后再重建内存本体。在 @Transactional 方法内直接 reload 有两个问题：
     * 读到的是未提交数据；外层事务回滚后内存是"新状态"、DB 是旧状态，缓存与库漂移。
     * 同一事务内多次调用（如批量变更逐条触发）只注册一次，提交后仅重建一次。
     */
    public void reloadAfterCommit() {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            reload();
            return;
        }
        if (TransactionSynchronizationManager.getResource(RELOAD_REGISTERED_KEY) != null) return;
        TransactionSynchronizationManager.bindResource(RELOAD_REGISTERED_KEY, Boolean.TRUE);
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                TransactionSynchronizationManager.unbindResourceIfPossible(RELOAD_REGISTERED_KEY);
                reload();
            }

            @Override
            public void afterCompletion(int status) {
                if (status != STATUS_COMMITTED) {
                    TransactionSynchronizationManager.unbindResourceIfPossible(RELOAD_REGISTERED_KEY);
                }
            }
        });
    }

    private void buildGraph() {
        List<Concept> concepts = conceptRepository.findAll();
        List<ConceptRelation> relations = conceptRelationRepository.findAll();
        List<IndustryRelation> industryRelations = industryRelationRepository.findAll();
        List<OntologyGroup> groups = groupRepository.findAll();

        Map<Long, Long> groupIdToIndustry = new HashMap<>();
        for (OntologyGroup g : groups) {
            if (g.getIndustryId() != null) {
                groupIdToIndustry.put(g.getId(), g.getIndustryId());
            }
        }

        Map<Long, Long> industryByConcept = new HashMap<>();
        Map<Long, String> nameByConcept = new LinkedHashMap<>();
        Set<Long> conceptIds = new HashSet<>();
        for (Concept c : concepts) {
            conceptIds.add(c.getId());
            nameByConcept.put(c.getId(), c.getName());
            Long industryId = c.getGroupId() != null
                    ? groupIdToIndustry.getOrDefault(c.getGroupId(), -1L) : -1L;
            industryByConcept.put(c.getId(), industryId);
        }

        // 关系元数据按行业解析（此前 sourceToTargetMap.putIfAbsent 全局取第一条，跨行业串味）
        Map<Long, Map<String, RelationMeta>> metaByIndustry = new HashMap<>();
        Map<String, Boolean> sourceToTargetByType = new HashMap<>();
        for (IndustryRelation ir : industryRelations) {
            String type = ir.getRelationType();
            sourceToTargetByType.putIfAbsent(type, Boolean.TRUE.equals(ir.getSourceToTarget()));
            RelationMeta existing = metaByIndustry
                    .computeIfAbsent(ir.getIndustryId(), k -> new HashMap<>())
                    .get(type);
            boolean transitive = Boolean.TRUE.equals(ir.getIsTransitive())
                    || (existing != null && existing.transitive());
            boolean symmetric = Boolean.TRUE.equals(ir.getIsSymmetric())
                    || (existing != null && existing.symmetric());
            metaByIndustry.get(ir.getIndustryId()).put(type, new RelationMeta(transitive, symmetric));
        }

        Map<Long, List<RelationEdge>> outgoing = new HashMap<>();
        Map<Long, List<RelationEdge>> incoming = new HashMap<>();
        Map<Long, Set<Long>> parentsByChild = new HashMap<>();
        Map<String, String> expressions = new HashMap<>();
        for (ConceptRelation r : relations) {
            Long sourceId = r.getSourceConceptId();
            Long targetId = r.getTargetConceptId();
            if (sourceId == null || targetId == null) continue;
            if (!conceptIds.contains(sourceId) || !conceptIds.contains(targetId)) continue;
            if (sourceId.equals(targetId)) continue;

            String type = r.getRelationType();
            outgoing.computeIfAbsent(sourceId, k -> new ArrayList<>())
                    .add(new RelationEdge(sourceId, targetId, type));
            incoming.computeIfAbsent(targetId, k -> new ArrayList<>())
                    .add(new RelationEdge(sourceId, targetId, type));

            // sourceToTarget 关系语义：source 是 parent、target 是 child（沿用原 Jena 方案的层级规则）
            Boolean sourceToTarget = sourceToTargetByType.get(type);
            if (Boolean.TRUE.equals(sourceToTarget)) {
                parentsByChild.computeIfAbsent(targetId, k -> new LinkedHashSet<>()).add(sourceId);
            }

            if (r.getExpression() != null && !r.getExpression().isBlank()) {
                expressions.putIfAbsent(sourceId + "|" + targetId + "|" + type, r.getExpression());
            }
        }

        Map<Long, Set<Long>> childrenByParent = new HashMap<>();
        for (Map.Entry<Long, Set<Long>> e : parentsByChild.entrySet()) {
            for (Long parent : e.getValue()) {
                childrenByParent.computeIfAbsent(parent, k -> new LinkedHashSet<>()).add(e.getKey());
            }
        }

        this.graph = new OntologyGraph(
                Map.copyOf(outgoing), Map.copyOf(incoming), Map.copyOf(parentsByChild), Map.copyOf(childrenByParent),
                Map.copyOf(metaByIndustry), Map.copyOf(industryByConcept), Map.copyOf(nameByConcept),
                Map.copyOf(expressions));
    }

    private String conceptNameOf(Long conceptId) {
        if (conceptId == null) return null;
        String name = graph.nameByConcept.get(conceptId);
        if (name != null) return name;
        return conceptRepository.findById(conceptId).map(Concept::getName).orElse(null);
    }

    private String relationExpressionOf(Long sourceId, Long targetId, String relationType) {
        return graph.expressions.get(sourceId + "|" + targetId + "|" + relationType);
    }

    public List<ToolDefinition> expandByConcepts(List<ToolDefinition> topK, int maxExpanded) {
        OntologyGraph g = graph;
        if (g.isEmpty()) {
            return topK;
        }

        Set<ToolDefinition> result = new LinkedHashSet<>(topK);

        Set<Long> consumedConceptIds = new HashSet<>();
        for (ToolDefinition tool : topK) {
            List<ConceptToolBinding> bindings = conceptToolBindingRepository
                    .findByToolIdAndBindingType(tool.getId(), BindingType.CONSUMES);
            for (ConceptToolBinding ctb : bindings) {
                consumedConceptIds.add(ctb.getConceptId());
            }
        }

        if (consumedConceptIds.isEmpty()) {
            return topK;
        }

        // 闭包移动集：子层级 + 计算类关系（COMPUTED_FROM/DERIVED_FROM/EQUIVALENT_TO，含对称反向），
        // 与原 Jena 方案的 listSubClasses/listIndividuals 全闭包等价
        Set<String> semanticTypes = Set.of(
                BuiltinRelation.COMPUTED_FROM.name(),
                BuiltinRelation.DERIVED_FROM.name(),
                BuiltinRelation.EQUIVALENT_TO.name());

        Set<Long> expanded = new HashSet<>(consumedConceptIds);
        Deque<Long> queue = new ArrayDeque<>(consumedConceptIds);
        while (!queue.isEmpty()) {
            Long cur = queue.poll();
            List<Long> next = new ArrayList<>(g.subclassClosure(cur));
            for (String type : semanticTypes) {
                for (RelationEdge e : g.neighbors(cur, type)) {
                    next.add(e.targetId());
                }
            }
            for (Long id : next) {
                if (id != null && expanded.add(id)) {
                    queue.add(id);
                }
            }
        }

        for (Long conceptId : expanded) {
            if (result.size() >= maxExpanded) break;
            List<ConceptToolBinding> producers = conceptToolBindingRepository
                    .findByConceptIdAndBindingType(conceptId, BindingType.PRODUCES);
            for (ConceptToolBinding ctb : producers) {
                if (result.size() >= maxExpanded) break;
                toolDefinitionRepository.findById(ctb.getToolId()).ifPresent(result::add);
            }
        }

        return new ArrayList<>(result);
    }

    /**
     * 语义层统一出口：根据概念 ID 列表扩展语义上下文，
     * 返回 LLM 所需的全部信息（概念关系、API 工具、表结构映射、JOIN 条件）。
     */
    public Map<String, Object> analyzeContext(List<Long> conceptIds, Map<Long, Double> faissConfidence) {
        OntologyGraph g = graph;
        Map<String, Object> result = new LinkedHashMap<>();

        List<Long> allConceptIds = new ArrayList<>(conceptIds);
        Set<Long> allConceptIdSet = new LinkedHashSet<>(conceptIds);
        List<Map<String, Object>> trace = new ArrayList<>();
        List<ToolDefinition> apiTools = new ArrayList<>();
        List<ConceptMapping> tableMappings = new ArrayList<>();
        List<ConceptJoinMapping> joinMappings = new ArrayList<>();
        Map<Long, List<Map<String, Object>>> relatedConcepts = new LinkedHashMap<>();

        // 置信度传播：FAISS 置信度 → 本体扩展继承
        Map<Long, Double> confidenceMap = new HashMap<>(faissConfidence);
        final double DECAY_FACTOR = 0.85;

        Set<Long> visited = new HashSet<>(conceptIds);
        Deque<Long> queue = new ArrayDeque<>(conceptIds);
        int depth = 0;
        int maxDepth = 2;

        while (!queue.isEmpty() && depth <= maxDepth && allConceptIdSet.size() < MAX_CONCEPT_EXPAND) {
            int size = queue.size();
            for (int i = 0; i < size; i++) {
                Long conceptId = queue.poll();
                if (conceptId == null) continue;

                Concept concept = conceptRepository.findById(conceptId).orElse(null);
                if (concept == null) continue;

                Map<String, Object> traceItem = new LinkedHashMap<>();
                traceItem.put("conceptId", conceptId);
                traceItem.put("conceptName", concept.getName());
                traceItem.put("depth", depth);
                traceItem.put("groupId", concept.getGroupId());
                Double conf = confidenceMap.get(conceptId);
                if (conf != null) {
                    traceItem.put("confidence", conf);
                }
                trace.add(traceItem);

                List<ConceptMapping> mappings = conceptMappingRepository.findByConceptId(conceptId);
                tableMappings.addAll(mappings);

                List<ConceptJoinMapping> joins = conceptJoinMappingRepository.findByConceptId(conceptId);
                joinMappings.addAll(joins);

                List<ConceptToolBinding> toolBindings = conceptToolBindingRepository.findByConceptId(conceptId);
                for (ConceptToolBinding ctb : toolBindings) {
                    toolDefinitionRepository.findById(ctb.getToolId()).ifPresent(td -> {
                        if (!"HTTP".equals(td.getToolType())) return;
                        boolean exists = apiTools.stream().anyMatch(t -> t.getId().equals(td.getId()));
                        if (!exists && apiTools.size() < MAX_API_TOOLS) {
                            apiTools.add(td);
                        }
                    });
                }

                if (!g.isEmpty() && depth < maxDepth) {
                    Double parentConfidence = confidenceMap.getOrDefault(conceptId, 0.0);
                    expandViaGraph(g, concept, visited, queue, allConceptIds, allConceptIdSet,
                            relatedConcepts, parentConfidence, confidenceMap, DECAY_FACTOR);
                }
            }
            depth++;
        }

        result.put("conceptIds", allConceptIds);
        result.put("conceptTrace", trace);
        result.put("apiTools", apiTools);
        result.put("tableMappings", tableMappings);
        result.put("joinMappings", joinMappings);
        result.put("relatedConcepts", relatedConcepts);

        agentDebug.info("[ONTOLOGY] analyzeContext: input={}, expanded={}, trace={}, mappings={}, joins={}, relations={}",
                conceptIds, allConceptIds.size(), trace.size(), tableMappings.size(), joinMappings.size(), relatedConcepts.size());

        return result;
    }

    /**
     * 扩展概念邻居（原 Jena 推理的等价实现）：
     * 1. 子类/父类闭包
     * 2. 语义关系出边 + 对称关系入边（transitive 由外层 BFS 逐层走）
     */
    private void expandViaGraph(OntologyGraph g, Concept concept, Set<Long> visited, Deque<Long> queue,
            List<Long> allConceptIds, Set<Long> allConceptIdSet,
            Map<Long, List<Map<String, Object>>> relatedConcepts,
            double parentConfidence, Map<Long, Double> confidenceMap, double decayFactor) {

        List<Map<String, Object>> related = new ArrayList<>();
        double propagatedConfidence = parentConfidence * decayFactor;

        record Neighbor(Long id, String relation) {}

        List<Neighbor> neighbors = new ArrayList<>();
        for (Long subId : g.subclassClosure(concept.getId())) {
            neighbors.add(new Neighbor(subId, "subClassOf"));
        }
        for (Long supId : g.superclassClosure(concept.getId())) {
            neighbors.add(new Neighbor(supId, "superClassOf"));
        }
        for (RelationEdge e : g.outgoing.getOrDefault(concept.getId(), List.of())) {
            neighbors.add(new Neighbor(e.targetId(), e.relationType()));
        }
        // 对称关系入边
        for (RelationEdge e : g.incoming.getOrDefault(concept.getId(), List.of())) {
            RelationMeta meta = g.meta(e.sourceId(), e.relationType());
            if (meta != null && meta.symmetric()) {
                neighbors.add(new Neighbor(e.sourceId(), e.relationType()));
            }
        }

        for (Neighbor n : neighbors) {
            if (n.id() == null || n.id().equals(concept.getId())) continue;
            double conf = Math.max(propagatedConfidence, confidenceMap.getOrDefault(n.id(), 0.0));
            confidenceMap.put(n.id(), conf);

            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("conceptId", n.id());
            entry.put("conceptName", conceptNameOf(n.id()));
            entry.put("relation", n.relation());
            entry.put("confidence", conf);
            String expression = relationExpressionOf(concept.getId(), n.id(), n.relation());
            if (expression != null) {
                entry.put("expression", expression);
            }
            related.add(entry);

            if (visited.add(n.id())) {
                queue.add(n.id());
            }
            if (allConceptIdSet.add(n.id())) {
                allConceptIds.add(n.id());
            }
        }

        if (!related.isEmpty()) {
            relatedConcepts.put(concept.getId(), related);
        }
    }

    /**
     * 获取概念的所有下钻维度（DRILLS_INTO 关系），包含异常阈值信息。
     * DRILLS_INTO 若标记为 transitive，则返回直接+间接下钻目标（与原 Jena 传递推理等价）。
     */
    public List<Map<String, Object>> getDrillDimensions(Long conceptId) {
        OntologyGraph g = graph;
        if (g.isEmpty()) return Collections.emptyList();

        Set<Long> targetIds = g.typedClosure(conceptId, BuiltinRelation.DRILLS_INTO.name());
        targetIds.remove(conceptId);
        if (targetIds.isEmpty()) return Collections.emptyList();

        List<Map<String, Object>> dimensions = new ArrayList<>();
        for (Long targetId : targetIds) {
            Concept target = conceptRepository.findById(targetId).orElse(null);
            if (target == null) continue;
            Map<String, Object> dim = new LinkedHashMap<>();
            dim.put("conceptId", target.getId());
            dim.put("conceptName", target.getName());
            dim.put("description", target.getDescription());
            dim.put("relationType", BuiltinRelation.DRILLS_INTO.name());
            if (target.getAnomalyThresholdExpr() != null) {
                dim.put("anomalyThresholdExpr", target.getAnomalyThresholdExpr());
                dim.put("anomalyThresholdDesc", target.getAnomalyThresholdDesc());
            }
            dimensions.add(dim);
        }

        if (!dimensions.isEmpty()) {
            agentDebug.info("[ONTOLOGY] getDrillDimensions: conceptId={}, drillCount={}, targets={}",
                    conceptId, dimensions.size(),
                    dimensions.stream().map(d -> String.valueOf(d.get("conceptName"))).collect(Collectors.joining(", ")));
        }
        return dimensions;
    }

    /**
     * 获取概念的关联维度（CORRELATED 关系，对称），用于交叉验证根因。
     */
    public List<Map<String, Object>> getCorrelatedDimensions(Long conceptId) {
        OntologyGraph g = graph;
        if (g.isEmpty()) return Collections.emptyList();

        Set<Long> targetIds = g.typedClosure(conceptId, BuiltinRelation.CORRELATED.name());
        targetIds.remove(conceptId);
        if (targetIds.isEmpty()) return Collections.emptyList();

        List<Map<String, Object>> dimensions = new ArrayList<>();
        for (Long targetId : targetIds) {
            Concept target = conceptRepository.findById(targetId).orElse(null);
            if (target == null) continue;
            Map<String, Object> dim = new LinkedHashMap<>();
            dim.put("conceptId", target.getId());
            dim.put("conceptName", target.getName());
            dim.put("description", target.getDescription());
            dim.put("relationType", BuiltinRelation.CORRELATED.name());
            if (target.getAnomalyThresholdExpr() != null) {
                dim.put("anomalyThresholdExpr", target.getAnomalyThresholdExpr());
                dim.put("anomalyThresholdDesc", target.getAnomalyThresholdDesc());
            }
            dimensions.add(dim);
        }
        return dimensions;
    }

    /**
     * 获取概念的完整下钻路径树（DRILLS_INTO 传递链），返回树形结构供 LLM 判断下钻顺序。
     */
    public Map<String, Object> getDrillPath(Long conceptId) {
        Concept concept = conceptRepository.findById(conceptId).orElse(null);
        if (concept == null) return Collections.emptyMap();

        Map<String, Object> path = new LinkedHashMap<>();
        path.put("conceptId", concept.getId());
        path.put("conceptName", concept.getName());
        path.put("description", concept.getDescription());
        if (concept.getAnomalyThresholdExpr() != null) {
            path.put("anomalyThresholdExpr", concept.getAnomalyThresholdExpr());
            path.put("anomalyThresholdDesc", concept.getAnomalyThresholdDesc());
        }

        Set<Long> visited = new HashSet<>();
        visited.add(conceptId);
        path.put("children", drillPathChildren(conceptId, visited, 1));
        return path;
    }

    private List<Map<String, Object>> drillPathChildren(Long conceptId, Set<Long> visited, int depth) {
        if (depth > MAX_DRILL_PATH_DEPTH) return Collections.emptyList();

        OntologyGraph g = graph;
        if (g.isEmpty()) return Collections.emptyList();

        List<Map<String, Object>> children = new ArrayList<>();
        for (RelationEdge e : g.neighbors(conceptId, BuiltinRelation.DRILLS_INTO.name())) {
            Long targetId = e.targetId();
            if (targetId == null || targetId.equals(conceptId) || !visited.add(targetId)) continue;
            Concept target = conceptRepository.findById(targetId).orElse(null);
            if (target == null) continue;
            Map<String, Object> child = new LinkedHashMap<>();
            child.put("conceptId", target.getId());
            child.put("conceptName", target.getName());
            child.put("description", target.getDescription());
            if (target.getAnomalyThresholdExpr() != null) {
                child.put("anomalyThresholdExpr", target.getAnomalyThresholdExpr());
                child.put("anomalyThresholdDesc", target.getAnomalyThresholdDesc());
            }
            child.put("children", drillPathChildren(targetId, new HashSet<>(visited), depth + 1));
            children.add(child);
        }
        return children;
    }
}