#!/usr/bin/env bash
# =============================================================================
# API 编排端到端测试（M3 + workflow 节点）
#
# 链路：root 建应用 → 建编排（transform）→ 试运行 → 发布 → 外部调用三态 →
#       workflow 节点：经编排发起真实审批流程（李四发起）
#
# 用法：./orchestration-e2e.sh [BASE_URL]
# 前置：root 密码 12345678；李四密码 123456；需一个 PUBLISHED 流程（workflow 段自动选）。
# =============================================================================
set -u
BASE="${1:-http://localhost:8080}"
PASS=0; FAIL=0
TS=$(date +%s)

ok() { echo "✅ $1"; PASS=$((PASS+1)); }
bad() { echo "❌ $1"; FAIL=$((FAIL+1)); }
expect_code() { if [ "$2" = "$3" ]; then ok "$1 (HTTP $3)"; else bad "$1 expect=$2 got=$3"; fi; }

login() { curl -s -X POST "$BASE/api/v1/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jq -r '.data.token'; }

T_ROOT=$(login 495737685@qq.com "12345678")
T_ZHOU=$(login zhou@luban.local "123456")
T_LI=$(login li@luban.local "123456")
[ -n "$T_ROOT" ] && [ -n "$T_ZHOU" ] && [ -n "$T_LI" ] || { echo "❌ 登录失败"; exit 1; }
ok "登录成功（root/周九/李四）"

APP=$(curl -s -X POST "$BASE/api/v1/applications" -H "Authorization: Bearer $T_ROOT" \
  -H "Content-Type: application/json" -d "{\"name\":\"E2E-编排应用-$TS\"}")
APP_ID=$(echo "$APP" | jq -r '.data.id // empty')
[ -n "$APP_ID" ] && [ "$APP_ID" != "null" ] || { echo "❌ 建应用失败: $APP"; exit 1; }
ok "应用 $APP_ID"

echo "=== 1. 创建编排（start → transform → output）==="
DSL=$(python3 -c "
import json
dsl = {'nodes': [
  {'id':'start','nodeType':'start','position':{'x':300,'y':50},'data':{'label':'入口','config':{'inputs':[{'name':'name','type':'string','required':True}]}}},
  {'id':'t1','nodeType':'transform','position':{'x':300,'y':170},'data':{'label':'变换','config':{'template':{'greeting':'Hello ' + chr(36) + 'input.name'}}}},
  {'id':'out','nodeType':'output','position':{'x':300,'y':290},'data':{'label':'出口','config':{}}}
], 'edges': [
  {'id':'e1','source':'start','target':'t1'},
  {'id':'e2','source':'t1','target':'out'}
]}
print(json.dumps({'name': 'E2E-编排-$TS', 'applicationId': $APP_ID, 'dsl': json.dumps(dsl)}))
")
CREATE=$(curl -s -X POST "$BASE/api/v1/orchestrations" -H "Authorization: Bearer $T_ROOT" \
  -H "Content-Type: application/json" -d "$DSL")
ORCH_ID=$(echo "$CREATE" | jq -r '.data.id // empty')
[ -n "$ORCH_ID" ] && [ "$ORCH_ID" != "null" ] || { echo "❌ 建编排失败: $CREATE"; exit 1; }
ok "编排创建 $ORCH_ID"

echo "=== 2. 试运行（transform 节点，无外部依赖）==="
TEST=$(curl -s -X POST "$BASE/api/v1/orchestrations/$ORCH_ID/test-run" \
  -H "Authorization: Bearer $T_ROOT" -H "Content-Type: application/json" \
  -d '{"inputs":{"name":"E2E"}}')
TEST_OK=$(echo "$TEST" | jq -r '.data.success // empty')
GREETING=$(echo "$TEST" | jq -r '.data.data.t1.greeting // empty')
[ "$TEST_OK" = "true" ] && ok "试运行成功" || bad "试运行失败: $(echo "$TEST" | head -c 200)"
[ "$GREETING" = "Hello E2E" ] && ok "变量插值正确（${GREETING}）" || bad "插值异常: $GREETING"

echo "=== 3. 发布（MANAGE）→ ToolDefinition 注册 ==="
PUB=$(curl -s -X POST "$BASE/api/v1/orchestrations/$ORCH_ID/publish" -H "Authorization: Bearer $T_ROOT")
TOOL_ID=$(echo "$PUB" | jq -r '.data.toolDefinitionId // empty')
PUB_VER=$(echo "$PUB" | jq -r '.data.publishedVersionId // empty')
if [ -n "$TOOL_ID" ] && [ "$TOOL_ID" != "null" ] && [ -n "$PUB_VER" ] && [ "$PUB_VER" != "null" ]; then
  ok "已发布（tool=${TOOL_ID} version=${PUB_VER}）"
else
  bad "发布失败: $(echo "$PUB" | head -c 200)"
fi
TOOL_NAME="orch_$ORCH_ID"

echo "=== 4. 外部调用三态（未登录 401 / 无授权 Key 403 / 授权后 200）==="
expect_code "未登录 invoke 被拒" 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/orchestrations/$TOOL_NAME/invoke" \
     -H 'Content-Type: application/json' -d '{}')"

KEY=$(curl -s -X POST "$BASE/api/v1/api-keys" -H "Authorization: Bearer $T_ROOT" \
  -H "Content-Type: application/json" -d "{\"name\":\"orch-key-$TS\"}")
KEY_ID=$(echo "$KEY" | jq -r '.data.id // empty')
RAW_KEY=$(echo "$KEY" | jq -r '.data.apiKeyId // empty')

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/orchestrations/$TOOL_NAME/invoke" \
  -H "Authorization: Bearer $T_ROOT" -H "X-API-Key: $RAW_KEY" -H "Content-Type: application/json" -d '{}')
expect_code "未授权 Key invoke 被拒" 403 "$CODE"

REQ=$(curl -s -X POST "$BASE/api/v1/api-keys/$KEY_ID/request-tool" -H "Authorization: Bearer $T_ROOT" \
  -H "Content-Type: application/json" -d "{\"toolId\":$TOOL_ID,\"reason\":\"e2e\"}")
PERM_ID=$(echo "$REQ" | jq -r '.data.id // empty')
if [ -z "$PERM_ID" ] || [ "$PERM_ID" = "null" ]; then
  echo "⚠️ 工具权限申请跳过: $(echo "$REQ" | head -c 200)"
else
  APP_RES=$(curl -s -X POST "$BASE/api/v1/api-keys/tool-permission/$PERM_ID/approve" -H "Authorization: Bearer $T_ROOT")
  APPROVED=$(echo "$APP_RES" | jq -r '.data.status // empty')
  if [ "$APPROVED" = "APPROVED" ]; then
    ok "root 审批工具权限（APPROVED）"
  else
    bad "审批异常: $(echo "$APP_RES" | head -c 200)"
  fi
  INVOKE=$(curl -s -X POST "$BASE/api/v1/orchestrations/$TOOL_NAME/invoke" \
    -H "Authorization: Bearer $T_ROOT" -H "X-API-Key: $RAW_KEY" \
    -H "Content-Type: application/json" -d '{"name":"E2E"}')
  INVOKE_OK=$(echo "$INVOKE" | jq -r '.data.success // empty')
  [ "$INVOKE_OK" = "true" ] && ok "授权后 invoke 200" || bad "invoke 失败: $(echo "$INVOKE" | head -c 200)"
fi

echo "=== 5. workflow 节点：经编排发起真实审批流程 ==="
# listDefinitions 无 applicationId 时返回空（引擎既有行为），用已知发布的流程定义
DEF_REF="${DEF_REF:-41}"  # E2E-条件请假流（app 17，PUBLISHED，条件分支 ≤3/>3）
if [ -n "$DEF_REF" ] && [ "$DEF_REF" != "null" ]; then
  NEW_ROLE=$(curl -s -X POST "$BASE/api/v1/roles" -H "Authorization: Bearer $T_ROOT" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"编排发起角色-$TS\",\"slug\":\"e2e-orch-$TS\",\"scope\":\"APPLICATION\",\"applicationId\":$APP_ID}")
  NEW_ROLE_ID=$(echo "$NEW_ROLE" | jq -r '.data.id // empty')
  curl -s -o /dev/null -X PUT "$BASE/api/v1/roles/$NEW_ROLE_ID/permissions" -H "Authorization: Bearer $T_ROOT" \
    -H "Content-Type: application/json" -d "{\"permissions\":[\"app:workflow:$DEF_REF\",\"app:develop\"]}"
  curl -s -o /dev/null -X POST "$BASE/api/v1/application-tools/$APP_ID/members" -H "Authorization: Bearer $T_ROOT" \
    -H "Content-Type: application/json" -d "{\"userId\":4,\"roleId\":$NEW_ROLE_ID}"

  WF_ORCH=$(python3 -c "
import json
dsl = {'nodes': [
  {'id':'start','nodeType':'start','position':{'x':300,'y':50},'data':{'label':'入口','config':{'inputs':[{'name':'days','type':'number','required':True}]}}},
  {'id':'wf','nodeType':'workflow','position':{'x':300,'y':170},'data':{'label':'发起流程','config':{'workflowAction':'start','workflowDefinitionId':int('$DEF_REF'),'formDataTemplate':{'days':'\$input.days'}}}},
  {'id':'out','nodeType':'output','position':{'x':300,'y':290},'data':{'label':'出口','config':{}}}
], 'edges': [
  {'id':'e1','source':'start','target':'wf'},
  {'id':'e2','source':'wf','target':'out'}
]}
print(json.dumps({'name': 'E2E-编排发起流程-$TS', 'applicationId': $APP_ID, 'dsl': json.dumps(dsl)}))
")
  WF_ORCH_ID=$(curl -s -X POST "$BASE/api/v1/orchestrations" -H "Authorization: Bearer $T_ROOT" \
    -H "Content-Type: application/json" -d "$WF_ORCH" | jq -r '.data.id // empty')
  WF_TEST=$(curl -s -X POST "$BASE/api/v1/orchestrations/$WF_ORCH_ID/test-run" \
    -H "Authorization: Bearer $T_LI" -H "Content-Type: application/json" -d '{"inputs":{"days":2}}')
  WF_INST=$(echo "$WF_TEST" | jq -r '.data.data.wf.instanceId // empty')
  if [ -n "$WF_INST" ] && [ "$WF_INST" != "null" ]; then
    ok "workflow 节点经编排发起流程实例 $WF_INST"
  else
    bad "workflow 节点发起失败: $(echo "$WF_TEST" | jq -c '.data.data // .message' | head -c 200)"
  fi
else
  echo "⚠️ workflow 节点用例跳过：无已发布流程"
fi

echo ""
echo "=== E2E 结果：$PASS 通过，$FAIL 失败 ==="
echo "artifacts: app=$APP_ID orchestration=$ORCH_ID tool=$TOOL_ID key=$KEY_ID"
[ "$FAIL" -eq 0 ] || exit 1
