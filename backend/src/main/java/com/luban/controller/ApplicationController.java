package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.dto.CreateAppRequest;
import com.luban.entity.Application;
import com.luban.entity.User;
import com.luban.repository.UserRepository;
import com.luban.security.ImpersonationFilter;
import com.luban.service.ApplicationService;
import com.luban.workflow.entity.Member;
import com.luban.workflow.repository.MemberRepository;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/applications")
public class ApplicationController {

    private final ApplicationService applicationService;
    private final UserRepository userRepository;
    private final MemberRepository memberRepository;

    public ApplicationController(ApplicationService applicationService, UserRepository userRepository,
                                 MemberRepository memberRepository) {
        this.applicationService = applicationService;
        this.userRepository = userRepository;
        this.memberRepository = memberRepository;
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
    public ResponseEntity<ApiResponse<List<Member>>> getImpersonatableUsers(
            @PathVariable Long id,
            @AuthenticationPrincipal User currentUser,
            jakarta.servlet.http.HttpServletRequest request) {
        Application app = applicationService.getById(id);
        User checkUser = (User) request.getAttribute(ImpersonationFilter.ORIGINAL_USER_ATTRIBUTE);
        if (checkUser == null) {
            checkUser = currentUser;
        }
        if (!app.getCreatedBy().equals(checkUser.getId())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiResponse.error("只有应用创建者才能查看可模拟用户"));
        }
        List<Member> members = memberRepository.findAll();
        return ResponseEntity.ok(ApiResponse.ok(members));
    }
}