package com.luban.service;

import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.concurrent.ConcurrentHashMap;

/**
 * API KEY 外调频控：每 Key 滑动窗口（默认 10s 内 10 次）+ 日配额（默认 1000 次）。
 * 编排与查询两个外调入口（PublicOrchestrationController / PublicQueryController）共享
 * 同一实例，保证每 KEY 配额跨入口统一；超限抛 {@link RateLimitExceeded}
 * （SecurityException 子类，controller 侧统一转 429）。
 */
@Component
public class ApiKeyRateLimiter {

    public static class RateLimitExceeded extends SecurityException {
        public RateLimitExceeded(String message) { super(message); }
    }

    private static final int RATE_LIMIT_WINDOW_MS = 10_000;
    private static final int RATE_LIMIT_MAX = 10;
    private static final int DAILY_QUOTA = 1000;
    private final ConcurrentHashMap<Long, java.util.ArrayDeque<Long>> invokeTimestamps =
            new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Integer> dailyInvokeCount =
            new ConcurrentHashMap<>();
    private volatile LocalDate dailyCountDate = LocalDate.now();

    public void check(Long apiKeyId) {
        LocalDate today = LocalDate.now();
        if (!today.equals(dailyCountDate)) {
            dailyInvokeCount.clear();
            dailyCountDate = today;
        }
        String quotaKey = "k:" + apiKeyId;
        int used = dailyInvokeCount.merge(quotaKey, 1, Integer::sum);
        if (used > DAILY_QUOTA) {
            throw new RateLimitExceeded("API KEY 日配额已用尽（" + DAILY_QUOTA + " 次/天）");
        }
        long now = System.currentTimeMillis();
        java.util.ArrayDeque<Long> window = invokeTimestamps.computeIfAbsent(apiKeyId,
                k -> new java.util.ArrayDeque<>());
        synchronized (window) {
            while (!window.isEmpty() && now - window.peekFirst() > RATE_LIMIT_WINDOW_MS) {
                window.pollFirst();
            }
            if (window.size() >= RATE_LIMIT_MAX) {
                throw new RateLimitExceeded("调用过于频繁（" + RATE_LIMIT_MAX + " 次/"
                        + (RATE_LIMIT_WINDOW_MS / 1000) + "s），请稍后重试");
            }
            window.addLast(now);
        }
    }
}
