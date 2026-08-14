package com.luban.service;

import com.luban.dto.AuthResponse;
import com.luban.dto.LoginRequest;
import com.luban.dto.RegisterRequest;
import com.luban.entity.User;
import com.luban.entity.UserSession;
import com.luban.repository.UserRepository;
import com.luban.repository.UserSessionRepository;
import com.luban.security.JwtTokenProvider;
import com.luban.workflow.entity.Member;
import com.luban.workflow.repository.MemberRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@Service
public class AuthService {

    private final UserRepository userRepository;
    private final UserSessionRepository userSessionRepository;
    private final MemberRepository memberRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;

    public AuthService(UserRepository userRepository,
                       UserSessionRepository userSessionRepository,
                       MemberRepository memberRepository,
                       PasswordEncoder passwordEncoder,
                       JwtTokenProvider jwtTokenProvider) {
        this.userRepository = userRepository;
        this.userSessionRepository = userSessionRepository;
        this.memberRepository = memberRepository;
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
        user.setName(request.getName());
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        userRepository.save(user);

        Member member = memberRepository.findByEmail(request.getEmail()).orElse(null);
        if (member != null) {
            member.setUserId(user.getId());
            memberRepository.save(member);
        } else {
            member = new Member();
            member.setUserId(user.getId());
            member.setName(request.getName());
            member.setEmail(request.getEmail());
            member.setProvider("manual");
            memberRepository.save(member);
        }

        String token = jwtTokenProvider.generateToken(user);
        saveSession(user.getId(), token);
        return new AuthResponse(token, new AuthResponse.UserInfo(user.getId(), user.getEmail(), user.getName()));
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
        return new AuthResponse(token, new AuthResponse.UserInfo(user.getId(), user.getEmail(), user.getName()));
    }

    private void saveSession(Long userId, String token) {
        UserSession session = new UserSession();
        session.setUserId(userId);
        session.setToken(token);
        session.setExpiresAt(LocalDateTime.now().plusDays(7));
        userSessionRepository.save(session);
    }
}