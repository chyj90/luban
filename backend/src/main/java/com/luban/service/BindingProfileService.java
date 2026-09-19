package com.luban.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.BindingProfile;
import com.luban.entity.Concept;
import com.luban.repository.BindingProfileRepository;
import com.luban.repository.ConceptMappingRepository;
import com.luban.repository.ConceptRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;

/**
 * 绑定集服务。一个数据源一个 profile：
 * - 接入新数据源 = ensureProfile 建档 → 跑 autoMatchV2 → 审批确认（映射落在 concept_mapping，按 datasource 归属）；
 * - 术语/枚举词典挂 profile，问数 prompt 与 value_origins 校验消费。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BindingProfileService {

    private static final int MAX_ENUM_VALUES_PER_COLUMN = 500;

    private final BindingProfileRepository bindingProfileRepository;
    private final ConceptMappingRepository conceptMappingRepository;
    private final ConceptRepository conceptRepository;
    private final com.luban.repository.DatasourceRepository datasourceRepository;
    private final DatasourceService datasourceService;
    private final ObjectMapper objectMapper;

    @Transactional
    public BindingProfile ensureProfile(Long datasourceId) {
        return bindingProfileRepository.findByDatasourceId(datasourceId).orElseGet(() -> {
            BindingProfile profile = new BindingProfile();
            profile.setDatasourceId(datasourceId);
            String dsName = datasourceService.getById(datasourceId).getName();
            profile.setName(dsName + " 绑定集");
            profile.setDescription("数据源「" + dsName + "」的概念绑定与术语词典");
            refreshStatus(profile);
            return bindingProfileRepository.save(profile);
        });
    }

    @Transactional(readOnly = true)
    public Optional<BindingProfile> findByDatasourceId(Long datasourceId) {
        return bindingProfileRepository.findByDatasourceId(datasourceId);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> listProfiles() {
        List<Map<String, Object>> result = new ArrayList<>();
        Map<Long, Long> coverageByDs = coverageByDatasource();
        long totalConcepts = conceptRepository.count();
        Map<Long, BindingProfile> profileByDs = new HashMap<>();
        for (BindingProfile p : bindingProfileRepository.findAll()) {
            profileByDs.put(p.getDatasourceId(), p);
        }
        // 有映射但尚未显式建档的数据源也纳入视图（合成条目，不落库），避免绑定管理页漏源
        Set<Long> dsIds = new LinkedHashSet<>(profileByDs.keySet());
        dsIds.addAll(coverageByDs.keySet());
        for (Long dsId : dsIds) {
            BindingProfile p = profileByDs.get(dsId);
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("datasourceId", dsId);
            long mapped = coverageByDs.getOrDefault(dsId, 0L);
            if (p != null) {
                item.put("id", p.getId());
                item.put("name", p.getName());
                item.put("description", p.getDescription());
                item.put("synonymCount", parseList(p.getSynonymDict()).size());
                item.put("enumColumnCount", parseList(p.getEnumDict()).size());
                item.put("updatedAt", p.getUpdatedAt());
            } else {
                item.put("id", -dsId);
                item.put("name", null);
                item.put("description", null);
                item.put("synonymCount", 0);
                item.put("enumColumnCount", 0);
                item.put("updatedAt", null);
            }
            String dsName;
            try {
                dsName = datasourceService.getById(dsId).getName();
            } catch (Exception e) {
                dsName = "数据源#" + dsId;
            }
            item.put("datasourceName", dsName);
            item.put("status", mapped > 0 ? "ACTIVE" : "EMPTY");
            item.put("mappedConcepts", mapped);
            item.put("totalConcepts", totalConcepts);
            result.add(item);
        }
        result.sort(Comparator.comparing(i -> String.valueOf(i.get("datasourceName"))));
        return result;
    }

    @Transactional
    public BindingProfile update(Long id, BindingProfile updated) {
        BindingProfile profile = bindingProfileRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("绑定集不存在: " + id));
        if (updated.getName() != null) profile.setName(updated.getName());
        if (updated.getDescription() != null) profile.setDescription(updated.getDescription());
        if (updated.getSynonymDict() != null) {
            validateSynonymDict(updated.getSynonymDict());
            profile.setSynonymDict(updated.getSynonymDict());
        }
        return bindingProfileRepository.save(profile);
    }

    @Transactional
    public void delete(Long id) {
        bindingProfileRepository.deleteById(id);
    }

    // ────────── 枚举字典 ──────────

    /**
     * 实时拉取列的 DISTINCT 值并写入字典（封顶 MAX_ENUM_VALUES_PER_COLUMN）。
     */
    @Transactional
    public List<String> refreshEnumColumn(Long datasourceId, String table, String column) {
        Set<String> values = datasourceService.queryDistinctValues(datasourceId, table, column);
        List<String> capped = values.stream().sorted().limit(MAX_ENUM_VALUES_PER_COLUMN).toList();

        BindingProfile profile = ensureProfile(datasourceId);
        List<Map<String, Object>> dict = parseList(profile.getEnumDict());
        Map<String, Object> entry = findEnumEntry(dict, table, column);
        if (entry == null) {
            entry = new LinkedHashMap<>();
            entry.put("table", table);
            entry.put("column", column);
            dict.add(entry);
        }
        entry.put("values", capped);
        entry.put("syncedAt", LocalDateTime.now().toString());
        profile.setEnumDict(writeJson(dict));
        bindingProfileRepository.save(profile);
        return capped;
    }

    /**
     * value_origins 校验入口：字典有条目 → 权威判定（免去实连）；
     * 无条目 → 返回 null，由调用方回落实时查询并在命中后回填字典。
     */
    @Transactional
    public Boolean lookupEnumValue(Long datasourceId, String table, String column, String value) {
        BindingProfile profile = bindingProfileRepository.findByDatasourceId(datasourceId).orElse(null);
        if (profile == null || profile.getEnumDict() == null) return null;
        Map<String, Object> entry = findEnumEntry(parseList(profile.getEnumDict()), table, column);
        if (entry == null || entry.get("values") == null) return null;
        return ((List<?>) entry.get("values")).contains(value);
    }

    /** 实时校验命中后回填字典（自愈），失败静默——缓存只是优化，不是正确性依赖 */
    @Transactional
    public void recordEnumValue(Long datasourceId, String table, String column, String value) {
        try {
            BindingProfile profile = ensureProfile(datasourceId);
            List<Map<String, Object>> dict = parseList(profile.getEnumDict());
            Map<String, Object> entry = findEnumEntry(dict, table, column);
            if (entry == null) {
                entry = new LinkedHashMap<>();
                entry.put("table", table);
                entry.put("column", column);
                entry.put("values", new ArrayList<>());
                dict.add(entry);
            }
            List<Object> values = entry.get("values") instanceof List<?> l ? new ArrayList<>(l) : new ArrayList<>();
            if (values.size() >= MAX_ENUM_VALUES_PER_COLUMN || values.contains(value)) return;
            values.add(value);
            entry.put("values", values);
            entry.put("syncedAt", LocalDateTime.now().toString());
            profile.setEnumDict(writeJson(dict));
            bindingProfileRepository.save(profile);
        } catch (Exception e) {
            log.debug("recordEnumValue failed (ignored): {}.{}={}: {}", table, column, value, e.getMessage());
        }
    }

    // ────────── 术语词典 ──────────

    @Transactional
    public List<Map<String, Object>> getSynonymDict(Long datasourceId) {
        BindingProfile profile = ensureProfile(datasourceId);
        return parseList(profile.getSynonymDict());
    }

    /** 问数 prompt 用：把术语词典渲染成紧凑文本；无词典返回空串 */
    @Transactional(readOnly = true)
    public String toPromptString(Long datasourceId) {
        BindingProfile profile = bindingProfileRepository.findByDatasourceId(datasourceId).orElse(null);
        if (profile == null || profile.getSynonymDict() == null) return "";
        List<Map<String, Object>> dict = parseList(profile.getSynonymDict());
        if (dict.isEmpty()) return "";
        StringBuilder sb = new StringBuilder("### 本数据源术语词典（用户方言 → 集团概念/规范值）\n");
        for (Map<String, Object> d : dict) {
            sb.append("- ").append(d.getOrDefault("term", ""));
            Object concept = d.get("conceptName");
            if (concept != null && !String.valueOf(concept).isEmpty()) {
                sb.append(" → 概念「").append(concept).append("」");
            }
            Object synonyms = d.get("synonyms");
            if (synonyms instanceof List<?> l && !l.isEmpty()) {
                sb.append("（同义: ").append(String.join("、", l.stream().map(String::valueOf).toList())).append("）");
            }
            Object note = d.get("note");
            if (note != null && !String.valueOf(note).isEmpty()) {
                sb.append("。").append(note);
            }
            sb.append("\n");
        }
        return sb.toString();
    }

    // ────────── 内部 ──────────

    private Map<Long, Long> coverageByDatasource() {
        Map<Long, Long> result = new HashMap<>();
        for (Object[] row : conceptMappingRepository.countDistinctConceptsByDatasource()) {
            result.put((Long) row[0], (Long) row[1]);
        }
        return result;
    }

    private void refreshStatus(BindingProfile profile) {
        Long mapped = coverageByDatasource().getOrDefault(profile.getDatasourceId(), 0L);
        profile.setStatus(mapped > 0 ? "ACTIVE" : "EMPTY");
    }

    private Map<String, Object> findEnumEntry(List<Map<String, Object>> dict, String table, String column) {
        for (Map<String, Object> e : dict) {
            if (table.equals(e.get("table")) && column.equals(e.get("column"))) return e;
        }
        return null;
    }

    private List<Map<String, Object>> parseList(String json) {
        if (json == null || json.isBlank()) return new ArrayList<>();
        try {
            List<Map<String, Object>> list = objectMapper.readValue(json, new TypeReference<>() {});
            return list != null ? list : new ArrayList<>();
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }

    private String writeJson(List<Map<String, Object>> list) {
        try {
            return objectMapper.writeValueAsString(list);
        } catch (Exception e) {
            return "[]";
        }
    }

    private void validateSynonymDict(String json) {
        List<Map<String, Object>> list = parseList(json);
        for (Map<String, Object> d : list) {
            if (d.get("term") == null || String.valueOf(d.get("term")).isBlank()) {
                throw new IllegalArgumentException("术语词典条目缺少 term 字段");
            }
        }
    }
}
