package com.luban.service;

import com.luban.util.DriverShim;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

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

    public synchronized void registerDriver(String driverName, String driverClass,
                                             List<Path> jarPaths) {
        if (loaders.containsKey(driverName)) {
            log.info("驱动 {} 已注册，先卸载旧版本", driverName);
            unregisterDriver(driverName);
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

        URLClassLoader loader = new URLClassLoader(urls, getClass().getClassLoader());
        try {
            Class<?> clazz = loader.loadClass(driverClass);
            Driver driver = (Driver) clazz.getDeclaredConstructor().newInstance();
            DriverShim shim = new DriverShim(driver);
            DriverManager.registerDriver(shim);
            loaders.put(driverName, loader);
            log.info("驱动注册成功: {} ({}), 加载 {} 个 JAR", driverName, driverClass, jarPaths.size());
        } catch (Exception e) {
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