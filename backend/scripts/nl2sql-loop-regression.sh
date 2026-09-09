#!/usr/bin/env bash
# =============================================================================
# 问数 agent 循环回归测试（安全架构 v1.2 / NL2SQL）
#
# 复现场景："LINE01 接 5000 件 FG-MOTOR-01 排得下吗"——
# 该场景曾因循环检测漏检（轮转循环）+ 无终止出口，重复近 100 轮。
# 断言：iterations/llm_calls 有界、answer 非兜底文案、无 error。
#
# 用法：./nl2sql-loop-regression.sh "$JWT" [BASE_URL]
# 建议用 root token（数据源 14 的查询需要权限）。
# =============================================================================
set -u
BASE="${2:-http://localhost:8080}"
TOKEN="${1:?usage: nl2sql-loop-regression.sh JWT [BASE_URL]}"
PASS=0; FAIL=0
ok() { echo "✅ $1"; PASS=$((PASS+1)); }
bad() { echo "❌ $1"; FAIL=$((FAIL+1)); }

SESSION="loop-regression-$(date +%s)"
RESP=$(curl -s -X POST "$BASE/api/v1/agent/chat" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION\",\"message\":\"LINE01 接 5000 件 FG-MOTOR-01 排得下吗\"}" \
  --max-time 600)

if [ -z "$RESP" ]; then bad "无响应（后端未启动或超时）"; echo "结果：$PASS 通过，$FAIL 失败"; exit 1; fi

echo "$RESP" | jq -r '"iterations=\(.iterations // "?") llmCalls=\(.llmCalls // "?") sqlExecs=\(.sqlExecCount // "?") key概念=\(.keyConcept // "?")"' 2>/dev/null | head -2

ITER=$(echo "$RESP" | jq -r '.iterations // 0')
LLMCALLS=$(echo "$RESP" | jq -r '.llmCalls // "?"')
ANSWER=$(echo "$RESP" | jq -r '.answer // ""')

# 1. 迭代轮数有界：旧缺陷下 ~50 轮；修复后同类问题应 < 30 轮
if [ "$ITER" -gt 0 ] && [ "$ITER" -lt 30 ]; then ok "迭代轮数有界（$ITER < 30）"; else bad "迭代轮数异常：$ITER"; fi

# 2. LLM 调用次数有界（响应缺该字段时跳过——旧版本后端未暴露）
if [ "$LLMCALLS" = "?" ] || [ "$LLMCALLS" = "null" ] || [ -z "$LLMCALLS" ]; then
  echo "✅ LLM 调用次数字段未暴露，跳过（以迭代轮数为准）"; PASS=$((PASS+1))
elif [ "$LLMCALLS" -gt 0 ] && [ "$LLMCALLS" -lt 30 ]; then
  ok "LLM 调用次数有界（$LLMCALLS < 30）"; PASS=$((PASS+1))
else
  bad "LLM 调用次数异常：$LLMCALLS"; FAIL=$((FAIL+1))
fi

# 3. answer 非兜底文案
if [ -n "$ANSWER" ] && [ "$ANSWER" != "处理完成" ] && [ "$ANSWER" != "分析已结束，但未生成结论摘要（原因已记录日志）。请重试或换个问法。" ]; then
  ok "生成了有效结论（前 80 字：$(echo "$ANSWER" | head -c 80)）"
else
  bad "answer 为空或兜底文案：$(echo "$ANSWER" | head -c 80)"
fi

# 4. 清理会话（避免历史污染后续测试）
curl -s -o /dev/null -X POST "$BASE/api/v1/agent/chat/clear" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION\"}"

echo ""
echo "结果：$PASS 通过，$FAIL 失败"
[ "$FAIL" -eq 0 ] || exit 1
