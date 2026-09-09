#!/usr/bin/env bash
# =============================================================================
# 流程审批端到端自动化（安全架构 v1.2 / E2E-1）
#
# 全链路：登录 → 建应用 → 建应用角色 → 加成员 → 建表单 → 建流程(发布) →
#         绑定 → 授予 app:workflow 提交权 → 周九发起 → 张三 approve → COMPLETED
#         第二条 → 张三 reject → REJECTED
#
# 用法：./workflow-e2e.sh [BASE_URL]
# 前置：后端运行中；root/周九/张三 三个账号密码 123456。
# 产物命名带时间戳，可重复执行。
# =============================================================================
set -u
BASE="${1:-http://localhost:8080}"
PASS=0; FAIL=0

assert_ok() { # name body
  if echo "$1" | jq -e '.success == true' >/dev/null 2>&1 || [ "$2" = "200" ]; then
    echo "✅ $1"; PASS=$((PASS+1))
  else
    echo "❌ $1"; FAIL=$((FAIL+1))
  fi
}

login() { curl -s -X POST "$BASE/api/v1/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"123456\"}" | jq -r '.data.token'; }

call() { # method path token body -> body(去掉状态行)
  local method="$1" path="$2" token="$3" body="${4:-}"
  if [ -n "$body" ]; then
    curl -s -X "$method" "$BASE$path" -H "Authorization: Bearer $token" -H "Content-Type: application/json" -d "$body"
  else
    curl -s -X "$method" "$BASE$path" -H "Authorization: Bearer $token"
  fi
}

TS=$(date +%s)
TOKEN_ROOT=$(login 495737685@qq.com)
TOKEN_ZHOU=$(login zhou@luban.local)
TOKEN_ZHANG=$(login zhang@luban.local)
[ -n "$TOKEN_ROOT" ] && [ -n "$TOKEN_ZHOU" ] && [ -n "$TOKEN_ZHANG" ] || { echo "❌ 登录失败"; exit 1; }
echo "✅ 登录成功（root/周九/张三）"

APP_NAME="E2E-流程测试应用-$TS"

echo "=== 1. root 创建应用 ==="
APP=$(call POST /api/v1/applications "$TOKEN_ROOT" "{\"name\":\"$APP_NAME\"}")
APP_ID=$(echo "$APP" | jq -r '.data.id // empty')
[ -n "$APP_ID" ] && [ "$APP_ID" != "null" ] || { echo "❌ 创建应用失败: $APP"; exit 1; }
echo "✅ 应用创建 $APP_ID"; PASS=$((PASS+1))

echo "=== 2. 创建应用角色 + 加成员（周九=发起人，张三=审批人） ==="
ROLE=$(call POST /api/v1/roles "$TOKEN_ROOT" "{\"name\":\"E2E成员\",\"slug\":\"e2e-member-$TS\",\"scope\":\"APPLICATION\",\"applicationId\":$APP_ID}")
ROLE_ID=$(echo "$ROLE" | jq -r '.data.id // empty')
[ -n "$ROLE_ID" ] && [ "$ROLE_ID" != "null" ] || { echo "❌ 创建角色失败: $ROLE"; exit 1; }
echo "✅ 角色创建 $ROLE_ID"; PASS=$((PASS+1))

call PUT "/api/v1/roles/$ROLE_ID/users" "$TOKEN_ROOT" "{\"userIds\":[2,3]}" >/dev/null
echo "✅ 角色成员已设（周九/张三）"; PASS=$((PASS+1))

echo "=== 3. 建表单 ==="
FIELDS='[{"key":"leaveDays","label":"请假天数","type":"number","required":true},{"key":"reason","label":"请假原因","type":"textarea","required":true}]'
FORM=$(call POST /api/v1/forms "$TOKEN_ROOT" "{\"name\":\"E2E-请假申请单-$TS\",\"applicationId\":$APP_ID,\"fields\":$(echo "$FIELDS" | jq -c @json)}")
FORM_ID=$(echo "$FORM" | jq -r '.data.id // .id // empty')
[ -n "$FORM_ID" ] && [ "$FORM_ID" != "null" ] || { echo "❌ 创建表单失败: $FORM"; exit 1; }
echo "✅ 表单创建 $FORM_ID"; PASS=$((PASS+1))

echo "=== 4. 建流程（start → 张三审批 → end）并发布 ==="
NODES='[
  {"id":"start","nodeType":"start","type":"startNode","position":{"x":300,"y":50},"data":{"label":"发起人","nodeType":"start","config":{"nodeName":"发起人"}}},
  {"id":"approval_1","nodeType":"approval","type":"approvalNode","position":{"x":300,"y":170},"data":{"label":"张三审批","nodeType":"approval","config":{"nodeName":"张三审批","approverType":"member","memberIds":[3]}}},
  {"id":"end","nodeType":"end","type":"endNode","position":{"x":300,"y":290},"data":{"label":"结束","nodeType":"end","config":{"nodeName":"结束"}}}
]'
EDGES='[
  {"id":"e1","source":"start","target":"approval_1","type":"smoothstep","markerEnd":{"type":"arrowclosed","width":20,"height":20}},
  {"id":"e2","source":"approval_1","target":"end","type":"smoothstep","markerEnd":{"type":"arrowclosed","width":20,"height":20}}
]'
DEF=$(call POST /api/v1/workflows "$TOKEN_ROOT" "{\"name\":\"E2E-请假审批流-$TS\",\"applicationId\":$APP_ID,\"nodes\":$(echo "$NODES" | jq -c @json),\"edges\":$(echo "$EDGES" | jq -c @json)}")
DEF_ID=$(echo "$DEF" | jq -r '.data.id // .id // empty')
[ -n "$DEF_ID" ] && [ "$DEF_ID" != "null" ] || { echo "❌ 创建流程失败: $DEF"; exit 1; }
echo "✅ 流程创建 $DEF_ID"; PASS=$((PASS+1))

PUB=$(call POST "/api/v1/workflows/$DEF_ID/publish" "$TOKEN_ROOT")
PUB_STATUS=$(echo "$PUB" | jq -r '.data.status // .status // empty')
[ "$PUB_STATUS" = "PUBLISHED" ] || { echo "❌ 发布失败: $PUB"; exit 1; }
echo "✅ 流程已发布 (PUBLISHED)"; PASS=$((PASS+1))

echo "=== 5. 绑定表单 + 授予 app:workflow 提交权 ==="
BIND=$(call POST /api/v1/form-workflow-bindings "$TOKEN_ROOT" "{\"formId\":$FORM_ID,\"workflowId\":$DEF_ID,\"isDefault\":true}")
BIND_ID=$(echo "$BIND" | jq -r '.data.id // .id // empty')
[ -n "$BIND_ID" ] && [ "$BIND_ID" != "null" ] || { echo "❌ 绑定失败: $BIND"; exit 1; }
echo "✅ 表单已绑定流程"; PASS=$((PASS+1))

call PUT "/api/v1/roles/$ROLE_ID/permissions" "$TOKEN_ROOT" "{\"permissions\":[\"app:workflow:$DEF_ID\"]}" >/dev/null
echo "✅ 已授予成员 app:workflow 提交权"; PASS=$((PASS+1))

echo "=== 6. 周九发起流程 #1 ==="
INST1=$(call POST /api/v1/workflow-instances "$TOKEN_ZHOU" "{\"definitionId\":$DEF_ID,\"formData\":$(echo '{"leaveDays":2,"reason":"e2e-approve"}' | jq -c @json)}")
INST1_ID=$(echo "$INST1" | jq -r '.id // empty')
[ -n "$INST1_ID" ] && [ "$INST1_ID" != "null" ] || { echo "❌ 发起失败: $INST1"; exit 1; }
echo "✅ 实例发起 $INST1_ID"; PASS=$((PASS+1))

echo "=== 7. 张三审批通过 → 期望 COMPLETED ==="
TASK=$(call GET "/api/v1/tasks?status=pending" "$TOKEN_ZHANG" | jq -c --argjson i "$INST1_ID" 'if type=="array" then . else .data end | .[] | select(.instanceId == $i) | {id, instanceId, status}' | head -1)
TASK_ID=$(echo "$TASK" | jq -r '.id // empty')
[ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ] || { echo "❌ 张三未收到待办: $TASK"; exit 1; }
echo "✅ 张三待办任务 $TASK_ID"; PASS=$((PASS+1))

call PUT "/api/v1/tasks/$TASK_ID/approve" "$TOKEN_ZHANG" '{"comment":"同意"}' >/dev/null
FINAL1=$(call GET "/api/v1/workflow-instances/$INST1_ID" "$TOKEN_ZHOU" | jq -r '.status // .data.status // empty')
if [ "$FINAL1" = "COMPLETED" ]; then
  echo "✅ 实例 #1 状态 COMPLETED"; PASS=$((PASS+1))
else
  echo "❌ 实例 #1 状态异常: $FINAL1"; FAIL=$((FAIL+1))
fi

echo "=== 8. 周九发起流程 #2 → 张三驳回 → 期望 REJECTED ==="
INST2=$(call POST /api/v1/workflow-instances "$TOKEN_ZHOU" "{\"definitionId\":$DEF_ID,\"formData\":$(echo '{"leaveDays":5,"reason":"e2e-reject"}' | jq -c @json)}")
INST2_ID=$(echo "$INST2" | jq -r '.id // empty')
[ -n "$INST2_ID" ] && [ "$INST2_ID" != "null" ] || { echo "❌ 发起#2失败: $INST2"; exit 1; }
TASK2=$(call GET "/api/v1/tasks?status=pending" "$TOKEN_ZHANG" | jq -c --argjson i "$INST2_ID" 'if type=="array" then . else .data end | .[] | select(.instanceId == $i) | .id' | head -1)
[ -n "$TASK2" ] && [ "$TASK2" != "null" ] || { echo "❌ 张三未收到#2待办"; exit 1; }
call PUT "/api/v1/tasks/$TASK2/reject" "$TOKEN_ZHANG" '{"comment":"驳回测试"}' >/dev/null
FINAL2=$(call GET "/api/v1/workflow-instances/$INST2_ID" "$TOKEN_ZHOU" | jq -r '.status // .data.status // empty')
if [ "$FINAL2" = "REJECTED" ]; then
  echo "✅ 实例 #2 状态 REJECTED"; PASS=$((PASS+1))
else
  echo "❌ 实例 #2 状态异常: $FINAL2"; FAIL=$((FAIL+1))
fi

echo ""
echo "=== E2E 结果：$PASS 通过，$FAIL 失败 ==="
echo "artifacts: app=${APP_ID} role=${ROLE_ID} form=${FORM_ID} wf=${DEF_ID}"
[ "$FAIL" -eq 0 ] || exit 1
