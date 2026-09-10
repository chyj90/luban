package com.luban.orchestration.dsl;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;
import com.fasterxml.jackson.databind.JsonNode;


import java.util.List;
import java.util.Map;

/**
 * 编排 DSL 的解析模型（与前端 React Flow nodes/edges 结构同构）。
 *
 * 变量语法（引擎解析，无 eval）：
 *   $input.customerId          — 编排入口参数
 *   $nodes.q_base.rows.0.name  — 上游节点输出（数字段 = 数组下标）
 */
public final class OrchestrationDsl {

    private OrchestrationDsl() {}

    public static final String PREFIX_INPUT = "$input.";
    public static final String PREFIX_NODE = "$nodes.";

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Dsl {
        private List<NodeDef> nodes;
        private List<EdgeDef> edges;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class NodeDef {
        private String id;
        private String nodeType; // start / http / query / python / transform / condition / parallel / workflow / output / error
        private Map<String, Object> position;
        private NodeData data;

        public Config config() {
            if (data != null && data.getConfig() != null) return data.getConfig();
            return new Config();
        }

        @lombok.Data
        @JsonIgnoreProperties(ignoreUnknown = true)
        public static class NodeData {
            private String label;
            private Config config;
        }

        @Data
        @JsonIgnoreProperties(ignoreUnknown = true)
        public static class Config {
            // start
            private List<PortDef> inputs;
            // http
            private Long toolId;          // 引用平台已注册 API 工具（优先）
            private String url;           // 直连（受限：IpGuard 白名单校验）
            private String method;
            private Map<String, Object> headers;
            private Map<String, Object> paramsTemplate;
            private Object bodyTemplate;  // JSON 对象或字符串模板（内嵌引用插值）
            // workflow：平台流程也是"食材"——发起/查询/审批经流程引擎（权限/审计天然生效）
            private String workflowAction;        // start / get_status / approve / reject
            private Long workflowDefinitionId;    // start 用：目标流程定义
            private String instanceIdTemplate;    // get_status/approve/reject 用：实例引用（$nodes/$input）
            private Map<String, Object> formDataTemplate; // start 用：表单数据模板
            private String comment;               // approve/reject 意见
            private Integer timeoutMs;
            private Integer retries;
            // query
            private Long queryId;
            // python
            private String source;
            private String entry;
            private List<String> packages;
            // transform
            private Map<String, String> template;
            // error 策略
            private String strategy;      // fail / fallback / continue
        }
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class EdgeDef {
        private String id;
        private String source;
        private String target;
        /** 条件分支表达式（复用流程引擎 ConditionEvaluator 语法），空 = 无条件 */
        private String condition;
        private JsonNode data;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class PortDef {
        private String name;
        private String type;   // string / number / boolean / object / array
        private boolean required;
        private Object defaultValue;
    }
}
