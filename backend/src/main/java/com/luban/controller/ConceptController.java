package com.luban.controller;

import com.luban.dto.*;
import com.luban.entity.Concept;
import com.luban.entity.ConceptRelation;
import com.luban.entity.ToolConcept;
import com.luban.service.ConceptMappingService;
import com.luban.service.ConceptService;
import com.luban.service.RoleConceptPermissionService;
import com.luban.entity.User;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/concepts")
@RequiredArgsConstructor
public class ConceptController {

    private final ConceptService conceptService;
    private final RoleConceptPermissionService roleConceptPermissionService;
    private final ConceptMappingService conceptMappingService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<Concept>>> list(@RequestParam(required = false) Long groupId,
                              @RequestParam(required = false) String keyword) {
        return ResponseEntity.ok(ApiResponse.ok(conceptService.list(groupId, keyword)));
    }

    @PostMapping("/batch")
    public ResponseEntity<ApiResponse<List<Concept>>> batch(@RequestBody List<Long> ids) {
        return ResponseEntity.ok(ApiResponse.ok(conceptService.findByIds(ids)));
    }

    @GetMapping("/tree")
    public ResponseEntity<ApiResponse<List<ConceptTreeResponse>>> tree(@RequestParam(required = false) Long groupId) {
        return ResponseEntity.ok(ApiResponse.ok(conceptService.getTree(groupId)));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<ConceptDetailResponse>> get(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(conceptService.getById(id)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<Concept>> create(@RequestBody CreateConceptRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(conceptService.create(request)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<Concept>> update(@PathVariable Long id, @RequestBody CreateConceptRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(conceptService.update(id, request)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        conceptService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @GetMapping("/{id}/relations")
    public ResponseEntity<ApiResponse<List<ConceptRelation>>> getRelations(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(conceptService.getRelations(id)));
    }

    @GetMapping("/relations")
    public ResponseEntity<ApiResponse<List<ConceptRelation>>> listAllRelations(@RequestParam(required = false) Long groupId) {
        return ResponseEntity.ok(ApiResponse.ok(conceptService.listAllRelations(groupId)));
    }

    @PostMapping("/{id}/relations")
    public ResponseEntity<ApiResponse<ConceptRelation>> createRelation(@PathVariable Long id,
                                           @RequestBody CreateRelationRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(conceptService.createRelation(id, request)));
    }

    @PutMapping("/{id}/relations/{relId}")
    public ResponseEntity<ApiResponse<ConceptRelation>> updateRelation(@PathVariable Long id,
                                           @PathVariable Long relId,
                                           @RequestBody CreateRelationRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(conceptService.updateRelation(relId, request)));
    }

    @DeleteMapping("/{id}/relations/{relId}")
    public ResponseEntity<ApiResponse<Void>> deleteRelation(@PathVariable Long id, @PathVariable Long relId) {
        conceptService.deleteRelation(relId);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @GetMapping("/{id}/tools")
    public ResponseEntity<ApiResponse<List<ToolConcept>>> getConceptTools(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(conceptService.getConceptTools(id)));
    }

    @PostMapping("/permissions/check")
    public ResponseEntity<ApiResponse<Map<String, Object>>> checkPermission(
            @RequestBody Map<String, Object> body) {
        Long userId = Long.valueOf(body.get("userId").toString());
        @SuppressWarnings("unchecked")
        List<Integer> conceptIdInts = (List<Integer>) body.get("conceptIds");
        List<Long> conceptIds = conceptIdInts.stream().map(Long::valueOf).collect(Collectors.toList());

        Map<Long, Boolean> results = roleConceptPermissionService.batchCheckQueryPermission(userId, conceptIds);
        List<Long> authorized = new ArrayList<>();
        List<Map<String, Object>> denied = new ArrayList<>();

        for (Map.Entry<Long, Boolean> entry : results.entrySet()) {
            if (entry.getValue()) {
                authorized.add(entry.getKey());
            } else {
                Concept concept = conceptService.getConceptById(entry.getKey());
                Map<String, Object> deniedInfo = new HashMap<>();
                deniedInfo.put("conceptId", entry.getKey());
                deniedInfo.put("conceptName", concept.getName());
                deniedInfo.put("groupName", concept.getGroupId() != null ? "未知域" : "公共域");
                denied.add(deniedInfo);
            }
        }

        return ResponseEntity.ok(ApiResponse.ok(Map.of("authorized", authorized, "denied", denied)));
    }

    @PostMapping("/auto-match-mappings")
    public ResponseEntity<ApiResponse<Map<String, Object>>> autoMatchMappings(
            @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<Number> conceptIdNumbers = (List<Number>) body.get("conceptIds");
        @SuppressWarnings("unchecked")
        List<Number> datasourceIdNumbers = (List<Number>) body.get("datasourceIds");
        if (conceptIdNumbers == null || conceptIdNumbers.isEmpty()) {
            return ResponseEntity.badRequest().body(ApiResponse.error("缺少 conceptIds 参数"));
        }
        if (datasourceIdNumbers == null || datasourceIdNumbers.isEmpty()) {
            return ResponseEntity.badRequest().body(ApiResponse.error("缺少 datasourceIds 参数"));
        }
        Long userId = getCurrentUserId();
        List<Long> conceptIds = conceptIdNumbers.stream().map(Number::longValue).toList();
        List<Long> datasourceIds = datasourceIdNumbers.stream().map(Number::longValue).toList();
        long taskId = conceptMappingService.submitAutoMatch(conceptIds, datasourceIds, userId);
        return ResponseEntity.ok(ApiResponse.ok(Map.of("taskId", taskId)));
    }

    @PostMapping("/apply-auto-match-mappings")
    public ResponseEntity<ApiResponse<Map<String, Object>>> applyAutoMatchMappings(
            @RequestBody Map<String, Object> body) {
        Long taskId = body.get("taskId") instanceof Number n ? n.longValue() : null;
        if (taskId == null) {
            return ResponseEntity.badRequest().body(ApiResponse.error("缺少 taskId 参数"));
        }
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> selected = (List<Map<String, Object>>) body.get("mappings");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> selectedJoins = (List<Map<String, Object>>) body.get("joinMappings");
        return ResponseEntity.ok(ApiResponse.ok(conceptMappingService.applyAutoMatch(taskId, selected != null ? selected : Collections.emptyList(), selectedJoins != null ? selectedJoins : Collections.emptyList())));
    }

    @PostMapping("/retry-auto-match-mappings")
    public ResponseEntity<ApiResponse<Map<String, Object>>> retryAutoMatchMappings(
            @RequestBody Map<String, Object> body) {
        Long taskId = body.get("taskId") instanceof Number n ? n.longValue() : null;
        if (taskId == null) {
            return ResponseEntity.badRequest().body(ApiResponse.error("缺少 taskId 参数"));
        }
        @SuppressWarnings("unchecked")
        List<Number> conceptIdNumbers = (List<Number>) body.get("conceptIds");
        if (conceptIdNumbers == null || conceptIdNumbers.isEmpty()) {
            return ResponseEntity.badRequest().body(ApiResponse.error("缺少 conceptIds 参数"));
        }
        List<Long> conceptIds = conceptIdNumbers.stream().map(Number::longValue).toList();
        Long userId = getCurrentUserId();
        long newTaskId = conceptMappingService.retryAutoMatch(taskId, conceptIds, userId);
        return ResponseEntity.ok(ApiResponse.ok(Map.of("taskId", newTaskId)));
    }

    private Long getCurrentUserId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof User user) {
            return user.getId();
        }
        return null;
    }
}