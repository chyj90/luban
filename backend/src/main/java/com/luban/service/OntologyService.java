package com.luban.service;

import com.luban.entity.Concept;
import com.luban.entity.ConceptJoinMapping;
import com.luban.entity.ConceptMapping;
import com.luban.entity.ConceptRelation;
import com.luban.entity.IndustryRelation;
import com.luban.entity.OntologyGroup;
import com.luban.entity.ToolConcept;
import com.luban.entity.ToolDefinition;
import com.luban.repository.ConceptJoinMappingRepository;
import com.luban.repository.ConceptMappingRepository;
import com.luban.repository.ConceptRelationRepository;
import com.luban.repository.ConceptRepository;
import com.luban.repository.IndustryRelationRepository;
import com.luban.repository.OntologyGroupRepository;
import com.luban.repository.ToolConceptRepository;
import com.luban.repository.ToolDefinitionRepository;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.apache.jena.ontology.*;
import org.apache.jena.rdf.model.ModelFactory;
import org.apache.jena.rdf.model.StmtIterator;
import org.apache.jena.util.iterator.ExtendedIterator;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import java.util.concurrent.locks.ReadWriteLock;
import java.util.concurrent.locks.ReentrantReadWriteLock;

@Slf4j
@Service
public class OntologyService {

    private final org.slf4j.Logger agentDebug = LoggerFactory.getLogger("agent-debug");

    private static final String NS = "http://luban.ai/ontology#";

    private final ConceptRepository conceptRepository;
    private final ConceptRelationRepository conceptRelationRepository;
    private final ConceptMappingRepository conceptMappingRepository;
    private final ConceptJoinMappingRepository conceptJoinMappingRepository;
    private final ToolConceptRepository toolConceptRepository;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final OntologyGroupRepository groupRepository;
    private final IndustryRelationRepository industryRelationRepository;

    private static final Long NO_INDUSTRY = -1L;

    private static final int MAX_CONCEPT_EXPAND = 20;
    private static final int MAX_API_TOOLS = 15;

    private volatile Map<Long, OntModel> models = Map.of();
    private final ReadWriteLock lock = new ReentrantReadWriteLock();
    private final Map<Long, Map<Long, OntClass>> classMaps = new ConcurrentHashMap<>();
    private final Map<Long, Map<String, ObjectProperty>> propertyCaches = new ConcurrentHashMap<>();

    public OntologyService(ConceptRepository conceptRepository,
                           ConceptRelationRepository conceptRelationRepository,
                           ConceptMappingRepository conceptMappingRepository,
                           ConceptJoinMappingRepository conceptJoinMappingRepository,
                           ToolConceptRepository toolConceptRepository,
                           ToolDefinitionRepository toolDefinitionRepository,
                           OntologyGroupRepository groupRepository,
                           IndustryRelationRepository industryRelationRepository) {
        this.conceptRepository = conceptRepository;
        this.conceptRelationRepository = conceptRelationRepository;
        this.conceptMappingRepository = conceptMappingRepository;
        this.conceptJoinMappingRepository = conceptJoinMappingRepository;
        this.toolConceptRepository = toolConceptRepository;
        this.toolDefinitionRepository = toolDefinitionRepository;
        this.groupRepository = groupRepository;
        this.industryRelationRepository = industryRelationRepository;
    }

    @PostConstruct
    public void init() {
        try {
            buildModels();
            int totalConcepts = classMaps.values().stream().mapToInt(Map::size).sum();
            log.info("Ontology models initialized: {} industries, {} concepts total",
                    models.size(), totalConcepts);
        } catch (Exception e) {
            log.error("Failed to initialize ontology models: {}", e.getMessage(), e);
            models = Map.of();
        }
    }

    public boolean isEnabled() {
        return !models.isEmpty();
    }

    public void reload() {
        lock.writeLock().lock();
        try {
            classMaps.clear();
            propertyCaches.clear();
            buildModels();
            int totalConcepts = classMaps.values().stream().mapToInt(Map::size).sum();
            log.info("Ontology models reloaded: {} industries, {} concepts total",
                    models.size(), totalConcepts);
        } catch (Exception e) {
            log.error("Failed to reload ontology models: {}", e.getMessage(), e);
        } finally {
            lock.writeLock().unlock();
        }
    }

    private void buildModels() {
        Map<Long, OntModel> newModels = new HashMap<>();
        classMaps.clear();
        propertyCaches.clear();

        Map<Long, Long> conceptIndustryMap = new HashMap<>();
        List<Concept> concepts = conceptRepository.findAll();
        for (Concept c : concepts) {
            Long industryId = NO_INDUSTRY;
            if (c.getGroupId() != null) {
                OntologyGroup group = groupRepository.findById(c.getGroupId()).orElse(null);
                if (group != null && group.getIndustryId() != null) {
                    industryId = group.getIndustryId();
                }
            }
            conceptIndustryMap.put(c.getId(), industryId);
        }

        Map<Long, Set<String>> industryTransitiveTypes = new HashMap<>();
        Map<Long, Set<String>> industrySymmetricTypes = new HashMap<>();
        List<IndustryRelation> allIndustryRelations = industryRelationRepository.findAll();
        for (IndustryRelation ir : allIndustryRelations) {
            Long indId = ir.getIndustryId();
            if (Boolean.TRUE.equals(ir.getIsTransitive())) {
                industryTransitiveTypes.computeIfAbsent(indId, k -> new HashSet<>())
                        .add(ir.getRelationType());
            }
            if (Boolean.TRUE.equals(ir.getIsSymmetric())) {
                industrySymmetricTypes.computeIfAbsent(indId, k -> new HashSet<>())
                        .add(ir.getRelationType());
            }
        }

        for (Long industryId : conceptIndustryMap.values()) {
            newModels.computeIfAbsent(industryId, id -> {
                OntModel model = ModelFactory.createOntologyModel(OntModelSpec.OWL_MEM_MICRO_RULE_INF);
                classMaps.put(id, new ConcurrentHashMap<>());
                propertyCaches.put(id, new ConcurrentHashMap<>());
                return model;
            });
        }

        for (Concept c : concepts) {
            Long industryId = conceptIndustryMap.get(c.getId());
            OntModel model = newModels.get(industryId);
            OntClass cls = model.createClass(NS + escapeUri(c.getName()));
            classMaps.get(industryId).put(c.getId(), cls);
        }

        for (Concept c : concepts) {
            if (c.getParentId() != null) {
                Long industryId = conceptIndustryMap.get(c.getId());
                Map<Long, OntClass> cm = classMaps.get(industryId);
                if (cm.containsKey(c.getParentId())) {
                    OntClass parent = cm.get(c.getParentId());
                    OntClass child = cm.get(c.getId());
                    parent.addSubClass(child);
                }
            }
        }

        List<ConceptRelation> relations = conceptRelationRepository.findAll();
        for (ConceptRelation r : relations) {
            Long industryId = conceptIndustryMap.get(r.getSourceConceptId());
            Map<Long, OntClass> cm = classMaps.get(industryId);
            if (cm == null) continue;
            OntClass source = cm.get(r.getSourceConceptId());
            OntClass target = cm.get(r.getTargetConceptId());
            if (source == null || target == null) continue;

            Set<String> transitiveTypes = industryTransitiveTypes.getOrDefault(industryId, Set.of());
            Set<String> symmetricTypes = industrySymmetricTypes.getOrDefault(industryId, Set.of());
            ObjectProperty prop = getOrCreateProperty(industryId, newModels.get(industryId), r.getRelationType(),
                    transitiveTypes, symmetricTypes);
            Individual sourceInd = source.createIndividual(NS + "s_" + r.getId());
            Individual targetInd = target.createIndividual(NS + "t_" + r.getId());
            sourceInd.addProperty(prop, targetInd);
        }

        this.models = Map.copyOf(newModels);
    }

    private ObjectProperty getOrCreateProperty(Long industryId, OntModel model, String relationType,
                                                Set<String> transitiveTypes, Set<String> symmetricTypes) {
        Map<String, ObjectProperty> cache = propertyCaches.get(industryId);
        return cache.computeIfAbsent(relationType, type -> {
            ObjectProperty prop = model.createObjectProperty(NS + type);
            if (transitiveTypes.contains(type)) {
                prop.convertToTransitiveProperty();
            }
            if (symmetricTypes.contains(type)) {
                prop.convertToSymmetricProperty();
                prop.convertToTransitiveProperty();
            }
            return prop;
        });
    }

    private int countRelations() {
        int count = 0;
        for (Map<Long, OntClass> cm : classMaps.values()) {
            for (OntClass cls : cm.values()) {
                for (ExtendedIterator<OntClass> it = cls.listSubClasses(); it.hasNext(); it.next()) {
                    count++;
                }
            }
        }
        return count;
    }

    public List<ToolDefinition> expandByConcepts(List<ToolDefinition> topK, int maxExpanded) {
        if (models.isEmpty()) {
            return topK;
        }

        lock.readLock().lock();
        try {
            Set<ToolDefinition> result = new LinkedHashSet<>(topK);

            Set<Long> consumedConceptIds = new HashSet<>();
            for (ToolDefinition tool : topK) {
                List<ToolConcept> bindings = toolConceptRepository.findByToolIdAndRelation(tool.getId(), "CONSUMES");
                for (ToolConcept tc : bindings) {
                    consumedConceptIds.add(tc.getConceptId());
                }
            }

            if (consumedConceptIds.isEmpty()) {
                return topK;
            }

            Set<Long> expandedConceptIds = new HashSet<>(consumedConceptIds);

            boolean changed = true;
            while (changed) {
                changed = false;
                Set<Long> newIds = new HashSet<>();

                for (Long cid : expandedConceptIds) {
                    Concept concept = conceptRepository.findById(cid).orElse(null);
                    if (concept == null) continue;

                    Long industryId = resolveIndustryId(concept.getGroupId());
                    OntModel model = models.get(industryId);
                    Map<Long, OntClass> cm = classMaps.get(industryId);

                    if (model != null && cm != null) {
                        OntClass cls = model.getOntClass(NS + escapeUri(concept.getName()));
                        if (cls != null) {
                            for (ExtendedIterator<OntClass> it = cls.listSubClasses(); it.hasNext(); ) {
                                OntClass sub = it.next();
                                if (sub.isAnon()) continue;
                                Long subId = findConceptIdByName(unescapeUri(sub.getLocalName()));
                                if (subId != null && expandedConceptIds.add(subId)) {
                                    newIds.add(subId);
                                    changed = true;
                                }
                            }
                        }
                    }

                    List<ConceptRelation> computedFrom = conceptRelationRepository
                            .findByTargetConceptIdAndRelationType(cid, "COMPUTED_FROM");
                    for (ConceptRelation r : computedFrom) {
                        if (expandedConceptIds.add(r.getSourceConceptId())) {
                            newIds.add(r.getSourceConceptId());
                            changed = true;
                        }
                    }

                    List<ConceptRelation> derivedFrom = conceptRelationRepository
                            .findByTargetConceptIdAndRelationType(cid, "DERIVED_FROM");
                    for (ConceptRelation r : derivedFrom) {
                        if (expandedConceptIds.add(r.getSourceConceptId())) {
                            newIds.add(r.getSourceConceptId());
                            changed = true;
                        }
                    }

                    List<ConceptRelation> equivs = new ArrayList<>();
                    equivs.addAll(conceptRelationRepository.findBySourceConceptIdAndRelationType(cid, "EQUIVALENT_TO"));
                    equivs.addAll(conceptRelationRepository.findByTargetConceptIdAndRelationType(cid, "EQUIVALENT_TO"));
                    for (ConceptRelation r : equivs) {
                        Long otherId = r.getSourceConceptId().equals(cid) ? r.getTargetConceptId() : r.getSourceConceptId();
                        if (expandedConceptIds.add(otherId)) {
                            newIds.add(otherId);
                            changed = true;
                        }
                    }
                }

                expandedConceptIds.addAll(newIds);
            }

            for (Long conceptId : expandedConceptIds) {
                if (result.size() >= maxExpanded) break;
                List<ToolConcept> producers = toolConceptRepository.findByConceptIdAndRelation(conceptId, "PRODUCES");
                for (ToolConcept tc : producers) {
                    if (result.size() >= maxExpanded) break;
                    toolDefinitionRepository.findById(tc.getToolId()).ifPresent(result::add);
                }
            }

            return new ArrayList<>(result);
        } finally {
            lock.readLock().unlock();
        }
    }

    private Long resolveIndustryId(Long groupId) {
        if (groupId == null) return NO_INDUSTRY;
        OntologyGroup group = groupRepository.findById(groupId).orElse(null);
        if (group == null || group.getIndustryId() == null) return NO_INDUSTRY;
        Long industryId = group.getIndustryId();
        return models.containsKey(industryId) ? industryId : NO_INDUSTRY;
    }

    private Long findConceptIdByName(String name) {
        List<Concept> concepts = conceptRepository.findByName(name);
        return concepts.isEmpty() ? null : concepts.get(0).getId();
    }

    /**
     * 语义层统一出口：根据概念 ID 列表，通过 Jena OWL 推理扩展语义上下文，
     * 返回 LLM 所需的全部信息（概念关系、API 工具、表结构映射、JOIN 条件）。
     */
    public Map<String, Object> analyzeContext(List<Long> conceptIds, Map<Long, Double> faissConfidence) {
        Map<String, Object> result = new LinkedHashMap<>();

        List<Long> allConceptIds = new ArrayList<>(conceptIds);
        Set<Long> allConceptIdSet = new LinkedHashSet<>(conceptIds);
        List<Map<String, Object>> trace = new ArrayList<>();
        List<ToolDefinition> apiTools = new ArrayList<>();
        List<ConceptMapping> tableMappings = new ArrayList<>();
        List<ConceptJoinMapping> joinMappings = new ArrayList<>();
        Map<Long, List<Map<String, Object>> > relatedConcepts = new LinkedHashMap<>();

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

                List<ToolConcept> toolBindings = toolConceptRepository.findByConceptId(conceptId);
                for (ToolConcept tc : toolBindings) {
                    toolDefinitionRepository.findById(tc.getToolId()).ifPresent(td -> {
                        if (!"HTTP".equals(td.getToolType())) return;
                        boolean exists = apiTools.stream().anyMatch(t -> t.getId().equals(td.getId()));
                        if (!exists && apiTools.size() < MAX_API_TOOLS) {
                            apiTools.add(td);
                        }
                    });
                }

                if (isEnabled() && depth < maxDepth) {
                    Double parentConfidence = confidenceMap.getOrDefault(conceptId, 0.0);
                    expandViaJena(concept, visited, queue, allConceptIds, allConceptIdSet, relatedConcepts, parentConfidence, confidenceMap, DECAY_FACTOR);
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
     * 通过 Jena OWL 推理扩展概念邻居：
     * 1. subClass（子类）和 superClass（父类）—— OWL 推理自动处理传递性
     * 2. ObjectProperty 关联的概念（COMPUTED_FROM/DERIVED_FROM/EQUIVALENT_TO 等）
     *    —— 若标记为 transitive/symmetric，Jena 自动推理
     */
    private void expandViaJena(Concept concept, Set<Long> visited, Deque<Long> queue, List<Long> allConceptIds, Set<Long> allConceptIdSet, Map<Long, List<Map<String, Object>> > relatedConcepts, double parentConfidence, Map<Long, Double> confidenceMap, double decayFactor) {
        lock.readLock().lock();
        try {
            Long industryId = resolveIndustryId(concept.getGroupId());
            OntModel model = models.get(industryId);
            Map<Long, OntClass> cm = classMaps.get(industryId);
            if (model == null || cm == null) return;

            OntClass cls = model.getOntClass(NS + escapeUri(concept.getName()));
            if (cls == null) return;

            List<Map<String, Object>> related = new ArrayList<>();
            double propagatedConfidence = parentConfidence * decayFactor;

            // 1. 通过 OWL 推理获取子类（Jena 自动处理传递性）
            for (ExtendedIterator<OntClass> it = cls.listSubClasses(); it.hasNext(); ) {
                OntClass sub = it.next();
                if (sub.isAnon()) continue;
                Long subId = findConceptIdByName(unescapeUri(sub.getLocalName()));
                if (subId != null) {
                    double conf = Math.max(propagatedConfidence, confidenceMap.getOrDefault(subId, 0.0));
                    confidenceMap.put(subId, conf);
                    related.add(Map.of("conceptId", subId, "conceptName", unescapeUri(sub.getLocalName()), "relation", "subClassOf", "confidence", conf));
                    if (visited.add(subId)) {
                        queue.add(subId);
                    }
                    if (allConceptIdSet.add(subId)) {
                        allConceptIds.add(subId);
                    }
                }
            }

            // 2. 通过 OWL 推理获取父类
            for (ExtendedIterator<OntClass> it = cls.listSuperClasses(); it.hasNext(); ) {
                OntClass sup = it.next();
                if (sup.isAnon() || sup.getLocalName() == null) continue;
                Long supId = findConceptIdByName(unescapeUri(sup.getLocalName()));
                if (supId != null) {
                    double conf = Math.max(propagatedConfidence, confidenceMap.getOrDefault(supId, 0.0));
                    confidenceMap.put(supId, conf);
                    related.add(Map.of("conceptId", supId, "conceptName", unescapeUri(sup.getLocalName()), "relation", "superClassOf", "confidence", conf));
                    if (visited.add(supId)) {
                        queue.add(supId);
                    }
                    if (allConceptIdSet.add(supId)) {
                        allConceptIds.add(supId);
                    }
                }
            }

            // 3. 通过 ObjectProperty 关联的概念（Jena 自动推理 transitive/symmetric）
            for (ExtendedIterator<Individual> it = model.listIndividuals(cls); it.hasNext(); ) {
                Individual ind = it.next();
                for (StmtIterator sit = ind.listProperties(); sit.hasNext(); ) {
                    org.apache.jena.rdf.model.Statement stmt = sit.next();
                    if (stmt.getObject().isResource()) {
                        org.apache.jena.rdf.model.Resource obj = stmt.getObject().asResource();
                        if (obj.canAs(Individual.class)) {
                            Individual targetInd = obj.as(Individual.class);
                            OntClass targetCls = targetInd.getOntClass();
                            if (targetCls != null && !targetCls.isAnon() && targetCls.getLocalName() != null) {
                                Long targetId = findConceptIdByName(unescapeUri(targetCls.getLocalName()));
                                if (targetId != null) {
                                    double conf = Math.max(propagatedConfidence, confidenceMap.getOrDefault(targetId, 0.0));
                                    confidenceMap.put(targetId, conf);
                                    related.add(Map.of("conceptId", targetId, "conceptName", unescapeUri(targetCls.getLocalName()), "relation", stmt.getPredicate().getLocalName(), "confidence", conf));
                                    if (visited.add(targetId)) {
                                        queue.add(targetId);
                                    }
                                    if (allConceptIdSet.add(targetId)) {
                                        allConceptIds.add(targetId);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (!related.isEmpty()) {
                relatedConcepts.put(concept.getId(), related);
            }
        } finally {
            lock.readLock().unlock();
        }
    }

    private String escapeUri(String name) {
        return name.replace(" ", "_").replace("/", "_");
    }

    private String unescapeUri(String uri) {
        return uri.replace("_", " ");
    }

    /**
     * 获取概念的所有直接下钻维度（DRILLS_INTO 关系），包含异常阈值信息。
     */
    public List<Map<String, Object>> getDrillDimensions(Long conceptId) {
        Concept concept = conceptRepository.findById(conceptId).orElse(null);
        if (concept == null) return Collections.emptyList();

        List<ConceptRelation> drillRelations = conceptRelationRepository
                .findBySourceConceptIdAndRelationType(conceptId, "DRILLS_INTO");

        List<Map<String, Object>> dimensions = new ArrayList<>();
        for (ConceptRelation relation : drillRelations) {
            Concept target = conceptRepository.findById(relation.getTargetConceptId()).orElse(null);
            if (target == null) continue;

            Map<String, Object> dim = new LinkedHashMap<>();
            dim.put("conceptId", target.getId());
            dim.put("conceptName", target.getName());
            dim.put("description", target.getDescription());
            dim.put("relationType", "DRILLS_INTO");
            if (target.getAnomalyThresholdExpr() != null) {
                dim.put("anomalyThresholdExpr", target.getAnomalyThresholdExpr());
                dim.put("anomalyThresholdDesc", target.getAnomalyThresholdDesc());
            }
            dimensions.add(dim);
        }

        if (!dimensions.isEmpty()) {
            agentDebug.info("[ONTOLOGY] getDrillDimensions: conceptId={}, conceptName={}, drillCount={}, targets={}",
                    conceptId, concept.getName(), dimensions.size(),
                    dimensions.stream().map(d -> String.valueOf(d.get("conceptName"))).collect(Collectors.joining(", ")));
        }

        return dimensions;
    }

    /**
     * 获取概念的关联维度（CORRELATED 关系），用于交叉验证根因。
     * 例如客诉率与订单量的 CORRELATED 关系，用于确认客诉率上升是否由订单量暴涨导致。
     */
    public List<Map<String, Object>> getCorrelatedDimensions(Long conceptId) {
        Concept concept = conceptRepository.findById(conceptId).orElse(null);
        if (concept == null) return Collections.emptyList();

        List<ConceptRelation> correlatedRelations = conceptRelationRepository
                .findBySourceConceptIdAndRelationType(conceptId, "CORRELATED");

        List<Map<String, Object>> dimensions = new ArrayList<>();
        for (ConceptRelation relation : correlatedRelations) {
            Concept target = conceptRepository.findById(relation.getTargetConceptId()).orElse(null);
            if (target == null) continue;

            Map<String, Object> dim = new LinkedHashMap<>();
            dim.put("conceptId", target.getId());
            dim.put("conceptName", target.getName());
            dim.put("description", target.getDescription());
            dim.put("relationType", "CORRELATED");
            if (target.getAnomalyThresholdExpr() != null) {
                dim.put("anomalyThresholdExpr", target.getAnomalyThresholdExpr());
                dim.put("anomalyThresholdDesc", target.getAnomalyThresholdDesc());
            }
            dimensions.add(dim);
        }
        return dimensions;
    }

    /**
     * 获取概念的完整下钻路径树（递归获取所有 DRILLS_INTO 链）。
     * 返回树形结构，LLM 据此判断应该按什么顺序下钻。
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

        List<Map<String, Object>> children = new ArrayList<>();
        List<ConceptRelation> drillRelations = conceptRelationRepository
                .findBySourceConceptIdAndRelationType(conceptId, "DRILLS_INTO");
        Set<Long> visited = new HashSet<>();
        visited.add(conceptId);

        for (ConceptRelation relation : drillRelations) {
            if (!visited.contains(relation.getTargetConceptId())) {
                Map<String, Object> childPath = getDrillPathRecursive(
                        relation.getTargetConceptId(), visited, 1);
                if (!childPath.isEmpty()) {
                    children.add(childPath);
                }
            }
        }
        path.put("children", children);
        return path;
    }

    private Map<String, Object> getDrillPathRecursive(Long conceptId, Set<Long> visited, int depth) {
        if (depth > 5 || !visited.add(conceptId)) {
            return Collections.emptyMap();
        }

        Concept concept = conceptRepository.findById(conceptId).orElse(null);
        if (concept == null) return Collections.emptyMap();

        Map<String, Object> node = new LinkedHashMap<>();
        node.put("conceptId", concept.getId());
        node.put("conceptName", concept.getName());
        if (concept.getAnomalyThresholdExpr() != null) {
            node.put("anomalyThresholdExpr", concept.getAnomalyThresholdExpr());
        }

        List<Map<String, Object>> children = new ArrayList<>();
        List<ConceptRelation> drillRelations = conceptRelationRepository
                .findBySourceConceptIdAndRelationType(conceptId, "DRILLS_INTO");

        for (ConceptRelation relation : drillRelations) {
            Map<String, Object> child = getDrillPathRecursive(
                    relation.getTargetConceptId(), new HashSet<>(visited), depth + 1);
            if (!child.isEmpty()) {
                children.add(child);
            }
        }
        node.put("children", children);
        return node;
    }
}