package com.luban.service;

import java.util.*;

/**
 * 强类型 Agent 状态包装器，替代散落的 Map<String, Object> 键值操作。
 * 所有状态读写收敛于此，编译期类型安全，IDE 自动补全。
 */
public class AgentStateData {

    private final Map<String, Object> data;

    public AgentStateData(Map<String, Object> data) {
        this.data = data != null ? data : new LinkedHashMap<>();
    }

    public static AgentStateData fromMap(Map<String, Object> data) {
        return new AgentStateData(data);
    }

    public Map<String, Object> raw() {
        return data;
    }

    // ────────── 基础标识 ──────────
    public String getSessionId() {
        return (String) data.get("session_id");
    }

    public void setSessionId(String v) {
        data.put("session_id", v);
    }

    public Long getUserId() {
        Object v = data.get("user_id");
        return v instanceof Number n ? n.longValue() : null;
    }

    public void setUserId(Long v) {
        data.put("user_id", v);
    }

    public String getUserName() {
        return (String) data.getOrDefault("user_name", "unknown");
    }

    public void setUserName(String v) {
        data.put("user_name", v);
    }

    public String getIntent() {
        return (String) data.getOrDefault("intent", "query");
    }

    public void setIntent(String v) {
        data.put("intent", v);
    }

    // ────────── 迭代控制 ──────────
    public int getIteration() {
        return (int) data.getOrDefault("iteration", 0);
    }

    public void setIteration(int v) {
        data.put("iteration", v);
    }

    public int getLlmCallCount() {
        return (int) data.getOrDefault("llm_call_count", 0);
    }

    public void incrementLlmCallCount() {
        data.put("llm_call_count", getLlmCallCount() + 1);
    }

    public int getToolCallCount() {
        return (int) data.getOrDefault("tool_call_count", 0);
    }

    public void incrementToolCallCount() {
        data.put("tool_call_count", getToolCallCount() + 1);
    }

    public int getSqlExecCount() {
        return (int) data.getOrDefault("sql_exec_count", 0);
    }

    public void incrementSqlExecCount() {
        data.put("sql_exec_count", getSqlExecCount() + 1);
    }

    public int getNl2sqlRetryCount() {
        return (int) data.getOrDefault("nl2sql_retry_count", 0);
    }

    public void incrementNl2sqlRetryCount() {
        data.put("nl2sql_retry_count", getNl2sqlRetryCount() + 1);
    }

    public void resetNl2sqlRetryCount() {
        data.put("nl2sql_retry_count", 0);
    }

    // ────────── 路由控制 ──────────
    public String getNextAction() {
        return (String) data.get("next_action");
    }

    public void setNextAction(String v) {
        data.put("next_action", v);
    }

    public String getFinalAnswer() {
        return (String) data.get("final_answer");
    }

    public void setFinalAnswer(String v) {
        data.put("final_answer", v);
    }

    public String getReasoning() {
        return (String) data.get("reasoning");
    }

    public void appendReasoning(String v) {
        String prev = getReasoning();
        data.put("reasoning", (prev != null && !prev.isEmpty()) ? prev + "\n\n---\n\n" + v : v);
    }

    public String getLlmReasoning() {
        return (String) data.get("llm_reasoning");
    }

    public void appendLlmReasoning(String v) {
        String prev = getLlmReasoning();
        data.put("llm_reasoning", (prev != null && !prev.isEmpty()) ? prev + "\n\n---\n\n" + v : v);
    }

    public String getLlmRawOutput() {
        return (String) data.get("llm_raw_output");
    }

    public void appendLlmRawOutput(String v) {
        String prev = getLlmRawOutput();
        data.put("llm_raw_output", (prev != null && !prev.isEmpty()) ? prev + "\n" + v : v);
    }

    public String getLastLlmResponse() {
        return (String) data.get("last_llm_response");
    }

    public void setLastLlmResponse(String v) {
        data.put("last_llm_response", v);
    }

    // ────────── 消息 ──────────
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getMessages() {
        return (List<Map<String, Object>>) data.get("messages");
    }

    public void setMessages(List<Map<String, Object>> v) {
        data.put("messages", v);
    }

    // ────────── 概念 ──────────
    @SuppressWarnings("unchecked")
    public List<Long> getConceptIds() {
        List<Long> ids = (List<Long>) data.getOrDefault("concept_ids", List.of());
        return ids != null ? ids : List.of();
    }

    public void setConceptIds(List<Long> v) {
        data.put("concept_ids", v);
    }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getConceptTrace() {
        return (List<Map<String, Object>>) data.getOrDefault("concept_trace", List.of());
    }

    public void setConceptTrace(List<Map<String, Object>> v) {
        data.put("concept_trace", v);
    }

    @SuppressWarnings("unchecked")
    public List<Long> getDrilledConcepts() {
        List<Long> v = (List<Long>) data.getOrDefault("drilled_concepts", new ArrayList<>());
        return v != null ? v : new ArrayList<>();
    }

    public void addDrilledConcepts(List<Long> v) {
        List<Long> current = getDrilledConcepts();
        for (Long id : v) {
            if (!current.contains(id)) current.add(id);
        }
        data.put("drilled_concepts", current);
    }

    @SuppressWarnings("unchecked")
    public List<Long> getRecognizedConceptIds() {
        return (List<Long>) data.get("recognized_concept_ids");
    }

    public void setRecognizedConceptIds(List<Long> v) {
        data.put("recognized_concept_ids", v);
    }

    // ────────── 数据源 ──────────
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getAvailableDatasources() {
        return (List<Map<String, Object>>) data.get("availableDatasources");
    }

    public void setAvailableDatasources(List<Map<String, Object>> v) {
        data.put("availableDatasources", v);
    }

    // ────────── NL2SQL ──────────
    @SuppressWarnings("unchecked")
    public Map<String, Object> getPendingNl2sql() {
        return (Map<String, Object>) data.get("pending_nl2sql");
    }

    public void setPendingNl2sql(Map<String, Object> v) {
        data.put("pending_nl2sql", v);
    }

    public String getNl2sqlLastError() {
        return (String) data.get("nl2sql_last_error");
    }

    public void setNl2sqlLastError(String v) {
        data.put("nl2sql_last_error", v);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> getNl2sqlResult() {
        return (Map<String, Object>) data.get("nl2sql");
    }

    public void setNl2sqlResult(Map<String, Object> v) {
        data.put("nl2sql", v);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> getQueryResult() {
        return (Map<String, Object>) data.get("query_result");
    }

    public void setQueryResult(Map<String, Object> v) {
        data.put("query_result", v);
    }

    // ────────── Tool ──────────
    @SuppressWarnings("unchecked")
    public Map<String, Object> getPendingToolCall() {
        return (Map<String, Object>) data.get("pending_tool_call");
    }

    public void setPendingToolCall(Map<String, Object> v) {
        data.put("pending_tool_call", v);
    }

    // ────────── Code ──────────
    @SuppressWarnings("unchecked")
    public Map<String, Object> getPendingCode() {
        return (Map<String, Object>) data.get("pending_code");
    }

    public void setPendingCode(Map<String, Object> v) {
        data.put("pending_code", v);
    }

    // ────────── Ontology ──────────
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getPendingOntologyChanges() {
        return (List<Map<String, Object>>) data.get("pending_ontology_changes");
    }

    public void setPendingOntologyChanges(List<Map<String, Object>> v) {
        data.put("pending_ontology_changes", v);
    }

    public String getPendingOntologyToolCallId() {
        return (String) data.get("pending_ontology_tool_call_id");
    }

    public void setPendingOntologyToolCallId(String v) {
        data.put("pending_ontology_tool_call_id", v);
    }

    // ────────── Pending Actions ──────────
    @SuppressWarnings("unchecked")
    public List<String> getPendingActions() {
        return (List<String>) data.get("pending_actions");
    }

    public void setPendingActions(List<String> v) {
        data.put("pending_actions", v);
    }

    public void removePendingActions() {
        data.remove("pending_actions");
    }

    // ────────── 循环检测 ──────────
    public String getLastActionSignature() {
        return (String) data.get("last_action_signature");
    }

    public void setLastActionSignature(String v) {
        data.put("last_action_signature", v);
    }

    public int getActionRepeatCount() {
        return (int) data.getOrDefault("action_repeat_count", 0);
    }

    public void setActionRepeatCount(int v) {
        data.put("action_repeat_count", v);
    }

    public int getParseErrorRetryCount() {
        return (int) data.getOrDefault("parse_error_retry_count", 0);
    }

    public void incrementParseErrorRetryCount() {
        data.put("parse_error_retry_count", getParseErrorRetryCount() + 1);
    }

    // ────────── 最终结果 ──────────
    public String getAnswerType() {
        return (String) data.get("answer_type");
    }

    public void setAnswerType(String v) {
        data.put("answer_type", v);
    }

    public String getRootCause() {
        return (String) data.get("root_cause");
    }

    public void setRootCause(String v) {
        data.put("root_cause", v);
    }

    public String getSuggestion() {
        return (String) data.get("suggestion");
    }

    public void setSuggestion(String v) {
        data.put("suggestion", v);
    }

    @SuppressWarnings("unchecked")
    public List<Object> getEvidence() {
        return (List<Object>) data.get("evidence");
    }

    public void setEvidence(List<Object> v) {
        data.put("evidence", v);
    }

    public String getMessageId() {
        return (String) data.get("message_id");
    }

    public void setMessageId(String v) {
        data.put("message_id", v);
    }

    // ────────── 流程标记 ──────────
    public boolean isSchemaFetched() {
        return Boolean.TRUE.equals(data.get("_schema_fetched"));
    }

    public void setSchemaFetched(boolean v) {
        data.put("_schema_fetched", v);
    }

    public boolean isDateRangeQueried() {
        return Boolean.TRUE.equals(data.get("_date_range_queried"));
    }

    public void setDateRangeQueried(boolean v) {
        data.put("_date_range_queried", v);
    }

    // ────────── 便捷查询 ──────────
    public boolean hasPendingActions() {
        List<String> pa = getPendingActions();
        return pa != null && !pa.isEmpty();
    }

    public boolean isMaxDrillReached() {
        return getSqlExecCount() >= 10;
    }

    public boolean allConceptsDrilled() {
        List<Long> drilled = getDrilledConcepts();
        List<Long> current = getConceptIds();
        if (getSqlExecCount() <= 0 || current.isEmpty()) return false;
        for (Long id : current) {
            if (!drilled.contains(id)) return false;
        }
        return true;
    }
}