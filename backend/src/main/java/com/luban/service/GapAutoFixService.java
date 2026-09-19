package com.luban.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.Concept;
import com.luban.entity.ConceptMapping;
import com.luban.repository.ConceptMappingRepository;
import com.luban.repository.ConceptRepository;
import com.luban.repository.DatasourceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 缺口 AI 修复建议：把聚簇到的问题交给大模型分析，给出"下一步做什么"的结构化建议。
 *
 * - no-concept：判断该不该新增概念，给出概念名/描述/同义词建议（确认后前端建概念 + 自动映射绑定）；
 * - sql-fail：结合样例 SQL 与数据库报错做诊断，指出可疑的绑定/概念（确认后前端重跑自动映射）。
 * 本服务只出建议不落库——真正的写入走既有的概念/映射接口，修复效果由回归问题集验证。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GapAutoFixService {

    private static final int MAX_TABLES_IN_PROMPT = 60;
    private static final int MAX_CONCEPTS_IN_PROMPT = 120;

    private final LlmChatClient llmChatClient;
    private final ObjectMapper objectMapper;
    private final ConceptRepository conceptRepository;
    private final ConceptMappingRepository mappingRepository;
    private final DatasourceRepository datasourceRepository;
    private final DatasourceService datasourceService;

    /** 修复建议结果：mode=create-concept 时带概念定义；mode=remap 时带涉及概念；infeasible 时只带原因 */
    public Map<String, Object> propose(String bucket, String term, List<Map<String, Object>> samples) {
        if (samples == null || samples.isEmpty()) {
            throw new IllegalArgumentException("缺少 samples");
        }
        List<String> questions = samples.stream()
                .map(s -> String.valueOf(s.get("question")))
                .filter(q -> !q.isBlank())
                .distinct()
                .limit(10)
                .toList();
        if (questions.isEmpty()) {
            throw new IllegalArgumentException("samples 中没有有效问题");
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("mode", "sql-fail".equals(bucket) ? "remap" : "create-concept");
        result.put("bucket", bucket);
        result.put("term", term);

        String llmResponse;
        if ("sql-fail".equals(bucket)) {
            llmResponse = proposeForSqlFail(term, questions, samples, result);
        } else if ("no-concept".equals(bucket)) {
            llmResponse = proposeForNoConcept(term, questions);
        } else {
            throw new IllegalArgumentException("该缺口类型暂不支持 AI 修复: " + bucket);
        }
        if (llmResponse == null) {
            throw new IllegalStateException("AI 分析失败：请确认大模型配置可用后重试");
        }
        Map<String, Object> parsed;
        try {
            parsed = objectMapper.readValue(sanitizeJson(llmResponse), new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            log.warn("[gap-fix] LLM 建议解析失败: {}", e.getMessage());
            throw new IllegalStateException("AI 返回内容无法解析，请重试");
        }
        boolean feasible = Boolean.TRUE.equals(parsed.get("feasible"))
                || "true".equalsIgnoreCase(String.valueOf(parsed.get("feasible")));
        result.put("feasible", feasible);
        for (String key : List.of("rationale", "diagnosis", "conceptName", "description", "fixHint")) {
            if (parsed.get(key) != null) result.put(key, String.valueOf(parsed.get(key)));
        }
        for (String key : List.of("synonyms", "involvedConcepts")) {
            if (parsed.get(key) instanceof List<?> l) {
                result.put(key, l.stream().map(String::valueOf).filter(s -> !s.isBlank()).limit(8).toList());
            }
        }
        return result;
    }

    /** no-concept：判断是否该新增概念，给概念定义建议 */
    private String proposeForNoConcept(String term, List<String> questions) {
        List<Concept> concepts = conceptRepository.findAll();
        String existingNames = concepts.stream()
                .map(Concept::getName)
                .filter(Objects::nonNull)
                .distinct()
                .limit(MAX_CONCEPTS_IN_PROMPT)
                .collect(Collectors.joining("、"));

        StringBuilder prompt = new StringBuilder();
        prompt.append("你是数据语义建模专家。以下是问数系统中反复出现、但无法命中任何概念的问题聚簇。\n\n");
        prompt.append("## 高频词\n").append(term).append("\n\n");
        prompt.append("## 样例问题\n");
        questions.forEach(q -> prompt.append("- ").append(q).append("\n"));
        prompt.append("\n## 已有概念（避免重复建设）\n").append(existingNames.isBlank() ? "（暂无）" : existingNames).append("\n");
        prompt.append("\n## 可用数据源的表\n").append(tableCatalog()).append("\n");
        prompt.append("""
                ## 任务
                1. 判断这些问题的可回答性缺口是什么：应该新增什么概念来覆盖？还是高频词只是疑问词/泛指词、不该建概念？
                2. 若应新增概念：给出概念定义。conceptName 用简短业务名词（2-6 字，不要用"多少""查询"这类泛词），
                   description 说明业务含义、口径与典型问法，synonyms 最多 5 个（可含表名/列名关键词，帮助后续自动映射）。
                3. 若不该建概念（泛词/已有概念可覆盖/缺的不是概念问题）：feasible=false，rationale 说明原因和用户该做什么。

                ## 输出格式（只输出 JSON）
                {"feasible": true, "conceptName": "...", "description": "...", "synonyms": ["..."], "rationale": "一句话说明为什么建这个概念"}
                或
                {"feasible": false, "rationale": "..."}
                """);
        return callLlm(prompt.toString());
    }

    /** sql-fail：结合样例 SQL 与报错诊断，指出可疑概念绑定 */
    private String proposeForSqlFail(String term, List<String> questions, List<Map<String, Object>> samples,
                                     Map<String, Object> result) {
        // 从样例 SQL 里提到的表反推可能涉及的概念（绑定表名匹配），供 LLM 重点诊断、前端一键重映射
        LinkedHashSet<String> mentionedTables = new LinkedHashSet<>();
        for (Map<String, Object> s : samples) {
            String sql = String.valueOf(s.getOrDefault("sql", ""));
            for (String token : sql.split("[^a-zA-Z0-9_\\u4e00-\\u9fa5]+")) {
                if (token.length() >= 3) mentionedTables.add(token.toLowerCase());
            }
        }
        List<Map<String, Object>> involved = new ArrayList<>();
        LinkedHashSet<Long> conceptIds = new LinkedHashSet<>();
        for (ConceptMapping m : mappingRepository.findAll()) {
            String tbl = m.getTableName() == null ? "" : m.getTableName().toLowerCase();
            if (tbl.isEmpty()) continue;
            boolean hit = mentionedTables.contains(tbl.toLowerCase());
            if (!hit) {
                for (String t : mentionedTables) {
                    if (tbl.contains(t) || t.contains(tbl)) { hit = true; break; }
                }
            }
            if (hit && conceptIds.add(m.getConceptId())) {
                conceptRepository.findById(m.getConceptId()).ifPresent(c ->
                        involved.add(Map.of("id", c.getId(), "name", c.getName())));
            }
            if (involved.size() >= 8) break;
        }

        StringBuilder prompt = new StringBuilder();
        prompt.append("你是数据语义排障专家。问数系统里以下问题生成的 SQL 执行失败了。\n\n");
        prompt.append("## 高频词\n").append(term).append("\n\n");
        prompt.append("## 失败样例（问题 / SQL / 数据库报错）\n");
        for (Map<String, Object> s : samples) {
            prompt.append("- 问题：").append(s.get("question")).append("\n");
            if (s.get("sql") != null) prompt.append("  SQL：").append(s.get("sql")).append("\n");
            prompt.append("  报错：").append(s.getOrDefault("error", "（未记录）")).append("\n");
        }
        if (!involved.isEmpty()) {
            prompt.append("\n## 疑似涉及的概念（按绑定表名与 SQL 中表名匹配）\n");
            for (Map<String, Object> c : involved) {
                prompt.append("- ").append(c.get("name")).append("（id=").append(c.get("id")).append("）\n");
            }
        }
        // 供前端把 LLM 选中的概念名映射回 id 做一键重映射
        result.put("conceptIdByName", involved.stream()
                .collect(Collectors.toMap(c -> String.valueOf(c.get("name")), c -> c.get("id"), (a, b) -> a, LinkedHashMap::new)));
        prompt.append("""
                ## 任务
                1. 诊断失败原因：绑定指向的表/列不存在？表结构变更？JOIN 条件错误？权限/库不存在？口径写错？
                2. 给出诊断与修复建议。若原因是概念绑定失效（表/列不存在、结构变更），feasible=true 并在
                   involvedConcepts 里列出需要重新自动映射的概念名（用上面列表里的名字）；否则 feasible=false，
                   fixHint 说明需要人工做什么。
                3. involvedConcepts 只能从上面"疑似涉及的概念"里选；列表为空时大概率 feasible=false。

                ## 输出格式（只输出 JSON）
                {"feasible": true, "diagnosis": "...", "fixHint": "...", "involvedConcepts": ["概念名", ...]}
                或
                {"feasible": false, "diagnosis": "...", "fixHint": "..."}
                """);
        return callLlm(prompt.toString());
    }

    private String callLlm(String prompt) {
        List<Map<String, Object>> messages = new ArrayList<>();
        messages.add(Map.of("role", "system", "content", "你是数据语义建模专家。只输出 JSON。"));
        messages.add(Map.of("role", "user", "content", prompt));
        return llmChatClient.chatQuietly(messages,
                new LlmChatClient.Options(0.3, 2048, true, Duration.ofSeconds(120)));
    }

    /** 表目录摘要：表名 + 注释，控制提示词体积 */
    private String tableCatalog() {
        StringBuilder sb = new StringBuilder();
        int tableCount = 0;
        for (var ds : datasourceRepository.findAll()) {
            if (tableCount >= MAX_TABLES_IN_PROMPT) break;
            try {
                Map<String, Object> structure = datasourceService.getStructure(ds.getId());
                if (structure.get("tables") instanceof List<?> tables) {
                    for (Object t : tables) {
                        if (tableCount >= MAX_TABLES_IN_PROMPT) break;
                        if (t instanceof Map<?, ?> table) {
                            sb.append("- ").append(table.get("name"));
                            Object comment = table.get("comment");
                            if (comment != null && !String.valueOf(comment).isBlank()) {
                                sb.append("（").append(comment).append("）");
                            }
                            sb.append("  [数据源: ").append(ds.getName()).append("]\n");
                            tableCount++;
                        }
                    }
                }
            } catch (Exception e) {
                log.warn("[gap-fix] 读取数据源 {} 结构失败: {}", ds.getName(), e.getMessage());
            }
        }
        return sb.isEmpty() ? "（暂无可用数据源）" : sb.toString();
    }

    /** 去掉 LLM 可能带的 markdown 代码围栏 */
    private String sanitizeJson(String raw) {
        String s = raw == null ? "" : raw.trim();
        if (s.startsWith("```")) {
            s = s.replaceFirst("^```(json)?", "").trim();
            int end = s.lastIndexOf("```");
            if (end >= 0) s = s.substring(0, end).trim();
        }
        return s;
    }
}
