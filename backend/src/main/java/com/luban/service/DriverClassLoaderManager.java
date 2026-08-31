package com.luban.service;

import com.luban.util.DriverShim;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Driver;
import java.sql.DriverManager;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
public class DriverClassLoaderManager {

    private final Map<String, URLClassLoader> loaders = new ConcurrentHashMap<>();

    @PostConstruct
    public void init() {
        // 预加载 DriverManager，触发其静态初始化（ServiceLoader 扫描 JDBC 驱动）
        // 避免首次 registerDriver 时 DriverManager 类加载与 DriverManager 同步锁竞争
        log.info("预加载 DriverManager, 已注册驱动数: {}", DriverManager.getDrivers().hasMoreElements());
    }

    public synchronized void registerDriver(String driverName, String driverClass,
                                             List<Path> jarPaths) {
        if (loaders.containsKey(driverName)) {
            log.info("驱动 {} 已注册，先卸载旧版本", driverName);
            unregisterDriver(driverName);
        }

        log.info("注册驱动开始: {} ({}), JAR 数量: {}", driverName, driverClass, jarPaths.size());
        for (Path p : jarPaths) {
            log.info("  JAR: {}", p.getFileName());
        }

        URL[] urls = jarPaths.stream()
                .filter(Files::exists)
                .map(p -> {
                    try {
                        return p.toUri().toURL();
                    } catch (Exception e) {
                        throw new RuntimeException("无法转换 JAR 路径: " + p, e);
                    }
                })
                .toArray(URL[]::new);

        log.info("创建 URLClassLoader, parent: {}", getClass().getClassLoader());
        URLClassLoader loader = new URLClassLoader(urls, getClass().getClassLoader());
        try {
            log.info("加载驱动类: {}", driverClass);
            Class<?> clazz = loader.loadClass(driverClass);
            log.info("驱动类加载成功, 开始实例化");
            Driver driver = (Driver) clazz.getDeclaredConstructor().newInstance();
            log.info("驱动实例化成功, 创建 DriverShim");
            DriverShim shim = new DriverShim(driver);
            log.info("DriverShim 创建成功, 注册到 DriverManager");
            DriverManager.registerDriver(shim);
            log.info("DriverManager 注册成功");
            loaders.put(driverName, loader);
            log.info("驱动注册成功: {} ({}), 加载 {} 个 JAR", driverName, driverClass, jarPaths.size());
        } catch (Throwable e) {
            log.error("驱动注册失败: {}", driverName, e);
            try {
                loader.close();
            } catch (Exception ex) {
                log.warn("关闭 ClassLoader 失败", ex);
            }
            throw new RuntimeException("驱动注册失败: " + driverName, e);
        }
    }

    public void unregisterDriver(String driverName) {
        URLClassLoader loader = loaders.remove(driverName);
        if (loader != null) {
            try {
                var drivers = DriverManager.getDrivers();
                while (drivers.hasMoreElements()) {
                    Driver driver = drivers.nextElement();
                    if (driver instanceof DriverShim shim && driver.getClass().getClassLoader() == loader) {
                        DriverManager.deregisterDriver(shim);
                    }
                }
                loader.close();
                log.info("驱动卸载成功: {}", driverName);
            } catch (Exception e) {
                log.warn("卸载驱动失败: {}", driverName, e);
            }
        }
    }

    public boolean isLoaded(String driverName) {
        return loaders.containsKey(driverName);
    }

    @PreDestroy
    public void cleanup() {
        for (String name : loaders.keySet()) {
            unregisterDriver(name);
        }
        log.info("所有驱动 ClassLoader 已清理");
    }
}