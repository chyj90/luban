package com.luban.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.concurrent.ConcurrentHashMap;

/**
 * API KEY 外调频控：每 Key 滑动窗口（默认 10s 内 10 次）+ 日配额（默认 1000 次）。
 * 编排与查询两个外调入口（PublicOrchestrationController / PublicQueryController）共享
 * 同一实例，保证每 KEY 配额跨入口统一；超限抛 {@link RateLimitExceeded}
 * （SecurityException 子类，controller 侧统一转 429）。
 *
 * 多副本注意：配额按 Pod 生效，全局配额 = 配置值 × 副本数；多副本部署时按此校准
 * （{@code luban.apikey.rate-limit.*}）。
 */
@Component
public class ApiKeyRateLimiter {

    public static class RateLimitExceeded extends SecurityException {
        public RateLimitExceeded(String message) { super(message); }
    }

    private static final int RATE_LIMIT_WINDOW_MS = 10_000;
    private final int rateLimitMax;
    private final int dailyQuota;
    private final ConcurrentHashMap<Long, java.util.ArrayDeque<Long>> invokeTimestamps =
            new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Integer> dailyInvokeCount =
            new ConcurrentHashMap<>();
    private volatile LocalDate dailyCountDate = LocalDate.now();

    public ApiKeyRateLimiter(
            @Value("${luban.apikey.rate.limit.max:10}") int rateLimitMax,
            @Value("${luban.apikey.rate.limit.daily.quota:1000}") int dailyQuota) {
        this.rateLimitMax = rateLimitMax;
        this.dailyQuota = dailyQuota;
    }

    public void check(Long apiKeyId) {
        LocalDate today = LocalDate.now();
        if (!today.equals(dailyCountDate)) {
            dailyInvokeCount.clear();
            dailyCountDate = today;
        }
        String quotaKey = "k:" + apiKeyId;
        int used = dailyInvokeCount.merge(quotaKey, 1, Integer::sum);
        if (used > dailyQuota) {
            throw new RateLimitExceeded("API KEY 日配额已用尽（" + dailyQuota + " 次/天）");
        }
        long now = System.currentTimeMillis();
        java.util.ArrayDeque<Long> window = invokeTimestamps.computeIfAbsent(apiKeyId,
                k -> new java.util.ArrayDeque<>());
        synchronized (window) {
            while (!window.isEmpty() && now - window.peekFirst() > RATE_LIMIT_WINDOW_MS) {
                window.pollFirst();
            }
            if (window.size() >= rateLimitMax) {
                throw new RateLimitExceeded("调用过于频繁（" + rateLimitMax + " 次/"
                        + (RATE_LIMIT_WINDOW_MS / 1000) + "s），请稍后重试");
            }
            window.addLast(now);
        }
    }
}
