package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.dto.PageResult;
import com.luban.dto.UserVO;
import com.luban.entity.User;
import com.luban.entity.UserDept;
import com.luban.repository.UserDeptRepository;
import com.luban.repository.UserRepository;
import com.luban.workflow.entity.Role;
import com.luban.workflow.entity.RoleUser;
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

        long total = userRepository.countUsersWithDeptInfo(kw, af);
        List<Object[]> rows = userRepository.findUsersWithDeptInfoPage(kw, af, pageSize, offset);
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
            Sheet sheet = workbook.createSheet("用户导入模板");
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

            String filename = URLEncoder.encode("用户导入模板.xlsx", StandardCharsets.UTF_8)
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
    public ResponseEntity<ApiResponse<ImportResult>> importUsers(@RequestParam("file") MultipartFile file) {
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

                if (email == null || email.isBlank()) {
                    email = name + "@luban.local";
                }
                if (userRepository.existsByEmail(email)) {
                    errors.add("第" + (i + 1) + "行: 用户 " + email + " 已存在，跳过");
                    skipped++;
                    continue;
                }

                User user = new User();
                user.setName(name);
                user.setEmail(email);
                user.setAccount(name);
                user.setMobile(mobile);
                user.setPosition(position);
                user.setEmployeeNo(employeeNo);
                user.setProvider("import");
                user.setStatus("ACTIVE");
                userRepository.save(user);
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

    @PutMapping("/{userId}/role")
    public ResponseEntity<ApiResponse<Void>> updateRole(
            @PathVariable Long userId,
            @RequestBody List<Long> roleIds) {
        roleUserRepository.deleteByUserId(userId);
        for (Long roleId : roleIds) {
            roleUserRepository.save(new RoleUser(roleId, userId));
        }

        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @PutMapping("/{userId}/department")
    public ResponseEntity<ApiResponse<Void>> updateDepartment(
            @PathVariable Long userId,
            @RequestParam Long deptId) {
        UserDept ud = userDeptRepository.findByUserIdAndIsPrimaryTrue(userId).orElse(null);
        if (ud != null) {
            userDeptRepository.delete(ud);
        }
        ud = new UserDept();
        ud.setUserId(userId);
        ud.setDepartmentId(deptId);
        ud.setIsPrimary(true);
        userDeptRepository.save(ud);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @PutMapping("/{userId}/leader")
    public ResponseEntity<ApiResponse<Void>> updateLeader(
            @PathVariable Long userId,
            @RequestParam(required = false) Long leaderId) {
        UserDept ud = userDeptRepository.findByUserIdAndIsPrimaryTrue(userId)
                .orElseThrow(() -> new RuntimeException("用户未关联部门"));
        ud.setLeaderId(leaderId);
        userDeptRepository.save(ud);
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