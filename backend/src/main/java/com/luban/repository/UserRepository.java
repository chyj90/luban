package com.luban.repository;

import com.luban.entity.User;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByEmail(String email);
    boolean existsByEmail(String email);
    Optional<User> findFirstByOrderByIdAsc();
    Page<User> findByAccountContainingIgnoreCaseOrEmailContainingIgnoreCase(String account, String email, Pageable pageable);
}