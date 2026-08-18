package com.luban.service;

import com.luban.entity.Concept;
import com.luban.entity.ConceptRelation;
import com.luban.entity.ToolConcept;
import com.luban.entity.ToolDefinition;
import com.luban.repository.ConceptRelationRepository;
import com.luban.repository.ConceptRepository;
import com.luban.repository.ToolConceptRepository;
import com.luban.repository.ToolDefinitionRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.jena.ontology.*;
import org.apache.jena.rdf.model.ModelFactory;
import org.apache.jena.util.iterator.ExtendedIterator;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReadWriteLock;
import java.util.concurrent.locks.ReentrantReadWriteLock;

@Slf4j
@Service
@RequiredArgsConstructor
public class OntologyService {

    private static final String NS = "http://luban.ai/ontology#";

    private final ConceptRepository conceptRepository;
    private final ConceptRelationRepository conceptRelationRepository;
    private final ToolConceptRepository toolConceptRepository;
    private final ToolDefinitionRepository toolDefinitionRepository;

    private volatile OntModel ontologyModel;
    private final ReadWriteLock lock = new ReentrantReadWriteLock();
    private final Map<String, ObjectProperty> propertyCache = new ConcurrentHashMap<>();
    private final Map<Long, OntClass> classMap = new ConcurrentHashMap<>();

    private static final Set<String> TRANSITIVE_TYPES = Set.of(
            "PARENT_OF", "PREREQUISITE_OF", "UPPER_STREAM_OF"
    );
    private static final Set<String> SYMMETRIC_TRANSITIVE_TYPES = Set.of(
            "EQUIVALENT_TO"
    );

    @PostConstruct
    public void init() {
        try {
            buildModel();
            log.info("Ontology model initialized with {} concepts, {} relations",
                    classMap.size(), countRelations());
        } catch (Exception e) {
            log.error("Failed to initialize ontology model: {}", e.getMessage(), e);
            ontologyModel = ModelFactory.createOntologyModel(OntModelSpec.OWL_MEM_MICRO_RULE_INF);
        }
    }

    public boolean isEnabled() {
        return ontologyModel != null;
    }

    public void reload() {
        lock.writeLock().lock();
        try {
            propertyCache.clear();
            classMap.clear();
            buildModel();
            log.info("Ontology model reloaded: {} concepts, {} relations",
                    classMap.size(), countRelations());
        } catch (Exception e) {
            log.error("Failed to reload ontology model: {}", e.getMessage(), e);
        } finally {
            lock.writeLock().unlock();
        }
    }

    private void buildModel() {
        ontologyModel = ModelFactory.createOntologyModel(OntModelSpec.OWL_MEM_MICRO_RULE_INF);
        classMap.clear();
        propertyCache.clear();

        List<Concept> concepts = conceptRepository.findAll();
        for (Concept c : concepts) {
            OntClass cls = ontologyModel.createClass(NS + escapeUri(c.getName()));
            classMap.put(c.getId(), cls);
        }

        for (Concept c : concepts) {
            if (c.getParentId() != null && classMap.containsKey(c.getParentId())) {
                OntClass parent = classMap.get(c.getParentId());
                OntClass child = classMap.get(c.getId());
                parent.addSubClass(child);
            }
        }

        List<ConceptRelation> relations = conceptRelationRepository.findAll();
        for (ConceptRelation r : relations) {
            OntClass source = classMap.get(r.getSourceConceptId());
            OntClass target = classMap.get(r.getTargetConceptId());
            if (source == null || target == null) continue;

            ObjectProperty prop = getOrCreateProperty(r.getRelationType());
            Individual sourceInd = source.createIndividual(NS + "s_" + r.getId());
            Individual targetInd = target.createIndividual(NS + "t_" + r.getId());
            sourceInd.addProperty(prop, targetInd);
        }
    }

    private ObjectProperty getOrCreateProperty(String relationType) {
        return propertyCache.computeIfAbsent(relationType, type -> {
            ObjectProperty prop = ontologyModel.createObjectProperty(NS + type);
            if (TRANSITIVE_TYPES.contains(type)) {
                prop.convertToTransitiveProperty();
            }
            if (SYMMETRIC_TRANSITIVE_TYPES.contains(type)) {
                prop.convertToSymmetricProperty();
                prop.convertToTransitiveProperty();
            }
            return prop;
        });
    }

    private int countRelations() {
        int count = 0;
        for (OntClass cls : classMap.values()) {
            for (ExtendedIterator<OntClass> it = cls.listSubClasses(); it.hasNext(); it.next()) {
                count++;
            }
        }
        return count;
    }

    public List<ToolDefinition> expandByConcepts(List<ToolDefinition> topK, int maxExpanded) {
        if (ontologyModel == null || classMap.isEmpty()) {
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

                    // Step 2: Jena推理机展开子概念（传递性自动处理）
                    OntClass cls = ontologyModel.getOntClass(NS + escapeUri(concept.getName()));
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

                    // Step 3: COMPUTED_FROM 关系 → 加入依赖的概念
                    List<ConceptRelation> computedFrom = conceptRelationRepository
                            .findByTargetConceptIdAndRelationType(cid, "COMPUTED_FROM");
                    for (ConceptRelation r : computedFrom) {
                        if (expandedConceptIds.add(r.getSourceConceptId())) {
                            newIds.add(r.getSourceConceptId());
                            changed = true;
                        }
                    }

                    // Step 4: DERIVED_FROM 关系 → 加入条件依赖的概念
                    List<ConceptRelation> derivedFrom = conceptRelationRepository
                            .findByTargetConceptIdAndRelationType(cid, "DERIVED_FROM");
                    for (ConceptRelation r : derivedFrom) {
                        if (expandedConceptIds.add(r.getSourceConceptId())) {
                            newIds.add(r.getSourceConceptId());
                            changed = true;
                        }
                    }

                    // Step 5: EQUIVALENT_TO 关系 → 跨系统等价概念
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

            // Step 6: 查找 PRODUCES 每个扩展概念的工具
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

    private Long findConceptIdByName(String name) {
        List<Concept> concepts = conceptRepository.findByName(name);
        return concepts.isEmpty() ? null : concepts.get(0).getId();
    }

    private String escapeUri(String name) {
        return name.replace(" ", "_").replace("/", "_");
    }

    private String unescapeUri(String uri) {
        return uri.replace("_", " ");
    }
}