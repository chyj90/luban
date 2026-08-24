package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.dto.PageResult;
import com.luban.dto.UserVO;
import com.luban.entity.User;
import com.luban.entity.UserDept;
import com.luban.repository.UserDeptRepository;
import com.luban.repository.UserRepository;
import com.luban.workflow.entity.Member;
import com.luban.workflow.entity.Role;
import com.luban.workflow.entity.RoleUser;
import com.luban.workflow.repository.MemberRepository;
import com.luban.workflow.repository.RoleRepository;
import com.luban.workflow.repository.RoleUserRepository;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@AllArgsConstructor
@Data
class SimpleUserVO {
    private Long id;
    private String account;
    private String email;
}

@RestController
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
public class UserController {

    private final MemberRepository memberRepository;
    private final UserRepository userRepository;
    private final UserDeptRepository userDeptRepository;
    private final RoleUserRepository roleUserRepository;
    private final RoleRepository roleRepository;
    private final PasswordEncoder passwordEncoder;

    private UserVO mapRowToVO(Object[] row) {
        UserVO vo = new UserVO();
        vo.setId(((Number) row[0]).longValue());
        vo.setDisplayName((String) row[1]);
        vo.setEmail((String) row[2]);
        vo.setMobile((String) row[3]);
        vo.setPosition((String) row[4]);
        vo.setEmployeeNo((String) row[5]);
        vo.setDeptId(row[6] != null ? ((Number) row[6]).longValue() : null);
        vo.setDeptName((String) row[7]);
        vo.setLeaderId(row[8] != null ? ((Number) row[8]).longValue() : null);
        vo.setUserId(row[9] != null ? ((Number) row[9]).longValue() : null);
        vo.setAccount((String) row[10]);
        if (row[11] != null) {
            vo.setCreatedAt(((Timestamp) row[11]).toLocalDateTime());
        }
        vo.setRoleId(row[12] != null ? ((Number) row[12]).longValue() : null);
        vo.setRoleName((String) row[13]);
        Object roleIdsRaw = row[14];
        vo.setRoleIds(roleIdsRaw != null ? String.valueOf(roleIdsRaw) : null);
        vo.setHasAccount(row[15] != null && ((Number) row[15]).intValue() == 1);
        return vo;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<PageResult<UserVO>>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String accountFilter) {
        String kw = (keyword != null && !keyword.isBlank()) ? keyword : null;
        String af = (accountFilter != null && !accountFilter.isBlank()) ? accountFilter : null;
        int offset = (page - 1) * pageSize;

        long total = memberRepository.countMembersWithUserInfo(kw, af);
        List<Object[]> rows = memberRepository.findMembersWithUserInfoPage(kw, af, pageSize, offset);
        List<UserVO> users = rows.stream().map(this::mapRowToVO).collect(Collectors.toList());

        int totalPages = (int) Math.ceil((double) total / pageSize);
        PageResult<UserVO> result = new PageResult<>(users, total, page, pageSize, totalPages);
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    @GetMapping("/simple")
    public ResponseEntity<ApiResponse<PageResult<SimpleUserVO>>> listSimple(
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int pageSize) {
        org.springframework.data.domain.Pageable pageable = org.springframework.data.domain.PageRequest.of(page - 1, pageSize);
        org.springframework.data.domain.Page<User> userPage;
        if (keyword != null && !keyword.isBlank()) {
            userPage = userRepository.findByAccountContainingIgnoreCaseOrEmailContainingIgnoreCase(keyword, keyword, pageable);
        } else {
            userPage = userRepository.findAll(pageable);
        }
        List<SimpleUserVO> list = userPage.getContent().stream()
                .map(u -> new SimpleUserVO(u.getId(), u.getAccount(), u.getEmail()))
                .toList();
        return ResponseEntity.ok(ApiResponse.ok(new PageResult<>(
                list, userPage.getTotalElements(), page, pageSize,
                userPage.getTotalPages())));
    }

    @GetMapping("/export-template")
    public ResponseEntity<byte[]> downloadTemplate() throws IOException {
        try (Workbook workbook = new XSSFWorkbook()) {
            Sheet sheet = workbook.createSheet("成员导入模板");
            Row header = sheet.createRow(0);
            String[] headers = {"姓名", "邮箱", "手机号", "职位", "工号", "部门名称"};
            CellStyle headerStyle = workbook.createCellStyle();
            headerStyle.setFillForegroundColor(IndexedColors.GREY_25_PERCENT.getIndex());
            headerStyle.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            Font headerFont = workbook.createFont();
            headerFont.setBold(true);
            headerStyle.setFont(headerFont);

            for (int i = 0; i < headers.length; i++) {
                Cell cell = header.createCell(i);
                cell.setCellValue(headers[i]);
                cell.setCellStyle(headerStyle);
            }

            Row sample = sheet.createRow(1);
            sample.createCell(0).setCellValue("张三");
            sample.createCell(1).setCellValue("zhangsan@example.com");
            sample.createCell(2).setCellValue("13800138000");
            sample.createCell(3).setCellValue("工程师");
            sample.createCell(4).setCellValue("EMP001");
            sample.createCell(5).setCellValue("技术部");

            for (int i = 0; i < headers.length; i++) {
                sheet.autoSizeColumn(i);
            }

            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            workbook.write(bos);
            byte[] bytes = bos.toByteArray();

            String filename = URLEncoder.encode("成员导入模板.xlsx", StandardCharsets.UTF_8)
                    .replace("+", "%20");
            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION,
                            "attachment; filename*=UTF-8''" + filename)
                    .contentType(MediaType.parseMediaType(
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                    .body(bytes);
        }
    }

    @PostMapping("/import")
    public ResponseEntity<ApiResponse<ImportResult>> importMembers(@RequestParam("file") MultipartFile file) {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(ApiResponse.error("请上传文件"));
        }

        try (InputStream is = file.getInputStream();
             Workbook workbook = WorkbookFactory.create(is)) {
            Sheet sheet = workbook.getSheetAt(0);
            int success = 0;
            int skipped = 0;
            List<String> errors = new ArrayList<>();

            for (int i = 1; i <= sheet.getLastRowNum(); i++) {
                Row row = sheet.getRow(i);
                if (row == null) continue;

                String name = getCellString(row, 0);
                if (name == null || name.isBlank()) {
                    errors.add("第" + (i + 1) + "行: 姓名为空，跳过");
                    skipped++;
                    continue;
                }

                String email = getCellString(row, 1);
                String mobile = getCellString(row, 2);
                String position = getCellString(row, 3);
                String employeeNo = getCellString(row, 4);
                String deptName = getCellString(row, 5);

                boolean exists = memberRepository.findByNameContaining(name).stream()
                        .anyMatch(m -> m.getName().equals(name));
                if (exists) {
                    errors.add("第" + (i + 1) + "行: 成员 " + name + " 已存在，跳过");
                    skipped++;
                    continue;
                }

                Member member = new Member();
                member.setName(name);
                member.setEmail(email != null ? email : name + "@luban.local");
                member.setMobile(mobile);
                member.setPosition(position);
                member.setEmployeeNo(employeeNo);
                member.setDepartmentName(deptName);
                member.setProvider("import");
                member.setStatus("ACTIVE");
                member.setSyncedAt(LocalDateTime.now());
                memberRepository.save(member);
                success++;
            }

            ImportResult result = new ImportResult(success, skipped, errors);
            return ResponseEntity.ok(ApiResponse.ok(result));
        } catch (IOException e) {
            return ResponseEntity.badRequest().body(ApiResponse.error("文件解析失败: " + e.getMessage()));
        }
    }

    private String getCellString(Row row, int col) {
        Cell cell = row.getCell(col);
        if (cell == null) return null;
        return switch (cell.getCellType()) {
            case STRING -> cell.getStringCellValue().trim();
            case NUMERIC -> {
                double val = cell.getNumericCellValue();
                yield val == (long) val ? String.valueOf((long) val) : String.valueOf(val);
            }
            case BOOLEAN -> String.valueOf(cell.getBooleanCellValue());
            default -> null;
        };
    }

    @PostMapping("/from-member/{memberId}")
    public ResponseEntity<ApiResponse<UserVO>> createFromMember(
            @PathVariable Long memberId,
            @RequestParam(defaultValue = "normal") String userType) {
        Member member = memberRepository.findById(memberId)
                .orElseThrow(() -> new RuntimeException("成员不存在: " + memberId));

        if (member.getUserId() != null) {
            throw new RuntimeException("该成员已是平台用户");
        }

        User user = new User();
        user.setEmail(member.getEmail() != null ? member.getEmail() : "member_" + memberId + "@luban.local");
        user.setAccount(member.getName());

        if ("test".equals(userType)) {
            user.setPassword(null);
        } else {
            user.setPassword(passwordEncoder.encode("luban123"));
        }
        userRepository.save(user);

        member.setUserId(user.getId());
        memberRepository.save(member);

        if ("test".equals(userType)) {
            roleUserRepository.deleteByUserId(user.getId());
            roleRepository.findBySlug("flow_tester").ifPresent(role -> {
                RoleUser ru = new RoleUser();
                ru.setRoleId(role.getId());
                ru.setUserId(user.getId());
                roleUserRepository.save(ru);
            });
        } else {
            roleRepository.findBySlug("user").ifPresent(role -> {
                RoleUser ru = new RoleUser();
                ru.setRoleId(role.getId());
                ru.setUserId(user.getId());
                roleUserRepository.save(ru);
            });
        }

        List<Object[]> rows = memberRepository.findAllMembersWithUserInfo();
        UserVO vo = rows.stream()
                .filter(row -> ((Number) row[0]).longValue() == memberId)
                .findFirst()
                .map(this::mapRowToVO)
                .orElseThrow(() -> new RuntimeException("查询失败"));

        return ResponseEntity.ok(ApiResponse.ok(vo));
    }

    @PutMapping("/{userId}/role")
    public ResponseEntity<ApiResponse<Void>> updateRole(
            @PathVariable Long userId,
            @RequestBody List<Long> roleIds) {
        List<Role> roles = roleRepository.findAllById(roleIds);
        boolean hasFlowTester = roles.stream().anyMatch(r -> "flow_tester".equals(r.getSlug()));

        if (hasFlowTester && roleIds.size() > 1) {
            return ResponseEntity.badRequest().body(ApiResponse.error("流程测试角色不能与其他角色同时选择"));
        }

        boolean alreadyFlowTester = roleUserRepository.findByRoleIdAndUserId(
                roleRepository.findBySlug("flow_tester").map(Role::getId).orElse(-1L), userId).isPresent();
        if (alreadyFlowTester) {
            return ResponseEntity.badRequest().body(ApiResponse.error("该用户已是流程测试角色，不可更改"));
        }

        roleUserRepository.deleteByUserId(userId);
        for (Long roleId : roleIds) {
            roleUserRepository.save(new RoleUser(roleId, userId));
        }

        if (hasFlowTester) {
            userRepository.findById(userId).ifPresent(u -> {
                u.setPassword(null);
                userRepository.save(u);
            });
        }

        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @PutMapping("/{userId}/department")
    public ResponseEntity<ApiResponse<Void>> updateDepartment(
            @PathVariable Long userId,
            @RequestParam Long deptId) {
        List<UserDept> existing = userDeptRepository.findByUserId(userId);
        if (!existing.isEmpty()) {
            userDeptRepository.deleteByUserIdAndDepartmentId(userId, existing.get(0).getDepartmentId());
        }
        UserDept ud = new UserDept();
        ud.setUserId(userId);
        ud.setDepartmentId(deptId);
        userDeptRepository.save(ud);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @PutMapping("/{userId}/leader")
    public ResponseEntity<ApiResponse<Void>> updateLeader(
            @PathVariable Long userId,
            @RequestParam(required = false) Long leaderId) {
        Member member = memberRepository.findByUserId(userId)
                .orElseThrow(() -> new RuntimeException("成员不存在"));
        member.setLeaderId(leaderId);
        memberRepository.save(member);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    public static class ImportResult {
        public int success;
        public int skipped;
        public List<String> errors;

        public ImportResult(int success, int skipped, List<String> errors) {
            this.success = success;
            this.skipped = skipped;
            this.errors = errors;
        }
    }
}