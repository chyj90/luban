package com.luban.service;

import com.luban.dto.AuthResponse;
import com.luban.dto.ChangePasswordRequest;
import com.luban.dto.LoginRequest;
import com.luban.dto.RegisterRequest;
import com.luban.entity.User;
import com.luban.entity.UserSession;
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
    private final RoleUserRepository roleUserRepository;
    private final RoleRepository roleRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;
    private final RsaKeyProvider rsaKeyProvider;

    public AuthService(UserRepository userRepository,
                       UserSessionRepository userSessionRepository,
                       RoleUserRepository roleUserRepository,
                       RoleRepository roleRepository,
                       PasswordEncoder passwordEncoder,
                       JwtTokenProvider jwtTokenProvider,
                       RsaKeyProvider rsaKeyProvider) {
        this.userRepository = userRepository;
        this.userSessionRepository = userSessionRepository;
        this.roleUserRepository = roleUserRepository;
        this.roleRepository = roleRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtTokenProvider = jwtTokenProvider;
        this.rsaKeyProvider = rsaKeyProvider;
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

        String token = jwtTokenProvider.generateToken(user);
        saveSession(user.getId(), token);
        boolean superAdmin = isSuperAdmin(user.getId());
        return new AuthResponse(token, new AuthResponse.UserInfo(user.getId(), user.getEmail(), user.getAccount(), superAdmin));
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
        boolean superAdmin = isSuperAdmin(user.getId());
        return new AuthResponse(token, new AuthResponse.UserInfo(user.getId(), user.getEmail(), user.getAccount(), superAdmin));
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
        List<Long> roleIds = roleUserRepository.findByUserId(userId).stream()
                .map(RoleUser::getRoleId)
                .toList();
        return roleRepository.findAllById(roleIds).stream()
                .anyMatch(r -> "super_admin".equals(r.getSlug()));
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