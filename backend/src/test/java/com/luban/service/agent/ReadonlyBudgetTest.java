package com.luban.service.agent;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ReadonlyBudgetTest {

    @Test
    void allowsUpToLimitThenBlocks() {
        Map<String, Integer> counts = new HashMap<>();
        for (int i = 0; i < 3; i++) {
            assertThat(ReadonlyBudget.reserve(counts, "get_enum_values", 3)).isTrue();
        }
        assertThat(ReadonlyBudget.reserve(counts, "get_enum_values", 3)).isFalse();
        assertThat(ReadonlyBudget.reserve(counts, "get_enum_values", 3)).isFalse();
    }

    @Test
    void budgetsAreIndependentPerAction() {
        Map<String, Integer> counts = new HashMap<>();
        assertThat(ReadonlyBudget.reserve(counts, "get_enum_values", 3)).isTrue();
        assertThat(ReadonlyBudget.reserve(counts, "get_enum_values", 3)).isTrue();
        assertThat(ReadonlyBudget.reserve(counts, "get_table_schema", 3)).isTrue();
        assertThat(ReadonlyBudget.reserve(counts, "get_table_schema", 3)).isTrue();
    }

    @Test
    void customLimitRespected() {
        Map<String, Integer> counts = new HashMap<>();
        assertThat(ReadonlyBudget.reserve(counts, "request_context", 1)).isTrue();
        assertThat(ReadonlyBudget.reserve(counts, "request_context", 1)).isFalse();
    }
}
