package com.luban.workflow.service;

import com.luban.workflow.service.FormStartValidator.FieldSpec;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 发起数据契约校验纯函数回归：必填缺失、类型不符、未知 key、schema 解析容错。
 */
class FormStartValidatorTest {

    private static final String FIELDS_JSON = """
            [
              {"key":"leave_type","label":"请假类型","type":"select","required":true},
              {"key":"days","label":"请假天数","type":"number","required":true},
              {"key":"reason","label":"请假事由","type":"textarea","required":false},
              {"key":"start_date","label":"开始日期","type":"date","required":false}
            ]""";

    @Test
    void parseFieldsReadsKeyLabelTypeRequired() {
        List<FieldSpec> fields = FormStartValidator.parseFields(FIELDS_JSON);
        assertEquals(4, fields.size());
        assertEquals(new FieldSpec("leave_type", "请假类型", "select", true), fields.get(0));
    }

    @Test
    void parseFieldsToleratesBrokenJsonAndWrappedObject() {
        assertTrue(FormStartValidator.parseFields(null).isEmpty());
        assertTrue(FormStartValidator.parseFields("not-json").isEmpty());
        assertEquals(1, FormStartValidator.parseFields("{\"fields\":[{\"key\":\"a\"}]}").size());
        // 无 key 的条目跳过
        assertTrue(FormStartValidator.parseFields("[{\"label\":\"无名\"}]").isEmpty());
    }

    @Test
    void missingRequiredFieldIsReported() {
        Map<String, Object> formData = new HashMap<>();
        formData.put("leave_type", "年假");
        // days 缺失
        List<String> violations = FormStartValidator.validate(FormStartValidator.parseFields(FIELDS_JSON), formData);
        assertEquals(1, violations.size());
        assertTrue(violations.get(0).contains("days"));
    }

    @Test
    void emptyStringAndEmptyArrayCountAsMissing() {
        Map<String, Object> formData = new HashMap<>();
        formData.put("leave_type", "  ");
        formData.put("days", List.of());
        List<String> violations = FormStartValidator.validate(FormStartValidator.parseFields(FIELDS_JSON), formData);
        assertEquals(2, violations.size());
    }

    @Test
    void numberFieldAcceptsNumericStringAndRejectsText() {
        Map<String, Object> ok = new HashMap<>();
        ok.put("leave_type", "年假");
        ok.put("days", "3");
        assertTrue(FormStartValidator.validate(FormStartValidator.parseFields(FIELDS_JSON), ok).isEmpty());

        Map<String, Object> bad = new HashMap<>(ok);
        bad.put("days", "三天");
        List<String> violations = FormStartValidator.validate(FormStartValidator.parseFields(FIELDS_JSON), bad);
        assertEquals(1, violations.size());
        assertTrue(violations.get(0).contains("days"));
    }

    @Test
    void optionalBlankFieldsPass() {
        Map<String, Object> formData = new HashMap<>();
        formData.put("leave_type", "事假");
        formData.put("days", 1);
        formData.put("reason", "");
        assertTrue(FormStartValidator.validate(FormStartValidator.parseFields(FIELDS_JSON), formData).isEmpty());
    }

    @Test
    void unknownKeysListedSeparately() {
        Map<String, Object> formData = new HashMap<>();
        formData.put("leave_type", "年假");
        formData.put("days", 1);
        formData.put("id", 1001);
        List<String> unknown = FormStartValidator.unknownKeys(FormStartValidator.parseFields(FIELDS_JSON), formData);
        assertEquals(List.of("id"), unknown);
        // 未知 key 不参与契约校验（由调用方结合流程定义引用集决定告警策略）
        assertTrue(FormStartValidator.validate(FormStartValidator.parseFields(FIELDS_JSON), formData).isEmpty());
    }
}
