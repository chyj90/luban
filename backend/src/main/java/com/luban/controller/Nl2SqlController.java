package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.service.SqlGeneratorService;
import com.luban.service.SqlSecurityValidator;
import com.luban.service.RoleConceptPermissionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/v1/nl2sql")
@RequiredArgsConstructor
public class Nl2SqlController {

    private final SqlGeneratorService sqlGeneratorService;
    private final SqlSecurityValidator sqlSecurityValidator;
    private final RoleConceptPermissionService permissionService;

    @PostMapping("/generate")
    public ApiResponse<Map<String, Object>> generateSql(
            @RequestBody Map<String, Object> body,
            @AuthenticationPrincipal Authentication auth) {

        @SuppressWarnings("unchecked")
        List<Integer> conceptIdsRaw = (List<Integer>) body.get("conceptIds");
        List<Long> conceptIds = conceptIdsRaw.stream().map(Integer::longValue).toList();

        Long userId = Long.parseLong(auth.getName());

        for (Long conceptId : conceptIds) {
            if (!permissionService.checkQueryPermission(userId, conceptId)) {
                return ApiResponse.error("无权访问概念: " + conceptId);
            }
        }

        @SuppressWarnings("unchecked")
        Map<String, Object> filters = (Map<String, Object>) body.getOrDefault("filters", Map.of());

        SqlGeneratorService.GeneratedSql generated = sqlGeneratorService.generateSql(conceptIds, filters);

        Long datasourceId = generated.getMappings().stream()
                .findFirst()
                .map(m -> m.getDatasourceId())
                .orElse(null);

        SqlSecurityValidator.ValidationResult validation = sqlSecurityValidator.validate(
                generated.getSql(), datasourceId, generated.getMappings());

        Map<String, Object> result = Map.of(
                "sql", generated.getSql(),
                "mainTable", generated.getMainTable(),
                "valid", validation.isValid(),
                "errors", validation.getErrors(),
                "warnings", validation.getWarnings(),
                "mappings", generated.getMappings().stream()
                        .map(m -> Map.of(
                                "tableName", m.getTableName(),
                                "columnName", m.getColumnName(),
                                "attributeName", m.getAttributeName() != null ? m.getAttributeName() : "",
                                "mappingType", m.getMappingType()
                        ))
                        .toList(),
                "joins", generated.getJoins().stream()
                        .map(j -> Map.of(
                                "joinType", j.getJoinType(),
                                "joinTable", j.getJoinTable(),
                                "joinCondition", j.getJoinCondition()
                        ))
                        .toList()
        );

        return ApiResponse.ok(result);
    }

    @PostMapping("/validate")
    public ApiResponse<Map<String, Object>> validateSql(@RequestBody Map<String, Object> body) {
        String sql = (String) body.get("sql");
        Long datasourceId = body.get("datasourceId") != null
                ? Long.valueOf(body.get("datasourceId").toString())
                : null;

        SqlSecurityValidator.ValidationResult result = sqlSecurityValidator.validate(sql, datasourceId, null);

        return ApiResponse.ok(Map.of(
                "valid", result.isValid(),
                "errors", result.getErrors(),
                "warnings", result.getWarnings()
        ));
    }
}