package com.luban.service;

import com.luban.entity.ConceptJoinMapping;
import com.luban.entity.ConceptMapping;
import com.luban.repository.ConceptJoinMappingRepository;
import com.luban.repository.ConceptMappingRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class SqlGeneratorService {

    private final ConceptMappingRepository mappingRepository;
    private final ConceptJoinMappingRepository joinMappingRepository;

    /**
     * 根据概念 ID 列表，从概念映射自动生成 SQL 查询
     */
    public GeneratedSql generateSql(List<Long> conceptIds, Map<String, Object> filters) {
        if (conceptIds == null || conceptIds.isEmpty()) {
            throw new IllegalArgumentException("概念 ID 列表不能为空");
        }

        List<ConceptMapping> allMappings = new ArrayList<>();
        for (Long conceptId : conceptIds) {
            allMappings.addAll(mappingRepository.findByConceptId(conceptId));
        }

        if (allMappings.isEmpty()) {
            throw new IllegalStateException("没有找到概念映射，请先在概念管理中配置字段映射");
        }

        Map<String, List<ConceptMapping>> tableGroups = allMappings.stream()
                .collect(Collectors.groupingBy(ConceptMapping::getTableName));

        String mainTable = tableGroups.keySet().stream()
                .filter(t -> tableGroups.get(t).stream().anyMatch(m -> Boolean.TRUE.equals(m.getIsRequired())))
                .findFirst()
                .orElse(tableGroups.keySet().iterator().next());

        List<ConceptMapping> mainMappings = tableGroups.get(mainTable);

        List<String> selectColumns = new ArrayList<>();
        List<String> whereClauses = new ArrayList<>();
        Map<String, String> columnAliases = new LinkedHashMap<>();

        for (ConceptMapping m : mainMappings) {
            String colExpr = buildColumnExpr(m);
            selectColumns.add(colExpr);
            if (m.getAttributeName() != null && !m.getAttributeName().isEmpty()) {
                columnAliases.put(m.getAttributeName(), colExpr);
            }
        }

        for (Map.Entry<String, String> entry : columnAliases.entrySet()) {
            String alias = entry.getKey();
            String colExpr = entry.getValue();
            if (filters.containsKey(alias)) {
                whereClauses.add(colExpr + " = :" + alias);
            }
        }

        List<JoinInfo> joinInfos = new ArrayList<>();
        if (tableGroups.size() > 1) {
            for (String table : tableGroups.keySet()) {
                if (table.equals(mainTable)) continue;
                List<ConceptJoinMapping> joins = joinMappingRepository.findByConceptIdInAndJoinTable(
                        conceptIds, table);
                for (ConceptJoinMapping join : joins) {
                    joinInfos.add(new JoinInfo(join.getRelationType(), join.getJoinTable(),
                            join.getJoinCondition()));
                }
            }
        }

        StringBuilder sql = new StringBuilder();
        sql.append("SELECT ").append(String.join(", ", selectColumns));
        sql.append(" FROM ").append(mainTable);

        for (JoinInfo join : joinInfos) {
            sql.append(" ").append(join.joinType).append(" JOIN ").append(join.joinTable);
            sql.append(" ON ").append(join.joinCondition);
        }

        if (!whereClauses.isEmpty()) {
            sql.append(" WHERE ").append(String.join(" AND ", whereClauses));
        }

        return new GeneratedSql(sql.toString(), mainTable, allMappings, joinInfos);
    }

    private String buildColumnExpr(ConceptMapping m) {
        if ("computed".equals(m.getMappingType()) && m.getComputedExpr() != null) {
            return "(" + m.getComputedExpr() + ")";
        }
        return m.getTableName() + "." + m.getColumnName();
    }

    public static class GeneratedSql {
        private final String sql;
        private final String mainTable;
        private final List<ConceptMapping> mappings;
        private final List<JoinInfo> joins;

        public GeneratedSql(String sql, String mainTable, List<ConceptMapping> mappings, List<JoinInfo> joins) {
            this.sql = sql;
            this.mainTable = mainTable;
            this.mappings = mappings;
            this.joins = joins;
        }

        public String getSql() { return sql; }
        public String getMainTable() { return mainTable; }
        public List<ConceptMapping> getMappings() { return mappings; }
        public List<JoinInfo> getJoins() { return joins; }
    }

    public static class JoinInfo {
        private final String joinType;
        private final String joinTable;
        private final String joinCondition;

        public JoinInfo(String joinType, String joinTable, String joinCondition) {
            this.joinType = joinType != null ? joinType : "LEFT";
            this.joinTable = joinTable;
            this.joinCondition = joinCondition;
        }

        public String getJoinType() { return joinType; }
        public String getJoinTable() { return joinTable; }
        public String getJoinCondition() { return joinCondition; }
    }
}