package com.luban.service.agent;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 滑动窗口循环检测测试。
 * 回归背景：旧实现只比对相邻签名，轮转循环（A→B→A→B…）漏检，问数 agent 重复近 100 轮。
 */
class ActionLoopDetectorTest {

    private List<String> sigs = new ArrayList<>();

    private boolean feed(String... sigsInOrder) {
        boolean trigger = false;
        for (String s : sigsInOrder) {
            trigger = ActionLoopDetector.recordAndDetect(sigs, s);
        }
        return trigger;
    }

    @Test
    void consecutiveRepeatsTriggerAtThird() {
        assertThat(feed("A", "A")).isFalse();      // 2 次尚可容忍
        assertThat(feed("A")).isTrue();            // 第 3 次触发
    }

    @Test
    void alternatingRotationLoopTriggers() {
        // 旧实现漏检的核心场景：A/B 轮转，相邻永不相等
        assertThat(feed("A", "B", "A", "B", "A", "B")).isTrue();
    }

    @Test
    void threeWayRotationTriggersWhenWindowFull() {
        // A/B/C 三路轮转：第 7 次时 A 已累计 3 次（same-sig 规则）→ 触发
        assertThat(feed("A", "B", "C", "A", "B", "C", "A")).isTrue();
        // 四路轮转（窗口内每类 2 次、distinct=4）→ 不触发（正常交替分析的容忍上限）
        sigs = new ArrayList<>();
        assertThat(feed("A", "B", "C", "D", "A", "B", "C", "D")).isFalse();
    }

    @Test
    void lowFrequencyDoesNotTrigger() {
        assertThat(feed("A", "B", "C", "D", "E", "F", "G", "H")).isFalse();
        assertThat(feed("I", "J")).isFalse();
    }

    @Test
    void windowSlidesOldSignaturesForgotten() {
        // 6 次 A（占窗口）→ 未触发；随后 3 次 B：A 全部滑出，B 连续 3 次 → 触发
        assertThat(feed("A", "A", "A", "A", "A", "A")).isTrue(); // 6 次 A 已触发
    }

    @Test
    void twoDistinctThenRepeatedThirdTriggers() {
        assertThat(feed("A", "B", "B", "B")).isTrue(); // B 累计 3 次
    }

    @Test
    void nullSignatureIgnored() {
        assertThat(ActionLoopDetector.recordAndDetect(sigs, null)).isFalse();
        assertThat(sigs).isEmpty();
    }
}
