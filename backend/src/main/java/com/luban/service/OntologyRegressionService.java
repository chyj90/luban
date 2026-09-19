package com.luban.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.OntologyQuestionsetCase;
import com.luban.repository.ChatMessageRepository;
import com.luban.repository.OntologyQuestionsetCaseRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 语义包典型问题集回归（内置本体质量的度量衡）。
 *
 * 每个语义包带一份典型问题集（自然语言问题 + 结构化期望：概念命中 / SQL 落表 / 回答可用性），
 * 回归跑真实问数链路并逐用例评估。内置本体好不好不再靠感觉，跑一遍报告说话。
 * 期望只做结构断言，不断言具体数值（随环境数据变化）。
 *
 * 问题集 = classpath 内置 JSON + 运行时追加（ontology_questionset_case，问数流量挖出的
 * 缺口问题经问题洞察/建概念引导写入），追加按 packageName 合并，随下一次回归一起跑。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OntologyRegressionService {

    private static final String QUESTIONSET_DIR = "classpath*:ontology-questionsets/*.json";
    private static final int ANSWER_EXCERPT_LEN = 200;
    private static final int QUESTION_MAX_LEN = 500;
    private static final List<String> DEFAULT_FORBIDDEN = List.of("无法查询", "无法确定", "分析未能");

    private final AgentService agentService;
    private final AsyncTaskService asyncTaskService;
    private final ChatMessageRepository chatMessageRepository;
    private final OntologyQuestionsetCaseRepository questionsetCaseRepository;
    private final ObjectMapper objectMapper;

    /** 列出全部可用问题集（内置 + 运行时追加合并），customCount 为运行时追加的条数 */
    public List<Map<String, Object>> listPackages() {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> pkg : loadPackages().values()) {
            String name = String.valueOf(pkg.get("name"));
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("name", name);
            item.put("displayName", pkg.get("displayName"));
            item.put("description", pkg.get("description"));
            item.put("caseCount", ((List<?>) pkg.getOrDefault("cases", List.of())).size());
            item.put("customCount", questionsetCaseRepository.countByPackageName(name));
            result.add(item);
        }
        return result;
    }

    /**
     * 运行时追加回归问题：按包去重后入库，期望断言只带概念命中（可选），
     * SQL/回答断言留空即只检查执行成功与回答不含失败表述。
     */
    public Map<String, Object> addCases(String packageName, List<String> questions,
                                        List<String> mustHitConcepts, String source, String userName) {
        if (packageName == null || packageName.isBlank()) {
            throw new IllegalArgumentException("缺少 packageName");
        }
        if (questions == null || questions.isEmpty()) {
            throw new IllegalArgumentException("缺少 questions");
        }
        if (!loadPackages().containsKey(packageName)) {
            throw new IllegalArgumentException("问题集不存在: " + packageName);
        }
        List<String> cleaned = questions.stream()
                .filter(Objects::nonNull)
                .map(String::trim)
                .filter(q -> !q.isEmpty())
                .map(q -> q.length() > QUESTION_MAX_LEN ? q.substring(0, QUESTION_MAX_LEN) : q)
                .distinct()
                .toList();
        if (cleaned.isEmpty()) {
            throw new IllegalArgumentException("questions 全为空");
        }

        Set<String> existing = questionsetCaseRepository
                .findByPackageNameAndQuestionIn(packageName, cleaned)
                .stream().map(OntologyQuestionsetCase::getQuestion).collect(Collectors.toSet());
        List<OntologyQuestionsetCase> toSave = new ArrayList<>();
        for (String q : cleaned) {
            if (existing.contains(q)) continue;
            OntologyQuestionsetCase row = new OntologyQuestionsetCase();
            row.setPackageName(packageName);
            row.setQuestion(q);
            row.setExpect(toExpectJson(mustHitConcepts));
            row.setSource(source == null || source.isBlank() ? "manual" : source);
            row.setCreatedBy(userName);
            toSave.add(row);
        }
        if (!toSave.isEmpty()) {
            questionsetCaseRepository.saveAll(toSave);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("added", toSave.size());
        result.put("duplicated", cleaned.size() - toSave.size());
        return result;
    }

    private String toExpectJson(List<String> mustHitConcepts) {
        try {
            Map<String, Object> expect = new LinkedHashMap<>();
            if (mustHitConcepts != null && !mustHitConcepts.isEmpty()) {
                expect.put("mustHitConcepts", mustHitConcepts);
            }
            return objectMapper.writeValueAsString(expect);
        } catch (Exception e) {
            return "{}";
        }
    }

    /** 异步执行一个语义包的回归，返回 taskId；报告写入异步任务结果 */
    public long run(String packageName, Long userId, String userName) {
        Map<String, Object> pkg = loadPackages().get(packageName);
        if (pkg == null) {
            throw new IllegalArgumentException("问题集不存在: " + packageName);
        }
        List<Map<String, Object>> cases = castList(pkg.get("cases"));
        if (cases.isEmpty()) {
            throw new IllegalArgumentException("问题集为空: " + packageName);
        }
        AsyncTaskHolder holder = createTask(cases.size(), userId);
        long taskId = holder.taskId();
        Thread.startVirtualThread(() -> {
            List<String> sessionIds = new ArrayList<>();
            List<Map<String, Object>> results = new ArrayList<>();
            int passed = 0;
            try {
                for (int i = 0; i < cases.size(); i++) {
                    Map<String, Object> c = cases.get(i);
                    String caseId = String.valueOf(c.getOrDefault("id", "case-" + (i + 1)));
                    String question = String.valueOf(c.get("question"));
                    asyncTaskService.updateProgress(taskId, i + 1,
                            "用例 " + (i + 1) + "/" + cases.size() + ": " + question);

                    String sessionId = "regression-" + packageName + "-" + taskId + "-" + caseId;
                    sessionIds.add(sessionId);
                    Map<String, Object> chatResult;
                    try {
                        chatResult = agentService.chat(sessionId, question, userId, userName);
                    } catch (Exception e) {
                        chatResult = Map.of("answer", "", "error", true, "_exception", String.valueOf(e.getMessage()));
                    }
                    Map<String, Object> evaluated = evaluateCase(c, chatResult);
                    evaluated.put("id", caseId);
                    evaluated.put("question", question);
                    evaluated.put("sessionId", sessionId);
                    if (Boolean.TRUE.equals(evaluated.get("pass"))) passed++;
                    results.add(evaluated);
                }

                Map<String, Object> report = new LinkedHashMap<>();
                report.put("package", packageName);
                report.put("packageDisplayName", pkg.get("displayName"));
                report.put("total", cases.size());
                report.put("passed", passed);
                report.put("failed", cases.size() - passed);
                report.put("results", results);
                asyncTaskService.completeTask(taskId, objectMapper.writeValueAsString(report));
                log.info("[regression] 完成: package={}, passed={}/{}, taskId={}",
                        packageName, passed, cases.size(), taskId);
            } catch (Exception e) {
                log.error("[regression] 执行失败: {}", e.getMessage(), e);
                asyncTaskService.failTask(taskId, e.getMessage());
            } finally {
                // 回归会话是一次性产物，跑完即清，不污染用户会话列表
                for (String sessionId : sessionIds) {
                    try {
                        chatMessageRepository.deleteBySessionId(sessionId);
                    } catch (Exception e) {
                        log.warn("[regression] 清理会话 {} 失败: {}", sessionId, e.getMessage());
                    }
                }
            }
        });
        return taskId;
    }

    private Map<String, Object> evaluateCase(Map<String, Object> caseSpec, Map<String, Object> chatResult) {
        Map<String, Object> expect = caseSpec.get("expect") instanceof Map<?, ?> m
                ? new LinkedHashMap<String, Object>((Map<String, Object>) m) : Map.of();
        String answer = String.valueOf(chatResult.getOrDefault("answer", ""));
        boolean hasError = Boolean.TRUE.equals(chatResult.get("error"))
                || chatResult.containsKey("_exception");
        String sqlRaw = "";
        if (chatResult.get("nl2sql") instanceof Map<?, ?> nl) {
            sqlRaw = String.valueOf(((Map<String, Object>) nl).getOrDefault("sql", ""));
        }
        final String sql = sqlRaw;
        // 多步查询时最后一条 nl2sql 往往只是收尾取数，完整落表信息要看全部执行过的 SQL——
        // 回答的证据链会引用它们，故表检查对 "SQL + 回答" 全文匹配
        final String sqlCorpus = sql + "\n" + answer;
        Set<String> hitConcepts = new LinkedHashSet<>();
        if (chatResult.get("usedConcepts") instanceof List<?> list) {
            for (Object o : list) {
                if (o instanceof Map<?, ?> m && m.get("conceptName") != null) {
                    hitConcepts.add(String.valueOf(m.get("conceptName")));
                }
            }
        }

        List<Map<String, Object>> checks = new ArrayList<>();
        checks.add(check("执行成功", "chat 无异常", hasError ? "error: " + chatResult.get("_exception") : "ok", !hasError));

        List<String> mustHit = castStringList(expect.get("mustHitConcepts"));
        if (!mustHit.isEmpty()) {
            boolean hit = mustHit.stream().anyMatch(hitConcepts::contains);
            checks.add(check("概念命中", "任一命中: " + mustHit,
                    hitConcepts.isEmpty() ? "（未命中概念）" : String.join("、", hitConcepts), hit));
        }
        List<String> sqlAny = castStringList(expect.get("sqlContainsAny"));
        if (!sqlAny.isEmpty()) {
            boolean ok = sqlAny.stream().anyMatch(s -> sqlCorpus.contains(s));
            checks.add(check("SQL 涉及表", "任一包含: " + sqlAny,
                    sqlCorpus.isBlank() ? "（未生成 SQL）" : abbreviate(sqlCorpus, 120), ok));
        }
        List<String> sqlAll = castStringList(expect.get("sqlContainsAll"));
        if (!sqlAll.isEmpty()) {
            List<String> missing = sqlAll.stream().filter(s -> !sqlCorpus.contains(s)).toList();
            checks.add(check("SQL 涉及表(全部)", String.join(" + ", sqlAll),
                    sqlCorpus.isBlank() ? "（未生成 SQL）" : missing.isEmpty() ? "全部包含" : "缺失: " + missing, missing.isEmpty()));
        }
        List<String> answerAny = castStringList(expect.get("answerContainsAny"));
        if (!answerAny.isEmpty()) {
            boolean ok = answerAny.stream().anyMatch(answer::contains);
            checks.add(check("回答要点", "任一包含: " + answerAny, abbreviate(answer, 80), ok));
        }
        List<String> forbidden = new ArrayList<>(castStringList(expect.get("answerForbiddenAny")));
        forbidden.addAll(DEFAULT_FORBIDDEN);
        List<String> hitForbidden = forbidden.stream().filter(answer::contains).toList();
        checks.add(check("回答未失败", "不含失败表述", hitForbidden.isEmpty() ? "ok" : "命中: " + hitForbidden, hitForbidden.isEmpty()));

        boolean pass = checks.stream().allMatch(c -> Boolean.TRUE.equals(c.get("pass")));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("pass", pass);
        result.put("checks", checks);
        result.put("answerExcerpt", abbreviate(answer, ANSWER_EXCERPT_LEN));
        result.put("sql", abbreviate(sql, 300));
        return result;
    }

    private Map<String, Object> check(String name, String expected, String actual, boolean pass) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("check", name);
        m.put("expected", expected);
        m.put("actual", actual);
        m.put("pass", pass);
        return m;
    }

    private Map<String, Map<String, Object>> loadPackages() {
        Map<String, Map<String, Object>> packages = new LinkedHashMap<>();
        try {
            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
            Resource[] resources = resolver.getResources(QUESTIONSET_DIR);
            for (Resource r : resources) {
                try {
                    Map<String, Object> pkg = objectMapper.readValue(r.getInputStream(),
                            new TypeReference<Map<String, Object>>() {});
                    Object name = pkg.get("name");
                    if (name != null) packages.put(String.valueOf(name), pkg);
                } catch (Exception e) {
                    log.warn("[regression] 问题集 {} 解析失败: {}", r.getFilename(), e.getMessage());
                }
            }
        } catch (Exception e) {
            log.warn("[regression] 无可用问题集: {}", e.getMessage());
        }
        mergeRuntimeCases(packages);
        return packages;
    }

    /** 追加 DB 里的运行时问题到对应问题集（只进有内置包的域，孤儿行忽略） */
    private void mergeRuntimeCases(Map<String, Map<String, Object>> packages) {
        try {
            for (String packageName : packages.keySet()) {
                List<OntologyQuestionsetCase> rows =
                        questionsetCaseRepository.findByPackageNameOrderByCreatedAtAsc(packageName);
                if (rows.isEmpty()) continue;
                List<Map<String, Object>> cases = new ArrayList<>(
                        castList(packages.get(packageName).getOrDefault("cases", List.of())));
                for (OntologyQuestionsetCase row : rows) {
                    Map<String, Object> c = new LinkedHashMap<>();
                    c.put("id", "db-" + row.getId());
                    c.put("question", row.getQuestion());
                    if (row.getExpect() != null && !row.getExpect().isBlank()) {
                        c.put("expect", objectMapper.readValue(row.getExpect(),
                                new TypeReference<Map<String, Object>>() {}));
                    }
                    cases.add(c);
                }
                packages.get(packageName).put("cases", cases);
            }
        } catch (Exception e) {
            log.warn("[regression] 合并运行时问题失败（仅内置问题集生效）: {}", e.getMessage());
        }
    }

    private AsyncTaskHolder createTask(int caseCount, Long userId) {
        long taskId = asyncTaskService.createTask("ONTOLOGY_REGRESSION", caseCount + 1, userId).getId();
        asyncTaskService.startTask(taskId);
        return new AsyncTaskHolder(taskId);
    }

    private record AsyncTaskHolder(long taskId) {}

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> castList(Object o) {
        return o instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
    }

    private List<String> castStringList(Object o) {
        return o instanceof List<?> l ? l.stream().map(String::valueOf).collect(Collectors.toList()) : List.of();
    }

    private String abbreviate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max) + "…";
    }
}
