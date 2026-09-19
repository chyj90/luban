package com.luban.embedding;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.net.URI;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 语义服务（embedding-service）实例端点注册表。
 *
 * 多副本部署时构建类请求（FAISS build / 列索引 build）必须广播到**每一个** EB 实例，
 * 否则索引只落一个实例、检索随机 503 或返回旧结果。端点来源两种：
 * 1. `embedding.service.endpoints` 显式逗号分隔列表（优先）；
 * 2. 未配置时把 base-url 的主机名按 DNS A 记录展开为逐 Pod 地址——K8s 下把
 *    LUBAN_EMBEDDING_BASE_URL 指向 headless service 即可（如
 *    http://embedding-headless:8765）；单地址（compose/裸机）自动退化为单端点，行为不变。
 */
@Component
public class EmbeddingEndpointRegistry {

    private static final long CACHE_MS = 30_000;

    @Value("${embedding.service.url:http://localhost:8765}")
    private String baseUrl;

    @Value("${embedding.service.endpoints:}")
    private String explicitEndpoints;

    private volatile List<String> cached = List.of();
    private volatile long cachedAt = 0;

    /** 全部 EB 实例地址（构建广播 / 状态对账用），至少返回 [base-url]。 */
    public List<String> endpoints() {
        List<String> hit = cached;
        long now = System.currentTimeMillis();
        if (!hit.isEmpty() && now - cachedAt < CACHE_MS) {
            return hit;
        }
        List<String> resolved = resolve();
        cached = resolved;
        cachedAt = now;
        return resolved;
    }

    /** 检索类请求的目标：始终走 base-url（K8s Service/单实例地址）。 */
    public String primary() {
        return baseUrl;
    }

    private synchronized List<String> resolve() {
        if (explicitEndpoints != null && !explicitEndpoints.isBlank()) {
            return Arrays.stream(explicitEndpoints.split(","))
                    .map(String::trim).filter(s -> !s.isEmpty()).toList();
        }
        try {
            URI uri = URI.create(baseUrl);
            int port = uri.getPort() > 0 ? uri.getPort() : 8765;
            InetAddress[] addrs = InetAddress.getAllByName(uri.getHost());
            if (addrs.length <= 1) {
                return List.of(baseUrl);
            }
            List<String> out = new ArrayList<>();
            for (InetAddress addr : addrs) {
                out.add(uri.getScheme() + "://" + addr.getHostAddress() + ":" + port);
            }
            return out;
        } catch (Exception e) {
            return List.of(baseUrl);
        }
    }
}
