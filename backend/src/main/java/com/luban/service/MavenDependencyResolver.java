package com.luban.service;

import lombok.extern.slf4j.Slf4j;
import org.apache.maven.model.Model;
import org.apache.maven.model.io.xpp3.MavenXpp3Reader;
import org.apache.maven.repository.internal.MavenRepositorySystemUtils;
import org.eclipse.aether.DefaultRepositorySystemSession;
import org.eclipse.aether.RepositorySystem;
import org.eclipse.aether.RepositorySystemSession;
import org.eclipse.aether.artifact.Artifact;
import org.eclipse.aether.artifact.DefaultArtifact;
import org.eclipse.aether.connector.basic.BasicRepositoryConnectorFactory;
import org.eclipse.aether.impl.DefaultServiceLocator;
import org.eclipse.aether.repository.LocalRepository;
import org.eclipse.aether.repository.RemoteRepository;
import org.eclipse.aether.resolution.ArtifactRequest;
import org.eclipse.aether.resolution.ArtifactResult;
import org.eclipse.aether.spi.connector.RepositoryConnectorFactory;
import org.eclipse.aether.spi.connector.transport.TransporterFactory;
import org.eclipse.aether.transfer.AbstractTransferListener;
import org.eclipse.aether.transfer.TransferEvent;
import org.eclipse.aether.transport.file.FileTransporterFactory;
import org.eclipse.aether.transport.http.HttpTransporterFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.function.Consumer;

@Slf4j
@Component
public class MavenDependencyResolver {

    private final String repoUrl;
    private final String fallbackUrl;
    private final int connectTimeout;
    private final int readTimeout;
    private final RepositorySystem repoSystem;

    private static final long MIN_FREE_SPACE = 100 * 1024 * 1024;

    public MavenDependencyResolver(
            @Value("${luban.drivers.maven.repo-url:https://repo1.maven.org/maven2/}") String repoUrl,
            @Value("${luban.drivers.maven.fallback-url:https://repo1.maven.org/maven2/}") String fallbackUrl,
            @Value("${luban.drivers.maven.connect-timeout:10000}") int connectTimeout,
            @Value("${luban.drivers.maven.read-timeout:30000}") int readTimeout) {
        this.repoUrl = repoUrl.endsWith("/") ? repoUrl : repoUrl + "/";
        this.fallbackUrl = fallbackUrl.endsWith("/") ? fallbackUrl : fallbackUrl + "/";
        this.connectTimeout = connectTimeout;
        this.readTimeout = readTimeout;
        this.repoSystem = createRepositorySystem();
    }

    private static RepositorySystem createRepositorySystem() {
        DefaultServiceLocator locator = MavenRepositorySystemUtils.newServiceLocator();
        locator.addService(RepositoryConnectorFactory.class, BasicRepositoryConnectorFactory.class);
        locator.addService(TransporterFactory.class, HttpTransporterFactory.class);
        locator.addService(TransporterFactory.class, FileTransporterFactory.class);
        return locator.getService(RepositorySystem.class);
    }

    public List<Path> resolve(String groupId, String artifactId, String version,
                              String classifier, Path targetDir,
                              Consumer<DownloadProgress> progressCallback) {
        checkDiskSpace(targetDir);

        progressCallback.accept(DownloadProgress.info("解析依赖: " + groupId + ":" + artifactId + ":" + version));

        Path localRepoPath = targetDir.resolve(".m2-repository");
        RepositorySystemSession session = createSession(localRepoPath, progressCallback);

        List<RemoteRepository> repos = List.of(
                new RemoteRepository.Builder("central", "default", repoUrl).build(),
                new RemoteRepository.Builder("fallback", "default", fallbackUrl).build(),
                new RemoteRepository.Builder("maven-central", "default", "https://repo1.maven.org/maven2/").build()
        );

        try {
            // 指定了 classifier（如 standalone），直接下载该 JAR，跳过依赖解析
            if (classifier != null && !classifier.isEmpty()) {
                List<Path> jars = new ArrayList<>();
                Artifact jarArtifact = new DefaultArtifact(groupId, artifactId, classifier, "jar", version);
                downloadAndCopy(jarArtifact, targetDir, session, repos, jars, progressCallback);
                progressCallback.accept(DownloadProgress.info("使用 " + classifier + " JAR，跳过依赖解析"));
                return jars;
            }

            // 无指定 classifier 时，优先尝试 all-in-one 胖包
            try {
                List<Path> allJars = new ArrayList<>();
                Artifact allArtifact = new DefaultArtifact(groupId, artifactId, "all", "jar", version);
                downloadAndCopy(allArtifact, targetDir, session, repos, allJars, progressCallback);
                if (!allJars.isEmpty()) {
                    progressCallback.accept(DownloadProgress.info("使用 all-in-one JAR，跳过依赖解析"));
                    return allJars;
                }
            } catch (Exception e) {
                log.info("all classifier JAR 不存在，回退到常规依赖解析: {}", e.getMessage());
            }

            // 常规路径：下载 JAR + 递归解析 POM 依赖
            Set<String> resolved = new HashSet<>();
            List<Path> jars = new ArrayList<>();

            resolveRecursive(groupId, artifactId, version, null, "compile",
                    targetDir, localRepoPath, session, repos, resolved, jars, progressCallback);

            progressCallback.accept(DownloadProgress.info(
                    "依赖解析完成，共 " + jars.size() + " 个 JAR"));
            return jars;

        } catch (Throwable e) {
            log.error("Maven 依赖解析失败: {}:{}:{}", groupId, artifactId, version, e);
            throw new RuntimeException("依赖解析失败: " + e.getMessage(), e);
        }
    }

    private void resolveRecursive(String groupId, String artifactId, String version,
                                  String classifier, String parentScope,
                                  Path targetDir, Path localRepoPath,
                                  RepositorySystemSession session, List<RemoteRepository> repos,
                                  Set<String> resolved, List<Path> jars,
                                  Consumer<DownloadProgress> progressCallback) {
        String coord = groupId + ":" + artifactId + ":" + version
                + (classifier != null ? ":" + classifier : "");
        if (!resolved.add(coord)) {
            return;
        }

        Artifact jarArtifact = (classifier != null && !classifier.isEmpty())
                ? new DefaultArtifact(groupId, artifactId, classifier, "jar", version)
                : new DefaultArtifact(groupId, artifactId, "jar", version);

        try {
            downloadAndCopy(jarArtifact, targetDir, session, repos, jars, progressCallback);
        } catch (Throwable e) {
            log.warn("JAR 下载失败: {}, 继续尝试解析 POM 依赖", coord);
        }

        Artifact pomArtifact = new DefaultArtifact(groupId, artifactId, "pom", version);
        try {
            downloadAndCopy(pomArtifact, localRepoPath, session, repos, new ArrayList<>(), progressCallback);
        } catch (Throwable e) {
            log.warn("POM 下载失败: {}, 跳过依赖解析", coord);
            return;
        }

        Path pomFile = localRepoPath.resolve(
                session.getLocalRepositoryManager().getPathForLocalArtifact(pomArtifact));
        if (!Files.exists(pomFile)) {
            return;
        }

        Model model;
        try (InputStream is = Files.newInputStream(pomFile)) {
            MavenXpp3Reader reader = new MavenXpp3Reader();
            model = reader.read(is);
        } catch (Exception e) {
            log.warn("POM 解析失败: {}", pomFile, e);
            return;
        }

        Map<String, String> depVersionMap = new HashMap<>();
        if (model.getDependencyManagement() != null && model.getDependencyManagement().getDependencies() != null) {
            for (org.apache.maven.model.Dependency dm : model.getDependencyManagement().getDependencies()) {
                String dmKey = dm.getGroupId() + ":" + dm.getArtifactId();
                depVersionMap.put(dmKey, dm.getVersion());
            }
            log.debug("dependencyManagement 解析到 {} 个版本定义", depVersionMap.size());
        }

        if (model.getDependencies() == null) {
            return;
        }

        log.info("POM {} 解析到 {} 个直接依赖", coord, model.getDependencies().size());
        for (org.apache.maven.model.Dependency dep : model.getDependencies()) {
            String scope = dep.getScope() != null ? dep.getScope() : "compile";

            String effectiveScope = mediateScope(parentScope, scope);
            if (effectiveScope == null) {
                log.debug("  跳过 {}:{} (scope={})", dep.getGroupId(), dep.getArtifactId(), scope);
                continue;
            }

            String depVersion = resolveProperties(dep.getVersion(), model.getProperties());
            if (depVersion == null) {
                String dmKey = dep.getGroupId() + ":" + dep.getArtifactId();
                depVersion = depVersionMap.get(dmKey);
                if (depVersion == null) {
                    log.warn("依赖 {}:{} 缺少版本号（dependencyManagement 中也未找到），跳过", dep.getGroupId(), dep.getArtifactId());
                    continue;
                }
                log.debug("依赖 {}:{} 从 dependencyManagement 获取版本: {}", dep.getGroupId(), dep.getArtifactId(), depVersion);
            }

            log.info("  -> {}:{}:{} (scope={}, optional={})", dep.getGroupId(), dep.getArtifactId(), depVersion, scope, dep.isOptional());
            resolveRecursive(dep.getGroupId(), dep.getArtifactId(), depVersion,
                    null, effectiveScope,
                    targetDir, localRepoPath, session, repos, resolved, jars, progressCallback);
        }
    }

    private String mediateScope(String parentScope, String childScope) {
        if (childScope.equals("test") || childScope.equals("system")) {
            return null;
        }
        if (childScope.equals("provided")) {
            return "compile";
        }
        if (childScope.equals("runtime")) {
            if (parentScope.equals("compile") || parentScope.equals("runtime")) {
                return parentScope;
            }
            return null;
        }
        if (childScope.equals("compile")) {
            return parentScope;
        }
        return null;
    }

    private String resolveProperties(String value, java.util.Properties props) {
        if (value == null || !value.contains("${")) {
            return value;
        }
        if (props == null || props.isEmpty()) {
            log.warn("无法解析属性引用 '{}'：POM 中无 properties 定义", value);
            return value;
        }
        StringBuilder result = new StringBuilder(value);
        int start = result.indexOf("${");
        while (start >= 0) {
            int end = result.indexOf("}", start);
            if (end < 0) break;
            String key = result.substring(start + 2, end);
            String propValue = props.getProperty(key);
            if (propValue != null) {
                result.replace(start, end + 1, propValue);
                start = result.indexOf("${", start);
            } else {
                log.warn("无法解析属性 '{}'，POM 中未定义: {}", key, value);
                start = result.indexOf("${", end);
            }
        }
        return result.toString();
    }

    private void downloadAndCopy(Artifact artifact, Path targetDir,
                                 RepositorySystemSession session, List<RemoteRepository> repos,
                                 List<Path> jars, Consumer<DownloadProgress> progressCallback) {
        String fileName = artifact.getArtifactId() + "-" + artifact.getVersion()
                + (artifact.getClassifier() != null && !artifact.getClassifier().isEmpty()
                        ? "-" + artifact.getClassifier() : "")
                + "." + artifact.getExtension();

        Path target = targetDir.resolve(fileName);
        if (Files.exists(target)) {
            progressCallback.accept(DownloadProgress.done(fileName));
            jars.add(target);
            return;
        }

        ArtifactRequest request = new ArtifactRequest();
        request.setArtifact(artifact);
        repos.forEach(request::addRepository);

        try {
            ArtifactResult result = repoSystem.resolveArtifact(session, request);
            if (result.isResolved() && result.getArtifact().getFile() != null) {
                Path source = result.getArtifact().getFile().toPath();
                Path parent = target.getParent();
                if (parent != null) {
                    Files.createDirectories(parent);
                }
                Files.copy(source, target);
                jars.add(target);
                progressCallback.accept(DownloadProgress.done(fileName));
            }
        } catch (Throwable e) {
            throw new RuntimeException("下载失败: " + fileName + " - " + e.getMessage(), e);
        }
    }

    private RepositorySystemSession createSession(Path localRepoPath,
                                               Consumer<DownloadProgress> progressCallback) {
        DefaultRepositorySystemSession session = MavenRepositorySystemUtils.newSession();

        LocalRepository localRepo = new LocalRepository(localRepoPath.toFile());
        session.setLocalRepositoryManager(repoSystem.newLocalRepositoryManager(session, localRepo));

        session.setTransferListener(new AbstractTransferListener() {
            @Override
            public void transferStarted(TransferEvent event) {
                String name = event.getResource().getResourceName();
                String fileName = name.substring(name.lastIndexOf('/') + 1);
                progressCallback.accept(DownloadProgress.info("下载: " + fileName));
            }

            @Override
            public void transferSucceeded(TransferEvent event) {
                String name = event.getResource().getResourceName();
                String fileName = name.substring(name.lastIndexOf('/') + 1);
                progressCallback.accept(DownloadProgress.done(fileName));
            }

            @Override
            public void transferFailed(TransferEvent event) {
                String repoUrl = event.getResource().getRepositoryUrl();
                String name = event.getResource().getResourceName();
                String fullUrl = (repoUrl != null ? repoUrl : "") + name;
                if (!name.endsWith(".pom")) {
                    log.warn("下载失败: {}", fullUrl);
                }
            }
        });

        session.setSystemProperties(System.getProperties());
        session.setConfigProperties(System.getProperties());

        System.setProperty("aether.connector.connectTimeout", String.valueOf(connectTimeout));
        System.setProperty("aether.connector.requestTimeout", String.valueOf(readTimeout));

        return session;
    }

    private void checkDiskSpace(Path targetDir) {
        try {
            long free = Files.getFileStore(targetDir).getUsableSpace();
            if (free < MIN_FREE_SPACE) {
                throw new RuntimeException(String.format(
                        "磁盘空间不足，可用 %.1f MB，需要至少 %d MB",
                        free / (1024.0 * 1024.0), MIN_FREE_SPACE / (1024 * 1024)));
            }
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            log.warn("无法检查磁盘空间: {}", e.getMessage());
        }
    }
}