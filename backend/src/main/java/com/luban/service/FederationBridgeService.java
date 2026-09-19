package com.luban.service;

import com.luban.entity.FederationBridge;
import com.luban.repository.FederationBridgeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 跨源桥接管理。创建时校验两侧数据源真实存在、桥接列真实存在于表结构
 * （schema 缓存），保证问数生成的 nl2sql_federated 步骤有可信的联接依据。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FederationBridgeService {

    private final FederationBridgeRepository bridgeRepository;
    private final DatasourceService datasourceService;

    @Transactional(readOnly = true)
    public List<Map<String, Object>> list() {
        return bridgeRepository.findAll().stream()
                .sorted(Comparator.comparing(FederationBridge::getId))
                .map(this::toMap)
                .collect(Collectors.toList());
    }

    private Map<String, Object> toMap(FederationBridge b) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", b.getId());
        m.put("name", b.getName());
        m.put("leftDatasourceId", b.getLeftDatasourceId());
        m.put("leftTable", b.getLeftTable());
        m.put("leftColumn", b.getLeftColumn());
        m.put("rightDatasourceId", b.getRightDatasourceId());
        m.put("rightTable", b.getRightTable());
        m.put("rightColumn", b.getRightColumn());
        m.put("joinType", b.getJoinType());
        m.put("description", b.getDescription());
        m.put("leftDatasourceName", safeDsName(b.getLeftDatasourceId()));
        m.put("rightDatasourceName", safeDsName(b.getRightDatasourceId()));
        return m;
    }

    private String safeDsName(Long dsId) {
        try {
            return datasourceService.getById(dsId).getName();
        } catch (Exception e) {
            return "数据源#" + dsId;
        }
    }

    /** 创建桥接：校验两侧数据源存在、桥接列存在于各自表结构（读 schema 缓存） */
    @Transactional
    public FederationBridge create(FederationBridge bridge) {
        validateSide(bridge.getLeftDatasourceId(), bridge.getLeftTable(), bridge.getLeftColumn(), "左");
        validateSide(bridge.getRightDatasourceId(), bridge.getRightTable(), bridge.getRightColumn(), "右");
        if (Objects.equals(bridge.getLeftDatasourceId(), bridge.getRightDatasourceId())) {
            throw new IllegalArgumentException("桥接两侧必须是不同数据源（同源联接请用普通 JOIN 映射）");
        }
        String jt = bridge.getJoinType() == null ? "INNER" : bridge.getJoinType().toUpperCase();
        if (!jt.equals("INNER") && !jt.equals("LEFT")) {
            throw new IllegalArgumentException("joinType 仅支持 INNER / LEFT");
        }
        bridge.setJoinType(jt);
        if (bridge.getName() == null || bridge.getName().isBlank()) {
            bridge.setName(safeDsName(bridge.getLeftDatasourceId()) + " ↔ " + safeDsName(bridge.getRightDatasourceId()));
        }
        return bridgeRepository.save(bridge);
    }

    @Transactional
    public void delete(Long id) {
        bridgeRepository.deleteById(id);
    }

    private void validateSide(Long datasourceId, String table, String column, String side) {
        if (datasourceId == null || table == null || table.isBlank()
                || column == null || column.isBlank()) {
            throw new IllegalArgumentException(side + "侧缺少 datasourceId / table / column");
        }
        Map<String, Object> structure = datasourceService.getStructure(datasourceId);
        boolean columnExists = false;
        if (structure.get("tables") instanceof List<?> tables) {
            for (Object o : tables) {
                if (o instanceof Map<?, ?> t && table.equalsIgnoreCase(String.valueOf(t.get("name")))) {
                    if (t.get("columns") instanceof List<?> cols) {
                        columnExists = cols.stream().anyMatch(c ->
                                c instanceof Map<?, ?> cm
                                        && column.equalsIgnoreCase(String.valueOf(cm.get("name"))));
                    }
                    break;
                }
            }
        }
        if (!columnExists) {
            throw new IllegalArgumentException(side + "侧桥接列不存在: 数据源#" + datasourceId
                    + " " + table + "." + column + "，请确认表结构后重试");
        }
    }
}
