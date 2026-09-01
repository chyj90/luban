package com.luban.service;

import com.luban.entity.JdbcDriver;
import com.luban.entity.JdbcDriverJar;
import com.luban.repository.JdbcDriverJarRepository;
import com.luban.repository.JdbcDriverRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Slf4j
@Service
@RequiredArgsConstructor
public class JdbcDriverService {

    private final JdbcDriverRepository driverRepository;
    private final JdbcDriverJarRepository jarRepository;
    private final MavenDependencyResolver mavenResolver;
    private final DriverClassLoaderManager classLoaderManager;
    private final PlatformTransactionManager transactionManager;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${luban.drivers.auto-load-on-startup:true}")
    private boolean autoLoadOnStartup;

    @Value("${luban.drivers.storage-path:drivers}")
    private String storagePath;

    private final ExecutorService installExecutor = Executors.newCachedThreadPool();

    @PostConstruct
    public void loadInstalledDrivers() {
        if (!autoLoadOnStartup) {
            log.info("auto-load-on-startup=false，跳过启动时驱动加载");
            return;
        }
        List<JdbcDriver> installed = driverRepository.findByInstalledTrue();
        for (JdbcDriver driver : installed) {
            try {
                Path driverDir = getDriverDir(driver.getName());
                if (Files.exists(driverDir)) {
                    List<Path> jars;
                    try (var stream = Files.list(driverDir)) {
                        jars = stream.filter(p -> p.toString().endsWith(".jar")).toList();
                    }
                    classLoaderManager.registerDriver(driver.getName(), driver.getDriverClass(), jars);
                    log.info("启动时加载驱动: {}", driver.getDisplayName());
                }
            } catch (Throwable e) {
                log.warn("启动时加载驱动失败: {} - {}", driver.getDisplayName(), e.getMessage());
            }
        }
    }

    public List<JdbcDriver> listAll() {
        List<JdbcDriver> drivers = driverRepository.findByEnabledTrue();
        for (JdbcDriver driver : drivers) {
            if (driver.getInstalled()) {
                Path driverDir = getDriverDir(driver.getName());
                if (!Files.exists(driverDir) || !hasJarFiles(driverDir)) {
                    driver.setInstalled(false);
                    driverRepository.save(driver);
                }
            }
        }
        return drivers;
    }

    public JdbcDriver getByName(String name) {
        return driverRepository.findByName(name)
                .orElseThrow(() -> new IllegalArgumentException("驱动不存在: " + name));
    }

    public SseEmitter install(String name) {
        JdbcDriver driver = getByName(name);
        if (Boolean.TRUE.equals(driver.getInstalled()) && classLoaderManager.isLoaded(name)) {
            SseEmitter done = new SseEmitter(1000L);
            try {
                done.send(SseEmitter.event().name("complete").data("已安装"));
                done.complete();
            } catch (IOException e) {
                done.completeWithError(e);
            }
            return done;
        }

        SseEmitter emitter = new SseEmitter(0L);
        CompletableFuture.runAsync(() -> {
            try {
                Path driverDir = getDriverDir(driver.getName());
                // 清理旧版本驱动文件
                if (Files.exists(driverDir)) {
                    try (var files = Files.walk(driverDir)) {
                        files.sorted(Comparator.reverseOrder())
                                .forEach(p -> { try { Files.deleteIfExists(p); } catch (IOException ignored) {} });
                    }
                }
                Files.createDirectories(driverDir);

                sendProgress(emitter, DownloadProgress.info("开始下载: " + driver.getDisplayName()));

                List<Path> jars = mavenResolver.resolve(
                        driver.getGroupId(), driver.getArtifactId(), driver.getVersion(),
                        driver.getClassifier(), driverDir,
                        progress -> sendProgress(emitter, progress));

                sendProgress(emitter, DownloadProgress.registering("注册驱动: " + driver.getDriverClass()));
                classLoaderManager.registerDriver(driver.getName(), driver.getDriverClass(), jars);

                new TransactionTemplate(transactionManager).execute(status -> {
                    saveJarRecords(driver.getId(), driver.getGroupId(), driver.getArtifactId(), driver.getVersion(), jars);
                    driver.setInstalled(true);
                    driverRepository.save(driver);
                    return null;
                });

                sendProgress(emitter, DownloadProgress.info("安装完成"));
                emitter.send(SseEmitter.event().name("complete").data("安装完成"));
                emitter.complete();
            } catch (Throwable e) {
                log.error("驱动安装失败: {} ({})", driver.getName(), e.getMessage(), e);
                try {
                    emitter.send(SseEmitter.event().name("error").data("安装失败: " + e.getMessage()));
                } catch (IOException ignored) {
                }
                emitter.complete();
            }
        }, installExecutor);

        return emitter;
    }

    private void sendProgress(SseEmitter emitter, DownloadProgress progress) {
        try {
            String json = objectMapper.writeValueAsString(progress);
            emitter.send(SseEmitter.event().name("progress").data(json));
        } catch (IOException e) {
            log.warn("SSE 推送失败: {}", e.getMessage());
        }
    }

    private void saveJarRecords(Long driverId, String groupId, String artifactId, String version, List<Path> jars) {
        jarRepository.deleteByDriverId(driverId);
        for (Path jar : jars) {
            JdbcDriverJar record = new JdbcDriverJar();
            record.setDriverId(driverId);
            record.setGroupId(groupId);
            record.setArtifactId(artifactId);
            record.setVersion(version);
            record.setFileName(jar.getFileName().toString());
            try {
                record.setFileSize(Files.size(jar));
            } catch (IOException ignored) {
            }
            record.setIsMain(false);
            jarRepository.save(record);
        }
        if (!jars.isEmpty()) {
            JdbcDriverJar main = jarRepository.findByDriverId(driverId).stream()
                    .filter(j -> j.getFileName().contains(artifactId))
                    .findFirst().orElse(null);
            if (main != null) {
                main.setIsMain(true);
                jarRepository.save(main);
            }
        }
    }

    public String buildJdbcUrl(String type, Map<String, Object> config) {
        if (config.containsKey("jdbcUrl") && config.get("jdbcUrl") != null
                && !String.valueOf(config.get("jdbcUrl")).isBlank()) {
            return String.valueOf(config.get("jdbcUrl"));
        }

        String host = String.valueOf(config.get("host"));
        Object portObj = config.get("port");
        String database = String.valueOf(config.getOrDefault("database", ""));

        return switch (type.toLowerCase()) {
            case "mysql" -> buildBuiltinUrl("jdbc:mysql://{host}:{port}/{database}?useSSL=false&allowPublicKeyRetrieval=true",
                    host, portObj, 3306, database);
            case "postgresql" -> buildBuiltinUrl("jdbc:postgresql://{host}:{port}/{database}",
                    host, portObj, 5432, database);
            case "rest_api" -> throw new IllegalArgumentException("REST API 类型不需要 JDBC URL");
            default -> {
                JdbcDriver driver = getByName(type);
                String url = driver.getJdbcUrlTemplate();
                for (var entry : config.entrySet()) {
                    String key = entry.getKey();
                    Object val = entry.getValue();
                    if (val == null) continue;
                    String strVal = String.valueOf(val);
                    if (strVal.isBlank()) continue;
                    url = url.replace("{" + key + "}", strVal);
                }
                if (portObj != null) {
                    url = url.replace("{port}", String.valueOf(portObj));
                } else {
                    url = url.replace("{port}", String.valueOf(driver.getDefaultPort()));
                }
                url = url.replace("{host}", host);
                yield url;
            }
        };
    }

    public String getDriverClass(String type) {
        return switch (type.toLowerCase()) {
            case "mysql" -> "com.mysql.cj.jdbc.Driver";
            case "postgresql" -> "org.postgresql.Driver";
            default -> getByName(type).getDriverClass();
        };
    }

    private String buildBuiltinUrl(String template, String host, Object portObj, int defaultPort, String database) {
        String port = portObj != null ? String.valueOf(portObj) : String.valueOf(defaultPort);
        return template.replace("{host}", host).replace("{port}", port).replace("{database}", database);
    }

    private Path getDriverDir(String driverName) {
        return Path.of(storagePath, driverName);
    }

    private boolean hasJarFiles(Path driverDir) {
        try (var stream = Files.list(driverDir)) {
            return stream.anyMatch(p -> p.toString().endsWith(".jar"));
        } catch (Exception e) {
            return false;
        }
    }
}