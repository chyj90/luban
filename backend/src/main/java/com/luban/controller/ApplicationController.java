package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.dto.CreateAppRequest;
import com.luban.entity.Application;
import com.luban.entity.User;
import com.luban.repository.UserRepository;
import com.luban.service.ApplicationService;
import com.luban.workflow.entity.Member;
import com.luban.workflow.entity.Role;
import com.luban.workflow.entity.RoleUser;
import com.luban.workflow.repository.MemberRepository;
import com.luban.workflow.repository.RoleRepository;
import com.luban.workflow.repository.RoleUserRepository;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Collections;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/applications")
public class ApplicationController {

    private final ApplicationService applicationService;
    private final UserRepository userRepository;
    private final MemberRepository memberRepository;
    private final RoleRepository roleRepository;
    private final RoleUserRepository roleUserRepository;

    public ApplicationController(ApplicationService applicationService, UserRepository userRepository,
                                 MemberRepository memberRepository, RoleRepository roleRepository,
                                 RoleUserRepository roleUserRepository) {
        this.applicationService = applicationService;
        this.userRepository = userRepository;
        this.memberRepository = memberRepository;
        this.roleRepository = roleRepository;
        this.roleUserRepository = roleUserRepository;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<Application>>> list(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(ApiResponse.ok(applicationService.listByCreatedBy(user.getId())));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<Application>> getOne(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(applicationService.getById(id)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<Application>> create(@Valid @RequestBody CreateAppRequest request,
                                                            @AuthenticationPrincipal User user) {
        Application app = applicationService.create(request, user.getId());
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(app));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<Application>> update(@PathVariable Long id,
                                                            @RequestBody Map<String, String> request) {
        Application app = applicationService.update(id, request.get("name"));
        return ResponseEntity.ok(ApiResponse.ok(app));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        applicationService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @GetMapping("/{id}/impersonatable-users")
    public ResponseEntity<ApiResponse<List<Member>>> getImpersonatableUsers(@PathVariable Long id) {
        Role flowTester = roleRepository.findBySlug("flow_tester").orElse(null);
        if (flowTester == null) {
            return ResponseEntity.ok(ApiResponse.ok(Collections.emptyList()));
        }
        List<Long> userIds = roleUserRepository.findByRoleId(flowTester.getId())
                .stream().map(RoleUser::getUserId).toList();
        if (userIds.isEmpty()) {
            return ResponseEntity.ok(ApiResponse.ok(Collections.emptyList()));
        }
        List<Member> members = memberRepository.findByUserIdIn(userIds);
        return ResponseEntity.ok(ApiResponse.ok(members));
    }
}