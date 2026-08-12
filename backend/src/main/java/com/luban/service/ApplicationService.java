package com.luban.service;

import com.luban.dto.CreateAppRequest;
import com.luban.entity.Application;
import com.luban.entity.CodePage;
import com.luban.entity.Page;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.CodePageRepository;
import com.luban.repository.PageRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class ApplicationService {

    private final ApplicationRepository applicationRepository;
    private final PageRepository pageRepository;
    private final CodePageRepository codePageRepository;

    public ApplicationService(ApplicationRepository applicationRepository,
                              PageRepository pageRepository,
                              CodePageRepository codePageRepository) {
        this.applicationRepository = applicationRepository;
        this.pageRepository = pageRepository;
        this.codePageRepository = codePageRepository;
    }

    public List<Application> listByWorkspace(Long workspaceId) {
        return applicationRepository.findByWorkspaceId(workspaceId);
    }

    public Application getById(Long id) {
        return applicationRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("应用不存在"));
    }

    @Transactional
    public Application create(CreateAppRequest request) {
        Application app = new Application();
        app.setName(request.getName());
        app.setWorkspaceId(request.getWorkspaceId());
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
                  <div class="card">
                    <div class="avatar">🏗️</div>
                    <h1 class="title">Hello, 鲁班!</h1>
                    <p class="subtitle">欢迎使用 Inteli 应用构建器</p>
                    <div class="counter">
                      <button class="btn btn-minus" id="btn-minus">−</button>
                      <span class="count" id="count">0</span>
                      <button class="btn btn-plus" id="btn-plus">+</button>
                    </div>
                    <p class="hint">点击上方按钮试试</p>
                  </div>
                  <div class="footer">
                    <span>拖拽组件或直接编写代码来构建你的页面</span>
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
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  min-height: 100vh;
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
                }

                #app {
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  gap: 24px;
                }

                .card {
                  background: #ffffff;
                  border-radius: 16px;
                  padding: 48px 40px;
                  text-align: center;
                  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
                  min-width: 320px;
                  transition: transform 0.2s ease;
                }

                .card:hover {
                  transform: translateY(-2px);
                }

                .avatar {
                  font-size: 48px;
                  margin-bottom: 16px;
                }

                .title {
                  font-size: 28px;
                  font-weight: 700;
                  color: #1e293b;
                  margin-bottom: 8px;
                }

                .subtitle {
                  font-size: 14px;
                  color: #64748b;
                  margin-bottom: 32px;
                }

                .counter {
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  gap: 16px;
                  margin-bottom: 16px;
                }

                .btn {
                  width: 44px;
                  height: 44px;
                  border: none;
                  border-radius: 12px;
                  font-size: 22px;
                  font-weight: 600;
                  cursor: pointer;
                  transition: all 0.15s ease;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                }

                .btn-minus {
                  background: #fee2e2;
                  color: #dc2626;
                }

                .btn-minus:hover {
                  background: #fecaca;
                  transform: scale(1.05);
                }

                .btn-plus {
                  background: #dcfce7;
                  color: #16a34a;
                }

                .btn-plus:hover {
                  background: #bbf7d0;
                  transform: scale(1.05);
                }

                .count {
                  font-size: 36px;
                  font-weight: 700;
                  color: #1e293b;
                  min-width: 48px;
                  transition: color 0.2s ease;
                }

                .count.negative {
                  color: #dc2626;
                }

                .count.positive {
                  color: #16a34a;
                }

                .hint {
                  font-size: 12px;
                  color: #94a3b8;
                }

                .footer {
                  color: rgba(255, 255, 255, 0.8);
                  font-size: 13px;
                }""");
        defaultCodePage.setJs("""
                console.log("Hello, 鲁班!");

                document.addEventListener("DOMContentLoaded", () => {
                  const countEl = document.getElementById("count");
                  const btnMinus = document.getElementById("btn-minus");
                  const btnPlus = document.getElementById("btn-plus");
                  const title = document.querySelector(".title");

                  let count = 0;

                  function updateCount() {
                    countEl.textContent = count;
                    countEl.classList.remove("negative", "positive");
                    if (count < 0) countEl.classList.add("negative");
                    else if (count > 0) countEl.classList.add("positive");
                  }

                  btnMinus.addEventListener("click", () => {
                    count--;
                    updateCount();
                  });

                  btnPlus.addEventListener("click", () => {
                    count++;
                    updateCount();
                  });

                  title.addEventListener("click", () => {
                    title.textContent = "👋 Hello, Inteli!";
                    title.style.color = "#7c3aed";
                    setTimeout(() => {
                      title.textContent = "Hello, 鲁班!";
                      title.style.color = "#1e293b";
                    }, 1500);
                });
              });""");
        defaultCodePage.setLibraries("[]");
        defaultCodePage.setQueryIds("[]");
        codePageRepository.save(defaultCodePage);

        app.setDefaultPageId(defaultPage.getId());
        return applicationRepository.save(app);
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