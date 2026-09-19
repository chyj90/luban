package com.luban.controller;

import com.luban.constant.Permissions;
import com.luban.annotation.RequirePermission;
import com.luban.dto.ApiResponse;
import com.luban.entity.BindingProfile;
import com.luban.entity.User;
import com.luban.repository.ConceptRepository;
import com.luban.service.BindingProfileService;
import com.luban.service.ConceptMappingService;
import com.luban.service.DatasourceService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.stream.Collectors;

/**
 * 绑定集管理：一个数据源一套概念绑定 + 术语/枚举词典。
 * 映射本体仍走 concept-mapping 接口（自动匹配/人工确认），此处承载 profile 元数据与词典，
 * 并提供"接入新数据源一键绑定"编排：建档 → 全量概念自动匹配 → 异步任务 → 前端确认应用。
 */
@RestController
@RequestMapping("/api/v1/binding-profiles")
@RequiredArgsConstructor
@RequirePermission(Permissions.CONNECT_CONCEPTS)
public class BindingProfileController {

    private final BindingProfileService bindingProfileService;
    private final ConceptMappingService conceptMappingService;
    private final ConceptRepository conceptRepository;
    private final DatasourceService datasourceService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> list() {
        return ResponseEntity.ok(ApiResponse.ok(bindingProfileService.listProfiles()));
    }

    /**
     * 一键接入：对该数据源启动全量概念的自动映射（规则优先 + LLM 兜底，异步任务）。
     * 返回 taskId，前端轮询 async-tasks/{id}，完成后调 apply-auto-match-mappings 确认应用。
     */
    @PostMapping("/datasource/{datasourceId}/auto-bind")
    public ResponseEntity<ApiResponse<Map<String, Object>>> autoBind(
            @PathVariable Long datasourceId,
            @AuthenticationPrincipal User user,
            @RequestBody(required = false) Map<String, Object> body) {
        datasourceService.getById(datasourceId);
        var profile = bindingProfileService.ensureProfile(datasourceId);
        List<Long> conceptIds;
        if (body != null && body.get("conceptIds") instanceof List<?> list && !list.isEmpty()) {
            conceptIds = list.stream()
                    .filter(n -> n instanceof Number)
                    .map(n -> ((Number) n).longValue())
                    .collect(Collectors.toList());
        } else {
            conceptIds = conceptRepository.findAll().stream()
                    .map(c -> c.getId())
                    .collect(Collectors.toList());
        }
        if (conceptIds.isEmpty()) {
            throw new IllegalArgumentException("平台还没有任何概念，请先在概念编辑器中建模再接入绑定");
        }
        Long userId = user != null ? user.getId() : null;
        long taskId = conceptMappingService.submitAutoMatchV2(conceptIds, List.of(datasourceId), userId);
        return ResponseEntity.ok(ApiResponse.ok(Map.of(
                "profileId", profile.getId(),
                "taskId", taskId,
                "conceptCount", conceptIds.size())));
    }

    @GetMapping("/datasource/{datasourceId}")
    public ResponseEntity<ApiResponse<BindingProfile>> getByDatasource(@PathVariable Long datasourceId) {
        return ResponseEntity.ok(ApiResponse.ok(bindingProfileService.ensureProfile(datasourceId)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<BindingProfile>> update(@PathVariable Long id, @RequestBody BindingProfile updated) {
        return ResponseEntity.ok(ApiResponse.ok(bindingProfileService.update(id, updated)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        bindingProfileService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @PostMapping("/datasource/{datasourceId}/enum-refresh")
    public ResponseEntity<ApiResponse<Map<String, Object>>> refreshEnum(
            @PathVariable Long datasourceId,
            @RequestBody Map<String, String> body) {
        String table = body.get("table");
        String column = body.get("column");
        if (table == null || table.isBlank() || column == null || column.isBlank()) {
            throw new IllegalArgumentException("缺少 table 或 column");
        }
        List<String> values = bindingProfileService.refreshEnumColumn(datasourceId, table, column);
        return ResponseEntity.ok(ApiResponse.ok(Map.of("table", table, "column", column, "values", values)));
    }

    @GetMapping("/datasource/{datasourceId}/synonyms")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> synonyms(@PathVariable Long datasourceId) {
        return ResponseEntity.ok(ApiResponse.ok(bindingProfileService.getSynonymDict(datasourceId)));
    }
}
