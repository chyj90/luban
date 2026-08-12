package com.luban.repository;

import com.luban.entity.JsFunction;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface JsFunctionRepository extends JpaRepository<JsFunction, Long> {
    List<JsFunction> findByPageId(Long pageId);
    void deleteByPageId(Long pageId);
}