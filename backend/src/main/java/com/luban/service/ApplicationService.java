package com.luban.service;

import com.luban.dto.CreateAppRequest;
import com.luban.entity.Application;
import com.luban.entity.CodePage;
import com.luban.entity.Page;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.CodePageRepository;
import com.luban.repository.PageRepository;
import com.luban.workflow.config.TestDataService;
import com.luban.workflow.repository.WorkflowDefinitionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class ApplicationService {

    private final ApplicationRepository applicationRepository;
    private final PageRepository pageRepository;
    private final CodePageRepository codePageRepository;
    private final WorkflowDefinitionRepository workflowDefinitionRepository;
    private final TestDataService testDataService;

    public ApplicationService(ApplicationRepository applicationRepository,
                              PageRepository pageRepository,
                              CodePageRepository codePageRepository,
                              WorkflowDefinitionRepository workflowDefinitionRepository,
                              TestDataService testDataService) {
        this.applicationRepository = applicationRepository;
        this.pageRepository = pageRepository;
        this.codePageRepository = codePageRepository;
        this.workflowDefinitionRepository = workflowDefinitionRepository;
        this.testDataService = testDataService;
    }

    public List<Application> listByCreatedBy(Long userId) {
        List<Application> myApps = applicationRepository.findByCreatedBy(userId);
        for (Application app : myApps) {
            app.setWorkflowCount(workflowDefinitionRepository.countByApplicationId(app.getId()));
            app.setPublishedWorkflowCount(workflowDefinitionRepository.countByApplicationIdAndStatus(app.getId(), "PUBLISHED"));
        }

        List<Application> otherApps = applicationRepository.findAllWithPublishedWorkflows();
        List<Application> others = new ArrayList<>();
        for (Application app : otherApps) {
            if (!app.getCreatedBy().equals(userId)) {
                app.setWorkflowCount(workflowDefinitionRepository.countByApplicationId(app.getId()));
                app.setPublishedWorkflowCount(workflowDefinitionRepository.countByApplicationIdAndStatus(app.getId(), "PUBLISHED"));
                others.add(app);
            }
        }

        List<Application> result = new ArrayList<>(myApps);
        result.addAll(others);
        return result;
    }

    public Application getById(Long id) {
        return applicationRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("应用不存在"));
    }

    @Transactional
    public Application create(CreateAppRequest request, Long userId) {
        Application app = new Application();
        app.setName(request.getName());
        app.setCreatedBy(userId);
        app.setSlug(generateSlug(request.getName()));
        app = applicationRepository.save(app);

        Page defaultPage = new Page();
        defaultPage.setName("Page1");
        defaultPage.setApplicationId(app.getId());
        defaultPage.setSlug("page1");
        defaultPage.setIsDefault(true);
        defaultPage = pageRepository.save(defaultPage);

        CodePage defaultCodePage = new CodePage();
        defaultCodePage.setPageId(defaultPage.getId());
        defaultCodePage.setHtml("""
                <div id="app">
                  <div class="welcome">
                    <div class="brand">LUBAN</div>
                    <h1>欢迎使用鲁班</h1>
                    <p class="desc">低代码应用构建平台，通过自然语言对话快速搭建页面、管理数据、设计流程</p>
                    <div class="features">
                      <div class="feature">
                        <div class="feature-icon">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                        </div>
                        <span>页面构建</span>
                      </div>
                      <div class="feature">
                        <div class="feature-icon">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/></svg>
                        </div>
                        <span>数据管理</span>
                      </div>
                      <div class="feature">
                        <div class="feature-icon">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                        <span>流程设计</span>
                      </div>
                    </div>
                  </div>
                </div>""");
        defaultCodePage.setCss("""
                * {
                  margin: 0;
                  padding: 0;
                  box-sizing: border-box;
                }

                body {
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                  background: #f7f8fa;
                  min-height: 100vh;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                }

                #app {
                  width: 100%;
                  max-width: 520px;
                  padding: 24px;
                }

                .welcome {
                  text-align: center;
                  padding: 56px 40px;
                  background: #fff;
                  border-radius: 12px;
                  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
                }

                .brand {
                  font-size: 12px;
                  font-weight: 700;
                  letter-spacing: 5px;
                  color: #1677ff;
                  margin-bottom: 28px;
                }

                .welcome h1 {
                  font-size: 26px;
                  font-weight: 600;
                  color: #1e293b;
                  margin-bottom: 10px;
                  letter-spacing: -0.5px;
                }

                .desc {
                  font-size: 14px;
                  color: #64748b;
                  line-height: 1.7;
                  margin-bottom: 36px;
                  max-width: 360px;
                  margin-left: auto;
                  margin-right: auto;
                }

                .features {
                  display: flex;
                  justify-content: center;
                  gap: 32px;
                }

                .feature {
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  gap: 8px;
                  color: #94a3b8;
                  font-size: 12px;
                  font-weight: 500;
                }

                .feature-icon {
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  width: 44px;
                  height: 44px;
                  border-radius: 10px;
                  background: #f1f5f9;
                  color: #64748b;
                  transition: background 0.2s, color 0.2s;
                }

                .feature:hover .feature-icon {
                  background: #e6f4ff;
                  color: #1677ff;
                }""");
        defaultCodePage.setJs("""
                console.log("Luban Platform - Default Page");""");
        defaultCodePage.setLibraries("[]");
        defaultCodePage.setQueryIds("[]");
        codePageRepository.save(defaultCodePage);

        app.setDefaultPageId(defaultPage.getId());
        app = applicationRepository.save(app);

        testDataService.initApplicationRoles(app.getId());

        return app;
    }

    public Application update(Long id, String name) {
        Application app = applicationRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("应用不存在"));
        app.setName(name);
        app.setSlug(generateSlug(name));
        return applicationRepository.save(app);
    }

    @Transactional
    public void delete(Long id) {
        applicationRepository.deleteById(id);
    }

    private String generateSlug(String name) {
        String base = name.toLowerCase()
                .replaceAll("[^a-z0-9\\u4e00-\\u9fa5]+", "-")
                .replaceAll("^-|-$", "");
        if (base.isEmpty()) {
            base = "app";
        }
        return base + "-" + UUID.randomUUID().toString().substring(0, 6);
    }
}