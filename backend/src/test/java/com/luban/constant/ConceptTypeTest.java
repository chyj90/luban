package com.luban.constant;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ConceptTypeTest {

    @Test
    void parsesKnownTypesCaseInsensitively() {
        assertThat(ConceptType.fromNullable("metric")).isEqualTo(ConceptType.METRIC);
        assertThat(ConceptType.fromNullable(" DIMENSION ")).isEqualTo(ConceptType.DIMENSION);
        assertThat(ConceptType.fromNullable("ENTITY")).isEqualTo(ConceptType.ENTITY);
    }

    @Test
    void unknownOrNullMeansUnclassified() {
        // LLM 可能输出任意值，未知类型必须归为"未分类"而不是报错或乱存
        assertThat(ConceptType.fromNullable("kpi")).isNull();
        assertThat(ConceptType.fromNullable("")).isNull();
        assertThat(ConceptType.fromNullable(null)).isNull();
    }
}
