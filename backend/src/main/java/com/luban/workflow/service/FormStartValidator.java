package com.luban.workflow.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;

/**
 * 发起数据与绑定表单 schema 的契约校验（纯函数，无副作用，可单测）。
 *
 * 背景：流程发起此前不校验 formData——条件分支、触发器 paramsMapping 的 form.data.*、
 * form_field 审批人全靠"页面字段 key 与表单字段 key 约定一致"，页面漏传或抄错 key
 * 时发起照常成功，问题被推迟到审批回写静默断链（触发器命中 0 行）。
 * 本校验把约定变契约：发起时按绑定表单 schema 硬校验必填与类型；
 * 表单 schema 之外的 key（业务记录 id 等触发器引用字段）不做拒绝，由调用方决定告警策略。
 */
public final class FormStartValidator {

    private FormStartValidator() {}

    /** 表单字段规格（来自 form_definitions.fields JSON 数组） */
    public record FieldSpec(String key, String label, String type, boolean required) {}

    /** 解析表单 fields JSON；非法条目跳过，整体解析失败返回空列表（调用方据此跳过校验） */
    public static List<FieldSpec> parseFields(String fieldsJson) {
        if (fieldsJson == null || fieldsJson.isBlank()) return List.of();
        try {
            ObjectMapper mapper = new ObjectMapper();
            JsonNode root = mapper.readTree(fieldsJson);
            JsonNode arr = root.isArray() ? root : root.path("fields");
            if (!arr.isArray()) return List.of();
            List<FieldSpec> fields = new ArrayList<>();
            for (JsonNode f : arr) {
                String key = f.path("key").asText(f.path("name").asText("")).trim();
                if (key.isEmpty()) continue;
                fields.add(new FieldSpec(
                        key,
                        f.path("label").asText("").trim(),
                        f.path("type").asText("text").trim(),
                        f.path("required").asBoolean(false)));
            }
            return fields;
        } catch (Exception e) {
            return List.of();
        }
    }

    /**
     * 契约校验：返回违规描述列表（空 = 通过）。
     * 必填字段缺失/null/空串/空集合；number 类型字段值既不是数字也不是数字字符串。
     */
    public static List<String> validate(List<FieldSpec> fields, Map<String, Object> formData) {
        List<String> violations = new ArrayList<>();
        if (fields == null || fields.isEmpty() || formData == null) return violations;
        for (FieldSpec f : fields) {
            Object value = formData.get(f.key());
            if (isEmpty(value)) {
                if (f.required()) {
                    violations.add("缺少必填字段 " + f.key()
                            + (f.label() == null || f.label().isBlank() ? "" : "（" + f.label() + "）"));
                }
                continue;
            }
            if ("number".equalsIgnoreCase(f.type()) && !isNumeric(value)) {
                violations.add("字段 " + f.key() + " 类型应为数字，实际值: " + abbreviate(value));
            }
        }
        return violations;
    }

    /** formData 中不属于表单 schema 的 key（软告警用，调用方决定是否拒绝） */
    public static List<String> unknownKeys(List<FieldSpec> fields, Map<String, Object> formData) {
        List<String> unknown = new ArrayList<>();
        if (fields == null || fields.isEmpty() || formData == null) return unknown;
        List<String> known = fields.stream().map(FieldSpec::key).toList();
        for (String key : formData.keySet()) {
            if (!known.contains(key)) unknown.add(key);
        }
        return unknown;
    }

    private static boolean isEmpty(Object value) {
        if (value == null) return true;
        if (value instanceof String s) return s.trim().isEmpty();
        if (value instanceof Collection<?> c) return c.isEmpty();
        if (value instanceof Map<?, ?> m) return m.isEmpty();
        return false;
    }

    private static boolean isNumeric(Object value) {
        if (value instanceof Number) return true;
        if (value instanceof String s) {
            try {
                Double.parseDouble(s.trim());
                return true;
            } catch (NumberFormatException e) {
                return false;
            }
        }
        return false;
    }

    private static String abbreviate(Object value) {
        String s = String.valueOf(value);
        return s.length() > 40 ? s.substring(0, 40) + "…" : s;
    }
}
