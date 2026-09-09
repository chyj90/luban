package com.luban.service.agent;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 动作循环检测器（滑动窗口）。
 *
 * 背景：原实现只比对相邻两次动作签名——LLM 交替输出 [动作A, 动作B, 动作A...] 的
 * 轮转循环（轮间顺序轮换）永远不构成"相邻相同"，导致问数 agent 重复执行同一组
 * 动作近 100 轮才被硬上限拦住。
 *
 * 判定（满足任一即视为循环，应强制终止）：
 * 1. 窗口内任一签名出现次数 ≥ {@link #MAX_SAME_SIG}（含连续重复）；
 * 2. 窗口已满 {@link #WINDOW} 个且去重后种类 ≤ {@link #MAX_DISTINCT_IN_WINDOW}（覆盖 ≤3 路轮转）。
 */
public final class ActionLoopDetector {

    public static final int WINDOW = 8;
    public static final int MAX_SAME_SIG = 3;
    public static final int MAX_DISTINCT_IN_WINDOW = 3;

    private ActionLoopDetector() {}

    /** 追加签名（就地维护窗口，超出部分丢弃最旧），返回是否触发循环终止 */
    public static boolean recordAndDetect(List<String> signatures, String signature) {
        if (signature == null) return false;
        signatures.add(signature);
        while (signatures.size() > WINDOW) {
            signatures.remove(0);
        }
        Map<String, Integer> counts = new HashMap<>();
        for (String s : signatures) {
            counts.merge(s, 1, Integer::sum);
        }
        boolean sameSigOverflow = counts.values().stream().anyMatch(c -> c >= MAX_SAME_SIG);
        boolean rotationLoop = signatures.size() >= WINDOW && counts.size() <= MAX_DISTINCT_IN_WINDOW;
        return sameSigOverflow || rotationLoop;
    }

    /** 供日志/兜底文案使用：窗口内出现最多的签名及其次数 */
    public static Map.Entry<String, Integer> dominantSignature(List<String> signatures) {
        Map<String, Integer> counts = new HashMap<>();
        for (String s : signatures) counts.merge(s, 1, Integer::sum);
        Map.Entry<String, Integer> best = null;
        for (Map.Entry<String, Integer> e : counts.entrySet()) {
            if (best == null || e.getValue() > best.getValue()) best = e;
        }
        return best;
    }
}
