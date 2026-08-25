package com.luban.service;

import com.luban.dto.AuthResponse;
import com.luban.dto.LoginRequest;
import com.luban.dto.RegisterRequest;
import com.luban.entity.User;
import com.luban.entity.UserSession;
import com.luban.repository.UserRepository;
import com.luban.repository.UserSessionRepository;
import com.luban.security.JwtTokenProvider;
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

    public AuthService(UserRepository userRepository,
                       UserSessionRepository userSessionRepository,
                       RoleUserRepository roleUserRepository,
                       RoleRepository roleRepository,
                       PasswordEncoder passwordEncoder,
                       JwtTokenProvider jwtTokenProvider) {
        this.userRepository = userRepository;
        this.userSessionRepository = userSessionRepository;
        this.roleUserRepository = roleUserRepository;
        this.roleRepository = roleRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtTokenProvider = jwtTokenProvider;
    }

    @Transactional
    public AuthResponse register(RegisterRequest request) {
        if (userRepository.existsByEmail(request.getEmail())) {
            throw new IllegalArgumentException("该邮箱已被注册");
        }

        User user = new User();
        user.setEmail(request.getEmail());
        user.setAccount(request.getAccount());
        user.setName(request.getAccount());
        user.setProvider("manual");
        user.setPassword(passwordEncoder.encode(request.getPassword()));
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

        if (!passwordEncoder.matches(request.getPassword(), user.getPassword())) {
            throw new IllegalArgumentException("邮箱或密码错误");
        }

        String token = jwtTokenProvider.generateToken(user);
        saveSession(user.getId(), token);
        boolean superAdmin = isSuperAdmin(user.getId());
        return new AuthResponse(token, new AuthResponse.UserInfo(user.getId(), user.getEmail(), user.getAccount(), superAdmin));
    }

    private boolean isSuperAdmin(Long userId) {
        List<Long> roleIds = roleUserRepository.findByUserId(userId).stream()
                .map(RoleUser::getRoleId)
                .toList();
        return roleRepository.findAllById(roleIds).stream()
                .anyMatch(r -> "super_admin".equals(r.getSlug()));
    }

    private void saveSession(Long userId, String token) {
        UserSession session = new UserSession();
        session.setUserId(userId);
        session.setToken(token);
        session.setExpiresAt(LocalDateTime.now().plusDays(7));
        userSessionRepository.save(session);
    }
}