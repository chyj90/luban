/**
 * 上下文窗口管理（需求 R4）
 *
 * 背景：agentLoop 每轮把全部历史消息原样发给 LLM，工具结果以完整 JSON 入上下文，
 * maxIterations=100 的长任务必然撞上下文上限或成本失控。
 *
 * 策略（在 API 边界压缩，conversationMessages/UI/记忆保留全量）：
 * 1. 预算内 → 原样返回（短会话零行为变化）；
 * 2. 超预算 → 第一层：保护窗口外的旧工具结果裁剪为占位标记（保留 assistant 结论）；
 * 3. 仍超 → 第二层：从最旧开始整组丢弃（assistant+其后相邻 tool 消息作为一个单元，
 *    保证 tool_call 配对不变，不产生孤儿 tool 消息）；system 消息与最近 N 条永不丢弃；
 * 4. 仍超 → 第三层：保护窗口内的大工具结果也裁剪（从最旧开始，最近 TAIL 条原样保留，
 *    裁剪上限放宽到 RECENT_TRIM_MAX——执行阶段大体积来源是整页代码/分析示例等工具结果）。
 */
import type { LLMMessage } from './llmClient';

/** 发送给 API 的历史消息字符预算（不含 system；中文约 1.5 字符/token 的保守估算） */
export const CONTEXT_BUDGET_CHARS = 120_000;
/** 压缩时永远完整保留的最近消息条数 */
export const CONTEXT_KEEP_RECENT = 24;
/** 第三层：保护窗口内最近 TAIL 条消息原样保留（模型正在使用的最新结果不裁剪） */
export const RECENT_TAIL_UNTOUCHED = 6;
/** 第三层：保护窗口内工具结果的裁剪上限（保留足够上下文，砍掉整页代码级别的大块） */
export const RECENT_TRIM_MAX = 2000;
/** 旧工具结果裁剪后保留的占位标记上限 */
const TRIM_MARKER_MAX = 240;

export function estimateChars(messages: LLMMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += (m.content || '').length;
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        total += tc.function.arguments?.length || 0;
      }
    }
  }
  return total;
}

function trimContent(content: string): string {
  if (content.length <= TRIM_MARKER_MAX) return content;
  return `${content.slice(0, TRIM_MARKER_MAX)}…[工具结果已裁剪，原 ${content.length} 字符，完整结果见界面/数据源]`;
}

interface MessageUnit {
  start: number;
  end: number; // inclusive
  isSystem: boolean;
}

/** 把消息序列切成不可拆分的单元：assistant(+相邻 tool 消息)、user、system */
function buildUnits(messages: LLMMessage[]): MessageUnit[] {
  const units: MessageUnit[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.role === 'system') {
      units.push({ start: i, end: i, isSystem: true });
      i++;
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      const start = i;
      i++;
      while (i < messages.length && messages[i].role === 'tool') i++;
      units.push({ start, end: i - 1, isSystem: false });
      continue;
    }
    units.push({ start: i, end: i, isSystem: false });
    i++;
  }
  return units;
}

/**
 * 压缩历史消息到字符预算内。返回新数组（可能原样返回）。
 * 不变量：tool 消息必须紧跟其配对的 assistant(tool_calls) 消息；system 消息与最近
 * keepRecent 条消息完整保留。
 */
export function compactForApi(
  messages: LLMMessage[],
  budgetChars: number = CONTEXT_BUDGET_CHARS,
  keepRecent: number = CONTEXT_KEEP_RECENT,
): LLMMessage[] {
  if (messages.length === 0 || estimateChars(messages) <= budgetChars) {
    return messages;
  }

  const protectedFrom = Math.max(0, messages.length - keepRecent);
  const isProtected = (idx: number) => idx >= protectedFrom;

  // 第一层：保护窗口外的旧工具结果裁剪为标记
  let working: LLMMessage[] = messages.map((m, idx) => {
    if (!isProtected(idx) && m.role === 'tool' && m.content.length > TRIM_MARKER_MAX) {
      return { ...m, content: trimContent(m.content) };
    }
    return m;
  });

  let estimate = estimateChars(working);
  if (estimate <= budgetChars) return working;

  // 第二层：从最旧的单元开始整组丢弃（跳过 system 与保护区）
  const units = buildUnits(working);
  const dropped = new Set<number>();
  for (const unit of units) {
    if (estimate <= budgetChars) break;
    if (unit.isSystem) continue;
    if (unit.start >= protectedFrom) continue;
    for (let i = unit.start; i <= unit.end; i++) dropped.add(i);
    estimate = estimateChars(working.filter((_, idx) => !dropped.has(idx)));
  }

  if (dropped.size > 0) {
    working = working.filter((_, idx) => !dropped.has(idx));
    estimate = estimateChars(working);
    console.log(`[ContextWindow] 压缩：丢弃 ${dropped.size} 条最旧消息，当前约 ${estimate} 字符`);
  }

  // 第三层：保护窗口内的大工具结果裁剪（从最旧开始，最近 TAIL 条原样保留）
  estimate = estimateChars(working);
  if (estimate > budgetChars) {
    const tailStart = Math.max(0, working.length - RECENT_TAIL_UNTOUCHED);
    let trimmedCount = 0;
    for (let i = 0; i < tailStart; i++) {
      if (estimate <= budgetChars) break;
      const m = working[i];
      if (m.role === 'tool' && m.content.length > RECENT_TRIM_MAX) {
        working[i] = { ...m, content: `${m.content.slice(0, RECENT_TRIM_MAX)}…[工具结果已裁剪，原 ${m.content.length} 字符]` };
        trimmedCount++;
        estimate = estimateChars(working);
      }
    }
    if (trimmedCount > 0) {
      console.log(`[ContextWindow] 压缩：裁剪保护窗口内 ${trimmedCount} 条大工具结果，当前约 ${estimate} 字符`);
    }
  }

  if (estimate > budgetChars) {
    console.warn(`[ContextWindow] 三层压缩后仍超预算（约 ${estimate} 字符），按原样发送`);
  }
  return working;
}
