package com.luban.workflow.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class DataInitializer implements CommandLineRunner {

    private final TestDataService testDataService;

    @Override
    public void run(String... args) {
        log.info("启动时初始化全局测试组织数据...");
        testDataService.ensureGlobalOrgData();
        log.info("全局测试组织数据就绪（角色数据按应用懒加载，由 TestDataService.initApplicationRoles 提供）");
    }
}