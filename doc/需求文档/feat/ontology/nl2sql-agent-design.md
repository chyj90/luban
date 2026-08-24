# NL2SQL Agent 集成设计文档

## 1. 概述

### 1.0 核心架构理念

**语义层是统一的信息中介**：用户问题 → FAISS 匹配概念 → Jena 语义层扩展出相关概念、关联的 API（action）和库表结构 → **全部统一**交给 LLM → LLM 自己判断是调 API 还是拼 SQL。

```
用户问题 → 语义层（概念匹配 + API绑定 + 表映射 + JOIN）→ 统一上下文 → LLM 决策
                                                                    ├─ 调 API（tool_call）
                                                                    └─ 拼 SQL（nl2sql）
```

将 NL2SQL 能力集成到现有 Agent 体系中，使 Agent 能够：
- 利用 FAISS 概念向量检索找到相关语义概念
- 通过 Jena 语义层获取概念映射（表名、字段名、JOIN 条件）
- 同时获取概念关联的 API 工具（ToolConcept: PRODUCES/CONSUMES）
- 将 API 工具 + 库表结构**统一**提供给 LLM
- LLM 自主选择：调已有 API 或生成 SQL（SELECT only）
- 经 SqlSecurityValidator 校验后执行，返回结果及概念追溯

### 1.1 现有基础设施

| 组件 | 作用 | Agent 接入状态 |
|------|------|:---:|
| OntologyService (Jena) | 构建语义模型，扩展概念关联的工具和映射 | ✅ |
| FaissService | 概念向量检索，search(embedding, topK) | ❌ 待接入 |
| SqlGeneratorService | 概念ID → 映射信息（表名、字段、JOIN） | ❌ 待接入 |
| SqlSecurityValidator | 仅允许 SELECT，禁止 DROP/DELETE 等 | ❌ 待接入 |
| RoleConceptPermissionService | Role → Group(域) 权限检查 | ❌ 待接入 |
| ToolConcept (概念-工具绑定) | 概念关联的 API action（PRODUCES/CONSUMES） | ✅ |
| ConceptMapping (字段映射) | 概念 → 表名.字段名 | ✅ |
| ConceptJoinMapping (JOIN映射) | 概念间 JOIN 条件 | ✅ |

---

## 2. 架构设计

### 2.1 核心思想：语义层统一供给，LLM 统一决策

```
                         ┌──────────────────────────────────┐
                         │       语义层（Jena + FAISS）       │
                         │                                  │
                         │  用户问题 → FAISS 向量检索         │
                         │    → 匹配概念 + 相关概念           │
                         │    → 找到概念关联的 API（action）   │
                         │    → 找到概念关联的库表结构（映射）  │
                         │    → RBAC 域权限过滤              │
                         │                                  │
                         │  输出：统一上下文                  │
                         │  · 可用 API 工具列表              │
                         │  · 可用表结构 + 字段 + JOIN        │
                         │  · 概念关系图                     │
                         └──────────────┬───────────────────┘
                                        │
                                        ▼
                         ┌──────────────────────────────────┐
                         │           LLM（统一决策）          │
                         │                                  │
                         │  同时看到 API 和库表结构，          │
                         │  自主判断：                       │
                         │  · 有现成 API 能覆盖 → tool_call  │
                         │  · 需要拼 SQL 查询 → nl2sql      │
                         │  · 无法回答 → final_answer       │
                         └──────────────┬───────────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
            ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
            │tool_executor │   │nl2sql_executor│   │ final_answer │
            │ 执行 HTTP API │   │ LLM拼SQL→校验 │   │  直接回复     │
            │ 返回结果      │   │ →执行→返回结果│   │              │
            └──────┬───────┘   └──────┬───────┘   └──────────────┘
                   │                  │
                   └────────┬─────────┘
                            │ 结果回 agent，可继续多轮
                            ▼
                        __END__
```

**关键区别**：
- **不是** router 在 tool_call 和 nl2sql 之间二选一
- **而是** 语义层把 API 和库表结构**一起**给 LLM，LLM 看到完整上下文后自己决定用哪个
- `tool_executor` 和 `nl2sql_executor` 是**两个并列的执行器**，都是 LLM 决策后的下游

### 2.2 Agent 图结构

```
__START__
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│                      agent 节点                           │
│                                                          │
│  1. FAISS 检索 → 概念列表                                 │
│  2. Jena 语义扩展 → 相关概念 + API绑定 + 表映射 + JOIN     │
│  3. RBAC 过滤                                             │
│  4. 构建统一上下文 Prompt → 调用 LLM                       │
│  5. 解析 LLM 响应                                         │
│     ├─ tool_call  → router → tool_executor → 回 agent    │
│     ├─ nl2sql     → router → nl2sql_executor → 回 agent  │
│     └─ final_answer → __END__                            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**新增节点：`nl2sql_executor`**

### 2.3 节点职责

| 节点 | 职责 | 说明 |
|------|------|------|
| **agent** | 语义检索 + 构建统一上下文 + 调用 LLM 决策 | 核心节点，语义层在此发挥作用 |
| **tool_executor** | 执行 LLM 选中的 HTTP API 工具 | 调用外部接口，返回结果 |
| **nl2sql_executor** | 根据 LLM 指定的概念和问题，生成 SQL → 校验 → 执行 | 动态拼 SQL 查询数据库 |
| **router** | 根据 LLM 响应的 type 字段路由 | tool_call / nl2sql / final_answer |

### 2.4 tool_executor 与 nl2sql_executor 的关系

| 维度 | tool_executor | nl2sql_executor |
|------|:---:|:---:|
| **触发条件** | LLM 判断有现成 API 能覆盖用户问题 | LLM 判断需要从库表拼 SQL 才能回答 |
| **输入** | `tool_name` + `arguments`（LLM 已选好） | `concept_ids` + 用户问题 |
| **做什么** | 调用预定义的 HTTP API，返回 JSON 结果 | 用表结构上下文让 LLM 生成 SQL，校验后执行 |
| **数据来源** | 外部系统 API | 数据库直查（通过 ConceptMapping 关联的数据源） |
| **能否共存** | 可以。一轮对话中 LLM 可能先调 API 获取参数，再拼 SQL 查询 | 同左 |
| **本质** | 静态工具：API 是运维人员预先配置好的 | 动态工具：SQL 是 LLM 根据表结构现场生成的 |

**一句话总结**：语义层是"信息中介"，把概念翻译成 API 和库表结构两种"资源视图"，统一交给 LLM。LLM 看到完整视图后，自己判断是调 API 还是拼 SQL。两个 executor 只是执行器，不做决策。

---

## 3. 完整数据流

### 3.1 总流程：语义层统一供给 → LLM 统一决策

```
用户问题: "查询所有导师及其学生数量"

┌─ Step 1: FAISS 向量检索 ──────────────────────────────────────────┐
│  FaissService.getEmbedding(问题) → 向量                            │
│  FaissService.search(向量, topK=10) → 匹配概念列表                 │
│  返回: [{id:1, name:"Tutor", score:0.95}, {id:2, name:"Student",  │
│          score:0.87}, {id:3, name:"Course", score:0.72}, ...]      │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ Step 2: Jena 语义扩展（关键步骤，含扩展深度和条数控制）───────────┐
│                                                                     │
│  对每个匹配概念，通过 Jena 语义层扩展：                              │
│                                                                     │
│  2a. 扩展相关概念（ConceptRelation）                                │
│      扩展规则（控制上下文大小，防止爆炸）：                          │
│      ├─ 直接邻居（1 跳）：必扩展                                     │
│      │   Tutor → [has_student]→Student, [teaches]→Course           │
│      ├─ 二级邻居（2 跳）：仅扩展关系类型为 N:1 或 1:N 的             │
│      │   Student → [belongs_to]→Class（N:1，扩展）                │
│      │   Student → [likes]→Hobby（N:M，不扩展）                    │
│      ├─ 三级及以上：不扩展                                          │
│      └─ 总概念数上限：20 个（超过时按 FAISS 分数截断）               │
│                                                                     │
│  2b. 找到概念关联的 API action（双路径并行）                        │
│      ├─ 概念路径（主）：从已扩展的概念中取关联的 ToolConcept         │
│      │   Tutor → [PRODUCES] get_tutor_list (HTTP API)               │
│      │   Student → [PRODUCES] get_student_by_tutor (HTTP API)       │
│      ├─ 工具向量路径（辅）：FAISS 检索工具向量，补充概念路径遗漏     │
│      │   ToolEmbeddingService.search(问题向量, topK=10)             │
│      │   → 只保留已扩展概念关联的工具，合并去重                      │
│      └─ 总 API 工具数上限：15 个（超过时按概念关联度排序截断）       │
│                                                                     │
│  2c. 找到概念关联的库表结构（ConceptMapping + ConceptJoinMapping）   │
│      Tutor → tutor表: id, name, email, department_id               │
│      Student → student表: id, name, grade, tutor_id                │
│      JOIN: tutor.id = student.tutor_id (LEFT)                      │
│                                                                     │
│  输出：统一上下文 = API列表(≤15) + 表结构 + 概念关系(≤20) + JOIN    │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ Step 3: RBAC 权限过滤 ────────────────────────────────────────────┐
│  RoleConceptPermissionService.batchCheck(userId, conceptIds)       │
│  ├─ 有权限的概念/API/表 → 进入统一上下文                            │
│  └─ 无权限 → 记录到 denied，提示用户申请域权限                       │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ Step 4: 构建统一上下文 Prompt → 调用 LLM（一次决策）──────────────┐
│                                                                     │
│  Prompt 同时包含：                                                  │
│  · 可用 API 工具列表（含 name, description, input_schema）          │
│  · 可用表结构（含 表名, 字段, JOIN 条件）                           │
│  · 概念关系图                                                       │
│  · 无权限提示                                                       │
│                                                                     │
│  LLM 看到全部信息后自主决策（一次输出，nl2sql 直接带 SQL）：       │
│  ├─ 有 API 能直接覆盖 → {"type":"tool_call","tool_call":{...}}     │
│  ├─ 需要拼 SQL 查询   → {"type":"nl2sql","sql":"SELECT ...",       │
│  │                        "concept_ids":[...],"explanation":"..."}  │
│  └─ 无法回答          → {"type":"final_answer","answer":"..."}     │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ Step 5: 路由执行 ─────────────────────────────────────────────────┐
│                                                                     │
│  tool_call:                                                        │
│    → tool_executor 执行 HTTP API                                    │
│    → 返回 JSON 结果 → 回 agent（LLM 将结果转为自然语言）             │
│                                                                     │
│  nl2sql:                                                           │
│    → nl2sql_executor（见 3.2）                                     │
│    → LLM 生成 SQL → 校验 → 执行 → 返回结果 + conceptTrace           │
│                                                                     │
│  final_answer:                                                     │
│    → 直接返回 LLM 的回答文本                                        │
└────────────────────────────────────────────────────────────────────┘
```

### 3.2 NL2SQL 执行节点流程（nl2sql_executor 内部）

> 注意：LLM 在第一次调用时已直接输出 SQL（见 4.1），`nl2sql_executor` 只负责校验 + 执行，**不再二次调用 LLM**。

```
Step 1: 从 LLM 响应中获取 sql、concept_ids、question

Step 2: 校验 SQL（SqlSecurityValidator）
  ├─ 禁止非 SELECT
  ├─ 禁止 DROP/ALTER/DELETE/INSERT/UPDATE
  ├─ 禁止危险函数 (SLEEP, LOAD_FILE 等)
  ├─ 校验表访问权限（只能访问 mappings 中的表）
  └─ 校验数据源状态

Step 3: 校验失败 → 抛出错误，回 agent 告知用户

Step 4: 校验通过 → 执行 SQL（带资源限制）
  ├─ 超时：30 秒（JDBC setQueryTimeout）
  ├─ 行数上限：1000 行（自动追加 LIMIT 1000）
  └─ 执行 → 返回结果

Step 5: 结果回 agent，LLM 将查询结果转为自然语言回答
  └─ 返回：
      {
        answer: "LLM 生成的自然语言回答",
        conceptTrace: [...],
        sql: "SELECT t.name, COUNT(s.id) ...",
        data: [查询结果行],
        executed: true
      }
```

---

## 4. Prompt 设计

### 4.1 Agent 主 Prompt（统一上下文，一次决策 → 一次输出）

#### System Prompt

```
你是鲁班 Agent，企业数据查询助手。

你可以通过以下三种方式回答用户问题：

1. 工具调用（tool_call）：执行预定义的 HTTP API 获取数据
2. 语义查询（nl2sql）：利用语义概念映射的库表结构，生成 SQL 查询
3. 直接回答（final_answer）：对于非数据查询问题，直接给出答案

决策规则（重要）：
- 同时看到「可用 API 工具」和「可用库表结构」，选择最合适的方式
- 如果某个 API 能精确覆盖用户问题（一次调用即可获取全部所需数据），优先使用 tool_call
- 如果用户问题涉及聚合（COUNT/SUM/AVG）、分组（GROUP BY）、多表关联、或需要灵活筛选，使用 nl2sql
- 如果两者都能覆盖，优先 tool_call（API 是预优化过的，比动态 SQL 快且稳定）
- 如果某些概念用户无权限 → 明确告知用户需要申请对应域权限
- 如果 API 和库表都无法覆盖 → 直接回答

返回格式（严格 JSON，不要额外文本）：
- 工具调用：{"type":"tool_call","tool_call":{"name":"工具名","arguments":{...}}}
- 语义查询：{"type":"nl2sql","sql":"SELECT ...","concept_ids":[1,2],"explanation":"SQL的简要说明"}
- 最终回答：{"type":"final_answer","answer":"你的回答"}
```

#### 统一上下文 Prompt（buildUnifiedContextPrompt）

> **关键**：API 工具和库表结构在同一个 prompt 中，LLM 同时看到两者，并**一次输出** SQL（不再二次调用 LLM 生成 SQL）。

```
可用 API 工具（可调用获取数据）：
- get_tutor_list [GET /api/tutor/list]
  描述：获取导师列表
  参数：{ department_id?: string }
  关联概念：Tutor（生产该概念的数据）

- get_student_by_tutor [GET /api/student/by-tutor]
  描述：根据导师ID查询学生列表
  参数：{ tutor_id: string }
  关联概念：Student（生产该概念的数据）

可用库表结构（可生成 SQL 查询）：
- Tutor (导师) [概念ID:1]
  映射表：tutor
  字段：id (BIGINT, 主键), name (VARCHAR), email (VARCHAR), department_id (BIGINT)
  关联 API：get_tutor_list (PRODUCES)
  关联关系：
    - has_student → Student (1:N), JOIN: tutor.id = student.tutor_id [LEFT]

- Student (学生) [概念ID:2]
  映射表：student
  字段：id (BIGINT, 主键), name (VARCHAR), grade (VARCHAR), tutor_id (BIGINT)
  关联 API：get_student_by_tutor (PRODUCES)
  关联关系：
    - has_tutor → Tutor (N:1), JOIN: student.tutor_id = tutor.id [LEFT]

无权限概念（需申请权限）：
- Finance (财务) [ID:5] → 需要申请「财务域」权限

用户问题：查询所有导师及其学生数量
```

**LLM 看到上述上下文后的决策逻辑**：
- `get_tutor_list` API 能拿到导师列表，但不能直接拿到学生数量
- `tutor` 表 + `student` 表 + JOIN 能直接 GROUP BY 出学生数量
- → 决策：`nl2sql`，**直接输出** SQL：

```json
{
  "type": "nl2sql",
  "sql": "SELECT t.name, COUNT(s.id) AS student_count FROM tutor t LEFT JOIN student s ON t.id = s.tutor_id GROUP BY t.name",
  "concept_ids": [1, 2],
  "explanation": "通过 LEFT JOIN 关联 tutor 和 student 表，按导师分组统计学生数量"
}
```

### 4.2 结果格式化 Prompt（执行结果回 agent 后）

```
查询结果如下：
SQL: SELECT t.name, COUNT(s.id) as student_count FROM tutor t LEFT JOIN student s ON t.id = s.tutor_id GROUP BY t.name
结果: [{"name":"张三","student_count":5},{"name":"李四","student_count":3}]

请用自然语言回答用户问题：查询所有导师及其学生数量
要求：简洁、准确、包含具体数字。
```

---

## 5. RBAC 权限控制

### 5.1 权限模型

```
User ──(RoleUser)──► Role ──(RoleConceptPermission)──► Group (概念域)
                                                              │
                                                              ▼
                                                         Concept
```

- `RoleConceptPermission`: role_id → group_id，唯一约束 (role_id, group_id)
- 概念通过 `concept.group_id` 归属到域
- `group_id = null` 的概念视为公开（所有人可访问）

### 5.2 权限检查流程

```
1. 获取用户 ID（从 Authentication）
2. 查询用户所属角色: RoleUserRepository.findByUserId(userId)
3. 获取 FAISS 检索到的概念列表
4. batchCheckPermission(userId, conceptIds):
   ├─ 概念无 group_id → 允许
   ├─ 用户的任何角色有该 group_id 权限 → 允许
   └─ 否则 → 拒绝
5. 分类：
   ├─ allowedConcepts: 有权限的，进入 prompt
   └─ deniedConcepts: 无权限的，提示用户申请
```

### 5.3 无权限提示

在 Context Prompt 中列出无权限概念：

```
无权限概念（需申请权限）：
- Finance (财务) [ID:5] → 需要申请「财务域」权限
- HR (人力资源) [ID:8] → 需要申请「人力资源域」权限
```

LLM 在回答中应告知用户：
> "您的问题涉及「财务」和「人力资源」域的数据，但您当前没有这些域的访问权限。请联系管理员申请相应权限。"

---

## 6. 多轮对话

### 6.1 策略：保留 trace + 每轮重检 + 语义链判断

```
每轮对话：
  1. 从历史消息中提取上一轮的 conceptTrace（概念ID列表 + 映射摘要 + 表名列表）
  2. 对当前问题重新 FAISS 检索
  3. 复用判断（三层判断，而非简单的交集 > 50%）：
     ├─ 第一层：概念交集 > 50%？
     │   ├─ 是 → 进入第二层判断
     │   └─ 否 → 用户换了话题，丢弃旧 trace
     ├─ 第二层：上一轮 SQL 涉及的表，当前轮概念是否也映射到这些表？
     │   ├─ 是 → 同一分析链，复用映射
     │   └─ 否 → 虽然概念相同但问题不同（如"张三有多少学生"→"张三的工资"），
     │           丢弃旧映射，重新检索
     └─ 第三层：当前问题是否包含新的聚合/分组/排序语义？
         ├─ 是 → 映射可复用，但 SQL 需要重新生成
         └─ 否 → 同一条分析链的延续，尽量复用
  4. SQL 永远基于当前轮次重新生成，不缓存
```

### 6.2 上下文保留格式

在消息历史中，每轮 nl2sql 结果后追加一条 system 消息：

```json
{
  "role": "system",
  "content": "上一轮语义查询使用了概念: [Tutor(ID:1), Student(ID:2)]，SQL: SELECT ..."
}
```

### 6.3 多轮示例

```
用户: 查询所有导师
Agent: [nl2sql] 共3位导师：张三、李四、王五
       [system] 上一轮使用了概念: [Tutor(ID:1)]

用户: 他们各有多少学生？
Agent: [FAISS检索 → 问题"各有多少学生" → 匹配到 Tutor(ID:1) 和 Student(ID:2)]
       [发现与上轮重叠 → 复用映射]
       [nl2sql] 张三名下5名学生，李四3名，王五7名
```

---

## 7. 安全控制

### 7.1 SqlSecurityValidator 校验点

| 校验项 | 策略 | 说明 |
|--------|------|------|
| SQL 类型 | 仅允许 SELECT | 禁止 INSERT/UPDATE/DELETE/DROP/ALTER 等 |
| 危险操作 | 禁止 | DROP, ALTER, TRUNCATE, CREATE, EXEC, GRANT, REVOKE |
| 危险函数 | 禁止 | SLEEP, BENCHMARK, LOAD_FILE, xp_cmdshell 等 |
| 注释注入 | 禁止 | /* */ 和 -- 注释 |
| SQL 长度 | ≤ 4096 | 防止超长注入 |
| 表访问 | 仅允许映射中的表 | 防止访问未授权表 |
| 数据源状态 | 仅 ACTIVE | 防止访问已停用数据源 |

### 7.2 执行层资源限制（nl2sql_executor 内）

| 限制项 | 策略 | 说明 |
|--------|------|------|
| 执行超时 | 30 秒 | JDBC Statement.setQueryTimeout(30)，超时自动 kill |
| 返回行数 | ≤ 1000 行 | 自动追加 LIMIT 1000（若 LLM 未加），防止百万行返回撑爆内存 |
| 结果集内存 | ≤ 10MB | 结果集序列化后大小超限则截断，标记 truncated=true |
| 连接池保护 | 独立连接池 | NL2SQL 查询使用独立连接池（max 5 连接），不跟业务查询混用 |

### 7.3 三层防护

```
第一层：RBAC 权限过滤
  → 无权限的概念不进入 prompt，LLM 看不到

第二层：SqlSecurityValidator
  → 即使 LLM 生成了恶意 SQL，SQL 层面拦截

第三层：执行资源限制
  → 即使 SQL 合法，也不会拖垮数据库（超时/行数/内存上限）
```

---

## 8. 错误处理

### 8.1 FAISS 不可用

```
降级策略：
  - 概念检索失败 → 不提供概念信息，LLM 仅能使用工具调用
  - 记录日志，不影响工具调用路径
```

### 8.2 LLM 生成 SQL 失败

```
重试策略：
  - 第 1 次失败 → 将错误信息反馈给 LLM，要求修正
  - 第 2 次失败 → 最多重试 2 次
  - 最终失败 → 返回错误信息给用户
```

### 8.3 SQL 校验失败

```
返回结构：
{
  "answer": "SQL 生成失败：禁止的操作 [DROP]",
  "conceptTrace": [...],
  "sql": "生成的 SQL",
  "validationErrors": ["只允许 SELECT 查询"],
  "executed": false
}
```

### 8.4 SQL 执行失败

```
返回结构：
{
  "answer": "查询执行失败：Table 'xxx' doesn't exist",
  "conceptTrace": [...],
  "sql": "SELECT ...",
  "executionError": "Table 'xxx' doesn't exist",
  "executed": false
}
```

### 8.5 无权限

```
返回结构：
{
  "answer": "您的问题涉及以下概念，但您没有访问权限：\n- Finance (财务) → 需要申请「财务域」权限\n请联系管理员。",
  "conceptTrace": [],
  "deniedConcepts": [{"id": 5, "name": "Finance", "groupName": "财务域"}],
  "executed": false
}
```

---

## 9. 数据流结构

### 9.1 AgentState 扩展

在现有 AgentState 基础上新增字段：

```java
// 新增字段
"concept_trace": List<ConceptTraceItem>    // 概念追溯信息
"denied_concepts": List<DeniedConcept>     // 无权限概念
"nl2sql_result": Nl2sqlResult              // NL2SQL 执行结果
```

### 9.2 ConceptTraceItem 结构

```json
{
  "conceptId": 1,
  "conceptName": "Tutor",
  "confidence": 0.95,
  "mappings": [
    {
      "tableName": "tutor",
      "columnName": "name",
      "mappingType": "direct"
    }
  ],
  "joins": [
    {
      "joinType": "LEFT",
      "joinTable": "student",
      "joinCondition": "tutor.id = student.tutor_id"
    }
  ]
}
```

### 9.3 前端展示

前端 `AgentChatPage` 已有 `ConceptTracePanel` 组件，可直接渲染 conceptTrace。需小幅改造以支持反馈闭环。

---

## 10. 用户反馈闭环

### 10.1 概述

用户每次问数后，Agent 回答底部展示：
- **用到的概念 + 关系**（ConceptTracePanel）
- **思维链/推理过程**（reasoning）
- **生成的 SQL**
- **反馈入口**（一键反馈，只需填写问题描述）

反馈提交后，自动记录上下文（sessionId、messageId、思维链、概念、SQL、查询结果），超管在"概念反馈"页面可查看，并可调用 LLM 分析反馈，给出本体调整建议。

### 10.2 完整闭环流程

```
┌─ 用户问数 ─────────────────────────────────────────────────────┐
│                                                                  │
│  Agent 回答: "共有3位导师，张三名下5名学生…"                        │
│                                                                  │
│  ┌─ 概念追溯 ────────────────────────────────────────────────┐  │
│  │ 🔍 匹配了 2 个概念                                         │  │
│  │   Tutor (导师) → tutor表: name, email          95%        │  │
│  │    关联: has_student → Student (LEFT JOIN)                 │  │
│  │   Student (学生) → student表: name, grade      87%        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ 思维链 ──────────────────────────────────────────────────┐  │
│  │ 1. 用户询问"导师及其学生数量"                                  │  │
│  │ 2. FAISS 检索匹配到概念: Tutor(0.95), Student(0.87)         │  │
│  │ 3. 识别关系: Tutor-[has_student]→Student                    │  │
│  │ 4. 生成 SQL: SELECT t.name, COUNT(s.id) ...                 │  │
│  │ 5. 执行查询, 返回 3 条结果                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ 生成 SQL ────────────────────────────────────────────────┐  │
│  │ SELECT t.name, COUNT(s.id) as student_count                │  │
│  │ FROM tutor t                                               │  │
│  │ LEFT JOIN student s ON t.id = s.tutor_id                   │  │
│  │ GROUP BY t.name                                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [ 💬 反馈 ]  ← 用户点击                                        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ 用户提交反馈 ───────────────────────────────────────────────────┐
│                                                                  │
│  用户只需填写问题描述：                                            │
│  ┌──────────────────────────────────────────────────┐            │
│  │ 导师表应该用 teacher 表，不是 tutor 表              │            │
│  └──────────────────────────────────────────────────┘            │
│  [ 提交反馈 ]                                                    │
│                                                                  │
│  系统自动记录：                                                   │
│  - sessionId: "sess-xxx"                                        │
│  - messageId: "msg-xxx"                                         │
│  - userQuestion: "查询所有导师及其学生数量"                        │
│  - reasoning: "1. FAISS 检索... 2. 识别关系... 3. 生成 SQL..."   │
│  - resolvedConcepts: [{"id":1,"name":"Tutor"},...]              │
│  - generatedSql: "SELECT t.name, COUNT(...) ..."                │
│  - queryResult: [{"name":"张三","count":5},...]                 │
│  - userFeedback: "导师表应该用 teacher 表..."                    │
│  - status: "pending"                                            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ 超管审核 ───────────────────────────────────────────────────────┐
│                                                                  │
│  概念反馈页面 (ConceptFeedbackPage)                              │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 反馈列表                                                  │   │
│  │ ┌────────┬──────────┬──────────┬────────┬──────┬──────┐ │   │
│  │ │ 会话ID │ 用户问题  │ 匹配概念  │ 状态   │ 时间  │ 操作 │ │   │
│  │ ├────────┼──────────┼──────────┼────────┼──────┼──────┤ │   │
│  │ │ sess-1 │ 查询导师  │ Tutor    │ 待处理 │ 08-22│ 👁📋 │ │   │
│  │ └────────┴──────────┴──────────┴────────┴──────┴──────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  点击查看详情 → 弹窗展示完整信息                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 反馈详情                                                  │   │
│  │                                                            │   │
│  │ 用户问题: 查询所有导师及其学生数量                             │   │
│  │ 用户反馈: 导师表应该用 teacher 表，不是 tutor 表              │   │
│  │                                                            │   │
│  │ 思维链:                                                    │   │
│  │ 1. FAISS 检索匹配到概念: Tutor(0.95), Student(0.87)       │   │
│  │ 2. 识别关系: Tutor-[has_student]→Student                  │   │
│  │ 3. 生成 SQL: SELECT t.name, COUNT(...) ...                │   │
│  │ 4. 执行查询, 返回 3 条结果                                  │   │
│  │                                                            │   │
│  │ 匹配概念: [Tutor, Student]                                 │   │
│  │ 生成 SQL: SELECT t.name, COUNT(s.id) ...                  │   │
│  │ 查询结果: [{"name":"张三","count":5},...]                  │   │
│  │                                                            │   │
│  │ [ 🤖 LLM 分析 ]  [ ✓ 标记已审核 ]  [ ❌ 关闭 ]              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ LLM 分析 ───────────────────────────────────────────────────────┐
│                                                                  │
│  超管点击「🤖 LLM 分析」→ 调用 LLM 分析反馈                       │
│                                                                  │
│  LLM 分析 Prompt:                                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 你是本体工程专家。请分析以下用户反馈，判断是否需要调整本体。  │   │
│  │                                                            │   │
│  │ 用户问题: 查询所有导师及其学生数量                             │   │
│  │ 用户反馈: 导师表应该用 teacher 表，不是 tutor 表              │   │
│  │                                                            │   │
│  │ 当前概念映射:                                                │   │
│  │ - Tutor → tutor 表: name, email                            │   │
│  │ - Student → student 表: name, grade                        │   │
│  │ - 关系: Tutor-[has_student]→Student                        │   │
│  │                                                            │   │
│  │ 生成的 SQL:                                                 │   │
│  │ SELECT t.name, COUNT(s.id) ... FROM tutor t ...            │   │
│  │                                                            │   │
│  │ 查询结果: [{"name":"张三","count":5},...]                   │   │
│  │                                                            │   │
│  │ 请分析并给出建议：                                           │   │
│  │ 1. 概念定义是否准确？需要如何调整？                            │   │
│  │ 2. 映射关系是否正确？需要如何调整？                            │   │
│  │ 3. 关系定义是否合理？                                         │   │
│  │ 4. 是否需要新建概念、修改映射、或调整关系？                      │   │
│  │                                                            │   │
│  │ 返回 JSON:                                                  │   │
│  │ {                                                           │   │
│  │   "analysis": "分析结论",                                    │   │
│  │   "suggestions": [                                          │   │
│  │     { "type": "rename_concept", "conceptId": 1,             │   │
│  │       "newName": "Teacher", "reason": "..." },              │   │
│  │     { "type": "update_mapping", "conceptId": 1,             │   │
│  │       "tableName": "teacher", "reason": "..." }             │   │
│  │   ],                                                        │   │
│  │   "severity": "high|medium|low"                             │   │
│  │ }                                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  LLM 返回分析结果，超管可选择：                                    │
│  - 接受建议 → 自动执行调整（改名、改映射、改关系）                   │
│  - 标记已审核 → 仅记录，不调整                                     │
│  - 标记已解决 → 问题已处理                                        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 10.3 反馈数据结构

#### ConceptFeedback 实体（已有，确认字段对齐）

```java
@Entity
@Table(name = "concept_feedback")
public class ConceptFeedback {
    private Long id;
    private String sessionId;        // 对话 session ID
    private String messageId;        // 消息 ID
    private String userQuestion;     // 用户原始问题
    private String reasoning;        // 思维链（自动记录）
    private String resolvedConcepts; // 匹配的概念 JSON（自动记录）
    private String generatedSql;     // 生成的 SQL（自动记录）
    private String queryResult;      // 查询结果（自动记录）
    private String userFeedback;     // 用户反馈文本（唯一需要用户填的）
    private String status;           // pending/reviewed/resolved
    private String reviewedBy;       // 审核人
    private String reviewComment;    // 审核意见
    private LocalDateTime createdAt;
    private LocalDateTime reviewedAt;
}
```

#### Agent 响应结构（新增字段）

```json
{
  "answer": "LLM 生成的自然语言回答",
  "conceptTrace": [...],
  "reasoning": "1. FAISS 检索...\n2. 识别关系...\n3. 生成 SQL...",
  "sql": "SELECT ...",
  "queryResult": [{"name":"张三","count":5}],
  "messageId": "msg-xxx",
  "executed": true
}
```

### 10.4 前端改动

#### AgentChatPage 改动

在 Agent 回答消息底部新增"反馈"按钮，点击弹出简化反馈表单：

```tsx
// 每条 agent 消息底部
{msg.role === 'assistant' && msg.executed && (
  <div className="agent-chat-feedback">
    <button onClick={() => setFeedbackMsgId(msg.id)}>
      💬 反馈
    </button>
    {feedbackMsgId === msg.id && (
      <div className="agent-chat-feedback-form">
        <textarea
          placeholder="请描述问题，如：概念匹配错误、SQL 不对..."
          value={feedbackText}
          onChange={(e) => setFeedbackText(e.target.value)}
        />
        <button onClick={() => submitFeedback(msg)}>提交反馈</button>
      </div>
    )}
  </div>
)}
```

提交时自动携带：
- sessionId, messageId（从当前会话获取）
- userQuestion（从当前消息获取）
- reasoning, resolvedConcepts, generatedSql, queryResult（从 msg 获取）
- userFeedback（用户填写的文本）

#### ConceptTracePanel 改动

- 移除现有的独立反馈按钮（每个概念的正确/错误/部分正确）
- 改为只展示概念信息，反馈统一在消息底部

#### ConceptFeedbackPage 改动

- 详情弹窗中新增"🤖 LLM 分析"按钮
- 调用 `/api/v1/concept-feedback/{id}/analyze` 接口
- 展示 LLM 分析结果（analysis + suggestions）
- 对于 actionable 的建议（rename_concept, update_mapping 等），提供"接受建议"按钮

### 10.5 后端改动

#### 新增接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/v1/concept-feedback` | POST | 创建反馈（已有，需对齐字段） |
| `/api/v1/concept-feedback/{id}/analyze` | POST | LLM 分析反馈，调用 LLM 分析并返回建议 |
| `/api/v1/concept-feedback/{id}/apply-suggestion` | POST | 接受 LLM 建议，自动执行本体调整 |

#### ConceptFeedbackService 新增方法

```java
// LLM 分析反馈
public Map<String, Object> analyzeByLlm(Long feedbackId) {
    // 1. 获取反馈记录
    // 2. 构建 LLM 分析 prompt（含用户问题、反馈、概念映射、SQL、结果）
    // 3. 调用 LLM
    // 4. 解析建议（rename_concept, update_mapping, add_relation 等）
    // 5. 返回分析结果
}

// 预览变更影响（dry-run，不实际执行）
public Map<String, Object> previewSuggestion(Long feedbackId, int suggestionIndex) {
    // 根据 suggestion type 计算影响范围：
    // - rename_concept: 列出所有引用该概念的 ConceptRelation、ToolConcept、ConceptJoinMapping
    // - update_mapping: 列出该映射关联的概念和 JOIN
    // - add_relation: 检查是否与已有关系冲突
    // 返回受影响实体列表，供超管确认
}

// 接受建议并执行（需先经过 preview 确认）
public void applySuggestion(Long feedbackId, int suggestionIndex) {
    // 根据 suggestion type 执行：
    // - rename_concept: 更新 Concept.name + 触发 FAISS 索引重建
    // - update_mapping: 更新 ConceptMapping
    // - add_relation: 新增 ConceptRelation
    // - update_join: 更新 ConceptJoinMapping
    // 执行后 reload OntologyService + 重建受影响概念的 FAISS 索引
}
```

> **安全约束**：`applySuggestion` 前必须先调用 `previewSuggestion`，超管在 UI 看到变更预览后确认，才执行实际变更。不允许一键自动修改本体。

---

## 11. 监控与可观测性

### 11.1 概述

监控（系统自动）与概念反馈（用户手动）是**互补关系**，共同构成系统质量保障闭环：

```
┌─────────────────────────────────────────────────────────────────┐
│                      质量保障双循环                              │
│                                                                  │
│  ┌──────────────────────┐    ┌──────────────────────────────┐   │
│  │  监控（系统驱动）      │    │  概念反馈（用户驱动）          │   │
│  │                      │    │                              │   │
│  │  自动采集，覆盖全量    │    │  用户主动，高信号             │   │
│  │  发现趋势性问题        │◄──►│  提供根因和上下文             │   │
│  │  量化评估优化效果      │    │  驱动本体持续改进             │   │
│  │                      │    │                              │   │
│  │  指标：匹配率、失败率   │    │  指标：反馈量、解决率         │   │
│  └──────────┬───────────┘    └──────────────┬───────────────┘   │
│             │                                │                   │
│             └────────────┬───────────────────┘                   │
│                          │                                       │
│                          ▼                                       │
│              ┌───────────────────────┐                           │
│              │  共通数据：conceptTrace │                           │
│              │  + SQL + 执行结果      │                           │
│              │  + LLM 耗时 + 决策类型  │                           │
│              └───────────────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

### 11.2 监控与概念反馈的关系

| 维度 | 监控 | 概念反馈 |
|------|------|----------|
| **触发方式** | 每次请求自动采集 | 用户主动点击反馈 |
| **覆盖范围** | 100% 请求 | 仅用户觉得有问题时 |
| **信号强度** | 噪音多，需要聚合分析 | 信号强，每个反馈都是确认的问题 |
| **发现问题的能力** | 发现趋势性/系统性异常（如某概念匹配率持续下降） | 发现具体错误（如表名映射错了） |
| **提供根因的能力** | 弱，只能告诉你"哪里有问题" | 强，用户直接告诉你"什么错了" |
| **验证修复的能力** | 强，修复后指标变化一目了然 | 弱，只能等用户再次反馈 |

**四个关键联动场景**：

**场景一：监控发现异常 → 触发主动审核**
```
监控发现：概念 "Tutor" 近 7 天匹配率从 95% 降至 62%
  → 自动标记为"待审核"
  → 超管在监控面板看到告警
  → 查看该概念的最近查询样本
  → 发现表结构变更导致表名不同
  → 主动修正映射，无需等用户反馈
```

**场景二：用户反馈 → 监控验证修复效果**
```
用户反馈：Tutor 应该映射到 teacher 表
  → 超管接受建议，更新映射
  → 监控自动对比：修复前后 "Tutor" 概念的匹配率 + SQL 成功率
  → 若指标回升 → 修复有效
  → 若指标不变 → 可能还有其他问题，需进一步排查
```

**场景三：反馈数据作为监控标签**
```
用户反馈标记了"概念错误" → 该条请求的监控数据打上标签
  → 可统计：哪些概念最常被反馈"映射错误"
  → 可训练：用反馈数据训练分类器，自动识别潜在的映射错误
```

**场景四：监控数据作为反馈上下文**
```
超管审核反馈时，监控面板同步展示：
  - 该概念近 30 天的匹配率趋势
  - 该概念的 TOP 10 用户查询
  - 该概念的 SQL 成功率
  → 帮助超管判断：这是个案还是系统性问题
```

### 11.3 监控指标设计

#### 请求级指标（每次 Agent 调用记录一条）

```json
{
  "sessionId": "sess-xxx",
  "messageId": "msg-xxx",
  "timestamp": "2026-08-22T10:30:00Z",
  "userId": 42,
  "userQuestion": "查询所有导师及其学生数量",
  
  "retrieval": {
    "conceptCount": 5,
    "topConceptName": "Tutor",
    "topConceptScore": 0.95,
    "expandedConceptCount": 8,
    "afterRbacCount": 6,
    "toolCount": 3,
    "retrievalLatencyMs": 120
  },
  
  "decision": {
    "type": "nl2sql",
    "conceptIds": [1, 2],
    "llmLatencyMs": 1800,
    "llmTokensUsed": 1200
  },
  
  "execution": {
    "sql": "SELECT t.name, COUNT(s.id)...",
    "datasourceId": 3,
    "validationPassed": true,
    "executionLatencyMs": 250,
    "rowCount": 3,
    "truncated": false,
    "success": true
  },
  
  "result": {
    "answerLength": 85,
    "hasFeedback": false
  }
}
```

#### 聚合指标（定时任务计算）

| 指标 | 计算方式 | 告警阈值 | 用途 |
|------|----------|----------|------|
| 概念匹配率 | 某概念被 FAISS 检索到且被 LLM 使用的比例 | < 60% 告警 | 发现概念定义有问题或过时 |
| 决策分布 | tool_call / nl2sql / final_answer 占比 | 无 | 了解 LLM 决策偏好 |
| SQL 成功率 | SQL 校验通过 + 执行成功的比例 | < 85% 告警 | 发现映射错误或表结构变更 |
| 平均 LLM 延迟 | LLM 调用耗时 P50/P95 | P95 > 5s 告警 | 性能监控 |
| 平均执行延迟 | SQL 执行耗时 P50/P95 | P95 > 10s 告警 | 数据库性能 |
| 用户反馈率 | 有反馈的请求 / 总请求 | > 10% 告警 | 用户体验差 |
| 反馈解决率 | 已解决反馈 / 总反馈 | < 50% 持续 7 天 | 超管处理不及时 |
| 无权限拒绝率 | 因 RBAC 被拒绝的请求 / 总请求 | 无 | 权限覆盖评估 |

### 11.4 监控数据存储

```
监控数据分为两层：

热数据（7 天）：存入 Redis Stream
  → 实时聚合指标，供监控面板展示
  → 7 天后自动过期

冷数据（90 天）：异步写入 MySQL 表 agent_query_log
  → 长期趋势分析
  → 与 concept_feedback 表关联（feedback_id 关联查询日志）
```

### 11.5 监控面板（前端）

```
┌─ 监控面板 ──────────────────────────────────────────────────────┐
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ 总请求    │ │ 决策分布  │ │ SQL成功率 │ │ 平均延迟  │           │
│  │ 1,234    │ │ T:40%    │ │ 92.3%    │ │ 1.8s     │           │
│  │ ↑12%     │ │ N:35%    │ │ ↓3.2%    │ │ ↑0.3s    │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│                                                                  │
│  ┌─ 概念健康度（匹配率倒序）─────────────────────────────────┐   │
│  │ 概念名    匹配率   SQL成功率  反馈数  趋势   操作           │   │
│  │ Tutor     95.2%    100%       0       →    查看详情        │   │
│  │ Student   88.7%    92.1%      1       ↓    查看详情 ⚠     │   │
│  │ Finance   62.1%    85.0%      3       ↓↓   查看详情 🔴    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ 最近异常 ────────────────────────────────────────────────┐   │
│  │ 🔴 Finance 概念匹配率降至 62.1%，连续 3 天下降              │   │
│  │ ⚠ Student 概念有 1 条未解决反馈                             │   │
│  │ ℹ 近 24 小时无权限拒绝 12 次，涉及 3 个概念域               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 11.6 监控与概念反馈的数据关联

```
agent_query_log (监控表)          concept_feedback (反馈表)
┌──────────────────────┐         ┌──────────────────────┐
│ id                   │         │ id                   │
│ session_id           │◄────────│ session_id           │
│ message_id           │◄────────│ message_id           │
│ user_question        │         │ user_question        │
│ concept_ids          │         │ resolved_concepts    │
│ generated_sql        │         │ generated_sql        │
│ execution_result     │         │ query_result         │
│ success              │         │ user_feedback        │
│ user_id              │         │ status               │
│ llm_latency_ms       │         │ created_at           │
│ ...                  │         │ ...                  │
└──────────────────────┘         └──────────────────────┘

关联方式：session_id + message_id 组成联合键
反馈详情页可 JOIN 查询监控数据，展示该请求的完整上下文
```

---

## 12. 现有页面升级建议

### 12.1 现状总览

当前平台有三个页面处于"能用但没什么大用"的状态，需要在新需求中重新定位，充分利用已有代码：

| 页面 | 当前功能 | 问题 |
|------|----------|------|
| **ConceptFeedbackPage** | 列表查看反馈、标记已审核/已解决 | 纯手工状态流转，无 LLM 辅助分析，无变更执行能力，超管只能看不能改 |
| **ConceptSnapshotPage** | 手动创建概念域快照、查看快照列表 | 快照孤立存在，无 diff 对比，无回滚，跟反馈/监控完全脱节 |
| **ConceptEmbeddingPage** | 管理导入任务的异步状态 | 纯运维工具，无业务价值感知 |

### 12.2 升级策略：三位一体联动

核心思路：**反馈 → 审核 → 快照 → 变更 → 监控验证**，这三个页面串联成完整的本体持续改进闭环。

```
┌──────────────────────────────────────────────────────────────────┐
│                    本体持续改进闭环                               │
│                                                                  │
│  用户反馈                                                         │
│    │                                                             │
│    ▼                                                             │
│  ┌──────────────────────┐                                        │
│  │ ConceptFeedbackPage  │ ← 超管审核 + LLM 分析 + 执行变更       │
│  │ （反馈管理中心）       │                                       │
│  └──────────┬───────────┘                                        │
│             │ 执行变更前                                          │
│             ▼                                                    │
│  ┌──────────────────────┐                                        │
│  │ ConceptSnapshotPage  │ ← 自动创建快照 + diff 对比 + 回滚      │
│  │ （变更审计中心）       │                                       │
│  └──────────┬───────────┘                                        │
│             │ 变更后验证                                          │
│             ▼                                                    │
│  ┌──────────────────────┐                                        │
│  │ AgentMetricsPage     │ ← 监控指标变化，验证修复效果            │
│  │ （监控面板）           │                                       │
│  └──────────────────────┘                                        │
│                                                                  │
│  ConceptEmbeddingPage → 当监控发现概念匹配率下降时，              │
│  提示是否需要重新 Embedding / 重建 FAISS 索引                     │
└──────────────────────────────────────────────────────────────────┘
```

### 12.3 ConceptFeedbackPage：从"状态流转"升级为"反馈管理中心"

#### 当前状态

```
现有功能：
├─ 列表：sessionId, userQuestion, matchedConcept, status, submittedBy, time
├─ 筛选：PENDING / REVIEWED / RESOLVED
├─ 操作：标记已审核 → 标记已解决
└─ 详情弹窗：userQuestion, matchedConcept, correctConcept, feedbackType, userComment, thoughtProcess

问题：
├─ 只是看反馈，不能分析反馈
├─ 不能根据反馈执行变更
├─ 看不到这条反馈对应的监控数据
└─ 看完了不知道概念有没有变好
```

#### 升级后

```
升级后功能：
├─ 列表增强
│   ├─ 新增列：反馈类型（概念错误/映射错误/SQL错误/其他）
│   ├─ 新增列：LLM 建议状态（待分析/有建议/已采纳/已忽略）
│   ├─ 新增列：关联监控（该概念当前匹配率 + 趋势箭头）
│   └─ 筛选增强：按反馈类型、按概念名筛选
│
├─ 详情弹窗 → 升级为"反馈工作台"
│   ├─ 左侧：反馈详情（原有内容 + SQL + 查询结果 + 概念追溯）
│   ├─ 右侧：监控面板（该概念近 30 天匹配率趋势 + SQL 成功率）
│   ├─ 底部：操作区
│   │   ├─ [LLM 分析] → 调用 LLM 分析反馈，给出建议
│   │   ├─ [预览变更] → 展示受影响实体（dry-run）
│   │   ├─ [创建快照] → 执行变更前自动/手动创建快照
│   │   ├─ [确认执行] → 执行本体变更（rename_concept / update_mapping 等）
│   │   └─ [忽略] → 标记为已忽略，附忽略原因
│   └─ 变更历史：展示此反馈关联的变更记录
│
└─ 状态流转升级
    PENDING → LLM分析中 → 待审核（有建议）→ 已采纳 → 监控验证中 → 已解决
                                          → 已忽略（附原因）
```

#### 代码改动量

| 改动 | 类型 | 说明 |
|------|------|------|
| 列表列扩展 | 修改 | 新增反馈类型、LLM建议状态、关联监控列 |
| 筛选增强 | 修改 | 新增按反馈类型、概念名筛选 |
| 详情弹窗 | 重写 | 升级为左右分栏工作台，新增 LLM 分析/预览/执行/忽略按钮 |
| 监控数据联动 | 新增 | 调用 AgentMetrics API 展示概念健康度 |
| 变更历史 | 新增 | 展示 feedback_id 关联的变更记录 |

### 12.4 ConceptSnapshotPage：从"孤立快照"升级为"变更审计中心"

#### 当前状态

```
现有功能：
├─ 创建快照：选择概念域 + 版本号 + 变更说明 → 保存当前概念状态
├─ 列表：ID, groupId, version, snapshot data, changeLog, createdBy, time
└─ 问题：快照跟谁都没关系，创建了也不知道跟谁比、怎么用
```

#### 升级后

```
升级后功能：
├─ 快照创建增强
│   ├─ 手动创建（保留）
│   └─ 自动创建：超管在反馈页执行变更时，自动创建快照
│       ├─ 版本号自动生成：v{groupCode}-{YYYYMMDD}-{序号}
│       └─ 变更说明自动填充：来自反馈的 LLM 建议摘要
│
├─ 快照列表增强
│   ├─ 新增列：关联反馈数（此快照由哪些反馈驱动）
│   ├─ 新增列：变更前后监控指标对比（匹配率变化）
│   └─ 操作：对比、回滚、查看详情
│
├─ 快照对比（Diff）— 核心新增
│   ├─ 选择两个快照版本
│   ├─ 展示差异：
│   │   ├─ 新增概念：+5 个
│   │   ├─ 删除概念：-2 个
│   │   ├─ 重命名概念：3 个（Tutor → Teacher）
│   │   ├─ 映射变更：12 个字段映射变化
│   │   └─ JOIN 变更：2 个 JOIN 条件变化
│   └─ 差异标注：每个变更标注来源（反馈ID / 手动 / 导入）
│
├─ 快照回滚
│   ├─ 选择目标快照 → 预览回滚影响 → 确认执行
│   ├─ 回滚前自动创建当前状态快照（安全兜底）
│   └─ 回滚后触发 FAISS 索引重建
│
└─ 关联信息
    ├─ 快照详情页展示：
    │   ├─ 关联的反馈列表（点击跳转到反馈详情）
    │   ├─ 创建快照前后的监控指标变化
    │   └─ 此快照包含的概念列表
    └─ 反馈详情页展示：
        └─ 此反馈关联的快照版本（点击跳转到快照对比）
```

#### 代码改动量

| 改动 | 类型 | 说明 |
|------|------|------|
| 自动快照 | 新增 | `ConceptFeedbackService.applySuggestion()` 中自动调用快照创建 |
| 快照对比 | 新增 | 后端新增 `/api/v1/concept-snapshots/{id1}/diff/{id2}` 接口 |
| 快照回滚 | 新增 | 后端新增 `/api/v1/concept-snapshots/{id}/rollback` 接口 |
| 列表增强 | 修改 | 新增关联反馈数、监控指标列 |
| 关联查询 | 新增 | 快照 ↔ 反馈 双向关联查询 |

### 12.5 ConceptEmbeddingPage：从"任务管理"升级为"语义层健康面板"

#### 当前状态

```
现有功能：
├─ 待处理任务：展示 PENDING/RUNNING 的导入任务
├─ 已处理任务：分页展示 COMPLETED/FAILED 任务
└─ 问题：纯运维视角，普通用户/超管用不上
```

#### 升级后

```
升级后功能：
├─ 保留现有任务管理（运维需要）
│
├─ 新增：语义层健康概览（页面顶部新增卡片区）
│   ├─ FAISS 索引状态：索引概念数 / 总概念数 / 最后更新时间
│   ├─ 待索引概念数：有映射但未 Embedding 的概念
│   ├─ 陈旧概念数：映射变更后未重新 Embedding 的概念
│   └─ 索引健康度评分：基于上述指标的综合评分
│
├─ 与监控联动
│   ├─ 当监控发现某概念匹配率 < 60% 时
│   │   → 自动检查该概念是否在 FAISS 索引中
│   │   → 检查 Embedding 是否过期（映射变更 > 7 天未重建）
│   │   → 在页面顶部展示"待处理建议"
│   └─ 示例提示：
│       "⚠ 概念 'Tutor' 近 7 天匹配率 52%，建议重新 Embedding"
│
└─ 与反馈联动
    ├─ 超管在反馈页执行变更后
    │   → 自动标记受影响概念为"需要重新 Embedding"
    │   → 在 Embedding 页面显示为待处理任务
    └─ 一键重建：选中概念 → 重新 Embedding → 更新 FAISS 索引
```

#### 代码改动量

| 改动 | 类型 | 说明 |
|------|------|------|
| 健康概览卡片 | 新增 | 页面顶部新增索引状态统计 |
| 陈旧概念检测 | 新增 | 后端新增检测逻辑，对比映射更新时间与 Embedding 时间 |
| 监控联动 | 新增 | 匹配率下降 → 自动检查 Embedding 状态 |
| 一键重建 | 新增 | 选中概念 → 触发异步 Embedding 重建任务 |

### 12.6 三个页面与监控的联动关系

```
┌─────────────────────────────────────────────────────────────────────┐
│                        联动关系图                                    │
│                                                                     │
│  AgentMetricsPage（监控面板）                                        │
│  │                                                                  │
│  ├─ 概念匹配率下降 ─────────────────────────────────────────────┐   │
│  │   │                                                          │   │
│  │   ├─→ ConceptEmbeddingPage（语义层健康）                     │   │
│  │   │   检查 Embedding 是否过期 → 提示重建索引                  │   │
│  │   │                                                          │   │
│  │   └─→ ConceptFeedbackPage（反馈管理）                        │   │
│  │       排查是否有未处理的反馈 → 优先处理                       │   │
│  │                                                              │   │
│  ├─ 用户反馈率上升 ─────────────────────────────────────────────┤   │
│  │   └─→ ConceptFeedbackPage                                    │   │
│  │       超管集中处理反馈                                        │   │
│  │                                                              │   │
│  └─ SQL 成功率下降 ─────────────────────────────────────────────┤   │
│      └─→ ConceptFeedbackPage                                    │   │
│          排查映射错误 → LLM 分析 → 变更 → 验证                   │   │
│                                                                     │
│  ConceptFeedbackPage（超管执行变更）                                 │
│  │                                                                  │
│  ├─→ ConceptSnapshotPage（自动创建快照）                            │
│  │   变更前自动快照 → 变更后通知监控验证                            │
│  │                                                                  │
│  ├─→ ConceptEmbeddingPage（标记需要重建）                           │
│  │   概念重命名/映射变更 → 标记对应概念 Embedding 过期              │
│  │                                                                  │
│  └─→ AgentMetricsPage（监控验证）                                   │
│      变更后监控指标变化 → 确认修复有效                               │
│                                                                     │
│  ConceptSnapshotPage（回滚操作）                                     │
│  │                                                                  │
│  ├─→ ConceptEmbeddingPage（重建索引）                               │
│  │   回滚后概念状态变化 → 重建 FAISS 索引                           │
│  │                                                                  │
│  └─→ AgentMetricsPage（监控验证）                                   │
│      回滚后指标是否恢复                                              │
└─────────────────────────────────────────────────────────────────────┘
```

### 12.7 页面升级优先级

| 优先级 | 页面 | 改动范围 | 理由 |
|:---:|------|----------|------|
| **P0** | ConceptFeedbackPage | 升级为反馈工作台 | 核心价值链路：用户反馈 → 超管审核 → 本体变更，必须最先做 |
| **P1** | ConceptSnapshotPage | 升级为变更审计中心 | 保障变更安全（自动快照+回滚），与反馈页联动紧密 |
| **P2** | ConceptEmbeddingPage | 升级为语义层健康面板 | 监控联动 + 索引运维，价值在长期运营中体现 |

---

## 13. 实现计划

### 13.1 阶段一：NL2SQL Agent 集成

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `AgentService.java` | 修改 | 新增 `nl2sql_executor` 节点；增强 `buildSystemPrompt`（含 API/SQL 决策规则）；新增 `buildUnifiedContextPrompt` 整合工具+概念+表结构；增强 `parseResponse` 支持 nl2sql 直接带 SQL |
| `AgentService.java` | 新增方法 | `searchConcepts()` - FAISS 检索；`expandSemanticLayer()` - Jena 扩展（含深度控制）；`buildUnifiedContext()` - 双路径工具检索 + 表结构查询；`executeNl2sql()` - 校验+执行（带资源限制） |
| `OntologyService.java` | 修改 | 新增 `analyzeContext()` 方法，整合概念关系+工具绑定+字段映射+JOIN 映射，含扩展深度控制 |
| `SqlSecurityValidator.java` | 修改 | 新增执行层资源限制：超时 30s、行数上限 1000、结果集内存 10MB |

### 13.2 阶段二：反馈闭环

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `AgentService.java` | 修改 | 响应中增加 `reasoning`、`sql`、`queryResult`、`messageId` 字段 |
| `ConceptFeedbackController.java` | 新增接口 | `POST /{id}/analyze` - LLM 分析；`POST /{id}/preview-suggestion` - 预览变更；`POST /{id}/apply-suggestion` - 接受建议 |
| `ConceptFeedbackService.java` | 新增方法 | `analyzeByLlm()`、`previewSuggestion()`、`applySuggestion()` |
| `AgentChatPage.tsx` | 修改 | 消息底部新增反馈按钮 + 简化反馈表单；`submitFeedback()` 自动携带上下文 |
| `ConceptTracePanel.tsx` | 修改 | 移除独立反馈按钮，只展示概念信息 |
| `ConceptFeedbackPage.tsx` | 修改 | 详情弹窗新增"LLM 分析"按钮 + 变更预览 + "确认执行"操作 |

### 13.3 阶段三：监控与可观测性

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| 新建 `AgentQueryLog.java` | 新增实体 | 监控数据实体，表名 `agent_query_log` |
| 新建 `AgentQueryLogRepository.java` | 新增 | 监控数据持久化 |
| 新建 `AgentMetricsService.java` | 新增 | 聚合指标计算 + 告警检测 |
| `AgentService.java` | 修改 | 每次请求结束时异步写入监控数据 |
| 新建 `AgentMetricsController.java` | 新增 | 监控面板 API |
| 新建 `AgentMetricsPage.tsx` | 新增 | 前端监控面板页面 |

### 13.4 阶段四：现有页面升级

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `ConceptFeedbackPage.tsx` | 重写 | 升级为反馈工作台：列表增强 + 左右分栏详情弹窗 + LLM 分析/预览/执行/忽略操作 |
| `ConceptFeedbackService.java` | 修改 | 新增 `analyzeByLlm()`、`previewSuggestion()`、`applySuggestion()` 方法 |
| `ConceptFeedbackController.java` | 新增接口 | `POST /{id}/analyze`、`POST /{id}/preview-suggestion`、`POST /{id}/apply-suggestion` |
| `ConceptSnapshotPage.tsx` | 重写 | 升级为变更审计中心：自动快照 + diff 对比 + 回滚 + 关联反馈 |
| `ConceptSnapshotService.java` | 新增方法 | `diffSnapshots()`、`rollback()`、`autoSnapshot()` |
| `ConceptSnapshotController.java` | 新增接口 | `GET /{id1}/diff/{id2}`、`POST /{id}/rollback` |
| `ConceptEmbeddingPage.tsx` | 修改 | 新增语义层健康概览卡片 + 陈旧概念检测 + 一键重建 |

### 13.5 预估工作量

| 阶段 | 模块 | 工作量 |
|------|------|--------|
| 阶段一 | AgentService 改造 | 核心，约 300 行 |
| 阶段一 | OntologyService 扩展 | 约 100 行 |
| 阶段一 | SqlSecurityValidator 资源限制 | 约 50 行 |
| 阶段二 | 反馈闭环后端 | 约 200 行 |
| 阶段二 | 反馈闭环前端 | 约 100 行 |
| 阶段三 | 监控后端 | 约 200 行 |
| 阶段三 | 监控前端 | 约 150 行 |
| 阶段四 | 反馈页升级（重写） | 约 300 行 |
| 阶段四 | 快照页升级（重写） | 约 250 行 |
| 阶段四 | Embedding 页升级 | 约 150 行 |
| 总计 | 联调测试 | 3 天 |

---

## 14. 附录：关键代码路径

### 14.1 现有文件索引

| 文件 | 路径 |
|------|------|
| AgentService | `backend/src/main/java/com/luban/service/AgentService.java` |
| OntologyService | `backend/src/main/java/com/luban/service/OntologyService.java` |
| FaissService | `backend/src/main/java/com/luban/service/FaissService.java` |
| SqlGeneratorService | `backend/src/main/java/com/luban/service/SqlGeneratorService.java` |
| SqlSecurityValidator | `backend/src/main/java/com/luban/service/SqlSecurityValidator.java` |
| RoleConceptPermissionService | `backend/src/main/java/com/luban/service/RoleConceptPermissionService.java` |
| ToolEmbeddingService | `backend/src/main/java/com/luban/service/ToolEmbeddingService.java` |
| ConceptFeedbackService | `backend/src/main/java/com/luban/service/ConceptFeedbackService.java` |
| ConceptFeedbackController | `backend/src/main/java/com/luban/controller/ConceptFeedbackController.java` |
| ConceptMappingRepository | `backend/src/main/java/com/luban/repository/ConceptMappingRepository.java` |
| ConceptJoinMappingRepository | `backend/src/main/java/com/luban/repository/ConceptJoinMappingRepository.java` |
| ConceptRelationRepository | `backend/src/main/java/com/luban/repository/ConceptRelationRepository.java` |
| AgentChatPage | `frontend/src/pages/AgentChatPage.tsx` |
| ConceptTracePanel | `frontend/src/components/ConceptTracePanel.tsx` |
| ConceptFeedbackPage | `frontend/src/pages/ConceptFeedbackPage.tsx` |

---

## 15. 平台概念重构：系统配置、本体、开发三模块关系

### 15.1 平台概念总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                         系统配置 (Connect)                           │
│                                                                      │
│  ┌─────────────────────┐    ┌──────────────────────────────────┐   │
│  │ 系统 (ToolGroup)     │    │ 数据源 (Datasource)               │   │
│  │  ├─ API 工具 (HTTP)  │    │  ├─ MySQL / PostgreSQL / REST_API │   │
│  │  └─ ~~SQL 工具~~ ❌   │    │  └─ 维护后平台不直接使用             │   │
│  └─────────┬───────────┘    └──────────────┬───────────────────┘   │
│            │                                │                        │
│            │ 工具只能维护 API                │ 给问数/开发两个模块使用  │
│            │                                │                        │
└────────────┼────────────────────────────────┼────────────────────────┘
             │                                │
             ▼                                │
┌─────────────────────────┐                  │
│   问数 (Ask) - 本体关联   │                  │
│                          │                  │
│  Concept (概念)           │                  │
│  ├─ 关联系统API (action)  │◄─────────────────┘
│  │  └─ ToolConcept       │   跨系统绑定
│  │     PRODUCES/CONSUMES │
│  ├─ 关联表结构 (字段映射) │◄─── ConceptMapping
│  │  └─ table.column      │    (datasource_id)
│  ├─ JOIN 映射             │◄─── ConceptJoinMapping
│  │  └─ targetConcept     │    (datasource_id)
│  └─ 权限: RBAC → 域       │
│     └─ RoleConceptPerm   │
└─────────────────────────┘
             │
             │  Jena 语义分析
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Jena 语义层 → 分析可能使用的概念 + 关联 action + 表字段 → LLM       │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────┐
│  开发 (Apps) - KEY 关联  │
│                          │
│  Application (开发者应用) │
│  └─ 关联 KEY (ApiKey)    │
│     ├─ 申请 API 工具      │◄── ApiKeyTool
│     │  └─ 审批流程        │
│     └─ 申请数据源 ❌ 缺失  │◄── ApiKeyDatasource (待建)
│                          │
│  开发者应用通过 KEY 使用   │
│  关联的 API 和数据源       │
└─────────────────────────┘
```

### 15.2 需求逐条对比现有代码

#### 15.2.1 系统配置：取消 SQL 类型，工具只能维护 API

| 状态 | 说明 |
|:---:|------|
| ❌ 矛盾 | `ToolDefinition.toolType` 当前支持 `"HTTP"`、`"SQL"`、`"MCP_PASSTHROUGH"` 三种类型 |
| ❌ 矛盾 | 前端 `ToolListPage.tsx` 包含完整的 SQL 工具配置界面：`sqlDatasourceId`、`sqlTemplate`、`sqlMaxRows`、`sqlParamsList`、`buildSqlInputSchema()` |
| ❌ 矛盾 | `buildConfig()` 方法支持 `type === 'SQL'` 分支，生成含 `datasourceId`、`sql` 的配置 JSON |
| ❌ 矛盾 | 前端 `TOOL_TYPE_LABELS` 包含 `SQL: 'SQL 查询'` |
| ✅ 已有 | `ToolDefinition.form.toolType` TypeScript 类型定义为 `'HTTP' \| 'SQL' \| 'MCP_PASSTHROUGH'`，需改为 `'HTTP' \| 'MCP_PASSTHROUGH'` |
| ❌ 待确认 | MCP_PASSTHROUGH 是否保留？用户说"工具只能维护API"，MCP 透传算不算 API？需明确 |

**调整方案：**

1. **删除 SQL 工具类型**：
   - `ToolDefinition.java`：`toolType` 字段不变（VARCHAR），但在业务层校验新建工具时拒绝 `SQL` 类型
   - 前端 `ToolListPage.tsx`：删除所有 SQL 相关 UI 和状态变量（`sqlDatasourceId`、`sqlTemplate`、`sqlMaxRows`、`sqlParamsList`、`sqlConfigStep`、`sqlParamMenuOpen`、`sqlParamMenuRef`、`buildSqlInputSchema()`、`insertParamAtCursor` 中的 SQL 调用）
   - `TOOL_TYPE_LABELS` 删除 `SQL: 'SQL 查询'`
   - `buildConfig()` 删除 `type === 'SQL'` 分支
   - 数据库中已有的 SQL 类型工具需要迁移脚本处理（删除或标记为废弃）

2. **MCP 透传是否保留**：需用户确认，若不保留同理删除

#### 15.2.2 系统配置：数据源继续可维护，但平台不直接使用

| 状态 | 说明 |
|:---:|------|
| ✅ 已有 | `Datasource` 实体，`DatasourceRepository`，`DatasourceService` 完整 CRUD + 连接测试 |
| ✅ 已有 | 前端 `ToolListPage.tsx` 中已有 `activeTab === 'datasources'` 的完整数据源管理 Tab |
| ✅ 已有 | 数据源类型支持 `MySQL`、`PostgreSQL`、`REST_API` |
| ⚠️ 部分 | 数据源当前被 SQL 工具使用（`config.datasourceId`），删除 SQL 工具后此关联自然消失 |
| ⚠️ 部分 | 数据源被 `ConceptMapping.datasourceId` 和 `ConceptJoinMapping.datasourceId` 使用，这是给问数模块用的，符合预期 |
| ⚠️ 部分 | 数据源被 `Query.datasourceId` 使用（开发模块的查询），符合预期 |
| ❌ 缺失 | 数据源没有与 KEY 的关联（见 13.2.4） |

**调整方案：**
- 删除 SQL 工具类型后，`Datasource` 的 `config` 不再被工具直接消费
- 数据源的 consumer 变为：① 问数模块（通过 ConceptMapping/ConceptJoinMapping）② 开发模块（通过 Query + KEY）
- 数据源管理前端保持不变，继续维护 CRUD + 连接测试

#### 15.2.3 问数模块：本体关联系统 API 作为 action

| 状态 | 说明 |
|:---:|------|
| ✅ 已有 | `ToolConcept` 实体：`tool_id` → `concept_id`，支持 `PRODUCES`/`CONSUMES` 关系 |
| ✅ 已有 | `ConceptController.getConceptTools(id)` 获取概念绑定的工具 |
| ✅ 已有 | `ConceptService.bindToolConcept()` / `unbindToolConcept()` |
| ✅ 已有 | 前端 `ConceptEditorPage.tsx` 工具绑定弹窗，支持选择绑定关系类型 |
| ✅ 已有 | 工具绑定支持跨系统：`ToolDefinition` 通过 `group_id` 归属到 `ToolGroup`（系统），但 `ToolConcept` 不限制 `group_id`，天然支持跨系统 |
| ⚠️ 部分 | 工具选择弹窗（`handleOpenToolPicker`）调用 `listToolDefinitions()` 返回所有工具，未按系统分组展示，用户体验不佳 |
| ⚠️ 部分 | 工具选择弹窗未显示工具所属系统名称，用户无法区分不同系统的同名工具 |
| ⚠️ 部分 | 前端 `availableTools` 类型为 `{ id, displayName, description }[]`，缺少 `groupId`/`groupName` |

**调整方案：**
1. 前端 `handleOpenToolPicker` 改为调用 `listToolDefinitions` 时携带 group 信息，或并行调用 `listToolGroups` 构建系统映射
2. 工具选择弹窗按系统分组展示，每个系统下列出其 API 工具
3. `availableTools` 类型扩展为 `{ id, displayName, description, groupId, groupName }`
4. 删除 SQL 工具后，工具选择弹窗中不会出现 SQL 类型工具

#### 15.2.3.1 问数模块：本体关联表结构（字段映射 + JOIN 映射）

| 状态 | 说明 |
|:---:|------|
| ✅ 已有 | `ConceptMapping` 实体：`concept_id` → `datasource_id` → `table_name.column_name`，支持 `direct`/`computed` 映射类型 |
| ✅ 已有 | `ConceptJoinMapping` 实体：`concept_id` → `target_concept` + `relation_type` + `join_table` + `join_condition` + `datasource_id` |
| ✅ 已有 | 前端 `ConceptEditorPage.tsx` 侧边栏完整展示字段映射和 JOIN 映射，支持添加/编辑/删除 |
| ✅ 已有 | `ConceptMappingService.autoMatch()` 自动匹配概念到表字段（LLM 驱动） |
| ✅ 已有 | `ConceptJoinMapping` 跨概念 JOIN，`targetConcept` 可以是任意概念，支持跨系统 |
| ✅ 已有 | `ConceptJoinMapping` 有 `datasource_id` 字段，支持指定数据源 |
| ✅ 已有 | `SqlGeneratorService` 提供 `getMappingContext(conceptIds)` 返回映射信息供 LLM 使用 |

**无需调整，已有功能完整。**

#### 15.2.3.2 问数模块：Jena 分析概念 + action + 表字段 → LLM

| 状态 | 说明 |
|:---:|------|
| ✅ 已有 | `OntologyService` 基于 Jena 构建语义模型，`expandByConcepts()` 扩展概念关联的工具集 |
| ✅ 已有 | `ToolConceptRepository.findByConceptIdIn()` 批量查询概念关联的工具 |
| ✅ 已有 | `ConceptMappingRepository.findByConceptId()` 查询概念的字段映射 |
| ✅ 已有 | `ConceptJoinMappingRepository` 查询 JOIN 映射 |
| ⚠️ 部分 | Jena 当前主要用于扩展工具集（`expandByConcepts`），未完整实现"分析可能使用的概念及其关联 action 和表字段"这条链路 |
| ⚠️ 部分 | 缺少一个统一的 `ConceptAnalysisService` 将 Jena 推理结果 + 工具绑定 + 字段映射 + JOIN 映射整合为 LLM 可用的上下文 |

**调整方案：**
1. 新增或扩展 `OntologyService` 方法：`analyzeContext(conceptIds)` → 返回
   ```json
   {
     "concepts": [{ "id": 1, "name": "Tutor", "description": "..." }],
     "relations": [{ "source": "Tutor", "target": "Student", "type": "has_student" }],
     "actions": [{ "toolId": 5, "toolName": "query_device_status", "relation": "PRODUCES" }],
     "mappings": [{ "tableName": "tutor", "columnName": "name", "mappingType": "direct" }],
     "joins": [{ "joinType": "LEFT", "joinTable": "student", "joinCondition": "tutor.id = student.tutor_id" }]
   }
   ```
2. 此方法在 `buildContextPrompt` 中调用，将整合后的上下文提供给 LLM

#### 15.2.3.3 问数模块：权限通过 RBAC 关联的域设置

| 状态 | 说明 |
|:---:|------|
| ✅ 已有 | `RoleConceptPermission` 实体：`role_id` → `group_id`（概念域） |
| ✅ 已有 | `RoleConceptPermissionService.batchCheckPermission(userId, conceptIds)` |
| ✅ 已有 | `Concept.group_id` 归属到 `OntologyGroup`（概念域） |
| ✅ 已有 | `group_id = null` 的概念视为公开（所有人可访问） |
| ✅ 已有 | 文档 5.2 节已详细描述权限检查流程 |
| ✅ 已有 | 文档 5.3 节已描述无权限提示机制 |

**无需调整，已有功能完整。**

#### 15.2.4 开发模块：开发者应用关联 KEY

| 状态 | 说明 |
|:---:|------|
| ✅ 已有 | `ApiKey` 实体：`owner_id` 归属用户，支持 `ACTIVE`/`REVOKED` 状态 |
| ✅ 已有 | `ApiKeyService.generateKey()` 生成 `lb_` 前缀的 48 位 KEY |
| ✅ 已有 | `ApiKeyService.listByOwner(ownerId)` 按用户查询 |
| ✅ 已有 | 前端 `ApiKeyPage.tsx` 完整 KEY 管理页面：生成/重命名/吊销/恢复/永久删除 |
| ⚠️ 部分 | `Application`（开发者应用）实体存在，但**未直接关联** `ApiKey` |
| ❌ 缺失 | 开发者应用页面中没有"关联 KEY"的入口 |
| ❌ 缺失 | 没有 `ApplicationApiKey` 关联表或多对多关系 |

**现有 Application 实体关键字段：**
```java
// Application.java - 当前字段
private Long id;
private String name;
private String slug;
private String description;
private Long createdBy;
private String status;
// 缺少：apiKeyId 或关联表
```

**调整方案：**
1. 新增 `ApplicationApiKey` 关联表或直接在 `Application` 中新增 `api_key_id` 字段
2. 前端应用详情页新增"关联 KEY"功能，展示已关联的 KEY 列表
3. 一个应用可以关联多个 KEY（多对多），或一个应用关联一个 KEY（一对一），需确认

#### 15.2.4.1 开发模块：为 KEY 申请关联的 API 和数据源

| 状态 | 说明 |
|:---:|------|
| ✅ 已有 | `ApiKeyTool` 实体：`api_key_id` → `tool_id`，支持 `PENDING`/`APPROVED`/`REJECTED` 状态 |
| ✅ 已有 | `ApiKeyService.requestToolPermission()` 申请工具权限，自动启动工作流审批 |
| ✅ 已有 | `ApiKeyService.approveToolPermission()` / `rejectToolPermission()` 审批 |
| ✅ 已有 | `ApiKeyController` 完整接口：`/request-tool`、`/request-tools`、`/approve`、`/reject` |
| ✅ 已有 | 前端 `ApiKeyPage.tsx` 有工具权限申请和审批 UI |
| ❌ 缺失 | **没有 `ApiKeyDatasource` 实体**：KEY 无法关联数据源 |
| ❌ 缺失 | `ApiKeyService` 中没有数据源权限申请/审批方法 |
| ❌ 缺失 | `ApiKeyController` 中没有数据源相关接口 |
| ❌ 缺失 | 前端没有 KEY 关联数据源的 UI |

**调整方案：**
1. **新增 `ApiKeyDatasource` 实体**：
   ```java
   @Entity
   @Table(name = "api_key_datasource", uniqueConstraints = {
       @UniqueConstraint(columnNames = {"api_key_id", "datasource_id"})
   })
   public class ApiKeyDatasource {
       private Long id;
       private Long apiKeyId;
       private Long datasourceId;
       private String status; // PENDING/APPROVED/REJECTED
       private Long workflowInstanceId;
       private LocalDateTime createdAt;
       private LocalDateTime updatedAt;
   }
   ```
2. `ApiKeyService` 新增方法：`requestDatasourcePermission()`、`approveDatasourcePermission()`、`rejectDatasourcePermission()`、`listKeyDatasources()`
3. `ApiKeyController` 新增接口：`POST /{keyId}/request-datasource`、`GET /{keyId}/datasources`、`POST /datasource-permission/{id}/approve`、`POST /datasource-permission/{id}/reject`
4. 前端 `ApiKeyPage.tsx` 新增"数据源权限"Tab 或面板

#### 15.2.4.2 开发模块：开发者应用使用通过 KEY 关联的 API 和数据源

| 状态 | 说明 |
|:---:|------|
| ⚠️ 部分 | 当前 `Query` 实体关联 `applicationId` 和 `datasourceId`，但未校验 KEY 权限 |
| ⚠️ 部分 | `QueryService.executeSql()` 直接执行 SQL，未验证调用方 KEY 是否有该数据源权限 |
| ❌ 缺失 | 开发者应用通过 KEY 调用 API 工具时，缺少 KEY 鉴权中间件/过滤器 |
| ❌ 缺失 | 没有统一的 "KEY 鉴权 → 资源访问控制" 流程 |

**调整方案：**
1. 新增 `ApiKeyAuthFilter` 或拦截器，从请求头 `X-API-Key` 提取 KEY，校验有效性
2. 校验 KEY 对目标资源（工具/数据源）的权限状态是否为 `APPROVED`
3. `QueryService.executeSql()` 增加 KEY 数据源权限校验
4. 工具执行（`ToolExecutor`）增加 KEY 工具权限校验

---

### 15.3 矛盾汇总与调整优先级

| 优先级 | 矛盾点 | 涉及文件 | 调整动作 |
|:---:|--------|----------|----------|
| **P0** | 删除 SQL 工具类型 | `ToolDefinition.java`（业务校验）、`ToolListPage.tsx`（删除 SQL UI） | 前端删除 SQL 配置界面；后端拒绝 SQL 类型创建；数据库迁移处理已有 SQL 工具 |
| **P0** | 新增 `ApiKeyDatasource` 实体 | 新建 `ApiKeyDatasource.java`、`ApiKeyDatasourceRepository.java` | KEY 关联数据源的基础数据模型 |
| **P1** | 新增 KEY 数据源权限申请/审批 | `ApiKeyService.java`、`ApiKeyController.java` | 参照 `ApiKeyTool` 的申请/审批模式 |
| **P1** | 前端 KEY 数据源权限 UI | `ApiKeyPage.tsx` | 新增"数据源权限"管理面板 |
| **P1** | 应用关联 KEY | `Application.java` 或新建关联表 | 新增 `ApplicationApiKey` 关联或直接字段 |
| **P1** | 前端应用关联 KEY UI | 应用详情页 | 新增"关联 KEY"操作 |
| **P2** | 工具选择弹窗按系统分组 | `ConceptEditorPage.tsx` | `handleOpenToolPicker` 增加系统分组展示 |
| **P2** | Jena 统一分析出口 | `OntologyService.java` 或新建 `ConceptAnalysisService` | 新增 `analyzeContext()` 方法整合概念+工具+映射 |
| **P2** | KEY 鉴权过滤器 | 新建 `ApiKeyAuthFilter.java` | 从请求头提取 KEY，校验资源权限 |
| **P3** | 查询执行增加 KEY 权限校验 | `QueryService.java`、`ToolExecutor` | 执行前校验 KEY 对数据源/工具的权限 |
| **P3** | MCP_PASSTHROUGH 是否保留 | `ToolDefinition`、`ToolListPage.tsx` | 需用户确认 |

### 15.4 数据模型变更总结

#### 15.4.1 需新增的实体

| 实体 | 表名 | 用途 |
|------|------|------|
| `ApiKeyDatasource` | `api_key_datasource` | KEY 与数据源的多对多关联，含审批状态 |
| `ApplicationApiKey` | `application_api_key` | 开发者应用与 KEY 的关联（或直接在 Application 加字段） |

#### 15.4.2 需删除/废弃的现有功能

| 功能 | 范围 | 影响 |
|------|------|------|
| SQL 工具创建 | 前端 + 后端校验 | 不影响已有 HTTP 工具 |
| SQL 工具配置 UI | `ToolListPage.tsx` | 约 80 行代码删除 |
| 已有 SQL 工具数据 | 数据库 | 根据实际数据量决定迁移策略（删除或标记废弃） |

#### 15.4.3 需扩展的现有功能

| 功能 | 现有状态 | 目标状态 |
|------|----------|----------|
| 工具选择弹窗 | 平铺所有工具 | 按系统分组展示 |
| `ApiKeyService` | 仅支持工具权限 | 新增数据源权限管理 |
| `ApiKeyController` | 仅工具权限接口 | 新增数据源权限接口 |
| `Application` 实体 | 无 KEY 关联 | 新增 KEY 关联 |
| KEY 鉴权 | 无 | 新增请求级 KEY 鉴权 |
| 资源访问控制 | 无 KEY 校验 | 执行前校验 KEY 权限 |

### 15.5 关键流程示意

#### 15.5.1 问数模块完整链路

```
用户问数
  │
  ▼
FAISS 向量检索 → 相关概念列表
  │
  ▼
RBAC 权限过滤 (RoleConceptPermission → group_id)
  ├─ 有权限 → 继续
  └─ 无权限 → 提示用户申请域权限
  │
  ▼
Jena 语义分析 (OntologyService.analyzeContext)
  ├─ 概念关系 (ConceptRelation)
  ├─ 关联 API action (ToolConcept: PRODUCES/CONSUMES)
  ├─ 字段映射 (ConceptMapping: table.column)
  └─ JOIN 映射 (ConceptJoinMapping)
  │
  ▼
构建上下文 → LLM
  ├─ 选择工具执行 (HTTP API)
  └─ 生成 SQL 执行 (NL2SQL)
  │
  ▼
返回结果 + 概念追溯 + 思维链 + 反馈入口
```

#### 15.5.2 开发模块完整链路

```
开发者创建 Application
  │
  ▼
生成/关联 KEY (ApiKey)
  │
  ▼
为 KEY 申请资源权限
  ├─ 申请 API 工具 (ApiKeyTool: PENDING → 审批 → APPROVED)
  └─ 申请数据源 (ApiKeyDatasource: PENDING → 审批 → APPROVED)
  │
  ▼
开发者应用发起请求
  ├─ 请求头携带 X-API-Key
  │
  ▼
KEY 鉴权过滤器
  ├─ 校验 KEY 有效性 (ACTIVE, 未过期)
  ├─ 校验目标工具权限 (ApiKeyTool.status = APPROVED)
  └─ 校验目标数据源权限 (ApiKeyDatasource.status = APPROVED)
  │
  ▼
执行请求 → 返回结果
```

---

## 16. 附录：补充文件索引

### 16.1 系统配置相关

| 文件 | 路径 |
|------|------|
| ToolDefinition | `backend/src/main/java/com/luban/entity/ToolDefinition.java` |
| ToolGroup | `backend/src/main/java/com/luban/entity/ToolGroup.java` |
| Datasource | `backend/src/main/java/com/luban/entity/Datasource.java` |
| DatasourceService | `backend/src/main/java/com/luban/service/DatasourceService.java` |
| DatasourceController | `backend/src/main/java/com/luban/controller/DatasourceController.java` |
| ToolListPage | `frontend/src/pages/ToolListPage.tsx` |

### 16.2 本体/问数相关

| 文件 | 路径 |
|------|------|
| Concept | `backend/src/main/java/com/luban/entity/Concept.java` |
| ConceptMapping | `backend/src/main/java/com/luban/entity/ConceptMapping.java` |
| ConceptJoinMapping | `backend/src/main/java/com/luban/entity/ConceptJoinMapping.java` |
| ConceptRelation | `backend/src/main/java/com/luban/entity/ConceptRelation.java` |
| ToolConcept | `backend/src/main/java/com/luban/entity/ToolConcept.java` |
| OntologyGroup | `backend/src/main/java/com/luban/entity/OntologyGroup.java` |
| RoleConceptPermission | `backend/src/main/java/com/luban/entity/RoleConceptPermission.java` |
| OntologyService | `backend/src/main/java/com/luban/service/OntologyService.java` |
| ConceptService | `backend/src/main/java/com/luban/service/ConceptService.java` |
| ConceptMappingService | `backend/src/main/java/com/luban/service/ConceptMappingService.java` |
| ConceptController | `backend/src/main/java/com/luban/controller/ConceptController.java` |
| ConceptEditorPage | `frontend/src/pages/ConceptEditorPage.tsx` |

### 16.3 开发/KEY 相关

| 文件 | 路径 |
|------|------|
| ApiKey | `backend/src/main/java/com/luban/entity/ApiKey.java` |
| ApiKeyTool | `backend/src/main/java/com/luban/entity/ApiKeyTool.java` |
| Application | `backend/src/main/java/com/luban/entity/Application.java` |
| Query | `backend/src/main/java/com/luban/entity/Query.java` |
| ApiKeyService | `backend/src/main/java/com/luban/service/ApiKeyService.java` |
| ApiKeyController | `backend/src/main/java/com/luban/controller/ApiKeyController.java` |
| QueryService | `backend/src/main/java/com/luban/service/QueryService.java` |
| ApiKeyPage | `frontend/src/pages/ApiKeyPage.tsx` |