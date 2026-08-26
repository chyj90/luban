# 端到端测试用例：自动洞察 Phase 2（本体维度下钻）

---

## 一、测试环境准备

### 1.1 获取超管 Token

```bash
TOKEN=$(curl -s -X POST 'http://localhost:8080/api/v1/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"root@luban.local","account":"root","password":"123456"}' | jq -r '.data.token')
echo "TOKEN=$TOKEN"
```

### 1.2 导入测试数据库

```bash
mysql -u root -p luban < backend/sql/test-data.sql
```

### 1.3 创建行业（如尚未创建）

```bash
# 创建零售电商行业
curl -s -X POST 'http://localhost:8080/api/v1/industries' \
  -H 'Authorization: Bearer '"$TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"retail_ecommerce","displayName":"零售电商","description":"零售电商行业数据分析"}'

# 创建运营商网络行业
curl -s -X POST 'http://localhost:8080/api/v1/industries' \
  -H 'Authorization: Bearer '"$TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"carrier_network","displayName":"运营商网络","description":"运营商网络运维分析"}'
```

### 1.4 创建数据源（test-data.sql 已包含，验证用）

```bash
# 验证数据源
curl -s 'http://localhost:8080/api/v1/datasources' \
  -H 'Authorization: Bearer '"$TOKEN" | jq '.data[] | {id, slug, name}'
```

**预期输出**：
```json
{"id":1,"slug":"retail_ecommerce","name":"零售电商库"}
{"id":2,"slug":"carrier_network","name":"运营商网络库"}
```

---

## 二、测试用例概览

| 编号 | 测试模块 | 测试项 | 验证方式 |
|------|---------|--------|---------|
| TC-01 | 关系类型管理 | 平台内置关系 + 行业自定义关系加载 | API + UI |
| TC-02 | 关系类型校验 | 非法关系类型创建拦截 | API |
| TC-03 | ontology_advisor | LLM 自动生成本体配置 | Chat UI |
| TC-04 | 自动洞察-退货率 | 多轮下钻分析根因 | Chat UI |
| TC-05 | 自动洞察-产能 | 异常阈值触发下钻 | Chat UI |
| TC-06 | 自动洞察-客诉 | 多轮下钻 + 关联维度 | Chat UI |
| TC-07 | 自动洞察-库存 | 异常阈值触发下钻 | Chat UI |
| TC-08 | 自动洞察-成本 | code_mode 统计计算 | Chat UI |
| TC-09 | 自动洞察-运营商 | 跨数据源分析 | Chat UI |
| TC-10 | 本体变更审核 | ontology_action 触发+审核 | Chat UI + UI |
| TC-11 | 下钻维度查询 | getDrillDimensions/getDrillPath API | API |
| TC-12 | 前端状态提示 | 下钻分析中进度提示 | Chat UI |

---

## 三、测试用例

### TC-01：关系类型管理 - 平台内置 + 行业自定义

**目的**：验证平台启动后自动注入 3 种内置关系 + 6 种行业默认关系，前端从 API 动态加载。

**步骤**：

```bash
# 查询零售电商行业的关系类型
INDUSTRY_ID=1
curl -s "http://localhost:8080/api/v1/industries/$INDUSTRY_ID/relations" \
  -H 'Authorization: Bearer '"$TOKEN" | jq '.data[] | {relationType, isBuiltin, description}'
```

**预期结果**：
- 返回 9 种关系类型（3 内置 + 6 行业默认）
- DRILLS_INTO、DRILLED_FROM、CORRELATED 的 `isBuiltin` 为 `true`
- COMPUTED_FROM、PARENT_OF 等 6 种的 `isBuiltin` 为 `false`

**UI 验证**：
1. 打开本体编辑器，选择"零售电商"行业
2. 选中两个概念，弹出关系类型选择框
3. 应显示 9 种关系类型，内置类型有"内置"标签

---

### TC-02：关系类型校验 - 非法类型拦截

**目的**：验证创建概念关系时，未注册的关系类型被拦截。

**步骤**：

```bash
# 尝试创建一个非法关系类型
curl -s -X POST 'http://localhost:8080/api/v1/concepts/1/relations' \
  -H 'Authorization: Bearer '"$TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"targetConceptId":2,"relationType":"INVALID_TYPE","description":"test"}' | jq
```

**预期结果**：
```json
{
  "code": 400,
  "message": "关系类型 'INVALID_TYPE' 未在行业 X 中注册，请先在行业关系管理中注册"
}
```

---

### TC-03：ontology_advisor - LLM 自动生成本体

**目的**：验证 LLM 能通过 ontology_action 自动分析表结构并生成本体配置建议。

**前置条件**：TC-01 通过，测试数据已导入。

**步骤**：
1. 以超管身份登录，进入 Chat 页面
2. 输入以下提示词：

```
帮我配置零售电商退货率分析本体，数据源"零售电商库"。根概念"退货率"，异常阈值 > 5%，下钻维度：产品线 → 地区 → 客户 → 批次 → 订单，关联维度：客户投诉率。需要用到 orders、returns、complaints 表，请配置完整的 ConceptMapping、ConceptJoinMapping、ConceptRelation。
```

**预期结果**：
- AI 返回 `ontology_action` 类型的响应
- 前端显示"本体变更建议"卡片（超管可见，普通用户不可见）
- 卡片包含：概念列表、映射配置、JOIN 关系、DRILLS_INTO 下钻关系
- 可进入本体编辑器审核变更（TC-10）

**普通用户验证**：
- 切换普通用户登录，输入相同提示词
- 应返回提示"本体变更仅超管可用"或 AI 仅做分析不做变更建议

---

### TC-04：自动洞察-退货率异常（核心场景）

**目的**：验证多轮下钻分析，AI 自动从整体趋势一直下钻到根因。

**前置条件**：TC-03 完成，本体已配置。

**步骤**：
1. 在 Chat 页面输入：

```
上个月退货率为什么涨了？
```

**预期行为**：

| 轮次 | 预期动作 | 预期前端提示 |
|------|---------|-------------|
| 第 1 轮 | 查询整体退货率趋势 SQL | 🔍 正在执行数据分析查询... |
| 第 1 轮结果 | 发现退货率 8.5%，超过 5% 阈值 → 触发下钻 | 🔍 正在分析第 1 轮下钻结果... |
| 第 2 轮 | 按产品线下钻查询 | 🔍 正在下钻分析第 2 轮... |
| 第 2 轮结果 | 发现产品线 1 退货率 12% | 🔍 正在分析第 2 轮下钻结果... |
| 第 3 轮 | 按地区下钻（华东区） | 🔍 正在下钻分析第 3 轮... |
| 第 3 轮结果 | 发现华东区批次 2024-B3 有问题 | - |

**最终答案格式**：
```json
{
  "type": "final_answer",
  "answer_type": "root_cause",
  "reasoning": "完整推理链...",
  "answer": "根因结论的自然语言描述",
  "evidence": [
    {"step":1,"dimension":"整体退货率","finding":"8.5%，超过5%阈值","anomaly":true},
    {"step":2,"dimension":"产品线","finding":"产品线1退货率12%","anomaly":true},
    {"step":3,"dimension":"地区","finding":"华东区退货率18%","anomaly":true}
  ],
  "root_cause": "华东区批次2024-B3存在质量问题",
  "suggestion": "建议暂停该批次发货并排查质量"
}
```

---

### TC-05：自动洞察-产能下降

**目的**：验证异常阈值（< 80%）触发自动下钻。

**步骤**：
1. 在 Chat 页面输入：

```
昨天产线产能为什么低于 80%？
```

**预期行为**：
- AI 查询产能数据，确认低于 80% 阈值
- 按产线下钻发现产线 3 异常
- 按设备下钻发现设备 2 故障停机
- 最终输出根因：设备 2 故障导致产线 3 产能下降

---

### TC-06：自动洞察-客诉上升

**目的**：验证多轮下钻 + 关联维度分析。

**步骤**：
1. 在 Chat 页面输入：

```
最近客诉率为什么超 3%？
```

**预期行为**：
- 查询整体客诉率，确认超过 3% 阈值
- 按销售渠道下钻 → 发现渠道 2 客诉最多
- 按物流商下钻 → 发现物流商 3 问题
- 关联维度：订单量趋势（确认不是订单量暴涨导致）
- 最终输出根因

---

### TC-07：自动洞察-库存积压

**目的**：验证异常阈值（> 60 天）触发下钻。

**步骤**：
1. 在 Chat 页面输入：

```
库存周转天数为什么超过 60 天？
```

**预期行为**：
- 查询库存周转天数，确认超过 60 天阈值
- 按物料下钻 → 发现物料 1/2 积压
- 按供应商下钻 → 发现供应商 1 过量采购
- 最终输出根因

---

### TC-08：自动洞察-成本异常

**目的**：验证 code_mode 统计计算（如离群值检测、时间序列分解）。

**步骤**：
1. 在 Chat 页面输入：

```
单位制造成本为什么超预算 110%？
```

**预期行为**：
- 查询成本数据
- 可能触发 code_mode 进行统计检验（如 Z-score 离群值检测）
- 按成本项下钻 → 按原材料下钻 → 发现原料价格波动
- 最终输出根因

---

### TC-09：自动洞察-运营商跨省专线故障

**目的**：验证跨数据源分析和运营商场景。

**步骤**：
1. 在 Chat 页面输入：

```
昨天跨省专线为什么故障？
```

**预期行为**：
- 查询运营商网络库的告警数据
- 按专线下钻 → 按光缆段/传输段/IP链路下钻
- 追溯承载关系（network_topology 表）
- 最终输出根因

---

### TC-10：本体变更审核

**目的**：验证 ontology_action 生成的变更需要超管审核后才能生效。

**步骤**：
1. 以超管身份在 Chat 中触发 ontology_action（如 TC-03）
2. 打开本体编辑器，点击"本体变更审核"按钮
3. 查看待审核变更列表，应包含：
   - 操作类型（CREATE/UPDATE/DELETE）
   - 变更前后 Diff 对比
   - 操作人、触发方式、时间
4. 逐条审核或批量通过
5. 验证通过后概念/关系/映射已生效

**API 验证**：
```bash
# 查询待审核变更
curl -s 'http://localhost:8080/api/v1/ontology-changes?status=PENDING' \
  -H 'Authorization: Bearer '"$TOKEN" | jq

# 批准变更
curl -s -X POST 'http://localhost:8080/api/v1/ontology-changes/1/approve' \
  -H 'Authorization: Bearer '"$TOKEN" | jq
```

---

### TC-11：下钻维度查询 API

**目的**：验证 getDrillDimensions 和 getDrillPath API。

**步骤**：

```bash
CONCEPT_ID=1  # 退货率概念 ID

# 获取直接下钻子维度
curl -s "http://localhost:8080/api/v1/concepts/$CONCEPT_ID/drill-dimensions" \
  -H 'Authorization: Bearer '"$TOKEN" | jq

# 获取完整下钻路径树
curl -s "http://localhost:8080/api/v1/concepts/$CONCEPT_ID/drill-path" \
  -H 'Authorization: Bearer '"$TOKEN" | jq
```

**预期结果**：
- `drill-dimensions` 返回直接子维度列表（产品线、地区、客户、批次、订单）
- 每个维度包含 `conceptId`、`conceptName`、`anomalyThresholdExpr`
- `drill-path` 返回完整树形结构，包含 `children` 嵌套

---

### TC-12：前端状态提示

**目的**：验证下钻分析过程中前端显示正确的进度提示。

**步骤**：
1. 执行 TC-04 场景
2. 观察 Chat 消息流中的 SSE 进度事件

**预期提示顺序**：
```
正在检索相关概念和数据库表...
🔍 正在执行数据分析查询...
🔍 正在分析第 1 轮下钻结果...
🔍 正在下钻分析第 2 轮...
🔍 正在分析第 2 轮下钻结果...
🔍 正在下钻分析第 3 轮...
```

---

## 四、异常场景测试

### TC-13：Python 服务不可用时的 code_mode 降级

**目的**：验证 embedding-service 不可用时，Prompt 中移除 code_mode 选项。

**步骤**：
1. 停止 embedding-service（`kill` 或 `docker stop`）
2. 重启后端服务
3. 在 Chat 中输入需要统计计算的查询（如 TC-08 成本分析）
4. 观察 AI 是否自动使用 nl2sql 替代 code_mode

**预期结果**：
- Prompt 中不包含 code_mode 格式说明
- AI 使用 nl2sql 完成数据分析

---

### TC-14：普通用户触发 ontology_action

**目的**：验证非超管用户无法触发本体变更。

**步骤**：
1. 以普通用户登录
2. 输入 TC-03 的提示词
3. 观察 AI 响应

**预期结果**：
- AI 不返回 ontology_action 类型响应
- 本体变更建议卡片不显示
- 或 AI 返回"本体变更仅超管可用"提示

---

### TC-15：下钻轮数限制

**目的**：验证 MAX_DRILL_ROUNDS=3 限制生效。

**步骤**：
1. 继续下钻分析（如 TC-04 场景）
2. 观察在 3 轮下钻后 AI 是否强制输出 final_answer

**预期结果**：
- 第 3 轮 SQL 执行后，AI 不再触发新一轮下钻
- 直接输出 root_cause 类型的 final_answer

---

## 五、测试检查清单

- [ ] TC-01：9 种关系类型全部加载，内置/自定义区分正确
- [ ] TC-02：非法关系类型被拦截，错误信息明确
- [ ] TC-03：ontology_advisor 正常工作，本体变更建议卡片可见
- [ ] TC-04：退货率 3 轮下钻，根因定位准确
- [ ] TC-05：产能异常阈值触发下钻
- [ ] TC-06：客诉多轮下钻 + 关联维度
- [ ] TC-07：库存异常阈值触发下钻
- [ ] TC-08：code_mode 统计计算可用
- [ ] TC-09：运营商场景跨数据源分析
- [ ] TC-10：本体变更审核流程完整
- [ ] TC-11：下钻维度 API 返回正确
- [ ] TC-12：前端进度提示正确显示
- [ ] TC-13：Python 服务不可用时代码降级
- [ ] TC-14：普通用户无法触发本体变更
- [ ] TC-15：下钻轮数限制 3 轮