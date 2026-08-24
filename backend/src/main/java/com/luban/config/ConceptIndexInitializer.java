package com.luban.config;

import com.luban.service.ConceptEmbeddingService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class ConceptIndexInitializer implements ApplicationRunner {

    private final ConceptEmbeddingService embeddingService;

    @Override
    public void run(ApplicationArguments args) {
        try {
            log.info("开始构建概念向量索引...");
            embeddingService.rebuildIndex();
            log.info("概念向量索引构建完成");
        } catch (Exception e) {
            log.warn("概念向量索引构建失败（可能 embedding 服务未启动）: {}", e.getMessage());
        }
    }
}