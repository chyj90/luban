package com.luban.service;

import com.luban.constant.BindingType;
import com.luban.entity.Concept;
import com.luban.entity.ConceptRelation;
import com.luban.entity.ConceptToolBinding;
import com.luban.entity.IndustryRelation;
import com.luban.entity.OntologyGroup;
import com.luban.entity.ToolDefinition;
import com.luban.repository.ConceptJoinMappingRepository;
import com.luban.repository.ConceptMappingRepository;
import com.luban.repository.ConceptRelationRepository;
import com.luban.repository.ConceptRepository;
import com.luban.repository.ConceptToolBindingRepository;
import com.luban.repository.IndustryRelationRepository;
import com.luban.repository.OntologyGroupRepository;
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
 * 验证内存图版 OntologyService 与原 Jena 实现的语义等价性：
 * transitive 传递闭包、symmetric 双向展开、父子层级、工具扩展、跨域关系。
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
    @Mock private OntologyGroupRepository groupRepository;
    @Mock private IndustryRelationRepository industryRelationRepository;

    private OntologyService service;

    private Concept concept(long id, String name, Long groupId) {
        Concept c = new Concept();
        c.setId(id);
        c.setName(name);
        c.setGroupId(groupId);
        return c;
    }

    private IndustryRelation meta(Long industryId, String type, boolean transitive, boolean symmetric) {
        IndustryRelation ir = new IndustryRelation();
        ir.setIndustryId(industryId);
        ir.setRelationType(type);
        ir.setSourceToTarget(false);
        ir.setIsTransitive(transitive);
        ir.setIsSymmetric(symmetric);
        return ir;
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
                groupRepository, industryRelationRepository);
    }

    private void build(List<Concept> concepts, List<ConceptRelation> relations,
            List<IndustryRelation> metas, List<OntologyGroup> groups) {
        when(conceptRepository.findAll()).thenReturn(concepts);
        when(conceptRelationRepository.findAll()).thenReturn(relations);
        when(industryRelationRepository.findAll()).thenReturn(metas);
        when(groupRepository.findAll()).thenReturn(groups);
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
        // 行业1: DRILLS_INTO transitive=true；A→B→C
        build(List.of(concept(1, "A", 10L), concept(2, "B", 10L), concept(3, "C", 10L)),
                List.of(relation(1, 2, "DRILLS_INTO", null), relation(2, 3, "DRILLS_INTO", null)),
                List.of(meta(1L, "DRILLS_INTO", true, false)),
                List.of(group(10L, 1L)));

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
                List.of(meta(1L, "DRILLS_INTO", false, false)),
                List.of(group(10L, 1L)));

        List<Map<String, Object>> dimsA = service.getDrillDimensions(1L);
        assertThat(dimsA).extracting(d -> ((Number) d.get("conceptId")).longValue())
                .containsExactly(2L);
    }

    @Test
    void symmetricCorrelatedResolvesBothDirections() {
        // 只存 A→B 一条边，CORRELATED symmetric，双向均可查到
        build(List.of(concept(1, "A", 10L), concept(2, "B", 10L)),
                List.of(relation(1, 2, "CORRELATED", null)),
                List.of(meta(1L, "CORRELATED", false, true)),
                List.of(group(10L, 1L)));

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
                List.of(meta(1L, "COMPUTED_FROM", false, false)),
                List.of(group(10L, 1L)));

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
        IndustryRelation parentOf = meta(1L, "PARENT_OF", false, false);
        parentOf.setSourceToTarget(true);

        ToolDefinition t1 = tool(100L, "tool_consumes");
        ToolDefinition t2 = tool(200L, "tool_produces");

        build(List.of(concept(1, "A", 10L), concept(2, "B", 10L)),
                List.of(relation(1, 2, "PARENT_OF", null)),
                List.of(parentOf),
                List.of(group(10L, 1L)));

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
    void crossIndustryRelationIsTraversed() {
        // A 在行业1，B 在行业2——原 Jena 按行业分模型会丢弃该关系，图实现应可遍历
        build(List.of(concept(1, "A", 10L), concept(2, "B", 20L)),
                List.of(relation(1, 2, "DRILLS_INTO", null)),
                List.of(meta(1L, "DRILLS_INTO", false, false), meta(2L, "DRILLS_INTO", false, false)),
                List.of(group(10L, 1L), group(20L, 2L)));

        assertThat(service.getDrillDimensions(1L))
                .extracting(d -> ((Number) d.get("conceptId")).longValue()).containsExactly(2L);
    }

    private OntologyGroup group(Long id, Long industryId) {
        OntologyGroup g = new OntologyGroup();
        g.setId(id);
        g.setName("g" + id);
        g.setDisplayName("g" + id);
        g.setIndustryId(industryId);
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
