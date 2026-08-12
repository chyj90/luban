package com.luban.service;

import com.luban.dto.CreateJsFunctionRequest;
import com.luban.entity.JsFunction;
import com.luban.repository.JsFunctionRepository;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class JsFunctionService {

    private final JsFunctionRepository jsFunctionRepository;

    public JsFunctionService(JsFunctionRepository jsFunctionRepository) {
        this.jsFunctionRepository = jsFunctionRepository;
    }

    public List<Map<String, Object>> listByPage(Long pageId) {
        List<JsFunction> functions = jsFunctionRepository.findByPageId(pageId);
        List<Map<String, Object>> result = new ArrayList<>();
        for (JsFunction fn : functions) {
            result.add(buildMap(fn));
        }
        return result;
    }

    public Map<String, Object> create(CreateJsFunctionRequest request) {
        JsFunction fn = new JsFunction();
        fn.setPageId(request.getPageId());
        fn.setName(request.getName());
        fn.setBody(request.getBody());
        fn = jsFunctionRepository.save(fn);
        return buildMap(fn);
    }

    private Map<String, Object> buildMap(JsFunction fn) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", fn.getId());
        map.put("pageId", fn.getPageId());
        map.put("name", fn.getName());
        map.put("body", fn.getBody());
        map.put("createdAt", fn.getCreatedAt());
        return map;
    }
}