package com.luban.service;

import com.luban.dto.AuthResponse;
import com.luban.dto.ChangePasswordRequest;
import com.luban.dto.LoginRequest;
import com.luban.dto.RegisterRequest;
import com.luban.entity.User;
import com.luban.entity.UserDept;
import com.luban.entity.UserSession;
import com.luban.repository.UserDeptRepository;
import com.luban.repository.UserRepository;
import com.luban.repository.UserSessionRepository;
import com.luban.security.JwtTokenProvider;
import com.luban.security.RsaKeyProvider;
import com.luban.workflow.entity.RoleUser;
import com.luban.workflow.repository.RoleRepository;
import com.luban.workflow.repository.RoleUserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
public class AuthService {

    private final UserRepository userRepository;
    private final UserSessionRepository userSessionRepository;
    private final UserDeptRepository userDeptRepository;
    private final RoleUserRepository roleUserRepository;
    private final RoleRepository roleRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;
    private final RsaKeyProvider rsaKeyProvider;
    private final RoleConceptPermissionService roleConceptPermissionService;

    public AuthService(UserRepository userRepository,
                       UserSessionRepository userSessionRepository,
                       UserDeptRepository userDeptRepository,
                       RoleUserRepository roleUserRepository,
                       RoleRepository roleRepository,
                       PasswordEncoder passwordEncoder,
                       JwtTokenProvider jwtTokenProvider,
                       RsaKeyProvider rsaKeyProvider,
                       RoleConceptPermissionService roleConceptPermissionService) {
        this.userRepository = userRepository;
        this.userSessionRepository = userSessionRepository;
        this.userDeptRepository = userDeptRepository;
        this.roleUserRepository = roleUserRepository;
        this.roleRepository = roleRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtTokenProvider = jwtTokenProvider;
        this.rsaKeyProvider = rsaKeyProvider;
        this.roleConceptPermissionService = roleConceptPermissionService;
    }

    /** 登录用户完整档案（含主部门组织信息）：登录/注册/me 三个出口共用，保证平台身份口径一致 */
    public AuthResponse.UserInfo toUserInfo(User user) {
        Long deptId = userDeptRepository.findPrimaryDeptIdByUserId(user.getId()).orElse(null);
        String deptName = userDeptRepository.findPrimaryDeptNameByUserId(user.getId()).orElse(null);
        Long leaderId = userDeptRepository.findByUserIdAndIsPrimaryTrue(user.getId())
                .map(UserDept::getLeaderId).orElse(null);
        return AuthResponse.UserInfo.from(user, deptId, deptName, leaderId, isSuperAdmin(user.getId()));
    }

    /** 解密 rsa: 前缀密文，非密文原样返回 */
    private String decryptPassword(String raw) {
        if (raw != null && raw.startsWith(RsaKeyProvider.PREFIX)) {
            return rsaKeyProvider.decrypt(raw.substring(RsaKeyProvider.PREFIX.length()));
        }
        return raw;
    }

    @Transactional
    public AuthResponse register(RegisterRequest request) {
        if (userRepository.existsByEmail(request.getEmail())) {
            throw new IllegalArgumentException("该邮箱已被注册");
        }

        String plainPassword = decryptPassword(request.getPassword());
        if (plainPassword == null || plainPassword.length() < 6) {
            throw new IllegalArgumentException("密码至少 6 位");
        }

        User user = new User();
        user.setEmail(request.getEmail());
        user.setAccount(request.getAccount());
        user.setName(request.getAccount());
        user.setProvider("manual");
        user.setPassword(passwordEncoder.encode(plainPassword));
        userRepository.save(user);

        // 新注册用户默认绑定平台“普通用户”角色，获得基础权限（工作台/应用只读）
        roleRepository.findBySlug("user").ifPresent(role ->
                roleUserRepository.save(new RoleUser(role.getId(), user.getId())));

        String token = jwtTokenProvider.generateToken(user);
        saveSession(user.getId(), token);
        return new AuthResponse(token, toUserInfo(user));
    }

    @Transactional
    public AuthResponse login(LoginRequest request) {
        User user = userRepository.findByEmail(request.getEmail())
                .orElseThrow(() -> new IllegalArgumentException("邮箱或密码错误"));

        if (!passwordEncoder.matches(decryptPassword(request.getPassword()), user.getPassword())) {
            throw new IllegalArgumentException("邮箱或密码错误");
        }

        String token = jwtTokenProvider.generateToken(user);
        saveSession(user.getId(), token);
        return new AuthResponse(token, toUserInfo(user));
    }

    @Transactional
    public void changePassword(User currentUser, ChangePasswordRequest request) {
        String oldPwd = decryptPassword(request.getOldPassword());
        String newPwd = decryptPassword(request.getNewPassword());

        if (newPwd == null || newPwd.length() < 6) {
            throw new IllegalArgumentException("新密码至少 6 位");
        }

        if (!passwordEncoder.matches(oldPwd, currentUser.getPassword())) {
            throw new IllegalArgumentException("原密码错误");
        }

        if (oldPwd.equals(newPwd)) {
            throw new IllegalArgumentException("新密码不能与原密码相同");
        }

        currentUser.setPassword(passwordEncoder.encode(newPwd));
        userRepository.save(currentUser);
    }

    private boolean isSuperAdmin(Long userId) {
        return roleConceptPermissionService.isSuperAdmin(userId);
    }

    private void saveSession(Long userId, String token) {
        try {
            UserSession session = new UserSession();
            session.setUserId(userId);
            session.setToken(token);
            session.setExpiresAt(LocalDateTime.now().plusDays(7));
            userSessionRepository.save(session);
        } catch (org.springframework.dao.DataIntegrityViolationException e) {
            // 会话行非认证必需（JWT 自验证），唯一键冲突时忽略——登录不受影响
            org.slf4j.LoggerFactory.getLogger(AuthService.class)
                    .warn("Session save skipped (duplicate token): {}", e.getMessage());
        }
    }
}