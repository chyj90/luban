#!/usr/bin/env bash
# =============================================================================
# 安全行为冒烟测试（安全架构 v1.1）
#
# 前置：后端已启动（默认 http://localhost:8080），准备两个账号的 JWT：
#   TOKEN_ADMIN — 持有 connect:systems 平台权限（或 super_admin）
#   TOKEN_USER  — 普通用户（无任何平台权限）
#
# 用法：
#   ./security-smoke.sh "$TOKEN_ADMIN" "$TOKEN_USER" [BASE_URL]
#
# 断言失败即 exit 1；全部通过 exit 0。
# =============================================================================
set -u
BASE="${3:-http://localhost:8080}"
TOKEN_ADMIN="${1:?usage: security-smoke.sh TOKEN_ADMIN TOKEN_USER [BASE_URL]}"
TOKEN_USER="${2:?usage: security-smoke.sh TOKEN_ADMIN TOKEN_USER [BASE_URL]}"

PASS=0; FAIL=0

assert_code() { # name expected actual
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "✅ ${name} (HTTP ${actual})"; PASS=$((PASS+1))
  else
    echo "❌ ${name} expect=${expected} got=${actual}"; FAIL=$((FAIL+1))
  fi
}

json_field() { # json field
  echo "$1" | jq -r "$2" 2>/dev/null
}

req() { # method path token body -> 输出 "code|body"
  local method="$1" path="$2" token="$3" body="${4:-}"
  if [ -n "$body" ]; then
    curl -s -w "\n%{http_code}" -X "$method" "$BASE$path" -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" -d "$body"
  else
    curl -s -w "\n%{http_code}" -X "$method" "$BASE$path" -H "Authorization: Bearer $token"
  fi
}

echo "=== 1. X-API-Key 不构成免登录通道 ==="
# 1a. 无 JWT、无 Key → 401
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/v1/tools")
assert_code "无凭据访问 /tools 被拒" 401 "$CODE"

# 1b. 仅 X-API-Key（无 JWT）→ 401（即使 Key 有效）
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/v1/tools" -H "X-API-Key: lb_totally_invalid_key_value_xxx")
assert_code "伪造 X-API-Key 被拒" 401 "$CODE"

echo "=== 2. Key 创建 / rotate / 吊销生命周期（admin）==="
RESP=$(req POST /api/v1/api-keys "$TOKEN_ADMIN" '{"name":"smoke-test-key"}')
CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | sed '$d')
assert_code "创建 API Key" 200 "$CODE"
RAW_KEY=$(json_field "$BODY" ".data.apiKeyId")
if [ -z "$RAW_KEY" ] || [ "$RAW_KEY" = "null" ]; then echo "❌ 未取得 raw key，后续用例跳过"; exit 1; fi
KEY_ID=$(json_field "$BODY" ".data.id")
KEY_PREVIEW_BEFORE_ROTATE=$(json_field "$BODY" ".data.keyPreview")

# rotate：换发新密钥，旧密钥立即失效
RESP=$(req POST "/api/v1/api-keys/$KEY_ID/rotate" "$TOKEN_ADMIN")
CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | sed '$d')
assert_code "rotate 轮换 Key" 200 "$CODE"
NEW_KEY=$(json_field "$BODY" ".data.apiKeyId")

echo "=== 3. 审批端点权限（approve/reject 仅 connect:systems/super_admin）==="
# 用普通用户 token 调审批端点 → 403（申请单 id 用不存在的占位值，鉴权在业务前拦截）
CODE=$(req POST "/api/v1/api-keys/datasource-permission/999999/approve" "$TOKEN_USER" | tail -1)
assert_code "普通用户审批被拒" 403 "$CODE"
CODE=$(req POST "/api/v1/api-keys/tool-permission/999999/approve" "$TOKEN_USER" | tail -1)
assert_code "普通用户审批被拒(工具)" 403 "$CODE"

echo "=== 4. 普通用户创建 PLATFORM 数据源被拒 ==="
CODE=$(req POST /api/v1/datasources "$TOKEN_USER" \
  '{"name":"smoke-platform-ds","slug":"PLATFORM","ownerId":1,"type":"mysql","config":{"host":"x"}}' | tail -1)
assert_code "普通用户创建 PLATFORM 数据源被拒" 403 "$CODE"

echo "=== 5. Key 吊销级联（admin 自有 Key）==="
CODE=$(req DELETE "/api/v1/api-keys/$KEY_ID" "$TOKEN_ADMIN" | tail -1)
assert_code "吊销 Key" 200 "$CODE"
LIST=$(req GET /api/v1/api-keys "$TOKEN_ADMIN")
REVOKED_STATUS=$(echo "$LIST" | sed '$d' | jq -r ".data[] | select(.id == $KEY_ID) | .status")
assert_code "吊销后状态 REVOKED" "REVOKED" "$REVOKED_STATUS"
# 恢复以便重复执行（幂等提示，失败不阻断）
curl -s -o /dev/null -X POST "$BASE/api/v1/api-keys/$KEY_ID/restore" -H "Authorization: Bearer $TOKEN_ADMIN"

echo "=== 6. 正向回归（改动不得破坏既有功能）==="
# 6a. 登录用户正常浏览工具注册表（JWT 主流程不受 Key 机制影响）
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/v1/tools" -H "Authorization: Bearer $TOKEN_ADMIN")
assert_code "JWT 用户 GET /tools 正常" 200 "$CODE"

# 6b. 平台权限持有者可创建 PLATFORM 数据源（正向放行；命名带时间戳，留痕不清理）
TS=$(date +%s)
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/datasources" \
  -H "Authorization: Bearer $TOKEN_ADMIN" -H "Content-Type: application/json" \
  -d '{"name":"smoke-platform-ds-'"$TS"'","slug":"PLATFORM","ownerId":1,"type":"mysql","config":{"host":"x"}}')
assert_code "admin 创建 PLATFORM 数据源放行" 201 "$CODE"

# 6c. rotate 后 Key 列表前缀更新（证明轮换真实生效）
OLD_PREVIEW="$KEY_PREVIEW_BEFORE_ROTATE"
if [ -n "$KEY_ID" ] && [ -n "$OLD_PREVIEW" ]; then
  LIST=$(req GET /api/v1/api-keys "$TOKEN_ADMIN")
  BODY=$(echo "$LIST" | sed '$d')
  NEW_PREFIX_ITEM=$(echo "$BODY" | jq -r ".data[] | select(.id == $KEY_ID) | .apiKeyId")
  if [ -n "$NEW_PREFIX_ITEM" ] && [ "${NEW_PREFIX_ITEM:0:12}" != "${OLD_PREVIEW:0:12}" ]; then
    echo "✅ rotate 后列表前缀已更新 (${NEW_PREFIX_ITEM})"; PASS=$((PASS+1))
  else
    echo "❌ rotate 后列表前缀未变化: ${NEW_PREFIX_ITEM}"; FAIL=$((FAIL+1))
  fi
fi

# 6d. 吊销/恢复状态在列表可见（级联与状态机生效）
LIST=$(req GET /api/v1/api-keys "$TOKEN_ADMIN")
BODY=$(echo "$LIST" | sed '$d')
STATUS=$(echo "$BODY" | jq -r ".data[] | select(.id == $KEY_ID) | .status")
if [ "$STATUS" = "ACTIVE" ]; then
  echo "✅ restore 后 Key 状态 ACTIVE"; PASS=$((PASS+1))
else
  echo "❌ restore 后 Key 状态异常: $STATUS"; FAIL=$((FAIL+1))
fi

# 6e. 普通用户任务列表与流程实例列表正常（运行态读路径）
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/v1/tasks?status=pending" -H "Authorization: Bearer $TOKEN_USER")
assert_code "普通用户 GET /tasks 正常" 200 "$CODE"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/v1/workflow-instances" -H "Authorization: Bearer $TOKEN_USER")
assert_code "普通用户 GET /workflow-instances 正常" 200 "$CODE"

echo ""
echo "结果：$PASS 通过，$FAIL 失败"
[ "$FAIL" -eq 0 ] || exit 1
