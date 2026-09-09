package com.luban.service.agent;

import java.util.Map;

/**
 * 只读动作执行预算（如 get_enum_values / get_table_schema / request_context）。
 *
 * 背景：MAX_DRILL_ROUNDS 兜底只统计 sql_exec_count，只读动作不计数——
 * 模型反复输出同类只读动作时无任何兜底，曾导致近 100 轮循环。
 * 每类只读动作最多执行 limit 次，超限后调用方应要求模型立即输出 final_answer。
 */
public final class ReadonlyBudget {

    public static final int DEFAULT_LIMIT = 3;

    private ReadonlyBudget() {}

    /**
     * 预留一次执行额度。返回 true=允许执行（计数 +1）；false=已达上限，禁止执行。
     */
    public static boolean reserve(Map<String, Integer> counts, String actionType, int limit) {
        int used = counts.merge(actionType, 1, Integer::sum);
        return used <= limit;
    }
}
