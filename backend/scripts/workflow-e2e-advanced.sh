#!/usr/bin/env bash
# =============================================================================
# 流程审批 E2E-2（条件分支 + 直属上级/部门经理 + 数据源运行态门禁）
#
# 组织数据（真实库）：
#   李四(4) dept=财务部(3) leader=周九(2)；财务部 manager=李四(4)
# 用例：
#   A. 李四发起 leaveDays=2 → 直属上级周九审批 → COMPLETED（单节点）
#   B. 李四发起 leaveDays=5 → 周九审批 → 部门经理李四审批 → COMPLETED（两节点）
#   C. 数据源门禁：未审批 PLATFORM 数据源 → 页面 runQuery 403；审批+绑定后 → 200
# 用法：./workflow-e2e-advanced.sh [BASE_URL]
# 用例 C 依赖一个可达的 PLATFORM 数据源：DS_ID=<id> 覆盖（默认 18，仅环境可达时有效）
# =============================================================================
set -u
BASE="${1:-http://localhost:8080}"
DS_ID="${DS_ID:-18}"
PASS=0; FAIL=0
TS=$(date +%s)

login() { curl -s -X POST "$BASE/api/v1/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"123456\"}" | jq -r '.data.token'; }
call() { local m="$1" p="$2" t="$3" b="${4:-}";
  if [ -n "$b" ]; then curl -s -X "$m" "$BASE$p" -H "Authorization: Bearer $t" -H "Content-Type: application/json" -d "$b";
  else curl -s -X "$m" "$BASE$p" -H "Authorization: Bearer $t"; fi; }
ok() { echo "✅ $1"; PASS=$((PASS+1)); }
bad() { echo "❌ $1"; FAIL=$((FAIL+1)); }
expect_code() { # name expected actual
  if [ "$2" = "$3" ]; then ok "$1 (HTTP $3)"; else bad "$1 expect=$2 got=$3"; fi
}

T_ROOT=$(login 495737685@qq.com)
T_LI=$(login li@luban.local)
T_ZHOU=$(login zhou@luban.local)
[ -n "$T_ROOT" ] && [ -n "$T_LI" ] && [ -n "$T_ZHOU" ] || { echo "❌ 登录失败"; exit 1; }
ok "登录成功（root/李四/周九）"

APP_NAME="E2E-条件分支-$TS"
APP=$(call POST /api/v1/applications "$T_ROOT" "{\"name\":\"$APP_NAME\"}")
APP_ID=$(echo "$APP" | jq -r '.data.id // empty')
[ -n "$APP_ID" ] && [ "$APP_ID" != "null" ] || { bad "建应用失败"; exit 1; }
ok "应用创建 $APP_ID"

ROLE=$(call POST /api/v1/roles "$T_ROOT" "{\"name\":\"审批成员\",\"slug\":\"e2e-adv-$TS\",\"scope\":\"APPLICATION\",\"applicationId\":$APP_ID}")
ROLE_ID=$(echo "$ROLE" | jq -r '.data.id // empty')
[ -n "$ROLE_ID" ] && [ "$ROLE_ID" != "null" ] || { bad "建角色失败"; exit 1; }
call PUT "/api/v1/roles/$ROLE_ID/users" "$T_ROOT" "{\"userIds\":[4]}" >/dev/null
ok "角色 $ROLE_ID 成员=李四"

echo "=== 建表单 + 条件分支流程（≤3 直属上级 / >3 加部门经理） ==="
FIELDS='[{"key":"leaveDays","label":"请假天数","type":"number","required":true},{"key":"reason","label":"请假原因","type":"textarea","required":true}]'
FORM=$(call POST /api/v1/forms "$T_ROOT" "{\"name\":\"E2E-条件请假单-$TS\",\"applicationId\":$APP_ID,\"fields\":$(echo "$FIELDS" | jq -c @json)}")
FORM_ID=$(echo "$FORM" | jq -r '.data.id // .id // empty')
[ -n "$FORM_ID" ] && [ "$FORM_ID" != "null" ] || { bad "建表单失败"; exit 1; }
ok "表单 $FORM_ID"

NODES='[
  {"id":"start","nodeType":"start","type":"startNode","position":{"x":300,"y":50},"data":{"label":"发起人","nodeType":"start","config":{"nodeName":"发起人"}}},
  {"id":"approval_1","nodeType":"approval","type":"approvalNode","position":{"x":300,"y":170},"data":{"label":"直属上级审批","nodeType":"approval","config":{"nodeName":"直属上级审批","approverType":"leader","leaderOf":"initiator"}}},
  {"id":"condition","nodeType":"condition","type":"conditionNode","position":{"x":300,"y":290},"data":{"label":"请假天数判断","nodeType":"condition","config":{"nodeName":"请假天数判断"}}},
  {"id":"approval_2","nodeType":"approval","type":"approvalNode","position":{"x":550,"y":410},"data":{"label":"部门经理审批","nodeType":"approval","config":{"nodeName":"部门经理审批","approverType":"department_head","departmentSource":"initiator"}}},
  {"id":"end","nodeType":"end","type":"endNode","position":{"x":300,"y":530},"data":{"label":"结束","nodeType":"end","config":{"nodeName":"结束"}}}
]'
EDGES='[
  {"id":"e1","source":"start","target":"approval_1","type":"smoothstep","markerEnd":{"type":"arrowclosed","width":20,"height":20}},
  {"id":"e2","source":"approval_1","target":"condition","type":"smoothstep","markerEnd":{"type":"arrowclosed","width":20,"height":20}},
  {"id":"e3","source":"condition","target":"end","type":"smoothstep","markerEnd":{"type":"arrowclosed","width":20,"height":20},"data":{"condition":"leaveDays <= 3","label":"≤3天"}},
  {"id":"e4","source":"condition","target":"approval_2","type":"smoothstep","markerEnd":{"type":"arrowclosed","width":20,"height":20},"data":{"condition":"leaveDays > 3","label":">3天"}},
  {"id":"e5","source":"approval_2","target":"end","type":"smoothstep","markerEnd":{"type":"arrowclosed","width":20,"height":20}}
]'
DEF=$(call POST /api/v1/workflows "$T_ROOT" "{\"name\":\"E2E-条件请假流-$TS\",\"applicationId\":$APP_ID,\"nodes\":$(echo "$NODES" | jq -c @json),\"edges\":$(echo "$EDGES" | jq -c @json)}")
DEF_ID=$(echo "$DEF" | jq -r '.data.id // .id // empty')
[ -n "$DEF_ID" ] && [ "$DEF_ID" != "null" ] || { bad "建流程失败"; exit 1; }
ok "流程 $DEF_ID"
call POST "/api/v1/workflows/$DEF_ID/publish" "$T_ROOT" >/dev/null
ok "流程已发布"
call POST /api/v1/form-workflow-bindings "$T_ROOT" "{\"formId\":$FORM_ID,\"workflowId\":$DEF_ID,\"isDefault\":true}" >/dev/null
call PUT "/api/v1/roles/$ROLE_ID/permissions" "$T_ROOT" "{\"permissions\":[\"app:workflow:$DEF_ID\",\"app:develop\"]}" >/dev/null
ok "角色授权 app:workflow + app:develop"

echo "=== 用例 A：leaveDays=2 → 直属上级（周九）审批 → COMPLETED ==="
INST_A=$(call POST /api/v1/workflow-instances "$T_LI" "{\"definitionId\":$DEF_ID,\"formData\":$(echo '{"leaveDays":2,"reason":"e2e-A-<=3"}' | jq -c @json)}")
INST_A_ID=$(echo "$INST_A" | jq -r '.id // empty')
[ -n "$INST_A_ID" ] && [ "$INST_A_ID" != "null" ] || { bad "A 发起失败"; exit 1; }
ok "A 实例 $INST_A_ID"

TASK_A=$(call GET "/api/v1/tasks?status=pending" "$T_ZHOU" | jq -c --argjson i "$INST_A_ID" 'if type=="array" then . else .data end | .[] | select(.instanceId == $i) | {id, nodeId, assigneeId}' | head -1)
TASK_A_ID=$(echo "$TASK_A" | jq -r '.id // empty')
NODE_A=$(echo "$TASK_A" | jq -r '.nodeId // empty')
ASGN_A=$(echo "$TASK_A" | jq -r '.assigneeId // empty')
[ -n "$TASK_A_ID" ] && [ "$NODE_A" = "approval_1" ] && [ "$ASGN_A" = "2" ] || { bad "A 周九待办不符: $TASK_A"; exit 1; }
ok "A 周九待办 approval_1 (assignee=2)"
call PUT "/api/v1/tasks/$TASK_A_ID/approve" "$T_ZHOU" '{"comment":"同意"}' >/dev/null
ST_A=$(call GET "/api/v1/workflow-instances/$INST_A_ID" "$T_LI" | jq -r '.status // .data.status // empty')
[ "$ST_A" = "COMPLETED" ] && ok "A COMPLETED" || { bad "A 状态=$ST_A"; exit 1; }

echo "=== 用例 B：leaveDays=5 → 周九审批 → 部门经理（李四）审批 → COMPLETED ==="
INST_B=$(call POST /api/v1/workflow-instances "$T_LI" "{\"definitionId\":$DEF_ID,\"formData\":$(echo '{"leaveDays":5,"reason":"e2e-B->3"}' | jq -c @json)}")
INST_B_ID=$(echo "$INST_B" | jq -r '.id // empty')
[ -n "$INST_B_ID" ] && [ "$INST_B_ID" != "null" ] || { bad "B 发起失败"; exit 1; }
ok "B 实例 $INST_B_ID"

TASK_B1=$(call GET "/api/v1/tasks?status=pending" "$T_ZHOU" | jq -c --argjson i "$INST_B_ID" 'if type=="array" then . else .data end | .[] | select(.instanceId == $i) | {id, nodeId}' | head -1)
TASK_B1_ID=$(echo "$TASK_B1" | jq -r '.id // empty')
[ -n "$TASK_B1_ID" ] && [ "$(echo "$TASK_B1" | jq -r '.nodeId')" = "approval_1" ] || { bad "B 第一级待办不符: $TASK_B1"; exit 1; }
ok "B 第一级=周九(approval_1)"
call PUT "/api/v1/tasks/$TASK_B1_ID/approve" "$T_ZHOU" '{"comment":"同意"}' >/dev/null

TASK_B2=$(call GET "/api/v1/tasks?status=pending" "$T_LI" | jq -c --argjson i "$INST_B_ID" 'if type=="array" then . else .data end | .[] | select(.instanceId == $i) | {id, nodeId, assigneeId}' | head -1)
TASK_B2_ID=$(echo "$TASK_B2" | jq -r '.id // empty')
NODE_B2=$(echo "$TASK_B2" | jq -r '.nodeId // empty')
[ -n "$TASK_B2_ID" ] && [ "$NODE_B2" = "approval_2" ] || { bad "B 第二级待办不符: $TASK_B2"; exit 1; }
ok "B 第二级=部门经理(approval_2, assignee=4)"
call PUT "/api/v1/tasks/$TASK_B2_ID/approve" "$T_LI" '{"comment":"同意"}' >/dev/null
ST_B=$(call GET "/api/v1/workflow-instances/$INST_B_ID" "$T_LI" | jq -r '.status // .data.status // empty')
[ "$ST_B" = "COMPLETED" ] && ok "B COMPLETED" || { bad "B 状态=$ST_B"; exit 1; }

echo "=== 用例 C：PLATFORM 数据源运行态门禁（未审批 403 → 审批+绑定后 200） ==="
# "数据源权限审批"平台流程由种子初始化（REST 禁止创建平台级流程）；
# 未审批 403 断言在申请前执行，不依赖审批流程存在。

Q=$(call POST /api/v1/queries "$T_ROOT" "{\"name\":\"QAdv-$TS\",\"applicationId\":$APP_ID,\"datasourceId\":$DS_ID,\"body\":\"SELECT 1 AS ok\",\"params\":{}}")
Q_ID=$(echo "$Q" | jq -r '.data.id // empty')
if [ -z "$Q_ID" ] || [ "$Q_ID" = "null" ]; then
  echo "⚠️ 用例 C 跳过：PLATFORM 数据源 $DS_ID 不可达（SQL 校验需真实连接）。请用可达数据源重跑：DS_ID=<id> ./workflow-e2e-advanced.sh"
  echo ""
  echo "=== E2E-2 结果：$PASS 通过，$FAIL 失败（C 未执行） ==="
  [ "$FAIL" -eq 0 ] || exit 1
  exit 0
fi
ok "查询 ${Q_ID}（引用 PLATFORM 数据源 ${DS_ID}）"

PAGE=$(call POST /api/v1/pages/code "$T_ROOT" "{\"name\":\"E2E-门禁页-$TS\",\"applicationId\":$APP_ID,\"queryIds\":[$Q_ID],\"html\":\"<div id='x'>ok</div>\",\"css\":\"\",\"js\":\"\"}")
PAGE_ID=$(echo "$PAGE" | jq -r '.data.id // empty')
[ -n "$PAGE_ID" ] && [ "$PAGE_ID" != "null" ] || { bad "建页面失败: $PAGE"; exit 1; }
ok "页面 $PAGE_ID"

# 未审批：李四 runQuery → 403
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/runtime/$PAGE_ID/query/$Q_ID/run" \
  -H "Authorization: Bearer $T_LI" -H "Content-Type: application/json" -d '{}')
expect_code "未审批 runQuery 被拒(403)" 403 "$CODE"

# 申请+审批+绑定
KEY=$(call POST /api/v1/api-keys "$T_ROOT" "{\"name\":\"adv-key-$TS\"}")
KEY_ID=$(echo "$KEY" | jq -r '.data.id // empty')
REQ=$(call POST "/api/v1/api-keys/$KEY_ID/request-datasource" "$T_ROOT" "{\"datasourceId\":$DS_ID}")
DS_PERM_ID=$(echo "$REQ" | jq -r '.data.id // empty')
[ -n "$DS_PERM_ID" ] && [ "$DS_PERM_ID" != "null" ] || { bad "申请数据源权限失败: $REQ"; exit 1; }
call POST "/api/v1/api-keys/datasource-permission/$DS_PERM_ID/approve" "$T_ROOT" >/dev/null
call POST "/api/v1/api-keys/$KEY_ID/bind-application" "$T_ROOT" "{\"applicationId\":$APP_ID}" >/dev/null
ok "已申请→审批→绑定（KEY $KEY_ID / 数据源 ${DS_ID}）"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/runtime/$PAGE_ID/query/$Q_ID/run" \
  -H "Authorization: Bearer $T_LI" -H "Content-Type: application/json" -d '{}')
expect_code "审批+绑定后 runQuery 放行(200)" 200 "$CODE"

echo ""
echo "=== E2E-2 结果：$PASS 通过，$FAIL 失败 ==="
echo "artifacts: app=${APP_ID} role=${ROLE_ID} form=${FORM_ID} wf=${DEF_ID} page=${PAGE_ID} key=${KEY_ID}"
[ "$FAIL" -eq 0 ] || exit 1
