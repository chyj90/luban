package com.luban.service;

import com.luban.constant.BindingType;
import com.luban.entity.Concept;
import com.luban.entity.ConceptRelation;
import com.luban.entity.ConceptToolBinding;
import com.luban.entity.OntologyGroup;
import com.luban.entity.RelationType;
import com.luban.entity.ToolDefinition;
import com.luban.repository.ConceptJoinMappingRepository;
import com.luban.repository.ConceptMappingRepository;
import com.luban.repository.ConceptRelationRepository;
import com.luban.repository.ConceptRepository;
import com.luban.repository.ConceptToolBindingRepository;
import com.luban.repository.OntologyGroupRepository;
import com.luban.repository.RelationTypeRepository;
import com.luban.repository.ToolDefinitionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * 验证内存图版 OntologyService 的语义：transitive 传递闭包、symmetric 双向展开、
 * 父子层级、工具扩展、跨域关系。关系元数据来自全局关系类型注册表（relation_type）。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class OntologyServiceGraphTest {

    @Mock private ConceptRepository conceptRepository;
    @Mock private ConceptRelationRepository conceptRelationRepository;
    @Mock private ConceptMappingRepository conceptMappingRepository;
    @Mock private ConceptJoinMappingRepository conceptJoinMappingRepository;
    @Mock private ConceptToolBindingRepository conceptToolBindingRepository;
    @Mock private ToolDefinitionRepository toolDefinitionRepository;
    @Mock private RelationTypeRepository relationTypeRepository;

    private OntologyService service;

    private Concept concept(long id, String name, Long groupId) {
        Concept c = new Concept();
        c.setId(id);
        c.setName(name);
        c.setGroupId(groupId);
        return c;
    }

    private RelationType meta(String type, boolean transitive, boolean symmetric) {
        RelationType rt = new RelationType();
        rt.setRelationType(type);
        rt.setSourceToTarget(false);
        rt.setIsTransitive(transitive);
        rt.setIsSymmetric(symmetric);
        return rt;
    }

    private ConceptRelation relation(long source, long target, String type, String expression) {
        ConceptRelation r = new ConceptRelation();
        r.setSourceConceptId(source);
        r.setTargetConceptId(target);
        r.setRelationType(type);
        r.setExpression(expression);
        return r;
    }

    @BeforeEach
    void setUp() {
        service = new OntologyService(conceptRepository, conceptRelationRepository,
                conceptMappingRepository, conceptJoinMappingRepository,
                conceptToolBindingRepository, toolDefinitionRepository,
                relationTypeRepository);
    }

    private void build(List<Concept> concepts, List<ConceptRelation> relations,
            List<RelationType> metas) {
        when(conceptRepository.findAll()).thenReturn(concepts);
        when(conceptRelationRepository.findAll()).thenReturn(relations);
        when(relationTypeRepository.findAll()).thenReturn(metas);
        lenient().when(conceptRepository.findById(anyLong()))
                .thenAnswer(inv -> concepts.stream()
                        .filter(c -> c.getId().equals(inv.getArgument(0, Long.class)))
                        .findFirst());
        lenient().when(conceptMappingRepository.findByConceptId(anyLong())).thenReturn(List.of());
        lenient().when(conceptJoinMappingRepository.findByConceptId(anyLong())).thenReturn(List.of());
        lenient().when(conceptToolBindingRepository.findByConceptId(anyLong())).thenReturn(List.of());
        service.init();
    }

    @Test
    void transitiveDrillClosure() {
        // DRILLS_INTO transitive=true；A→B→C
        build(List.of(concept(1, "A", 10L), concept(2, "B", 10L), concept(3, "C", 10L)),
                List.of(relation(1, 2, "DRILLS_INTO", null), relation(2, 3, "DRILLS_INTO", null)),
                List.of(meta("DRILLS_INTO", true, false)));

        List<Map<String, Object>> dimsA = service.getDrillDimensions(1L);
        assertThat(dimsA).extracting(d -> ((Number) d.get("conceptId")).longValue())
                .containsExactlyInAnyOrder(2L, 3L);   // 传递闭包含间接下钻

        List<Map<String, Object>> dimsB = service.getDrillDimensions(2L);
        assertThat(dimsB).extracting(d -> ((Number) d.get("conceptId")).longValue())
                .containsExactly(3L);
    }

    @Test
    void nonTransitiveDrillReturnsDirectOnly() {
        build(List.of(concept(1, "A", 10L), concept(2, "B", 10L), concept(3, "C", 10L)),
                List.of(relation(1, 2, "DRILLS_INTO", null), relation(2, 3, "DRILLS_INTO", null)),
                List.of(meta("DRILLS_INTO", false, false)));

        List<Map<String, Object>> dimsA = service.getDrillDimensions(1L);
        assertThat(dimsA).extracting(d -> ((Number) d.get("conceptId")).longValue())
                .containsExactly(2L);
    }

    @Test
    void symmetricCorrelatedResolvesBothDirections() {
        // 只存 A→B 一条边，CORRELATED symmetric，双向均可查到
        build(List.of(concept(1, "A", 10L), concept(2, "B", 10L)),
                List.of(relation(1, 2, "CORRELATED", null)),
                List.of(meta("CORRELATED", false, true)));

        assertThat(service.getCorrelatedDimensions(1L))
                .extracting(d -> ((Number) d.get("conceptId")).longValue()).containsExactly(2L);
        assertThat(service.getCorrelatedDimensions(2L))
                .extracting(d -> ((Number) d.get("conceptId")).longValue()).containsExactly(1L);
    }

    @Test
    void computedFromExpressionIsExposedInAnalyzeContext() {
        build(List.of(concept(1, "OEE", 10L), concept(2, "可用率", 10L), concept(3, "性能率", 10L)),
                List.of(relation(1, 2, "COMPUTED_FROM", "OEE = 可用率 × 性能率"),
                        relation(1, 3, "COMPUTED_FROM", null)),
                List.of(meta("COMPUTED_FROM", false, false)));

        Map<String, Object> result = service.analyzeContext(List.of(1L), Map.of(1L, 0.9));
        assertThat((List<Long>) result.get("conceptIds")).contains(1L);

        @SuppressWarnings("unchecked")
        Map<Long, List<Map<String, Object>>> related =
                (Map<Long, List<Map<String, Object>>>) result.get("relatedConcepts");
        assertThat(related).containsKey(1L);
        List<Map<String, Object>> rels = related.get(1L);
        assertThat(rels).anySatisfy(r -> {
            assertThat(((Number) r.get("conceptId")).longValue()).isEqualTo(2L);
            assertThat(r.get("expression")).isEqualTo("OEE = 可用率 × 性能率");
        });
        // 置信度衰减传播
        assertThat(rels).allSatisfy(r ->
                assertThat(((Number) r.get("confidence")).doubleValue()).isCloseTo(0.765, within(0.001)));
    }

    private static org.assertj.core.data.Offset<Double> within(double v) {
        return org.assertj.core.data.Offset.offset(v);
    }

    @Test
    void toolExpansionViaSubclass() {
        // parent=source: PARENT_OF A→B 表示 B 是 A 的子类；T2 绑定在子类 B 上，应被 T1 扩展出来
        RelationType parentOf = meta("PARENT_OF", false, false);
        parentOf.setSourceToTarget(true);

        ToolDefinition t1 = tool(100L, "tool_consumes");
        ToolDefinition t2 = tool(200L, "tool_produces");

        build(List.of(concept(1, "A", 10L), concept(2, "B", 10L)),
                List.of(relation(1, 2, "PARENT_OF", null)),
                List.of(parentOf));

        when(conceptToolBindingRepository.findByToolIdAndBindingType(100L, BindingType.CONSUMES))
                .thenReturn(List.of(binding(1L, 100L, BindingType.CONSUMES)));
        when(conceptToolBindingRepository.findByConceptIdAndBindingType(2L, BindingType.PRODUCES))
                .thenReturn(List.of(binding(2L, 200L, BindingType.PRODUCES)));
        when(conceptToolBindingRepository.findByConceptIdAndBindingType(1L, BindingType.PRODUCES))
                .thenReturn(List.of());
        when(toolDefinitionRepository.findById(200L)).thenReturn(Optional.of(t2));

        List<ToolDefinition> expanded = service.expandByConcepts(List.of(t1), 10);
        assertThat(expanded).extracting(ToolDefinition::getId).contains(100L, 200L);
    }

    @Test
    void crossDomainRelationIsTraversed() {
        // A 在域10，B 在域20——全局图中按 conceptId 建边，跨域关系可遍历
        build(List.of(concept(1, "A", 10L), concept(2, "B", 20L)),
                List.of(relation(1, 2, "DRILLS_INTO", null)),
                List.of(meta("DRILLS_INTO", false, false)));

        assertThat(service.getDrillDimensions(1L))
                .extracting(d -> ((Number) d.get("conceptId")).longValue()).containsExactly(2L);
    }

    private OntologyGroup group(Long id, Long industryId) {
        OntologyGroup g = new OntologyGroup();
        g.setId(id);
        g.setName("g" + id);
        g.setDisplayName("g" + id);
        return g;
    }

    private ToolDefinition tool(long id, String name) {
        ToolDefinition t = new ToolDefinition();
        t.setId(id);
        t.setName(name);
        t.setDescription(name);
        return t;
    }

    private ConceptToolBinding binding(long conceptId, long toolId, BindingType type) {
        ConceptToolBinding b = new ConceptToolBinding();
        b.setConceptId(conceptId);
        b.setToolId(toolId);
        b.setBindingType(type);
        return b;
    }
}
