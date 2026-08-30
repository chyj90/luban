# Ontology Plugin 设计文档

> 目标：做一个**完全本地化**的本体知识图谱工具，不依赖任何云平台。用户可以在 Claude Code / OpenCode 等 Agent 中**直接创建、编辑、查询本体**，所有数据以文件形式存储在本地。

---

## 一、产品定位

### 1.1 一句话定义

**一个本地文件驱动的本体知识图谱工作台**——Agent 对话即本体编辑器，ontology.json 是唯一的数据源。

### 1.2 核心理念

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   不依赖云平台，不依赖 Luban 后端，不依赖任何外部服务。              │
│                                                                  │
│   用户本地机器上：                                                 │
│   ┌──────────────────────────────────────────┐                   │
│   │  ontology.json  ←── 读写 ──→  Agent 对话  │                   │
│   │  （本地文件，可 git 版本管理）              │                   │
│   └──────────────────────────────────────────┘                   │
│                                                                  │
│   用户通过自然语言对话，就能：                                      │
│   • 创建/修改/删除概念、关系、映射                                   │
│   • 搜索、展开、下钻本体                                           │
│   • 基于本体生成 SQL                                              │
│                                                                  │
│   所有变更自动保存到 ontology.json，你可以 git commit 它。          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 1.3 与 Luban 的关系

**插件是完全独立的，不依赖 Luban。** 两者的关系是「可互操作的对等工具」，而非「主从依赖」：

| | Ontology Plugin | Luban 后端 |
|---|---|---|
| **定位** | 本地工作台 | Web 协作平台 |
| **数据存储** | 本地 ontology.json 文件 | MySQL 数据库 |
| **建模方式** | Agent 对话 | Web UI 拖拽 |
| **使用场景** | 个人开发者、数据分析师 | 团队协作、企业级管理 |
| **互操作** | 可导入 Luban 导出的 JSON | 可导入插件生成的 JSON |
| **是否需要对方** | ❌ 不需要 | ❌ 不需要 |

### 1.4 本体能力清单

插件完整实现 Luban 本体的核心能力：

| 能力 | 说明 | 类型 |
|------|------|------|
| **概念管理** | 创建/修改/删除概念，层级树结构 | 设计 |
| **关系管理** | 9 种内置关系类型，含计算公式 | 设计 |
| **表映射** | 概念 → 数据库表/列的映射 | 设计 |
| **JOIN 映射** | 跨表 JOIN 条件配置 | 设计 |
| **概念搜索** | 关键词匹配概念名和描述 | 消费 |
| **关系展开** | 沿关系类型展开（传递性、对称性） | 消费 |
| **下钻路径** | DRILLS_INTO 传递链，完整下钻树 | 消费 |
| **关联分析** | CORRELATED 对称展开，交叉验证 | 消费 |
| **公式解析** | COMPUTED_FROM/DERIVED_FROM 因子拆解 | 消费 |
| **SQL 生成** | 概念 + 映射 → 自动生成 SQL | 消费 |

### 1.5 前置条件

插件本身是**零依赖**的纯文本文件，但要让 Agent 发挥完整能力，需要以下前置条件：

| 条件 | 必需？ | 说明 |
|------|--------|------|
| **Agent 客户端** | ✅ 必需 | Claude Code / OpenCode / Cursor / Trae 等任意支持 Skill 的 Agent |
| **文件读写权限** | ✅ 必需 | Agent 能读取和写入本地文件（所有主流 Agent 都支持） |
| **数据库 MCP 工具** | ⚠️ 可选 | 如需执行 SQL，需要预先安装数据库 MCP 工具（见下方推荐） |
| **Python 运行时** | ❌ 不需要 | 纯文本 Skill，无需任何运行时 |
| **网络连接** | ❌ 不需要 | 插件本身离线工作；执行 SQL 时需要能连通目标数据库 |

**推荐的数据库 MCP 工具**（用户自行选择安装）：

| 数据库 | 推荐 MCP 工具 | 安装方式 |
|--------|-------------|----------|
| MySQL | `mysql-mcp-server` | `npx @anthropic/mcp-server-mysql` 或社区版本 |
| PostgreSQL | `postgres-mcp-server` | `npx @anthropic/mcp-server-postgres` 或社区版本 |
| SQLite | `sqlite-mcp-server` | 各 Agent 市场均有提供 |

> **注意**：数据库 MCP 工具是用户已有的基础设施，不属于本体插件的一部分。本体插件只负责「理解概念 → 生成 SQL」，SQL 执行委托给已有的数据库工具。

### 1.6 部署模型

```
┌──────────────────────────────────────────────────────────────────┐
│                       用户本地机器                                │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │           Claude Code / OpenCode / Cursor                  │  │
│  │                         │                                  │  │
│  │     ┌───────────────────┼───────────────────┐              │  │
│  │     │                   │                   │              │  │
│  │     ▼                   ▼                   ▼              │  │
│  │  ┌──────────┐    ┌──────────────┐    ┌──────────────┐     │  │
│  │  │ Ontology │    │  MySQL MCP   │    │  PG MCP      │     │  │
│  │  │ Skill    │    │  (用户已有)   │    │  (用户已有)   │     │  │
│  │  │          │    │              │    │              │     │  │
│  │  │ 概念设计  │    │  执行 SQL    │    │  执行 SQL    │     │  │
│  │  │ 概念搜索  │    │  查表结构    │    │  查表结构    │     │  │
│  │  │ 关系展开  │    │              │    │              │     │  │
│  │  │ SQL 生成  │    │              │    │              │     │  │
│  │  └────┬─────┘    └──────┬───────┘    └──────┬───────┘     │  │
│  │       │                 │                   │             │  │
│  │       ▼                 ▼                   ▼             │  │
│  │  ontology.json      目标数据库           目标数据库         │  │
│  │  (本地文件)                                              │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ❌ 不需要任何云平台                                               │
│  ❌ 不需要 Luban 后端                                             │
│  ❌ 不需要 Python 运行时                                          │
│  ❌ 不需要 FAISS 向量服务                                         │
│  ❌ 不需要网络连接（插件本身）                                      │
│  ✅ 只需要：Skill 文件 + ontology.json + Agent 客户端              │
│  ⚠️  执行 SQL 时：需要数据库 MCP 工具 + 目标数据库连通              │
└──────────────────────────────────────────────────────────────────┘
```

### 1.7 数据库连接方案

**本体插件不管理数据库连接。** 数据库的连通和管理由用户已有的数据库 MCP 工具负责。插件只负责两件事：

1. **存储连接元数据**：ontology.json 中记录数据源信息（host、port、库名、类型），**不包含密码**
2. **生成 SQL**：基于概念映射生成正确的 SQL 语句

#### 两种运行模式

```
┌─────────────────────────────────────────────────────────────────┐
│                    模式一：纯 SQL 生成（默认）                     │
│                                                                 │
│  用户问题 → 概念匹配 → 关系展开 → 映射查询 → 输出 SQL              │
│                                                                 │
│  要求：不需要数据库凭据，不需要网络，不需要数据库 MCP 工具           │
│  适用：用户手动复制 SQL 到自己的 SQL 客户端执行                     │
│       Agent 将 SQL 交给已有的数据库 MCP 工具执行                    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    模式二：表结构推断（可选）                       │
│                                                                 │
│  用户提供表结构 → 自动创建概念、映射                                │
│  或：Agent 通过数据库 MCP 工具查询 SHOW TABLES / DESCRIBE          │
│                                                                 │
│  要求：数据库 MCP 工具已安装 + 目标数据库连通                       │
│  适用：已有数据库，需要快速建立本体                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### 数据源信息存储

ontology.json 中只存储连接元数据，不包含密码：

```json
{
  "datasources": [
    {
      "id": 1,
      "name": "零售电商库",
      "type": "mysql",
      "host": "10.0.0.1",
      "port": 3306,
      "database": "retail_db"
    }
  ]
}
```

密码由数据库 MCP 工具自行管理，与本体插件无关。

---

## 二、使用场景

### 场景 1：从零开始建本体

```
用户：我有一个电商数据库，帮我建一下本体

Agent（加载了 ontology-plugin）：
→ 用户提供数据库连接信息或表结构描述
→ 创建概念组：订单域、用户域、商品域
→ 逐步创建概念：订单、订单明细、用户、商品、品类...
→ 配置关系：订单 CONTAINS 订单明细、订单 BELONGS_TO 用户
→ 配置表映射：订单 → orders 表、订单明细 → order_items 表
→ 配置 JOIN：orders.id = order_items.order_id
→ 自动保存到 ontology.json
→ 所有操作在对话中完成，不离开 Agent
```

### 场景 2：数据分析师在 Claude Code 中问数

```
用户：帮我看一下上个季度华东区各品类的销售额，看看哪些品类下降了

Agent（加载了 ontology-plugin）：
→ 搜索本体：匹配"销售额""品类""区域"概念
→ 展开关系：发现"销售额" COMPUTED_FROM "单价×数量"
→ 展开下钻：品类→子品类、区域→省份→城市
→ 读取映射：orders 表、products 表、regions 表
→ 生成 SQL 并解释推理过程
```

### 场景 3：持续迭代本体

```
用户：我们新增了一个"退款"业务，帮我把退款相关的概念加到本体里

Agent（加载了 ontology-plugin）：
→ 创建概念：退款单、退款明细、退款原因
→ 配置关系：退款单 BELONGS_TO 订单、退款单 CONTAINS 退款明细
→ 配置映射：退款单 → refunds 表
→ 检查本体一致性，提示是否有冲突
→ 自动保存到 ontology.json
```

### 场景 4：团队共享本体

```
用户 A 在本地建好了零售电商本体
→ ontology.json 提交到 git 仓库
→ 用户 B git pull 后，Agent 自动加载最新本体
→ 用户 B 可以继续修改，再提交
→ 团队通过 git 协作维护本体
```

### 场景 5：运维人员排查异常

```
用户：订单量突然下降了，帮我下钻找原因

Agent（加载了 ontology-plugin）：
→ 命中"订单量"概念
→ DRILLS_INTO 展开：订单量→渠道订单量→地域订单量→单品订单量
→ CORRELATED 关联：同时检查"支付成功率""库存"等关联指标
→ 给出下钻路径建议，生成对应 SQL
```

---

## 三、插件文件结构

```
ontology-plugin/
├── SKILL.md              # Skill 入口文件（Agent 加载此文件）
├── ontology.json         # 本体数据（概念、关系、映射）
└── README.md             # 安装说明
```

**三个文件，零依赖，复制即用。**

---

## 四、SKILL.md 设计

### 4.1 设计原则

SKILL.md 是插件的核心，Agent 加载后获得以下知识：

1. **ontology.json 的 Schema**：理解数据结构，能正确读写
2. **9 种关系类型的语义**：知道什么时候用什么关系
3. **CRUD 操作规范**：如何创建/修改/删除概念、关系、映射
4. **查询操作规范**：如何搜索、展开、下钻
5. **SQL 生成规范**：如何从映射生成 SQL
6. **与数据库 MCP 工具协作**：如何委托 SQL 执行

### 4.2 SKILL.md 完整内容

```markdown
---
name: "ontology"
description: "本体知识图谱：业务概念建模、关系展开、下钻分析、SQL 生成。当用户需要理解数据模型、查询业务概念、下钻分析指标、或创建/修改本体时使用。"
---

# Ontology Skill

## 数据文件

本体数据存储在 `ontology.json` 中。所有操作都通过读写这个文件完成。

### 读取本体
- 使用 Agent 的 Read 工具打开 `ontology.json`
- 如果文件不存在，使用模板创建空文件

### 写入本体
- 修改后使用 Agent 的 Write 工具写回 `ontology.json`
- 每次修改前先读取最新内容，避免覆盖他人修改
- 写入后告知用户变更内容

## 数据结构

### 顶层结构
```json
{
  "version": "1.0",
  "updated_at": "ISO时间戳",
  "datasources": [],
  "builtin_relations": [],
  "groups": []
}
```

### 概念 (Concept)
```json
{
  "id": 1,
  "name": "概念名称",
  "description": "描述",
  "parent_id": null,
  "anomaly_threshold": null,
  "relations": [],
  "mappings": [],
  "join_mappings": []
}
```

### 关系 (Relation) — 9 种内置类型

| 类型 | 含义 | 传递性 | 对称性 | 使用场景 |
|------|------|--------|--------|----------|
| `BELONGS_TO` | 属于 | 否 | 否 | 订单→用户 |
| `CONTAINS` | 包含 | 是 | 否 | 订单→订单明细 |
| `DRILLS_INTO` | 可下钻 | 是 | 否 | 销售额→品类销售额 |
| `COMPUTED_FROM` | 计算自 | 否 | 否 | 销售额=单价×数量 |
| `DERIVED_FROM` | 派生自 | 是 | 否 | 月活→日活 |
| `CORRELATED` | 关联 | 否 | **是** | 订单量↔支付成功率 |
| `CAUSES` | 导致 | 是 | 否 | 缺货→订单下降 |
| `PREVENTS` | 阻止 | 否 | 否 | 限流→服务崩溃 |
| `subClassOf` | 子类 | 是 | 否 | 线上订单→订单 |

### 表映射 (Mapping)
```json
{
  "table": "表名",
  "column": "列名",
  "attribute": "属性名",
  "type": "direct|computed|dimension"
}
```

### JOIN 映射 (JoinMapping)
```json
{
  "target_concept": "目标概念名",
  "relation_type": "BELONGS_TO",
  "join_table": "关联表名",
  "join_condition": "a.user_id = b.id",
  "join_type": "LEFT|INNER|RIGHT"
}
```

## 操作规范

### 一、创建概念

1. 分配唯一 ID（当前最大 ID + 1）
2. 填写 name、description、group_id
3. 如有父概念，填写 parent_id
4. 更新 ontology.json 的 updated_at
5. 写回文件

### 二、创建关系

1. 确认 source 和 target 概念存在
2. 选择正确的 relation type（参考上表）
3. 对于 COMPUTED_FROM/DERIVED_FROM，填写 expression
4. 检查是否产生循环引用
5. 写回文件

### 三、创建映射

1. 确认概念存在
2. 填写 table、column、attribute
3. type 默认为 "direct"
4. 写回文件

### 四、搜索概念

1. 读取 ontology.json
2. 在概念 name 和 description 中匹配关键词
3. 返回匹配的概念列表，附匹配度说明

### 五、关系展开

1. 从目标概念出发
2. 沿指定关系类型展开（通过 relations 数组）
3. transitive 关系：自动沿传递链展开（如 subClassOf → subClassOf）
4. symmetric 关系：自动添加反向（如 CORRELATED 双向）
5. 返回展开后的子图

### 六、下钻分析

1. 从目标概念出发
2. 沿 DRILLS_INTO 关系递归展开
3. 构建下钻树（children 嵌套）
4. 标注每个节点的 anomaly_threshold
5. 最大深度 5 层

### 七、SQL 生成

1. 读取目标概念的 mappings 和 join_mappings
2. 主表：mappings 中的 table
3. SELECT 列：mappings 中的 column（AS attribute）
4. JOIN：按 join_mappings 构建
5. 对于 COMPUTED_FROM 概念，用 expression 替代直接列
6. 生成完整 SQL

### 八、SQL 执行

**本体插件不执行 SQL。** 生成 SQL 后：
- 如果用户安装了数据库 MCP 工具（MySQL MCP / PostgreSQL MCP），将 SQL 交给该工具执行
- 如果用户没有数据库 MCP 工具，输出 SQL 让用户自行执行

### 九、一致性检查

每次修改 ontology.json 前检查：
1. 概念名在同一个 group 内不重复
2. parent_id 引用的概念存在
3. 关系 target_id 引用的概念存在
4. 映射的 table 在 datasources 引用的库中存在
5. 没有循环 parent_id 引用
```

### 4.3 空本体模板

首次使用时，如果 ontology.json 不存在，Agent 应创建以下内容：

```json
{
  "version": "1.0",
  "updated_at": "",
  "datasources": [],
  "builtin_relations": [
    { "name": "BELONGS_TO", "label": "属于", "transitive": false, "symmetric": false },
    { "name": "CONTAINS", "label": "包含", "transitive": true, "symmetric": false },
    { "name": "DRILLS_INTO", "label": "可下钻", "transitive": true, "symmetric": false },
    { "name": "COMPUTED_FROM", "label": "计算自", "transitive": false, "symmetric": false },
    { "name": "DERIVED_FROM", "label": "派生自", "transitive": true, "symmetric": false },
    { "name": "CORRELATED", "label": "关联", "transitive": false, "symmetric": true },
    { "name": "CAUSES", "label": "导致", "transitive": true, "symmetric": false },
    { "name": "PREVENTS", "label": "阻止", "transitive": false, "symmetric": false },
    { "name": "subClassOf", "label": "子类", "transitive": true, "symmetric": false }
  ],
  "groups": []
}
```

---

## 五、ontology.json 文件格式

### 5.1 设计原则

ontology.json 是插件的**唯一数据源和唯一持久化文件**。所有操作都通过读写这个文件完成。

```
用户操作流程：
1. Agent 加载 SKILL.md，获得 ontology.json 的 Schema 和操作规范
2. 用户通过对话操作本体（创建概念、关系、映射等）
3. Agent 根据 SKILL.md 的规范，使用 Read/Write 工具读写 ontology.json
4. 每次修改后自动写回文件
5. 用户可以将 ontology.json 提交到 git，团队共享
```

### 5.2 JSON Schema

```json
{
  "version": "1.0",
  "updated_at": "2026-08-30T12:00:00",
  "datasources": [
    {
      "id": 1,
      "name": "零售电商库",
      "type": "mysql",
      "host": "10.0.0.1",
      "port": 3306,
      "database": "retail_db"
    }
  ],
  "builtin_relations": [
    {
      "name": "DRILLS_INTO",
      "label": "可下钻",
      "description": "可下钻到子维度，纯分析导航",
      "transitive": true,
      "symmetric": false,
      "source_role": "父维度",
      "target_role": "子维度"
    }
  ],
  "groups": [
    {
      "id": 1,
      "name": "retail",
      "display_name": "零售电商",
      "description": "零售电商业务概念域",
      "concepts": [
        {
          "id": 1,
          "name": "订单",
          "description": "用户下单记录",
          "anomaly_threshold": null,
          "parent_id": null,
          "relations": [
            {
              "target_id": 2,
              "type": "BELONGS_TO",
              "expression": null,
              "description": "订单属于用户"
            }
          ],
          "mappings": [
            {
              "table": "orders",
              "column": "id",
              "attribute": "订单ID",
              "type": "direct"
            }
          ],
          "join_mappings": [
            {
              "target_concept": "用户",
              "relation_type": "BELONGS_TO",
              "join_table": "users",
              "join_condition": "orders.user_id = users.id",
              "join_type": "LEFT"
            }
          ]
        }
      ]
    }
  ]
}
```

### 5.3 文件生命周期

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  首次使用：                                                       │
│  ┌──────────┐     ┌──────────────┐    ┌─────────────────┐       │
│  │ 不存在    │ →  │ Agent 按模板  │ →  │ ontology.json   │       │
│  │          │     │ 创建空文件    │    │ (空本体)         │       │
│  └──────────┘     └──────────────┘    └─────────────────┘       │
│                                                                  │
│  后续使用：                                                       │
│  ┌─────────────────┐    ┌──────────────┐    ┌─────────────────┐  │
│  │ ontology.json   │ →  │ Agent 读取    │ →  │ 用户对话操作     │  │
│  │                  │    │              │    │                 │  │
│  └─────────────────┘    └──────────────┘    └────────┬────────┘  │
│                                                      │          │
│                                              ┌───────┴───────┐  │
│                                              │ Write 写回文件  │  │
│                                              └───────────────┘  │
│                                                                  │
│  团队协作：                                                       │
│  ┌─────────────────┐    ┌──────────┐    ┌─────────────────┐     │
│  │ 用户 A          │ →  │ git push │ →  │ 用户 B           │     │
│  │ 修改本体         │    │          │    │ git pull + 加载  │     │
│  └─────────────────┘    └──────────┘    └─────────────────┘     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 六、安装方式

### 6.1 安装步骤

```
1. 将 ontology-plugin/ 目录复制到项目根目录（或任意位置）

2. 配置 Agent 加载 Skill：
   - Claude Code: 自动识别 .trae/skills/ 或通过配置指定
   - OpenCode: 在 opencode.json 中配置 skills 路径
   - Cursor: 将 SKILL.md 放入 .cursor/skills/
   - Trae: 将 SKILL.md 放入 .trae/skills/

3. （可选）安装数据库 MCP 工具：
   - MySQL: 安装 mysql-mcp-server
   - PostgreSQL: 安装 postgres-mcp-server
   - 具体安装方式参考各工具的文档

4. 开始使用：
   - 在对话中直接说「帮我建一个电商本体」或「查询订单相关的概念」
   - Agent 会自动加载 SKILL.md 并操作 ontology.json
```

### 6.2 配置示例

**Claude Code**（`.claude/skills/ontology/SKILL.md`）：

将 `SKILL.md` 和 `ontology.json` 放入 `.claude/skills/ontology/` 目录即可。

**OpenCode**（`opencode.json`）：

```json
{
  "skills": {
    "ontology": "./ontology-plugin/SKILL.md"
  }
}
```

---

## 七、分阶段实施计划

### Phase 1：SKILL.md + 空本体模板

| 任务 | 说明 | 优先级 |
|------|------|--------|
| `ontology.json` Schema 定稿 | 确认所有字段格式 | P0 |
| 空本体模板 | 首次使用时 Agent 自动创建的文件内容 | P0 |
| SKILL.md 完整编写 | 包含 Schema、关系类型、CRUD 规范、查询规范、SQL 生成规范 | P0 |
| README.md | 安装说明、前置条件、使用示例 | P0 |

### Phase 2：增强与校验

| 任务 | 说明 |
|------|------|
| 一致性校验规则 | 在 SKILL.md 中补充更详细的校验规则 |
| 表结构推断指南 | 如何通过数据库 MCP 工具自动推断表结构、创建映射 |
| 知识迁移指南 | 从 Luban 导出 ontology.json 的互操作说明 |
| 使用示例 | 典型场景的对话示例 |

### Phase 3：生态完善

| 任务 | 说明 |
|------|------|
| 示例本体 | 零售电商、SaaS 等常见场景的预置 ontology.json |
| 可视化 | 生成 Mermaid 图展示本体结构 |
| 多本体管理 | 支持同时维护多个 ontology.json 文件 |

---

## 八、待决策问题

| # | 问题 | 选项 | 建议 |
|---|------|------|------|
| 1 | **方案确认**：纯 Skill，不依赖 MCP？ | 确认 / 再讨论 | ✅ 已确认 |
| 2 | **文件位置**：ontology.json 放哪里？ | 与 SKILL.md 同目录 / 项目根目录 / 用户指定 | 同目录，简单明确 |
| 3 | **ID 生成策略**：谁来分配 concept_id？ | Agent 自增 / UUID / 用户指定 | Agent 自增（当前最大 ID + 1） |
| 4 | **保存策略**：每次操作都写回 or 用户手动触发？ | 自动写回 / 手动触发 | 自动写回，每次修改后立即写 |
| 5 | **冲突处理**：多人同时修改 ontology.json？ | 不做处理 / 提示用户 | Phase 1 不做，Phase 3 考虑 |
| 6 | **关系类型**：9 种内置关系是否够用？ | 9 种 / 允许自定义 | 9 种，不可自定义，保证一致性 |
| 7 | **空本体**：首次使用自动创建 or 需要手动？ | 自动创建 / 手动创建 | 自动创建，降低门槛 |