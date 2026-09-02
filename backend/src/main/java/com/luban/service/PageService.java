package com.luban.service;

import com.luban.dto.CreateCodePageRequest;
import com.luban.dto.UpdateCodePageRequest;
import com.luban.entity.CodePage;
import com.luban.entity.Page;
import com.luban.repository.CodePageRepository;
import com.luban.repository.PageRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
public class PageService {

    private final PageRepository pageRepository;
    private final CodePageRepository codePageRepository;
    private final ObjectMapper objectMapper;

    public PageService(PageRepository pageRepository,
                       CodePageRepository codePageRepository,
                       ObjectMapper objectMapper) {
        this.pageRepository = pageRepository;
        this.codePageRepository = codePageRepository;
        this.objectMapper = objectMapper;
    }

    public List<Map<String, Object>> listByApplication(Long applicationId) {
        List<Page> pages = pageRepository.findByApplicationId(applicationId);
        List<Map<String, Object>> result = new ArrayList<>();
        for (Page page : pages) {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("id", page.getId());
            map.put("name", page.getName());
            map.put("applicationId", page.getApplicationId());
            map.put("slug", page.getSlug());
            map.put("isDefault", page.getIsDefault());
            map.put("createdAt", page.getCreatedAt());
            map.put("updatedAt", page.getUpdatedAt());
            result.add(map);
        }
        return result;
    }

    @Transactional
    public Map<String, Object> createCodePage(CreateCodePageRequest request) {
        Page page = new Page();
        page.setName(request.getName());
        page.setApplicationId(request.getApplicationId());
        page.setSlug(generateSlug(request.getName()));
        page.setIsDefault(false);
        page = pageRepository.save(page);

        CodePage codePage = new CodePage();
        codePage.setPageId(page.getId());
        codePage.setHtml(request.getHtml());
        codePage.setCss(request.getCss());
        codePage.setJs(request.getJs());
        codePage.setLibraries(toJson(request.getLibraries()));
        codePage.setQueryIds(toJson(request.getQueryIds()));
        codePage.setToolIds(toJson(request.getToolIds()));
        codePageRepository.save(codePage);

        return buildPageResponse(page, codePage);
    }

    public Map<String, Object> getCodePage(Long pageId) {
        Page page = pageRepository.findById(pageId)
                .orElseThrow(() -> new IllegalArgumentException("页面不存在"));
        CodePage codePage = codePageRepository.findByPageId(pageId)
                .orElseThrow(() -> new IllegalArgumentException("代码页面不存在"));
        return buildPageResponse(page, codePage);
    }

    @Transactional
    public Map<String, Object> updateCodePage(Long pageId, UpdateCodePageRequest request) {
        Page page = pageRepository.findById(pageId)
                .orElseThrow(() -> new IllegalArgumentException("页面不存在"));
        CodePage codePage = codePageRepository.findByPageId(pageId)
                .orElseThrow(() -> new IllegalArgumentException("代码页面不存在"));

        if (request.getHtml() != null) codePage.setHtml(request.getHtml());
        if (request.getCss() != null) codePage.setCss(request.getCss());
        if (request.getJs() != null) codePage.setJs(request.getJs());
        if (request.getLibraries() != null) codePage.setLibraries(toJson(request.getLibraries()));
        if (request.getQueryIds() != null) codePage.setQueryIds(toJson(request.getQueryIds()));
        if (request.getToolIds() != null) codePage.setToolIds(toJson(request.getToolIds()));
        codePageRepository.save(codePage);

        return buildPageResponse(page, codePage);
    }

    @Transactional
    public void delete(Long pageId) {
        pageRepository.deleteById(pageId);
    }

    @Transactional
    public Map<String, Object> renamePage(Long pageId, String name) {
        Page page = pageRepository.findById(pageId)
                .orElseThrow(() -> new IllegalArgumentException("页面不存在"));
        page.setName(name);
        page.setSlug(generateSlug(name));
        pageRepository.save(page);
        return pageToMap(page);
    }

    private Map<String, Object> pageToMap(Page page) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", page.getId());
        map.put("name", page.getName());
        map.put("applicationId", page.getApplicationId());
        map.put("slug", page.getSlug());
        map.put("isDefault", page.getIsDefault());
        map.put("createdAt", page.getCreatedAt());
        map.put("updatedAt", page.getUpdatedAt());
        return map;
    }

    private Map<String, Object> buildPageResponse(Page page, CodePage codePage) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", page.getId());
        result.put("name", page.getName());
        result.put("applicationId", page.getApplicationId());
        result.put("slug", page.getSlug());
        result.put("isDefault", page.getIsDefault());
        result.put("createdAt", page.getCreatedAt());
        result.put("updatedAt", page.getUpdatedAt());

        Map<String, Object> codePageData = new LinkedHashMap<>();
        codePageData.put("html", codePage.getHtml());
        codePageData.put("css", codePage.getCss());
        codePageData.put("js", codePage.getJs());
        codePageData.put("libraries", fromJsonList(codePage.getLibraries()));
        codePageData.put("queryIds", fromJsonLongList(codePage.getQueryIds()));
        codePageData.put("toolIds", fromJsonLongList(codePage.getToolIds()));
        result.put("codePage", codePageData);

        return result;
    }

    private String toJson(Object obj) {
        if (obj == null) return null;
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (JsonProcessingException e) {
            return null;
        }
    }

    private List<String> fromJsonList(String json) {
        if (json == null || json.isEmpty()) return List.of();
        try {
            return objectMapper.readValue(json, objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
        } catch (Exception e) {
            return List.of();
        }
    }

    private List<Long> fromJsonLongList(String json) {
        if (json == null || json.isEmpty()) return List.of();
        try {
            return objectMapper.readValue(json, objectMapper.getTypeFactory().constructCollectionType(List.class, Long.class));
        } catch (Exception e) {
            return List.of();
        }
    }

    private String generateSlug(String name) {
        return name.toLowerCase().replaceAll("[^a-z0-9\\u4e00-\\u9fa5]+", "-").replaceAll("^-|-$", "");
    }
}