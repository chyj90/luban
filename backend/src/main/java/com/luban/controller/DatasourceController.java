package com.luban.controller;

import com.luban.constant.Permissions;
import com.luban.dto.*;
import com.luban.entity.User;
import com.luban.security.appaccess.AppAccess;
import com.luban.security.appaccess.AppAction;
import com.luban.security.appaccess.AppAccessService;
import com.luban.service.DatasourceService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/datasources")
public class DatasourceController {

    private final DatasourceService datasourceService;
    private final AppAccessService appAccessService;

    public DatasourceController(DatasourceService datasourceService, AppAccessService appAccessService) {
        this.datasourceService = datasourceService;
        this.appAccessService = appAccessService;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> list(
            @RequestParam String slug,
            @RequestParam(required = false) Long ownerId) {
        return ResponseEntity.ok(ApiResponse.ok(datasourceService.listBySlug(slug, ownerId)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<Map<String, Object>>> create(
            @Valid @RequestBody CreateDatasourceRequest request,
            @AuthenticationPrincipal User user) {
        // PLATFORM 数据源是平台共享资源，创建需系统配置权限；APPLICATION 数据源按应用开发权校验
        if ("PLATFORM".equals(request.getSlug())) {
            appAccessService.assertPlatformPermission(user.getId(), Permissions.CONNECT_SYSTEMS);
        } else if (request.getOwnerId() != null) {
            appAccessService.assertAccess(user.getId(), request.getOwnerId(), AppAction.DEVELOP);
        }
        Map<String, Object> ds = datasourceService.create(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(ds));
    }

    // 数据源为用户级资源（owner 归属），resolver 返回 ownerId 并按资源所有者判定

    @PostMapping("/{id}/test")
    @AppAccess(action = AppAction.RUN, resource = "datasource", key = "id")
    public ResponseEntity<ApiResponse<TestDatasourceResponse>> test(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(datasourceService.test(id)));
    }

    @GetMapping("/{id}/structure")
    @AppAccess(action = AppAction.VIEW, resource = "datasource", key = "id")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getStructure(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(datasourceService.getStructure(id)));
    }

    @DeleteMapping("/{id}")
    @AppAccess(action = AppAction.DEVELOP, resource = "datasource", key = "id")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        datasourceService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @PutMapping("/{id}")
    @AppAccess(action = AppAction.DEVELOP, resource = "datasource", key = "id")
    public ResponseEntity<ApiResponse<Map<String, Object>>> update(
            @PathVariable Long id,
            @Valid @RequestBody CreateDatasourceRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(datasourceService.update(id, request)));
    }
}
