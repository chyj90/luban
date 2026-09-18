package com.luban.selftest.dto;

import lombok.Data;
import java.util.List;
import java.util.Map;

/**
 * 应用自检测试的 TestSpec 契约（L2 业务链路层）。
 * 通用声明式格式：与具体业务无关，契约见 doc/需求文档/需求文档-应用自检测试引擎设计.md。
 * 安全约束（渗透测试缓解措施 T3/T4/T6）：
 *  - actors 必须是真实平台用户，数量 ≤5；
 *  - steps 数量 ≤50；
 *  - 断言/捕获仅允许单条 SELECT；清理全部由引擎按写入记账（ledger）生成，不接受用户声明的清理 SQL。
 */
@Data
public class TestSpec {
    private String testName;
    /** 断言/捕获用的数据源，必须属于被测应用 */
    private Long datasourceId;
    /** 角色别名 → 平台用户 ID（必须真实存在），≤5 个 */
    private Map<String, Long> actors;
    private List<TestStep> steps;
}
