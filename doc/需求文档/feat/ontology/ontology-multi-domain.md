# 概念本体多域分层（Ontology Multi-Domain）需求文档

## 一、背景与动机

### 1.1 当前状态

ontology-layer 实现了单套本体的概念建模（概念树 + 关系类型 + 语义推理），解决了"工具之间的隐含依赖关系"这一问题。

### 1.2 新问题

一个企业不止一套本体。不同业务域（运营、营销、供应链、财务...）有各自的知识体系，它们之间既有差异又有关联。

**错误做法：把所有概念塞进一张大图。**
- 运营人员看到营销概念，干扰认知
- 概念数量膨胀后，编辑器渲染和查询性能急剧下降
- 不同域的概念命名冲突（运营有"活动"，营销也有"活动"，含义不同）

**正确做法：分域管理 + 跨域链接，像业界标准一样。**

### 1.3 业界参考

| 标准/产品 | 组织方式 | 核心思路 |
|-----------|---------|---------|
| TM Forum SID（电信） | 8 个 Domain → ABE → Entity 三级 | 分域、分层、跨域关联 |
| FIBO（金融） | Foundation + 多模块（Securities/Loans/Derivatives...） | 模块化 + 公共基础层 |
| IOF（工业） | Upper → Mid-Level → Domain → Application 四级 | 分层本体，逐层细化 |
| Palantir Foundry | 统一 Ontology + Object Types 按业务线组织 | 统一语义层，按域视图过滤 |

**业界共识：不是"一套本体"也不是"多套独立本体"，而是"分域管理、共享基础、跨域链接"。**

---

## 二、领域建模分析

### 2.1 运营域 vs 营销域：一个典型例子

```
运营域（Operations Domain）              营销域（Marketing Domain）
┌──────────────────────┐                ┌──────────────────────┐
│ 活动（Campaign）       │               │ 客户（Customer）        │
│  ├── 活动类型          │               │  ├── 客户等级          │
│  ├── 活动状态          │               │  ├── 客户生命周期      │
│  └── 活动效果          │               │  └── 客户价值          │
│                      │                │                      │
│ 渠道（Channel）        │               │ 线索（Lead）           │
│  ├── 线上渠道          │               │  ├── 线索来源          │
│  └── 线下渠道          │               │  └── 线索评分          │
│                      │                │                      │
│ 内容（Content）        │               │ 机会（Opportunity）     │
│  ├── 内容类型          │               │  ├── 机会阶段          │
│  └── 内容效果          │               │  └── 预计金额          │
│                      │                │                      │
│ 人群（Audience）       │               │ 合同（Contract）       │
│  ├── 人群画像          │               │  ├── 合同类型          │
│  └── 人群规模          │               │  └── 合同状态          │
│                      │                │                      │
│ 活动效果 ←─── 跨域关联 ────→ 线索转化率  │                      │
│ 渠道覆盖 ←─── 跨域关联 ────→ 线索来源   │                      │
└──────────────────────┘                └──────────────────────┘

共享基础概念（跨域共用）
┌──────────────────────────────────────────┐
│ 用户（User）   产品（Product）   订单（Order）  │
│ 标签（Tag）    组织（Organization）           │
└──────────────────────────────────────────┘
```

运营域和营销域有各自的专属概念，但通过"活动效果→线索转化率"、"渠道覆盖→线索来源"等跨域关联连接在一起。同时，"用户"、"产品"等基础概念被两个域共同引用。

### 2.2 电信行业：TM Forum SID 的域分解

```
TM Forum SID 框架（电信行业标准）

Domain: Market/Sales          Domain: Product
  ├── MarketSegment             ├── ProductSpecification
  ├── Competitor                ├── ProductOffering
  └── SalesChannel              └── ProductInstance

Domain: Customer              Domain: Service
  ├── Customer                  ├── ServiceSpecification
  ├── CustomerAccount           ├── ServiceInstance
  └── CustomerInteraction       └── ServiceUsage

Domain: Resource              Domain: Supplier/Partner
  ├── PhysicalResource          ├── Supplier
  ├── LogicalResource           └── PartnerAgreement
  └── NetworkResource

跨域关联示例：
  Customer ──owns──▶ ProductInstance ──realizedBy──▶ ServiceInstance
  ServiceInstance ──uses──▶ LogicalResource ──hostedOn──▶ PhysicalResource
```

### 2.3 工业制造：IOF 的分层体系

```
IOF（Industrial Ontologies Foundry）分层架构

Upper Ontology（上层本体：BFO/SUMO）
  定义最抽象的概念：Entity、Process、Quality、Role...
  ↓
Mid-Level Ontology（中层本体）
  制造通用概念：Material、Machine、Operation、ProductionOrder...
  ↓
Domain Ontology（领域本体）
  细分领域：SupplyChain、Quality、Maintenance、Energy...
  ↓
Application Ontology（应用本体）
  具体工厂/场景：Factory-A-Line3、Factory-B-Workshop2...
```

---

## 三、鲁班平台设计方案

### 3.1 核心概念：Ontology Group（本体组/域）

在现有 `concept` 表基础上引入 **Group（分组/域）** 概念，一个 Group 代表一个业务域的本体。

```
┌─────────────────────────────────────────────────────┐
│                   鲁班平台                            │
│                                                     │
│  Group: "运营域"           Group: "营销域"            │
│  ┌─────────────────┐     ┌─────────────────┐        │
│  │ 概念树           │     │ 概念树           │        │
│  │ 域内关系         │     │ 域内关系         │        │
│  │ 工具绑定         │     │ 工具绑定         │        │
│  └────────┬────────┘     └────────┬────────┘        │
│           │      跨域链接        │                  │
│           └──────────────────────┘                  │
│                                                     │
│  Group: "基础域"（共享概念）                          │
│  ┌─────────────────────────────────────────┐        │
│  │ 用户、产品、订单、标签、组织...              │        │
│  └─────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────┘
```

### 3.2 数据模型扩展

在现有 `concept` 表基础上，新增 `ontology_group` 表：

```sql
CREATE TABLE ontology_group (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    name        VARCHAR(64)  NOT NULL COMMENT '域名称，如"运营域"、"营销域"',
    code        VARCHAR(32)  NOT NULL COMMENT '域编码，如 operations、marketing',
    description VARCHAR(256) NULL     COMMENT '域描述',
    parent_id   BIGINT       NULL     COMMENT '父域ID，支持域的层级嵌套',
    sort_order  INT          DEFAULT 0 COMMENT '排序',
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NULL     ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_code (code),
    INDEX idx_parent (parent_id)
);
```

**现有 `concept` 表变更**：`group_id` 字段改为关联 `ontology_group.id`。

```sql
ALTER TABLE concept
    MODIFY COLUMN group_id BIGINT NULL COMMENT '所属本体域ID，NULL表示全局概念',
    ADD INDEX idx_group (group_id);
```

> **group_id 取值说明**：
> - `NULL`：全局概念，所有域可见（如"用户"、"时间"等横切概念，不强制属于某个 Group）
> - 指向某个 Group：属于该域的概念，默认只有该域和其子域可见
> - "基础域"是一个特殊的 Group，用于存放平台预置的共享概念。如果用户希望所有共享概念统一管理，可以建一个"基础域"Group 并放入其中；如果只是零散几个共享概念，直接用 NULL 即可。两种方式不互斥。

**跨域关系**：`concept_relation` 表本身不限制 source 和 target 必须在同一个 Group，天然支持跨域链接。

```
运营域.活动效果 ──DRIVES──▶ 营销域.线索转化率
运营域.渠道覆盖 ──FEEDS──▶  营销域.线索来源
```

### 3.3 域的层级（Group Hierarchy）

支持域之间的父子关系，形成域的层级树：

```
企业本体
├── 基础域（共享概念）
│   ├── 用户
│   ├── 产品
│   └── 订单
├── 运营域
│   ├── 活动
│   ├── 渠道
│   └── 内容
├── 营销域
│   ├── 客户
│   ├── 线索
│   └── 机会
├── 供应链域
│   ├── 供应商
│   ├── 采购
│   └── 库存
└── 财务域
    ├── 收入
    ├── 成本
    └── 利润
```

子域可以继承父域的概念引用权限。例如，"运营域"的子域"活动运营域"可以引用父域的所有概念。

**继承行为细则**：
- 子域用户默认可以看到父域的概念（只读），无需重复创建
- 子域可以创建指向父域概念的关系（如"活动运营.活动" → 父域"运营域.渠道"）
- 子域不能编辑或删除父域的概念
- 子域继承仅限直接父域，不跨级继承（避免过度耦合）

### 3.4 编辑器交互设计

**左侧：域选择器**
- 树形展示所有 Group（支持父子层级）
- 选中一个 Group 后，画布只渲染该 Group 的概念
- 可切换"显示跨域链接"开关，展开关联的外部概念

**画布：域内概念图**
- 当前 Group 的概念节点正常渲染
- 跨域关联的目标概念以虚线边框 + 域标签显示（如 `[营销域] 客户`）
- 跨域概念不可编辑，点击跳转到对应域

**顶部：面包屑导航**
```
企业本体 > 运营域 > 活动运营
```

### 3.5 推理引擎行为

**域内推理**：和当前一致，Jena 推理机在 Group 范围内进行。

**跨域推理**：当 Agent 查询涉及跨域概念时，推理机沿跨域关系展开：

```
Agent: "运营活动对营销线索转化率的影响？"

1. 运营域推理：活动效果 → COMPUTED_FROM → 参与人数, 转化人数
2. 跨域关系：运营域.转化人数 → EQUIVALENT_TO → 营销域.线索转化量
3. 营销域推理：线索转化率 → COMPUTED_FROM → 线索转化量, 线索总量
4. 补齐：加载运营域和营销域的相关工具
```

### 3.6 本体与应用的关系

**核心原则：本体是平台级资源，不属于任何应用。**

- 问数（Ask）功能在应用之外，是平台级 AI 对话能力，需要跨应用、跨域的本体知识
- 本体为问数提供语义理解基础，不应被单个应用的范围限制
- 后续如有需求，再考虑为应用开放本体访问权限（如 RBAC 权限 `ontology:group_xxx:read`）

---

## 四、本体多域分层实施路线（本体架构本身）

> 本章是 ontology-multi-domain 架构本身的实施计划，不包含第六章的行业落地能力。
> 第六章的 6 大能力在本体架构完成后再推进。

### Phase 1：Group 基础能力（1-2 天）

- [ ] 新建 `ontology_group` 表 + 后端 CRUD API
- [ ] `concept` 表 `group_id` 关联 `ontology_group.id`
- [ ] 前端域选择器（左侧树形列表）
- [ ] 画布按 Group 过滤渲染
- [ ] 编辑器支持跨域概念关联（虚线 + 域标签）

### Phase 2：Group 层级 + 跨域推理（1-2 天）

- [ ] 域的父子层级（`parent_id`）
- [ ] 子域继承父域概念引用（详见 3.3 补充说明）
- [ ] 跨域推理链路（Jena 推理机跨 Group 展开）
- [ ] 跨域概念跳转导航

### Phase 3：大规模优化 + 模板导入（按需）

- [ ] 大规模概念节点的按需加载（详见 6.2.4）
- [ ] 域的导入/导出（OWL 格式 + JSON 模板格式）
- [ ] 应用本体访问权限（待后续需求）

---

## 五、文献参考

### 5.1 TM Forum SID（信息框架）— 电信行业标准

> **来源**: TM Forum Information Framework (SID), Release 24.0
> **链接**: https://www.tmforum.org/information-framework-sid/

**概述**：SID（Shared Information/Data Model）是 TM Forum 定义的电信行业信息参考模型，采用分域（Domain）→ 聚合业务实体（ABE）→ 业务实体（BE）三级分解结构，是电信行业本体建模的事实标准。

**核心架构**：

```
SID 框架 = 8 个 Domain，每个 Domain 拆分为若干 ABE

Domain: Market & Sales
  ABE: MarketSegment, Competitor, SalesChannel, MarketingCampaign...
  → 管理市场细分、竞争对手、销售渠道、营销活动

Domain: Product
  ABE: ProductSpecification, ProductOffering, ProductInstance...
  → 产品规格定义、产品目录、已订购产品实例

Domain: Customer
  ABE: Customer, CustomerAccount, CustomerInteraction...
  → 客户信息、客户账户、客户交互记录

Domain: Service
  ABE: ServiceSpecification, ServiceInstance, ServiceUsage...
  → 服务定义、服务实例、服务使用量

Domain: Resource
  ABE: PhysicalResource, LogicalResource, NetworkResource...
  → 物理设备、逻辑资源、网络拓扑

Domain: Supplier/Partner
  ABE: Supplier, PartnerAgreement, PurchaseOrder...
  → 供应商管理、合作伙伴协议、采购订单

Domain: Enterprise
  ABE: Organization, Employee, FinancialAccount...
  → 企业内部组织架构、员工、财务科目

Domain: Common Business
  ABE: Party, Location, TimePeriod, Agreement...
  → 跨域通用概念，被其他 7 个 Domain 共同引用
```

**关键设计原则**：

1. **Domain 隔离**：每个 Domain 有独立的命名空间，避免概念冲突。例如，`Customer.Customer` 和 `Enterprise.Organization` 是两个完全不同的概念，尽管都涉及"人/组织"。
2. **Common Business 共享层**：`Party`（参与方）、`Location`（位置）、`TimePeriod`（时间段）等横切概念放在 Common Domain，被所有 Domain 引用，避免重复定义。
3. **ABE 聚合**：Domain 内的概念按业务聚合度分组为 ABE。例如 `Customer` Domain 下，`Customer` 和 `CustomerAccount` 分属不同 ABE，因为它们分别关注"身份"和"财务"。
4. **跨域关联**：通过关系（Association）连接不同 Domain 的实体。例如 `Customer` 通过 `owns` 关联 `ProductInstance`，`ProductInstance` 通过 `realizedBy` 关联 `ServiceInstance`。

**对鲁班平台的启示**：
- Common Business 域的设计值得借鉴——需要一个"基础域"存储跨域共享概念（用户、产品、标签等）
- ABE 的聚合粒度可以映射为 Group 的父子层级
- 跨域关联是核心能力，不能只做域内建模

---

### 5.2 FIBO（金融行业业务本体）— 模块化本体典范

> **来源**: EDMC Council, FIBO Specification
> **链接**: https://spec.edmcouncil.org/fibo/

**概述**：FIBO（Financial Industry Business Ontology）由 EDMC 主导、OMG 标准化，全球 200+ 金融机构参与维护。定义了约 **1500 个类、2500 个属性**，覆盖金融行业核心概念：法人、证券、账户、控股、协议、报送等。

**模块化结构**：

```
FIBO 本体 = Foundation（基础层） + 领域模块（Domain Modules）

FIBO Foundation（基础层）
  ├── FND: Foundations（基础概念）
  │   ├── Agreements（协议框架）
  │   ├── Agents（代理/法人框架）
  │   ├── Time（时间框架）
  │   └── Quantities（数量/度量框架）
  └── ...

FIBO Domain Modules（领域模块，每个独立 OWL 文件）
  ├── BE:  Business Entities（业务实体）
  │   ├── Corporations（公司法人）
  │   ├── Partnerships（合伙企业）
  │   └── Trusts（信托）
  ├── FBC: Finance, Business & Commerce（金融商业基础）
  │   ├── FinancialInstruments（金融工具）
  │   ├── Loans（贷款）
  │   ├── Accounts（账户）
  │   └── Currencies（货币）
  ├── SEC: Securities（证券）
  │   ├── Equities（股票）
  │   ├── Bonds（债券）
  │   └── Derivatives（衍生品）
  ├── IND: Indices & Indicators（指数与指标）
  │   ├── MarketIndices（市场指数）
  │   └── EconomicIndicators（经济指标）
  ├── BP:  Business Processes（业务流程）
  └── CIV: Civil & Regulatory（民法与监管）
```

**关键设计原则**：

1. **Foundation 基础层**：所有领域模块共享的上层概念。如 `FND.Agents.LegalPerson`（法人）被 `BE.Corporations` 和 `FBC.Accounts` 等模块共同引用。
2. **模块独立 OWL 文件**：每个模块是独立的 `owl` 文件，通过 `owl:import` 声明依赖。例如 `SEC.Equities` 导入 `FBC.FinancialInstruments` 和 `FND.Foundations`。
3. **本体语义层**：FIBO 不仅定义数据结构，更定义业务语义。例如 `Loan`（贷款）不仅有关联属性，还通过 OWL 公理约束"贷款必须有借款方和贷出方"。
4. **社区维护**：每个模块有独立的维护组（Working Group），由领域专家主导，确保本体准确反映业务知识。

**对鲁班平台的启示**：
- 模块化设计是解决大规模本体治理的核心手段——每个业务域独立维护、独立演进
- Foundation 基础层确保跨域语义一致性——鲁班需要"基础域"作为共享概念层
- `owl:import` 的依赖声明机制可以借鉴为 Group 之间的引用关系

---

### 5.3 IOF（工业本体基金会）— 分层本体架构

> **来源**: Industrial Ontologies Foundry (IOF)
> **链接**: https://www.industrialontologies.org/

**概述**：IOF 的使命是"创建一套覆盖整个数字制造领域的核心开放参考本体"。其核心方法是**分层本体架构**（Layered Ontology Architecture），从最抽象到最具体分为四层。

**分层架构**：

```
IOF 四层本体架构

Layer 1: Upper Ontology（上层本体）
  代表: BFO (Basic Formal Ontology) / SUMO (Suggested Upper Merged Ontology)
  内容: 最抽象的概念分类
  - Continuant（连续体） vs Occurrent（发生体）
  - IndependentEntity（独立实体） vs DependentEntity（依赖实体）
  - Quality（性质）、Role（角色）、Process（过程）...
  受众: 本体工程师

Layer 2: Mid-Level Ontology（中层本体）
  代表: IOF Core, Common Core Ontologies
  内容: 制造领域的通用概念，跨行业复用
  - Material（物料）、Machine（机器）、Operation（操作）
  - ProductionOrder（生产订单）、WorkSchedule（工单）
  - QualityMeasure（质量指标）、MaintenanceEvent（维护事件）
  受众: 行业架构师

Layer 3: Domain Ontology（领域本体）
  代表: 各子领域本体
  内容: 特定制造子领域的专业知识
  - SupplyChain（供应链）、Quality（质量）、Maintenance（维护）
  - Energy（能源）、Safety（安全）、Logistics（物流）
  受众: 领域专家

Layer 4: Application Ontology（应用本体）
  代表: 具体工厂/场景的本体
  内容: 特定工厂的实例化概念
  - Factory-A-Line-3（A工厂3号产线）
  - Factory-B-Workshop-2（B工厂2号车间）
  - 具体设备、工位、物料清单
  受众: 工厂工程师
```

**关键设计原则**：

1. **逐层继承**：下层概念通过 `rdfs:subClassOf` 继承上层概念。例如 `IOF:CNCMachine` 是 `IOF:Machine` 的子类，`IOF:Machine` 是 `BFO:MaterialEntity` 的子类。
2. **层间复用**：Mid-Level 本体被所有 Domain 本体复用，避免每个领域重新定义"机器"、"物料"等基础概念。
3. **应用层独立**：每个工厂/场景可以有自己的 Application Ontology，不影响其他工厂的本体。但都共享同一套 Mid-Level 和 Upper 本体。
4. **BFO 作为 Upper**：IOF 采用 BFO 作为上层本体基础，BFO 是 ISO/IEC 21838 标准，已被 350+ 本体项目采用。

**对鲁班平台的启示**：
- 分层设计是工业级本体的核心架构——不同抽象层次的概念分离管理
- Mid-Level 本体相当于鲁班的"基础域"（共享概念），Domain 本体相当于"业务域"（Group）
- Application 本体可能对应鲁班的"应用专属概念"（未来可扩展）

---

### 5.4 Palantir Foundry Ontology — 工程化产品参考

> **来源**: Palantir Architecture Center, Palantir AIOS Ontology
> **链接**: https://www.palantir.com/platforms/foundry/ontology/

**概述**：Palantir 的 Ontology 是连接企业 IT 基础设施与运营决策的**语义层**。Palantir 官方表述："The Ontology is the system of record for the enterprise."（本体是企业的记录系统）。

**核心组件**：

```
Palantir Ontology 架构

Semantic Layer（语义层）— "世界的名词"
  ├── Object Types（对象类型）
  │   定义企业中的核心实体：Customer、Order、Product、Equipment...
  │   每个 Object Type 有：
  │   - Properties（属性）：名称、状态、金额...
  │   - Link Types（链接类型）：关联到其他 Object Type
  │   - Actions（动作）：可执行的操作
  │
  ├── Link Types（链接类型）
  │   定义 Object Type 之间的关系：
  │   - "A 依赖于 B"、"A 是 B 的上游"、"A 生产 B"...
  │   以业务语义呈现，而非技术 ER 关系
  │
  └── Interface Types（接口类型）
      跨 Object Type 的共享能力定义

Dynamic Layer（动力层）— "世界的动词"
  ├── Actions（动作）
  │   对象上可执行的操作：createOrder、approveLoan...
  ├── Functions（函数）
  │   数据转换与计算逻辑
  └── Queries（查询）
      跨系统的数据聚合查询
```

**关键设计原则**：

1. **统一语义层**：全企业只有一个 Ontology（不是多个）。但 Object Types 可以按业务线（Line of Business）组织，通过视图过滤。
2. **Object Types 跨域共享**：`Customer` 这个 Object Type 在销售、营销、客服等多个业务线中都被使用，但只定义一次。
3. **Link Types 连接一切**：不同业务域的 Object Types 通过 Link Types 关联。例如 `Campaign`（营销域）→ `targets` → `CustomerSegment`（营销域），`CustomerSegment` → `contains` → `Customer`（共享对象）。
4. **Ontology 是操作系统的核心**：不仅仅是数据目录，而是企业操作系统的核心——所有查询、分析、决策、动作都通过 Ontology 进行。

**对鲁班平台的启示**：
- 统一 Ontology + 视图过滤的思路值得借鉴——一个平台一个本体，但按业务域展示
- Link Types 与鲁班已定义的 6 种关系类型（PARENT_OF、COMPUTED_FROM 等）思路一致
- 未来可考虑为概念绑定"动作"（Actions），使本体不仅是知识库，更是可操作的语义层

---

### 5.5 本体分层理论（Guarino 1998 经典分类）

> **来源**: Guarino, N. (1998). "Formal Ontology and Information Systems"
> **核心观点**：本体可按抽象层级分为四类，这一分类被学界广泛引用。

```
Guarino 本体分类（1998）

Top-Level Ontology（顶层本体）
  描述最通用的概念：时间、空间、对象、事件、属性...
  独立于任何领域
  示例：SUMO、BFO、DOLCE

Domain Ontology（领域本体）
  描述特定领域的概念：医学、法律、工程...
  特化顶层本体的概念
  示例：GALEN（医学）、FIBO（金融）

Task Ontology（任务本体）
  描述特定任务的概念：诊断、调度、配置...
  与领域无关但与任务相关

Application Ontology（应用本体）
  描述特定领域+特定任务的概念
  示例：某医院的心脏病诊断本体
```

**四层之间的依赖关系**：

```
Top-Level ──特化──▶ Domain ──特化──▶ Application
                              Task ──特化──▶ Application
```

Domain Ontology 和 Task Ontology 可以组合形成 Application Ontology。例如，医疗诊断本体 = 医学领域本体 + 诊断任务本体。

**对鲁班平台的启示**：
- 鲁班的"基础域"类似 Top-Level + Mid-Level 的混合
- 鲁班的"业务域 Group"类似 Domain Ontology
- 未来工具的"执行动作"可以建模为 Task Ontology
- 特定应用的本体 = 业务域 Group + 工具绑定，类似 Application Ontology

---

### 5.6 业界实践总结对照表

| 维度 | TM Forum SID | FIBO | IOF | Palantir | 鲁班建议 |
|------|-------------|------|-----|----------|---------|
| **组织方式** | 8 Domain + ABE + BE | Foundation + 模块 | 四层分层 | 统一 Ontology + 视图 | Group + 跨域链接 |
| **共享层** | Common Business Domain | Foundation 模块 | Upper/Mid-Level | 共享 Object Types | 基础域（共享概念） |
| **跨域关联** | Association 跨 Domain | owl:import 模块依赖 | subClassOf 跨层继承 | Link Types 跨 Object | concept_relation 跨 Group |
| **规模** | 电信行业全量 | 1500 类/2500 属性 | 制造全量 | 企业级 | 按需扩展 |
| **治理** | 行业协会维护 | 社区 Working Group | 基金会维护 | 企业内部 | 平台管理员 |
| **形式化** | UML/SID | OWL/RDF | OWL/BFO | 专有引擎 | Jena OWL（可选） |

---

## 六、行业落地路线图

### 6.1 从"能做"到"能落地"的差距

当前 ontology-multi-domain 解决了**架构容器**问题（分域、分层、跨域），但要让鲁班在工业、电信、金融领域快速落地，还需要补齐以下能力：

| 能力维度 | 现状 | 落地必需 | 差距 |
|---------|------|---------|------|
| 本体架构 | ✅ Group 分域+分层 | — | 无 |
| 行业本体内容 | ❌ 空容器 | 预置行业模板 | 内容缺失 |
| 概念→数据映射 | ❌ 无 | 概念绑定真实数据源 | 连接缺失 |
| 本体自动发现 | ❌ 无 | 数据源反向生成概念 | 起步成本高 |
| 语义路由 | ❌ 无 | 问数时自动路由到正确数据源 | 查询缺失 |
| 大规模性能 | ❌ 全量加载 | 按需加载+推理优化 | 性能不足 |
| 本体治理 | ❌ 无 | 版本管理+变更审批 | 治理缺失 |
| 工具绑定 | ❌ 弱 | 概念→工具→数据源全链路 | 执行缺失 |

### 6.2 必须补充的七大能力

#### 6.2.1 行业本体模板（解决"内容"问题）

**问题**：用户打开鲁班，Group 是空的，需要从零画电信 1000+ 概念，落地成本极高。

**方案**：预置行业模板，用户一键导入，在此基础上修改。

```
鲁班预置模板体系

行业模板（Industry Template）
├── 电信行业模板（对标 TM Forum SID）
│   ├── 基础域（Party, Location, TimePeriod, Agreement...）
│   ├── 客户域（Customer, CustomerAccount, CustomerInteraction...）
│   ├── 产品域（ProductSpecification, ProductOffering, ProductInstance...）
│   ├── 服务域（ServiceSpecification, ServiceInstance, ServiceUsage...）
│   ├── 资源域（PhysicalResource, LogicalResource, NetworkResource...）
│   └── 营销域（MarketSegment, Competitor, SalesChannel...）
│
├── 工业制造模板（对标 IOF + ISA-95）
│   ├── 基础域（Material, Machine, Operation, Process...）
│   ├── 设备域（Equipment, Sensor, Actuator, Controller...）
│   ├── 工艺域（WorkOrder, ProductionSchedule, QualityInspection...）
│   ├── 供应链域（Supplier, Inventory, Logistics, Procurement...）
│   └── 能效域（EnergyConsumption, Emission, Waste...）
│
├── 金融行业模板（对标 FIBO）
│   ├── 基础域（LegalPerson, Agreement, Account, Currency...）
│   ├── 证券域（Equity, Bond, Derivative, Fund...）
│   ├── 信贷域（Loan, Mortgage, CreditLine, Collateral...）
│   ├── 风控域（RiskExposure, Compliance, Audit...）
│   └── 客户域（Investor, Borrower, Beneficiary...）
│
└── 通用模板（中小企业起步用）
    ├── 基础域（User, Product, Order, Tag, Organization...）
    ├── 运营域（Campaign, Channel, Content, Audience...）
    ├── 营销域（Customer, Lead, Opportunity, Contract...）
    └── 财务域（Revenue, Cost, Budget, Invoice...）
```

**实施要点**：
- 每个模板预置 **50-100 个核心概念 + 关系**，覆盖行业 80% 常见场景
- 模板以 JSON 格式存储，支持导入/导出
- 用户导入后可以增删改，模板只作为起点
- 导入时，概念通过 `name` 在 Group 内唯一标识；`children` 和 `relations` 中的 `target` 使用名称引用，导入器在 Group 内按名称查重并解析为 ID。如果同一 Group 内存在同名概念，导入器报错并提示用户手动处理
- 模板格式：

```json
{
  "template": "tmf-sid-telecom",
  "version": "1.0",
  "groups": [
    {
      "code": "customer",
      "name": "客户域",
      "concepts": [
        {
          "name": "客户",
          "description": "购买或使用电信服务的个人或组织",
          "children": ["个人客户", "企业客户", "政企客户"],
          "relations": [
            { "target": "客户账户", "type": "HAS" },
            { "target": "产品实例", "type": "OWNS" }
          ]
        }
      ]
    }
  ]
}
```

#### 6.2.2 概念→数据映射层（解决"连接"问题）

**问题**：本体定义了"客户"概念，但问数"华东区客户数"时，系统不知道"客户"对应哪个数据库表。

**总体策略：三段式映射，由粗到精，逐步降低配置成本。**

```
映射三层递进

第一段：自动发现（零配置）  → 连接数据源，LLM 自动匹配表/字段到概念
第二段：可视化编辑（精确调优）→ 拖拽连线，手动调整不满意的映射
第三段：智能补全（持续优化）  → 问数时发现未映射概念，自动提示
```

---

##### 6.2.2.1 第一段：自动发现（零配置起步）

系统连接数据源后，自动扫描数据库元数据，LLM 做语义匹配，生成候选映射。

```
用户连接 CRM 数据库
    │
    ▼
系统自动扫描元数据
    ├── 表: customers, orders, products, accounts...
    ├── 字段: customers.id, customers.name, customers.region...
    └── 外键: orders.customer_id → customers.id
    │
    ▼
LLM 语义匹配
    ├── "customers" → 概念 "客户" (相似度 0.95) ✅
    ├── "orders" → 概念 "订单" (相似度 0.92) ✅
    ├── "accounts" → 概念 "账户" (相似度 0.88) ✅
    └── "t_log_2024" → ??? (相似度 0.12) ❌ 跳过
    │
    ▼
用户确认页面
    ┌─────────────────────────────────────────────┐
    │ 检测到 3 个可映射的表，请确认：                  │
    │                                             │
    │ ☑ customers    → 客户概念    置信度 95%      │
    │   id           → 客户ID                     │
    │   name         → 客户名称                    │
    │   region       → 所属区域                    │
    │   tier         → 客户等级                    │
    │                                             │
    │ ☑ orders       → 订单概念    置信度 92%      │
    │   ☐ amount   → ? (请选择概念属性)            │
    │                                             │
    │ ☐ accounts     → 账户概念    置信度 88%      │
    │                                             │
    │ [一键确认] [逐条审核]                         │
    └─────────────────────────────────────────────┘
```

**核心逻辑**：用 LLM 做表名/字段名 → 概念/属性的语义匹配，用户只需确认，不用手动配。

---

##### 6.2.2.2 第二段：可视化映射编辑器（精确调优）

自动发现不完美时，用户进入可视化编辑器手动调整。

```
┌──────────────────────────────────────────────────┐
│ 映射编辑器 — 概念: 客户                            │
│                                                  │
│  ┌── 概念属性 ──┐    ──映射──▶    ┌── 数据源字段 ──┐ │
│  │                                     │               │ │
│  │ 客户ID          ───────────▶  customers.id        │ │
│  │ 客户名称        ───────────▶  customers.name      │ │
│  │ 客户等级        ───────────▶  customers.tier      │ │
│  │ 所属区域        ───────────▶  customers.region    │ │
│  │ 创建时间        ───────────▶  customers.created_at│ │
│  │                                     │               │ │
│  │ + 添加属性                           │ 数据源: CRM库  │ │
│  └──────────────┘                     └───────────────┘ │
│                                                  │
│  ┌── 关联概念 ──┐    ──JOIN──▶    ┌── 关联表 ────┐   │
│  │                                     │               │   │
│  │ 订单 (HAS)       ───────────▶  orders            │   │
│  │   关联键: 客户ID                 ON customers.id = │   │
│  │                                 orders.customer_id│   │
│  │ 账户 (HAS)       ───────────▶  accounts          │   │
│  │   关联键: 客户ID                 ON customers.id = │   │
│  │                                 accounts.customer_id│  │
│  └──────────────┘                     └───────────────┘   │
└──────────────────────────────────────────────────┘
```

**关键交互**：
- 左侧是概念树（已有概念属性），右侧是数据源的表结构（自动读取）
- 拖拽连线建立映射
- 关联概念自动生成 JOIN 条件

---

##### 6.2.2.3 第三段：智能补全（持续优化）

用户问数时，系统发现"这个概念没映射"，自动提示。

```
用户问: "上周产品退货率多少？"

系统:
  ✓ "产品" → 已映射，ERP.products
  ✗ "退货" → 未映射

自动提示:
  ┌─────────────────────────────────────────────┐
  │ 检测到未映射概念 "退货"，建议映射：             │
  │                                             │
  │ 推荐表: ERP.return_orders (置信度 87%)        │
  │ 推荐字段:                                    │
  │   退货ID      → return_orders.id            │
  │   退货数量    → return_orders.quantity       │
  │   退货原因    → return_orders.reason         │
  │   关联产品    → return_orders.product_id     │
  │                                             │
  │ [一键映射] [忽略] [稍后配置]                   │
  └─────────────────────────────────────────────┘
```

---

##### 6.2.2.4 三种模式对比

| 模式 | 配置成本 | 准确率 | 适用场景 |
|------|---------|--------|---------|
| 自动发现 | 几乎为零 | 70-80% | 表名规范、语义清晰的场景 |
| 可视化编辑 | 中等 | 95%+ | 复杂映射、需要精确控制 |
| 智能补全 | 渐进式 | 持续提升 | 本体和数据源都在演化 |

**推荐组合**：80% 自动发现 + 15% 可视化编辑 + 5% 智能补全。

---

##### 6.2.2.5 关键设计决策：映射粒度

有两种映射粒度可选：

| 粒度 | 做法 | 优点 | 缺点 |
|------|------|------|------|
| **概念级** | 整个"客户"概念映射到 `customers` 表 | 简单，一次配完 | 不够灵活，属性粒度粗 |
| **属性级** | 每个概念属性映射到具体字段 | 精确，支持计算属性 | 配置量大 |

**建议用属性级**，但通过自动发现降低配置量。原因：

```
概念级的问题：
  客户 → customers 表
  问"客户数" → SELECT COUNT(*) FROM customers ✅
  问"华东区客户数" → WHERE region = '华东' ✅
  问"客户平均订单金额" → ??? 需要 JOIN orders，但概念级映射没告诉你怎么 JOIN ❌

属性级能解决：
  客户.订单 → JOIN orders ON customers.id = orders.customer_id（关联映射里配好了）
  问"客户平均订单金额" → AVG(orders.amount) GROUP BY customers.id ✅
```

---

##### 6.2.2.6 最终数据模型

采用**属性级映射**设计：一个概念属性对应一条映射记录，一条记录对应一个数据源的一个字段。相比概念级 JSON 存储，属性级设计更精确、更易查询和更新，且与 6.2.2.5 的粒度决策一致。

**主映射表：concept_mapping（属性→字段）**

```sql
CREATE TABLE concept_mapping (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    concept_id      BIGINT        NOT NULL COMMENT '概念ID',
    datasource_id   BIGINT        NOT NULL COMMENT '数据源ID（关联 datasource 表）',
    table_name      VARCHAR(128)  NOT NULL COMMENT '数据表名',
    column_name     VARCHAR(128)  NOT NULL COMMENT '数据库字段名',
    attribute_name  VARCHAR(128)  NULL     COMMENT '概念属性名（概念属性→表字段）',
    mapping_type    VARCHAR(16)   NOT NULL DEFAULT 'direct' COMMENT '映射类型: direct/join/computed',
    join_condition  VARCHAR(512)  NULL     COMMENT 'JOIN 条件，如 orders.customer_id = customers.id',
    computed_expr   VARCHAR(512)  NULL     COMMENT '计算表达式，如 SUM(orders.amount)',
    confidence      DECIMAL(3,2)  NULL     COMMENT '映射置信度（自动发现）',
    is_auto         BOOLEAN       NOT NULL DEFAULT FALSE COMMENT '是否自动发现',
    is_required     BOOLEAN       NOT NULL DEFAULT FALSE COMMENT '是否必填映射',
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_concept_attr_ds (concept_id, attribute_name, datasource_id),
    INDEX idx_datasource (datasource_id),
    INDEX idx_concept (concept_id)
) COMMENT '概念属性→数据源字段映射（属性级）';
```

**属性映射示例**（概念"客户"映射到 CRM 库）：

```
concept_id=1, datasource_id=5, table_name='customers'

┌────┬──────────────┬──────────────┬──────────┬────────┬──────────┐
│ id │ attribute_name│ column_name  │ mapping  │ is_auto│confidence│
│    │              │              │ _type    │        │          │
├────┼──────────────┼──────────────┼──────────┼────────┼──────────┤
│ 1  │ 客户ID       │ id           │ direct   │ true   │ 0.98     │
│ 2  │ 客户名称     │ name         │ direct   │ true   │ 0.95     │
│ 3  │ 客户等级     │ tier         │ direct   │ true   │ 0.72     │
│ 4  │ 所属区域     │ region       │ direct   │ true   │ 0.91     │
│ 5  │ 客户价值     │ NULL         │ computed │ false  │ NULL     │
│    │              │ computed_expr: SUM(orders.amount)            │
└────┴──────────────┴──────────────┴──────────┴────────┴──────────┘
```

**关联概念 JOIN 映射表：concept_join_mapping**

关联概念的 JOIN 关系（如"客户 HAS 订单"）需要额外的表来存储，因为一条 JOIN 涉及目标概念、关系类型、JOIN 表等多维信息，不适合放在属性级映射表中。

```sql
CREATE TABLE concept_join_mapping (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    concept_id      BIGINT        NOT NULL COMMENT '源概念ID',
    datasource_id   BIGINT        NOT NULL COMMENT '数据源ID',
    target_concept  VARCHAR(128)  NOT NULL COMMENT '目标概念名称',
    relation_type   VARCHAR(32)   NOT NULL COMMENT '关系类型: HAS/BELONGS_TO/COMPUTED_FROM等',
    join_table      VARCHAR(128)  NOT NULL COMMENT 'JOIN 的目标表名',
    join_condition  VARCHAR(512)  NOT NULL COMMENT 'JOIN 条件，如 customers.id = orders.customer_id',
    join_type       VARCHAR(16)   NOT NULL DEFAULT 'LEFT' COMMENT 'JOIN 类型: LEFT/INNER/RIGHT',
    confidence      DECIMAL(3,2)  NULL     COMMENT '自动发现置信度',
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_concept_join (concept_id, target_concept, relation_type, datasource_id),
    INDEX idx_concept (concept_id),
    INDEX idx_datasource (datasource_id)
) COMMENT '概念关联JOIN映射';
```

**JOIN 映射示例**：

```
concept_id=1（客户），datasource_id=5

┌────┬──────────────┬──────────┬───────────┬──────────────────────────┬────────┐
│ id │ target_concept│ relation │ join_table│ join_condition           │ join   │
│    │              │ _type    │           │                          │ _type  │
├────┼──────────────┼──────────┼───────────┼──────────────────────────┼────────┤
│ 1  │ 订单         │ HAS      │ orders    │ customers.id =           │ LEFT   │
│    │              │          │           │ orders.customer_id       │        │
│ 2  │ 账户         │ HAS      │ accounts  │ customers.id =           │ LEFT   │
│    │              │          │           │ accounts.customer_id     │        │
└────┴──────────────┴──────────┴───────────┴──────────────────────────┴────────┘
```

**关键设计**：
- 一个概念可以映射到多个数据源（通过 `concept_id + datasource_id` 区分）
- 一个概念属性在不同数据源中可以有不同映射（唯一索引 `uk_concept_attr_ds` 包含 datasource_id）
- 映射是声明式的，不需要写 SQL（平台根据映射记录 + JOIN 映射自动生成 JOIN）
- 映射支持"计算属性"（`mapping_type = 'computed'`，通过 `computed_expr` 定义表达式）
- `confidence` 字段记录自动发现的置信度，低置信度映射标记为待审核
- `is_auto` 字段区分映射来源（自动发现 vs 手动配置），便于追踪和优化

---

##### 6.2.2.7 映射实施路线

| 阶段 | 做什么 | 产出 |
|------|--------|------|
| Day 1-2 | 建表 + 后端 CRUD API | 映射的存储和查询 |
| Day 3 | 数据源元数据扫描 | 自动读取表结构、外键 |
| Day 4 | 自动发现（LLM 语义匹配） | 连接数据源后自动生成候选映射 |
| Day 5 | 可视化映射编辑器 | 拖拽连线手动调整 |
| 后续 | 智能补全 | 问数时自动发现未映射概念

#### 6.2.3 语义路由引擎（解决"查询"问题）

**问题**：用户问"华东区上周销量多少？"，系统需要理解"销量"对应哪个概念、哪个数据源、怎么查。

**方案**：构建语义路由引擎，将自然语言问题自动路由到正确的概念→映射→数据源。

```
语义路由流程

用户输入: "华东区上周销量多少？"
    │
    ▼
┌──────────────────────────────────────┐
│ 1. 概念识别（Concept Recognition）     │
│    LLM 分析问题，提取概念:              │
│    → "销量" → 匹配概念 "销售订单.金额"  │
│    → "华东区" → 匹配概念 "客户.所属区域"  │
│    → "上周" → 时间范围表达式            │
└──────────────┬───────────────────────┘
               ▼
┌──────────────────────────────────────┐
│ 2. 概念消歧（Concept Disambiguation）  │
│    多个候选概念时，用上下文消歧:         │
│    → "销量"可能指"订单金额"或"发货数量"  │
│    → 优先匹配当前域概念，再匹配全局概念  │
│    → 当前域由用户会话上下文决定（如用户  │
│      在"营销域"页面发起问数）            │
│    → 如果未指定域，则搜索所有域+全局概念  │
│    → 多候选时，按置信度排序，取 Top 1    │
└──────────────┬───────────────────────┘
               ▼
┌──────────────────────────────────────┐
│ 3. 权限校验（Permission Check）← 新增    │
│    校验用户角色是否有该概念的域权限:       │
│    → role_concept_permission 表查询     │
│    → 无权限直接拒绝，不暴露配置           │
│    → 详见 6.2.14 问数权限体系            │
└──────────────┬───────────────────────┘
               ▼
┌──────────────────────────────────────┐
│ 4. 映射解析（Mapping Resolution）      │
│    查找概念的映射:                      │
│    → "销售订单" → 数据源: ERP数据库     │
│    → "金额" → 字段: orders.amount      │
│    → "客户.所属区域" → 字段: customers.region │
└──────────────┬───────────────────────┘
               ▼
┌──────────────────────────────────────┐
│ 5. SQL 生成（SQL Generation）          │
│    SELECT SUM(orders.amount)          │
│    FROM orders                        │
│    JOIN customers ON ...              │
│    WHERE customers.region = '华东'    │
│      AND orders.created_at BETWEEN ... │
└──────────────┬───────────────────────┘
               ▼
┌──────────────────────────────────────┐
│ 6. SQL 安全校验（SQL Validation）       │
│    → 解析 SQL AST，只允许 SELECT       │
│    → 校验涉及的表在映射范围内           │
│    → 禁止 DML/DDL/子查询写操作         │
│    → 详见 6.2.3.0.1 安全防线（四层）    │
└──────────────┬───────────────────────┘
               ▼
┌──────────────────────────────────────┐
│ 7. 执行与返回                          │
│    优先走概念绑定的工具执行（6.2.6）；  │
│    如果未绑定，则走工具注册表自动匹配；  │
│    执行 SQL → 返回结果                 │
└──────────────────────────────────────┘
```

**核心组件**：

| 组件 | 功能 | 依赖 |
|------|------|------|
| 概念识别器 | 从自然语言中提取概念 | LLM + 概念向量索引（6.2.4） |
| 概念消歧器 | 多候选时选择最匹配的概念 | 上下文 + 域范围 |
| 权限校验器 | 校验用户角色是否有概念的域权限 | role_concept_permission 表（6.2.14） |
| 映射解析器 | 概念→数据源→SQL | concept_mapping 表（6.2.2） |
| SQL 生成器 | 自动生成可执行 SQL | 映射 + 表结构元数据（详见 6.2.3.0.1 NL2SQL 详解） |
| SQL 安全校验器 | 解析 SQL AST，只允许 SELECT，禁止写操作 | JSqlParser + 映射范围校验（6.2.3.0.1） |
| 执行器 | 调用绑定工具或工具注册表执行 | 工具绑定（6.2.6）+ 工具注册表 |

> **执行路径优先级**：概念绑定工具（6.2.6）> 工具注册表自动匹配。如果概念已绑定默认工具，语义路由直接使用绑定工具执行；如果未绑定，则由工具注册表根据 SQL 类型自动匹配合适的执行工具。

##### 6.2.3.0 现状 vs 目标：从工具中心化到概念中心化

**为什么需要改？** 当前问数链路是"工具中心化"的——每个工具就是一个 SQL 查询模板，工具描述写死了它能查什么。LLM 匹配到工具后直接调用，没有"概念→数据表/字段"的中间映射层。这种模式在工具数量少时可以工作，但每个新查询场景都需要创建一个新工具，无法规模化。

**目标**：从"工具中心化"演进到"概念中心化"，引入概念映射层（`concept_mapping`）作为业务语义和数据表之间的桥梁，让 Agent 根据映射关系动态生成 SQL，而非依赖工具内硬编码的 SQL 模板。

```
现状流程（工具中心化）                              目标流程（概念中心化）

用户问题: "华东区VIP客户价值"                           用户问题: "华东区VIP客户价值"
    │                                                    │
    ▼                                                    ▼
┌───────────────────────┐                          ┌───────────────────────┐
│ Step 1: LLM 选系统     │                          │ Step 1: FAISS 向量检索  │
│ 从可用系统中选一个      │                          │ embedding(用户问题)    │
│ 如 "ERP"              │                          │ → TopK 候选概念        │
└───────────┬───────────┘                          │ [客户价值(0.85),       │
            ▼                                      │  客户(0.78),           │
┌───────────────────────┐                          │  订单金额(0.61)]       │
│ Step 2: Embedding     │                          │                        │
│ 匹配工具描述            │                          │ 作用: 从200个概念中      │
│ 用户问题向量化          │                          │ 筛出5个候选，减少        │
│ → 与工具embedding      │                          │ LLM prompt长度         │
│   做余弦相似度          │                          └───────────┬───────────┘
│ → TopK 工具            │                                      ▼
└───────────┬───────────┘                          ┌───────────────────────┐
            ▼                                      │ Step 2: LLM 语义消歧    │
┌───────────────────────┐                          │                        │
│ Step 3: Jena 展开概念  │                          │ 候选概念 + 用户问题      │
│ 从工具 → 反向找概念     │                          │ → LLM 选择最匹配的       │
│ CONSUMES/PRODUCES     │                          │ → 确定: "客户价值"       │
│ 展开子概念/等价概念     │                          │                        │
│                        │                          │ 作用: 语义理解，          │
│ 作用: 补全关联工具      │                          │ 从候选概念中确定一个       │
└───────────┬───────────┘                          └───────────┬───────────┘
            ▼                                                      ▼
┌───────────────────────┐                          ┌───────────────────────┐
│ Step 4: LLM 调用工具   │                          │ Step 3: Jena 关系展开    │
│ 工具描述里写死了        │                          │                        │
│ 它能查什么 SQL         │                          │ "客户价值" COMPUTED_    │
│                        │                          │   FROM "客户"          │
│ 工具内部 SQL 模板:      │                          │ → 需要先查"客户"数据     │
│ SELECT SUM(amount)    │                          │                        │
│ FROM orders           │                          │ "客户" EQUIVALENT_TO   │
│ WHERE region = ?      │                          │   "消费者"(CRM域)       │
│   AND level = 'VIP'   │                          │ → 跨域备选              │
│                        │                          │                        │
│ 问题: 换个地区/级别     │                          │ "VIP客户" subClassOf   │
│ 就要多写一个工具        │                          │   "客户"               │
│                        │                          │ → 查询自动包含子类       │
│                        │                          │                        │
│                        │                          │ 输出: {客户价值, 客户}   │
│                        │                          │                        │
│                        │                          │ 作用: 补全依赖关系，      │
│                        │                          │ 确保SQL不遗漏JOIN       │
└───────────────────────┘                          └───────────┬───────────┘
                                                                  ▼
                                                   ┌───────────────────────┐
                                                   │ Step 4: 查映射+绑定     │
                                                   │                        │
                                                   │ concept_mapping:        │
                                                   │ 客户价值.金额           │
                                                   │ → ERP.orders.amount    │
                                                   │ 客户.名称              │
                                                   │ → CRM.customers.name   │
                                                   │ 客户.区域              │
                                                   │ → CRM.customers.region │
                                                   │                        │
                                                   │ concept_tool_binding:   │
                                                   │ 客户 → query_crm       │
                                                   │ 客户价值 → query_order │
                                                   └───────────┬───────────┘
                                                              ▼
                                                   ┌───────────────────────┐
                                                   │ Step 5: 权限校验（资源包）│
                                                   │                        │
                                                   │ role_concept_permission │
                                                   │ 用户角色 → 概念域权限    │
                                                   │ 无权限 → 拒绝并提示      │
                                                   │ 详见 6.2.14             │
                                                   └───────────┬───────────┘
                                                              ▼
                                                   ┌───────────────────────┐
                                                   │ Step 6: Agent 生成SQL  │
                                                   │                        │
                                                   │ 根据映射+绑定动态生成:   │
                                                   │ SELECT SUM(o.amount)   │
                                                   │ FROM orders o          │
                                                   │ JOIN customers c       │
                                                   │   ON o.customer_id     │
                                                   │    = c.id              │
                                                   │ WHERE c.region = '华东' │
                                                   │   AND c.level = 'VIP'  │
                                                   │                        │
                                                   │ 新需求: 换个地区/级别→  │
                                                   │ 同一套概念, 自动生成SQL  │
                                                   └───────────────────────┘
```

**核心区别**：

| 维度 | 现状 | 目标 |
|------|------|------|
| **匹配对象** | 匹配工具描述（"这个工具能查什么"） | 匹配概念名称+描述（"用户说的是哪个业务概念"） |
| **映射层** | 无，SQL 写死在工具模板里 | `concept_mapping` 表，概念属性→表字段，独立维护 |
| **SQL 生成** | 工具硬编码，一个查询场景一个工具 | Agent 根据映射关系动态生成，概念复用 |
| **权限控制** | 工具级（API KEY 逐工具授权） | 概念域级（角色 × 域，一次配置，详见 6.2.14） |
| **扩展成本** | 新查询场景 → 创建新工具 → 写死 SQL | 新查询场景 → 复用已有概念 → 映射关系自动组合 |

**FAISS、LLM、Jena 三者协作关系**：

```
FAISS ←→ LLM ←→ Jena：三者串行，互不替代

┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  FAISS                   LLM                   Jena           │
│  向量检索                 语义消歧                关系展开       │
│                                                               │
│  "像哪个概念"             "是哪个概念"            "还依赖谁"      │
│                                                               │
│  只看向量距离            理解上下文语义           OWL规则推理     │
│  毫秒级                 秒级                    毫秒级         │
│                                                               │
│  为什么不能替代：         为什么不能替代：         为什么不能替代：  │
│  LLM 也能做，但太慢       FAISS 只看相似度，       LLM 不知道     │
│  太贵，200个概念直接     不知道业务语义合理性      OWL里定义的     │
│  塞给LLM要20K tokens     Jena 只做规则推理，      父子/等价/      │
│  FAISS 先筛到5个候选    不理解自然语言            依赖关系        │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

**三者串行链路**：FAISS 筛候选（毫秒级过滤）→ LLM 定概念（语义理解消歧）→ Jena 补依赖（规则推理展开）。三者各司其职，互不替代。

##### 6.2.3.0.1 NL2SQL 详解：本体如何驱动 SQL 动态生成

当前工具内的 SQL 是硬编码的模板，例如 `SELECT * FROM employees WHERE dept = ?`。目标是从自然语言问题出发，通过本体概念和映射关系，让 LLM 动态生成 SQL，而非从工具模板中选取。

**核心流程**：

```
用户问题: "华东区上月VIP客户消费总额"
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: 概念识别 → 映射加载                                       │
│                                                                 │
│ FAISS + LLM 消歧 → 确定概念: "客户消费"                            │
│ Jena 展开 → "客户消费" COMPUTED_FROM "客户" → 需要客户表           │
│                                                                 │
│ 加载 concept_mapping:                                            │
│   客户消费.金额   → ERP.orders.amount                             │
│   客户消费.时间   → ERP.orders.created_at                         │
│   客户.名称      → ERP.customers.name                             │
│   客户.区域      → ERP.customers.region                           │
│   客户.等级      → ERP.customers.level                            │
│   客户.ID        → ERP.customers.id                               │
│   客户消费.客户ID → ERP.orders.customer_id                        │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: 权限校验（资源包验证）                                      │
│                                                                 │
│ 问数权限基于角色 × 概念域（详见 6.2.14），在生成 SQL 之前必须校验：    │
│                                                                 │
│ ┌── 校验流程 ─────────────────────────────────────────────────┐  │
│ │                                                              │  │
│ │ 1. 查用户角色                                                 │  │
│ │    SELECT * FROM role_user WHERE user_id = 当前用户ID         │  │
│ │    → 角色: HR-问数                                            │  │
│ │                                                              │  │
│ │ 2. 查角色概念域权限                                            │  │
│ │    SELECT * FROM role_concept_permission                     │  │
│ │    WHERE role_id IN (HR-问数)                                │  │
│ │      AND group_id IN (运营域ID, 营销域ID)                    │  │
│ │    → 运营域 ✅  营销域 ❌（未授权）                            │  │
│ │                                                              │  │
│ │ 3. 逐概念校验                                                 │  │
│ │    "客户消费" → 所属域: 运营域 → role_concept_permission 有 ✅  │  │
│ │    "客户"     → 所属域: 运营域 → role_concept_permission 有 ✅  │  │
│ │                                                              │  │
│ │ 4. 结果判断                                                   │  │
│ │    ├─ 全部概念通过 → 继续 Step 3                               │  │
│ │    └─ 任一概念无权限 → 拒绝，返回:                              │  │
│ │       "您的问题涉及「客户消费」概念，属于「运营域」。            │  │
│ │        您当前没有该域的查询权限，请联系管理员开通。"              │  │
│ └──────────────────────────────────────────────────────────────┘  │
│                                                                 │
│ 关键约束:                                                        │
│ - 权限校验不暴露数据库表名、字段名、数据源配置                       │
│ - 校验失败只提示概念名和域名的业务名称                              │
│ - 多个概念部分无权限时，不执行部分查询（全有或全无）                  │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: 构建 LLM NL2SQL Prompt                                   │
│                                                                 │
│ 将映射关系、表结构、自然语言问题一起发送给 LLM:                      │
│                                                                 │
│ ┌── LLM Prompt ──────────────────────────────────────────────┐  │
│ │                                                             │  │
│ │ 你是 SQL 生成器。根据以下信息生成 SQL 查询。                   │  │
│ │                                                             │  │
│ │ ## 用户问题                                                  │  │
│ │ 华东区上月VIP客户消费总额                                      │  │
│ │                                                             │  │
│ │ ## 涉及的概念及映射关系                                        │  │
│ │ 概念: 客户消费                                                │  │
│ │   属性: 金额 → ERP.orders.amount                             │  │
│ │   属性: 时间 → ERP.orders.created_at                          │  │
│ │   属性: 客户ID → ERP.orders.customer_id                       │  │
│ │                                                             │  │
│ │ 概念: 客户（依赖概念，Jena COMPUTED_FROM 推导）                 │  │
│ │   属性: 名称 → ERP.customers.name                             │  │
│ │   属性: 区域 → ERP.customers.region                           │  │
│ │   属性: 等级 → ERP.customers.level                            │  │
│ │   属性: ID → ERP.customers.id                                 │  │
│ │                                                             │  │
│ │ ## 表结构                                                    │  │
│ │ CREATE TABLE orders (                                       │  │
│ │   id INT PRIMARY KEY,                                       │  │
│ │   customer_id INT,                                          │  │
│ │   amount DECIMAL(10,2),                                     │  │
│ │   created_at DATETIME                                       │  │
│ │ );                                                          │  │
│ │                                                             │  │
│ │ CREATE TABLE customers (                                    │  │
│ │   id INT PRIMARY KEY,                                       │  │
│ │   name VARCHAR(100),                                        │  │
│ │   region VARCHAR(50),                                       │  │
│ │   level VARCHAR(20)  -- 'VIP', '普通', '企业'                │  │
│ │ );                                                          │  │
│ │                                                             │  │
│ │ ## 要求                                                      │  │
│ │ - 只生成 SELECT 语句，不要 INSERT/UPDATE/DELETE               │  │
│ │ - 使用概念映射中的字段名                                      │  │
│ │ - 金额聚合使用 SUM                                           │  │
│ │ - "上月"指 2026年7月                                          │  │
│ │ - "华东"对应 region = '华东'                                   │  │
│ │ - "VIP客户"对应 level = 'VIP'                                  │  │
│ │                                                             │  │
│ │ 请生成 SQL:                                                  │  │
│ └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: LLM 输出 SQL                                             │
│                                                                 │
│ SELECT SUM(o.amount) AS total_consumption                       │
│ FROM orders o                                                   │
│ JOIN customers c ON o.customer_id = c.id                        │
│ WHERE c.region = '华东'                                          │
│   AND c.level = 'VIP'                                           │
│   AND o.created_at >= '2026-07-01'                              │
│   AND o.created_at < '2026-08-01'                               │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: SQL 安全校验 + 执行                                      │
│                                                                 │
│ - 校验: 只允许 SELECT，禁止 INSERT/UPDATE/DELETE/DROP             │
│ - 校验: 涉及的表必须在映射范围内（orders, customers 都在映射中）    │
│ - 执行: 通过 concept_tool_binding 找到执行工具                    │
│   客户消费 → query_order_stats (SQL 执行工具)                    │
│   或直接通过 DatasourceService 执行 SQL                          │
└─────────────────────────────────────────────────────────────────┘
```

**LLM 生成 SQL 的关键约束（System Prompt）**：

```
你必须遵守以下规则：

1. 只生成 SELECT 查询，禁止 INSERT/UPDATE/DELETE/DROP/ALTER
2. 表名和字段名必须完全使用提供的映射关系中的名称，不要自己编造
3. JOIN 条件从表结构的外键关系推断（如 orders.customer_id → customers.id）
4. 聚合函数（SUM/COUNT/AVG/MAX/MIN）从用户问题中推断
   - "总额" → SUM
   - "人数" → COUNT
   - "平均" → AVG
5. 时间范围从用户问题中推断
   - "上月" → 当前月-1，整月范围
   - "今年" → 当前年份 1月1日到当前日期
   - "最近30天" → 当前日期-30天
6. 过滤条件从用户问题中提取，使用映射中的字段名
   - "华东区" → region = '华东'
   - "VIP客户" → level = 'VIP'
7. 如果问题涉及多个概念（Jena 展开的依赖概念），自动生成 JOIN
8. 如果无法确定某个条件，返回 NULL 而不是猜测
```

**与硬编码工具 SQL 的对比**：

```
┌──────────────────┬────────────────────────┬────────────────────────┐
│                  │ 硬编码工具 SQL（现状）    │ 本体 NL2SQL（目标）      │
├──────────────────┼────────────────────────┼────────────────────────┤
│ SQL 来源          │ 创建工具时手写模板       │ LLM 根据映射动态生成     │
│ 参数化            │ 占位符 ? 替换           │ LLM 自然理解后填入       │
│ 新查询场景        │ 创建新工具 + 写新 SQL    │ 复用已有概念，映射自动组合│
│ JOIN 处理         │ 工具内手写 JOIN          │ Jena 展开依赖 → LLM 生成 │
│ 时间推断          │ 参数传入                │ LLM 从自然语言推断       │
│ 聚合推断          │ 工具内写死               │ LLM 从自然语言推断       │
│ 安全              │ 工具限制（只能调已授权）  │ SQL 校验 + 概念权限      │
│ 错误处理          │ SQL 语法错误 → 工具报错  │ LLM 自修正 + 安全拦截    │
└──────────────────┴────────────────────────┴────────────────────────┘
```

**安全防线（四层）**：

```
第 1 层: 资源包验证（Step 2）
  → 角色 × 概念域权限校验（role_concept_permission）
  → 无权限直接拒绝，不暴露任何配置信息
  → 详见 6.2.14 问数权限体系

第 2 层: Prompt 约束
  → System Prompt 明确禁止 DML/DDL，只允许 SELECT

第 3 层: SQL 解析校验
  → 使用 JSqlParser 或类似工具解析 SQL AST
  → 检查: 只包含 SELECT 语句
  → 检查: 涉及的表名都在映射范围内
  → 检查: 无子查询写操作、无存储过程调用

第 4 层: 数据库权限
  → 问数 Agent 执行 SQL 时，使用 PLATFORM 数据源中配置的数据库账号
  → 该账号在数据库层面仅授予 SELECT 权限（由 DBA 在创建数据源时配置）
  → 实现方式：在数据源管理页面，PLATFORM 类型数据源需额外配置"问数专用账号"
    - 数据源创建者提供一个只读数据库账号（与日常读写账号分离）
    - 平台在初始化时验证该账号确实只有 SELECT 权限
  → 即使上方三层校验全部被绕过，数据库层面也无法执行写操作
  → 注意：与 REF 数据源（API Key 授权）不同，PLATFORM 数据源的问数权限通过角色概念域授权
    （role_concept_permission 表），不依赖 API Key 机制
```

##### 6.2.3.1 概念溯源：问数结果中展示匹配的概念

**问题**：当前问数只返回查询结果，用户看不到系统"理解"了哪些概念。如果概念解析错误，用户也无法察觉，只能看到错误的数字。

**方案**：每次问数响应中，附带一个**概念溯源面板**，展示本次查询匹配到的概念及映射路径。

```
问数结果中的概念溯源展示

┌─────────────────────────────────────────────────────┐
│ 🤖 AI 助手                                          │
│                                                     │
│ 华东区上周销量为 12,580 件，总金额 ¥3,270,000。       │
│ 较前一周增长 8.3%。                                  │
│                                                     │
│ ┌ 概念溯源 ──────────────────────────────────┐       │
│ │                                            │       │
│ │ 本次查询使用了以下概念:                       │       │
│ │                                            │       │
│ │ ┌──────────────┐  ┌──────────────┐         │       │
│ │ │ 📦 销售订单    │  │ 👤 客户       │         │       │
│ │ │              │  │              │         │       │
│ │ │ 金额         │  │ 所属区域      │         │       │
│ │ │ 数量         │  └──────────────┘         │       │
│ │ │ 创建时间      │                          │       │
│ │ └──────────────┘                          │       │
│ │                                            │       │
│ │ 映射路径:                                   │       │
│ │ 销售订单.金额 → ERP.orders.amount          │       │
│ │ 销售订单.数量 → ERP.orders.quantity        │       │
│ │ 客户.所属区域 → CRM.customers.region       │       │
│ │                                            │       │
│ │ 数据源: ERP 数据库, CRM 数据库              │       │
│ │                                            │       │
│ │ [👍 概念正确] [👎 概念错误]                  │       │
│ └────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────┘
```

**概念溯源面板的内容**：

| 信息项 | 说明 | 来源 |
|-------|------|------|
| 匹配的概念 + 属性 | 本次查询涉及的概念名称和使用的属性 | `concept:resolve` 消歧结果 |
| 映射路径 | 概念属性 → 数据表字段的完整路径 | `mapping:resolve` 解析结果 |
| 数据源 | 查询实际使用的数据源名称 | 映射对应数据源 |
| 反馈按钮 | 用户可反馈概念是否正确 | 用于优化消歧模型 |

**交互设计**：

```
概念溯源面板的三种状态

状态 1: 正常（所有概念已匹配）
  ┌ 概念溯源 ──────────────────────────────────┐
  │ ✅ 已匹配 3 个概念                          │
  │ [展开查看详情]                              │
  └────────────────────────────────────────────┘
  默认折叠，点击展开后显示完整映射路径

状态 2: 部分匹配（有概念未映射）
  ┌ 概念溯源 ──────────────────────────────────┐
  │ ⚠️ 已匹配 2 个概念，1 个概念未映射            │
  │ [展开查看详情]                              │
  │                                            │
  │ 展开后:                                    │
  │ ✅ 销售订单 (ERP.orders)                   │
  │ ✅ 客户 (CRM.customers)                    │
  │ ⚠️ 客户等级 (未映射)                        │
  │    提示: 该概念尚未配置数据映射，             │
  │    查询结果可能不完整                        │
  └────────────────────────────────────────────┘

状态 3: 无法匹配（概念消歧失败）
  ┌ 概念溯源 ──────────────────────────────────┐
  │ ❌ 无法识别概念                             │
  │                                            │
  │ 您的问题中可能包含以下未定义的概念:            │
  │ • "客户流失率" — 系统中未找到此概念          │
  │                                            │
  │ 建议: 联系数据架构师添加此概念，              │
  │ 或尝试换个说法，如"客户数变化"               │
  └────────────────────────────────────────────┘
```

**用户反馈闭环**：

```
用户点击反馈后的处理流程

👍 概念正确:
  → 记录正向反馈，提升该概念-问题的匹配权重
  → 无进一步操作

👎 概念错误:
  → 弹出简洁反馈面板（系统自动采集上下文，用户只需描述问题）:
    ┌ 反馈 ───────────────────────────────────┐
    │                                        │
    │ 哪里不对？                              │
    │ [____________________________]          │
    │                                        │
    │ 系统将自动上传:                          │
    │ 📝 你的问题: "华东区上周销量多少？"        │
    │ 🧠 思考过程: [已自动采集]                 │
    │ 📦 匹配概念: 销售订单, 客户               │
    │ 📊 查询结果: [已自动采集]                 │
    │                                        │
    │ [提交反馈]  [取消]                       │
    └────────────────────────────────────────┘
  → 一键提交，无需用户重复描述技术细节
  → 反馈记录到 feedback_log 表

反馈自动采集的字段（用户无需填写）:

| 字段 | 说明 | 采集方式 |
|------|------|---------|
| 用户原始问题 | 用户输入的自然语言 | 从当前会话消息自动获取 |
| 思考过程 | LLM 的推理链（如有） | 从 Agent 响应中自动获取 |
| 匹配的概念 | concept:resolve 的消歧结果 | 从 conceptTrace 自动获取 |
| 映射路径 | 概念→数据源的完整路径 | 从 conceptTrace 自动获取 |
| 生成的 SQL | 语义路由生成的查询语句 | 从 Agent 工具调用记录获取 |
| 查询结果 | 返回的数据结果 | 从 Agent 响应中自动获取 |
| 用户反馈 | 用户描述的"哪里不对" | 用户唯一需要填写的内容 |
| 时间戳 | 反馈时间 | 系统自动生成 |
```

**反馈数据的使用**：

```
反馈数据流向

用户提交反馈
    │
    ▼
┌──────────────────────────────────────────────┐
│ feedback_log 表                              │
│ ├── 原始问题 + 消歧概念 + SQL + 结果 + 用户反馈  │
│ └── 完整上下文，管理员可直接复现问题              │
└──────────────────┬───────────────────────────┘
                   │
    ┌──────────────┼──────────────┐
    ▼              ▼              ▼
┌────────┐  ┌──────────┐  ┌──────────────┐
│ 即时通知 │  │ 消歧优化  │  │ 管理员审核     │
│        │  │          │  │              │
│ 新反馈时 │  │ 积累反馈  │  │ 概念本体页面   │
│ 通知管理 │  │ 对，优化  │  │ 查看反馈列表   │
│ 员      │  │ LLM prompt│  │ 调整映射/概念  │
└────────┘  └──────────┘  └──────────────┘
```

**实施要点**：
- 概念溯源面板默认折叠，不影响用户查看查询结果
- 映射路径使用业务语言，不暴露数据库字段名（除非用户展开"技术详情"）
- **反馈一键上传**：用户只需描述"哪里不对"，其余字段（输入、思考过程、概念、输出）全部自动采集，零额外填写负担
- 反馈数据匿名化，不关联具体用户，只记录概念-问题匹配对
- 问数响应中 `conceptTrace` 字段与 `content` 平级，前端独立渲染

##### 6.2.3.2 概念溯源与现有问数页面集成

**现状**：`AgentChatPage.tsx` 的 `ChatMessage` 接口只有 `role`、`content`、`toolCalls`、`timestamp` 四个字段，API 响应只返回 `answer` 和 `toolCalls`，不支持概念溯源。

**集成方案**：

```
前端改动清单

1. ChatMessage 接口扩展:
   interface ChatMessage {
     id: string;
     role: 'user' | 'assistant' | 'system';
     content: string;
     toolCalls?: { name: string; result: string }[];
     conceptTrace?: ConceptTrace;  // ← 新增
     timestamp: string;
   }

2. ConceptTrace 类型定义:
   interface ConceptTrace {
     status: 'all_matched' | 'partial' | 'none';
     concepts: {
       conceptId: number;
       conceptName: string;
       attributes: { name: string; mappingPath: string }[];
       matched: boolean;
       confidence: number;
     }[];
     dataSources: string[];
   }

3. API 响应扩展:
   // POST /api/v1/agent/chat 响应中新增字段
   {
     "answer": "...",
     "toolCalls": [...],
     "conceptTrace": {           // ← 新增
       "status": "all_matched",
       "concepts": [
         {
           "conceptId": 12,
           "conceptName": "销售订单",
           "attributes": [
             { "name": "金额", "mappingPath": "ERP.orders.amount" },
             { "name": "数量", "mappingPath": "ERP.orders.quantity" }
           ],
           "matched": true,
           "confidence": 0.95
         }
       ],
       "dataSources": ["ERP 数据库"]
     }
   }
```

**渲染位置**：消息内容下方、工具调用上方，使用独立组件 `ConceptTracePanel`。

```
AgentChatPage 消息渲染结构（改动后）

agent-chat-message-body
  ├── agent-chat-message-content    ← 现有：AI 回答文本
  ├── concept-trace-panel           ← 新增：概念溯源面板
  │   ├── 默认折叠：概念溯源（✅ 已匹配 3 个概念）
  │   └── 展开后：
  │       ├── 概念卡片列表
  │       │   ├── 销售订单（金额 → ERP.orders.amount, 数量 → ...）
  │       │   └── 客户（所属区域 → CRM.customers.region）
  │       ├── 数据源标签
  │       └── [👍 概念正确] [👎 概念错误]
  └── agent-chat-tool-calls         ← 现有：工具调用记录
```

**ConceptTracePanel 组件设计**：

```tsx
// 组件 Props
interface ConceptTracePanelProps {
  trace: ConceptTrace;
  messageId: string;
}

// 组件状态
const [expanded, setExpanded] = useState(false);
const [feedbackOpen, setFeedbackOpen] = useState(false);
const [feedbackText, setFeedbackText] = useState('');

// 三种状态渲染
if (trace.status === 'none') {
  // 红色提示：无法识别概念
  return <div className="concept-trace concept-trace-error">
    <span>❌ 无法识别概念</span>
    <p>建议：联系数据架构师添加相关概念，或尝试换个说法</p>
  </div>;
}

if (trace.status === 'partial') {
  // 黄色提示：部分概念未映射
  return <div className="concept-trace concept-trace-warning">
    <span>⚠️ 已匹配 {trace.concepts.filter(c => c.matched).length} 个概念，
          {trace.concepts.filter(c => !c.matched).length} 个概念未映射</span>
    {/* 展开后显示详情 */}
  </div>;
}

// 正常显示：全部匹配
return <div className="concept-trace concept-trace-success">
  {/* 折叠/展开切换 + 概念列表 + 反馈按钮 */}
</div>;
```

**反馈提交**：

```tsx
// 点击 👎 概念错误 → 弹出反馈面板
const submitFeedback = async () => {
  await fetch('/api/v1/concepts/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messageId,        // 关联的消息 ID
      conceptTrace,     // 系统自动采集的完整溯源信息
      userFeedback: feedbackText,  // 用户唯一需要填写的
    }),
  });
  setFeedbackOpen(false);
  setFeedbackText('');
};
```

**CSS 样式要点**：

```css
.concept-trace {
  margin-top: 8px;
  border-radius: 6px;
  font-size: 12px;
  overflow: hidden;
}
.concept-trace-success {
  background: #f6ffed;
  border: 1px solid #b7eb8f;
}
.concept-trace-warning {
  background: #fffbe6;
  border: 1px solid #ffe58f;
}
.concept-trace-error {
  background: #fff2f0;
  border: 1px solid #ffccc7;
}
.concept-trace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
}
.concept-trace-body {
  padding: 0 12px 12px;
}
.concept-trace-concept {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 4px;
  margin: 4px 4px 0 0;
}
.concept-trace-feedback {
  display: flex;
  gap: 8px;
  padding: 8px 0;
  border-top: 1px solid #e8e8e8;
  margin-top: 8px;
}
```

**改动文件清单**：

| 文件 | 改动类型 | 说明 |
|------|:---:|------|
| `AgentChatPage.tsx` | 修改 | ChatMessage 接口加 conceptTrace，渲染 ConceptTracePanel |
| `ConceptTracePanel.tsx` | 新增 | 概念溯源面板组件 |
| `ConceptTracePanel.css` | 新增 | 面板样式 |
| `AgentChatPage.css` | 修改 | 可共用样式，无需大改 |
| `types/chat.ts` | 新增 | ConceptTrace 类型定义 |

**实现顺序**：先加 `ConceptTrace` 类型 → 加 `ConceptTracePanel` 组件 → 改 `AgentChatPage` 渲染逻辑 → 后端 API 加 `conceptTrace` 字段。

#### 6.2.4 大规模性能基础设施（解决"规模"问题）

**问题**：工业场景可能有数万个概念节点，当前全量加载在前端渲染和 Jena 推理都会卡死。

**方案**：

```
性能优化策略

1. 前端按需加载（Lazy Loading）
   ├── 初始只加载当前 Group 的概念（通常 < 200 个）
   ├── 展开子概念时懒加载子节点
   ├── 跨域概念以瘦节点显示（只显示名称 + 域标签）
   └── 虚拟滚动：画布外节点不渲染 DOM

2. 后端分页查询
   ├── GET /api/v1/concepts?groupId=1&page=0&size=100
   ├── 关系按需加载：GET /api/v1/concepts/:id/relations
   └── 搜索：全文索引 + 向量检索（概念名称语义匹配）

3. 推理引擎优化
   ├── 推理结果缓存（Redis/Memcached）
   ├── 增量推理：只推理变更的概念，不全量重跑
   ├── 推理范围限制：默认只在当前 Group 内推理
   └── 异步推理：大范围推理后台执行，前端轮询结果

4. 概念向量索引（语义搜索）
   ├── 概念名称 + 描述做 embedding
   ├── Python FAISS 内存索引（JVM 侧通过 HTTP 调用 Python embedding 服务）
   ├── 具体方案见 6.2.4.1 向量数据库必要性评估 和 6.2.4.2 Python FAISS 方案
   └── 问数时快速找到语义匹配的概念
```

##### 6.2.4.1 向量数据库必要性评估

> 向量数据库是基础设施中成本和运维复杂度最高的组件之一，需要审慎评估。
> **注意**：本项目使用 MySQL，MySQL 不支持 pgvector，且 MySQL 9.0 的 VECTOR 类型尚不成熟，不作为选项。

**向量检索在系统中的使用场景**：

| 场景 | 当前方案 | 是否依赖向量检索 | 检索规模 |
|------|---------|:---:|------|
| 概念消歧（concept:resolve） | LLM prompt 中传入概念列表，让 LLM 直接匹配 | ❌ 不依赖 | 全量概念（百~千级） |
| 概念搜索（编辑器内搜索） | 数据库 LIKE/全文索引 | ❌ 不依赖 | 当前 Group 概念（<200） |
| 自动发现（concept:discover） | LLM 直接分析表名/字段名语义 | ❌ 不依赖 | 单次一张表 |
| 智能补全（concept:complete） | LLM 语义匹配概念→表 | ❌ 不依赖 | 单次一个概念 |
| 语义相似概念推荐 | 无此功能 | — | — |

**结论：当前所有 LLM 驱动的功能都是直接把概念列表传给 LLM 做语义匹配，不依赖向量检索做预过滤。** 向量检索在系统中是一个可选的性能优化手段，而非必需组件。

**规模分析**：

```
概念数量与向量检索价值的关系

概念数 < 200（MVP 阶段）:
  └── LLM prompt 可容纳全部概念，向量检索无价值
      一个概念名称 + 描述约 100 tokens，200 个概念 ≈ 20K tokens
      DeepSeek 64K 上下文完全够用

概念数 200 ~ 2000（单行业落地）:
  └── 全量塞入 prompt 开始昂贵
      2000 个概念 ≈ 200K tokens，超出单次上下文
      此时向量检索有价值：先检索 Top 20 候选，再交给 LLM
      → 但概念数在千级，JVM 内存索引完全够用，无需外部数据库

概念数 > 2000（多行业跨域）:
  └── 需要向量检索做预过滤
      是否需要独立向量数据库取决于 QPS
      低频场景（<10 QPS）：JVM 内存索引足够
      高频场景（>100 QPS）：考虑 Milvus/Qdrant
```

**方案对比（MySQL 环境）**：

| 方案 | 部署复杂度 | 查询延迟 | 成本 | 适用规模 |
|------|:---:|------|------|------|
| 无向量检索，LLM 直接匹配 | ★☆☆ | 取决于 LLM API | 零额外成本 | <200 概念 |
| JVM 内存索引（FAISS Java binding） | ★★☆ | <1ms | 零额外成本 | <10K 向量，低 QPS |
| Milvus / Qdrant 独立部署 | ★★★ | <5ms | 服务器 + 运维 | >10K 向量，高 QPS |

**推荐分阶段策略**：

```
Phase 1（MVP，0-200 概念）:
  方案: 无向量检索
  理由: LLM prompt 直接容纳全部概念，零额外成本
  实现: concept:resolve 直接把当前 Group 概念列表序列化到 prompt
  风险: 无

Phase 2（单行业落地，200-2000 概念）:
  方案: Python FAISS 向量索引（复用已有 embedding 服务）
  理由: embedding 生成已在 Python 服务中，FAISS 是 Python 原生库，直接在 Python 侧构建索引比 Java 侧用 jvector 更成熟高效
  架构:
    - Java 负责: MySQL 读写 embedding 数据、调用 Python /v1/search/concepts 查询
    - Python 负责: FAISS 索引构建与维护、向量检索
    - 服务重启: Python 从 MySQL 加载所有 embedding 重建索引（千级 < 1 秒）
    - embedding 持久化: concept 表 embedding BLOB 列（MySQL，Java 负责写入）
  风险: 无，Python 服务已存在，只加两个端点

Phase 3（多行业平台化，>2000 概念 + 高 QPS）:
  方案: Milvus / Qdrant
  触发条件（满足其一即升级）:
    - 概念总数 > 5000 且日常 QPS > 50
    - 内存索引占用 > 100MB 影响 GC
    - 需要多实例共享索引（水平扩展）
    - 需要多模态检索（如同时检索概念和文档）
  理由: 独立向量数据库在大规模场景下性能更优，支持分布式和高可用
```

**不推荐一开始就引入独立向量数据库的理由**：

1. **运维成本高**：需要独立部署、监控、备份、升级，对一个小团队是额外负担
2. **MVP 阶段用不到**：50-200 个概念，LLM prompt 直接匹配更快更准
3. **JVM 内存索引已足够**：千级概念 × 1536 维 embedding ≈ 6MB，放内存毫无压力，且免去网络 I/O 开销
4. **LLM 本身就是最强的语义匹配器**：向量检索只是帮 LLM 缩小候选集，而概念数量少时不需要缩小
5. **数据同步简单**：MySQL concept 表新增 embedding 列，启动时一次性加载到内存，增删改时同步更新，无需维护外部数据库同步管道

**embedding 持久化方案**：

```
concept 表新增字段:
  embedding BLOB  -- 存储 1536 维 float32 向量（6KB/条）

embedding 生成时机:
  - 概念创建时：调用 LLM embedding API 生成并存储
  - 概念名称/描述修改时：重新生成 embedding
  - 定时任务：每周全量重新生成（防止模型升级后 embedding 漂移）

内存索引同步:
  - 服务启动：从 MySQL 加载所有 embedding → 构建 FAISS 索引
  - 概念新增：生成 embedding → 写入 MySQL → 插入内存索引
  - 概念修改：重新生成 embedding → 更新 MySQL → 更新内存索引
  - 概念删除：删除 MySQL 记录 → 从内存索引移除
```

##### 6.2.4.2 向量索引实施（Python FAISS + Java 持久化）

> **架构决策**：向量索引放在 Python embedding 服务中，而非 Java 侧。
> 理由：embedding 生成已在 Python 服务中（端口 8765），FAISS 是 Python 原生库，在 Python 侧构建索引零额外依赖。Java 侧只负责 MySQL 读写和调用 Python 查询，不引入 jvector/jfaiss 等第三方依赖。

**Java/Python 分工**：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Python embedding 服务 (port 8765)              │
│                                                                 │
│  已有:                                                          │
│  POST /v1/embeddings              ← embedding 生成               │
│                                                                 │
│  新增:                                                          │
│  POST /v1/search/concepts         ← FAISS 向量搜索概念           │
│    body: { query: "华东区客户", topK: 5, groupId?: 1 }          │
│    return: [{ conceptId, conceptName, score, ... }]             │
│                                                                 │
│  POST /v1/index/concepts/rebuild  ← 重建 FAISS 索引              │
│    body: { concepts: [{ id, name, desc, embedding }] }          │
│                                                                 │
│  内部: FAISS IndexFlatIP + sentence-transformers                │
│        零 LLM 依赖，纯向量计算                                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Java (Spring Boot)                            │
│                                                                 │
│  ConceptEmbeddingService（Java 侧）                              │
│  ├── saveEmbedding(conceptId, float[])                          │
│  │   → 序列化 float[] → byte[] → 写入 MySQL concept.embedding    │
│  ├── loadAllEmbeddings()                                        │
│  │   → 从 MySQL 加载所有 concept 的 embedding                     │
│  └── getEmbedding(conceptId)                                    │
│                                                                 │
│  EmbeddingPythonClient（调用 Python 服务）                       │
│  ├── searchConcepts(query, topK, groupId)                       │
│  │   → HTTP POST /v1/search/concepts                           │
│  └── rebuildIndex(allConcepts)                                  │
│      → HTTP POST /v1/index/concepts/rebuild                    │
│                                                                 │
│  Java 不碰 FAISS，不引入 jvector/jfaiss 依赖                     │
│  所有 LLM 调用（消歧、发现、补全）在 Java LangGraph 中完成         │
│  一份 LLM 配置，不重复配置                                       │
└─────────────────────────────────────────────────────────────────┘
```

**DDL**（concept 表扩展，Java 侧管理）：

```sql
-- concept 表新增 embedding 列
ALTER TABLE concept ADD COLUMN embedding BLOB NULL
    COMMENT '1536维 float32 向量，LLM embedding API 生成，用于语义相似概念检索';

-- 可选：为快速判断是否已生成 embedding 加标记
ALTER TABLE concept ADD COLUMN embedding_version VARCHAR(32) NULL
    COMMENT '生成 embedding 使用的模型版本，用于判断是否需要重新生成';
```

**Python 侧新增代码**（embedding 服务）：

```python
# faiss_index.py — FAISS 向量索引管理
import faiss
import numpy as np
from typing import List, Dict

class ConceptVectorIndex:
    def __init__(self, dim: int = 1536):
        self.dim = dim
        self.index = faiss.IndexFlatIP(dim)  # 内积相似度（cosine 等价）
        self.id_map: Dict[int, int] = {}     # faiss_id → concept_id

    def rebuild(self, concepts: List[dict]):
        """重建索引，从 {id, embedding} 列表构建"""
        self.index.reset()
        self.id_map.clear()
        embeddings = []
        for i, c in enumerate(concepts):
            emb = np.array(c['embedding'], dtype=np.float32)
            faiss.normalize_L2(emb.reshape(1, -1))
            embeddings.append(emb)
            self.id_map[i] = c['id']
        self.index.add(np.array(embeddings))

    def search(self, query_embedding: List[float], top_k: int = 5) -> List[dict]:
        """向量检索，返回 TopK 概念"""
        q = np.array(query_embedding, dtype=np.float32).reshape(1, -1)
        faiss.normalize_L2(q)
        scores, indices = self.index.search(q, top_k)
        return [
            {'concept_id': self.id_map[int(idx)], 'score': float(score)}
            for score, idx in zip(scores[0], indices[0])
            if idx >= 0
        ]

# app.py — 新增两个端点
@app.route('/v1/search/concepts', methods=['POST'])
def search_concepts():
    """FAISS 向量搜索概念"""
    data = request.json
    query_embedding = model.encode(data['query']).tolist()
    results = index.search(query_embedding, data.get('topK', 5))
    return jsonify({'results': results})

@app.route('/v1/index/concepts/rebuild', methods=['POST'])
def rebuild_index():
    """重建 FAISS 索引"""
    concepts = request.json['concepts']
    index.rebuild(concepts)
    return jsonify({'status': 'ok', 'count': len(concepts)})
```

**数据流**（Java → Python 协作）：

```
概念创建/修改（Java Controller）
    │
    ▼
ConceptEmbeddingService.generateEmbedding(name, description)
    │
    ├─→ Python POST /v1/embeddings        ← 生成 embedding（已有端点）
    │
    ▼
ConceptEmbeddingService.saveEmbedding()
    │
    ├─→ MySQL concept.embedding BLOB      ← 持久化到 MySQL
    │
    └─→ Python POST /v1/index/concepts/rebuild  ← 通知 Python 重建索引
```

**查询流程**（完整链路）：

```
用户问数: "华东区上月客户数"
    │
    ▼ Java AgentService
    │
    ├─→ Python POST /v1/embeddings        ← 生成 query embedding
    │   body: { input: "客户 数量" }
    │   return: { embedding: [0.12, -0.34, ...] }
    │
    ├─→ Python POST /v1/search/concepts   ← FAISS TopK 候选概念
    │   body: { query: "客户 数量", topK: 5 }
    │   return: { results: [
    │     {conceptId: 42, name: "客户", score: 0.94},
    │     {conceptId: 88, name: "消费者", score: 0.85},
    │     ...
    │   ]}
    │
    ├─→ Java LLM 消歧                     ← 复用现有 LangGraph LLM 配置
    │   prompt: "从候选概念中选择最匹配的"
    │   return: conceptId=42
    │
    ├─→ Java Jena 推理                    ← 已有 OntologyService
    │
    ├─→ Java concept_mapping 查表
    │
    └─→ Java SQL 生成 + 执行
```

**启动时索引构建**（Java 侧触发 Python）：

```java
@Component
public class ConceptIndexInitializer implements ApplicationRunner {
    @Autowired
    private ConceptEmbeddingService embeddingService;
    @Autowired
    private EmbeddingPythonClient pythonClient;

    @Override
    public void run(ApplicationArguments args) {
        log.info("开始构建概念向量索引...");
        List<ConceptEmbeddingDTO> allConcepts = embeddingService.loadAllEmbeddings();
        // 通知 Python 从 MySQL 加载并重建 FAISS 索引
        pythonClient.rebuildIndex(allConcepts);
        log.info("Python FAISS 索引构建完成，共 {} 个概念", allConcepts.size());
    }
}
```

**embedding 重新生成策略**：

```
触发条件:
  1. 概念名称或描述变更 → 立即重新生成该条 → 通知 Python 重建索引
  2. embedding_version 与当前模型版本不一致 → 标记为待重新生成
  3. 每周定时任务: 扫描 embedding_version != 当前版本 的概念 → 批量重新生成

重新生成流程:
  1. Java 读取待生成的概念列表
  2. 批量调用 Python /v1/embeddings（单次最多 100 条）
  3. 批量写入 MySQL
  4. 通知 Python 重建 FAISS 索引（千级 < 1 秒）
```

**REST API**（Java 侧）：

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/v1/concepts/:id/embedding/regenerate` | 重新生成单个概念的 embedding | connect:concepts |
| POST | `/api/v1/concepts/embeddings/rebuild` | 通知 Python 重建 FAISS 索引 | connect:concepts |
| GET | `/api/v1/concepts/semantic-search?q=xxx&k=10` | 语义搜索概念（调用 Python FAISS） | connect:concepts |

#### 6.2.5 本体治理体系（解决"治理"问题）

**问题**：本体变更可能破坏已有问数逻辑，多团队协作需要审批和版本管理。

**方案**：

```
本体治理体系

1. 版本管理
   ├── 本体快照：每次变更生成快照版本（v1.0 → v1.1 → v2.0）
   ├── 差异对比：两个版本之间的概念/关系变更 diff
   ├── 回滚：一键回退到历史版本
   └── 影响分析：变更前预览"哪些问数逻辑会受影响"

2. 变更审批
   ├── 草稿模式：编辑在草稿中进行，不影响线上本体
   ├── 提交审批：草稿提交 → 域管理员审批 → 发布
   ├── 审批流复用：复用现有工作流引擎（ProcessEngine）
   └── 变更日志：谁、什么时间、改了哪个概念、什么内容

3. 冲突检测
   ├── 同名检测：同一 Group 内不能有同名概念（code 唯一）
   ├── 循环依赖检测：关系不能形成环
   ├── 映射完整性检测：关键概念必须有数据源映射（依赖 6.2.2 的 concept_mapping）
   └── 跨域引用检测：被其他域引用的概念不能直接删除，需提示影响范围
```

#### 6.2.6 工具深度绑定（解决"执行"问题）

**问题**：本体定义了概念，但问数需要执行 SQL、调用 API、查询 MCP 服务。当前概念和工具是分离的。

**方案**：概念节点直接绑定工具，形成"概念→映射→工具→执行"全链路。

```
概念→工具绑定模型

┌──────────────────────────────────────────────┐
│ 概念: 销售订单                                 │
│                                              │
│ 映射: ERP数据库.orders (amount, status, ...)  │
│                                              │
│ 绑定工具:                                     │
│  ├── 查询: SQL工具 "query_orders"             │
│  │    SELECT * FROM orders WHERE ...          │
│  ├── 统计: SQL工具 "sum_orders"               │
│  │    SELECT SUM(amount) FROM orders ...      │
│  ├── 导出: API工具 "export_orders"            │
│  │    POST /api/erp/orders/export             │
│  └── 通知: HTTP工具 "notify_sales"            │
│       POST /api/notification/send             │
└──────────────────────────────────────────────┘
```

**数据模型**：

```sql
CREATE TABLE concept_tool_binding (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    concept_id  BIGINT NOT NULL COMMENT '概念ID',
    tool_id     BIGINT NOT NULL COMMENT '工具ID（关联 tool_definition 表）',
    binding_type VARCHAR(32) NOT NULL COMMENT '绑定类型: QUERY/STAT/ACTION/EXPORT',
    is_default  BOOLEAN DEFAULT FALSE COMMENT '是否为默认工具',
    config      JSON   NULL     COMMENT '绑定配置（参数映射等）',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uk_concept_tool_type (concept_id, tool_id, binding_type),
    INDEX idx_tool (tool_id)
);
```

### 6.2.14 问数权限体系（角色 × 概念域授权）

> **背景**：问数 Agent 需要读取数据源表结构、调用 API 工具并动态生成 SQL。问数是部门级批量使用场景（如 HR 部门 5 人查人力系统），不能像开发者那样每人申请一次数据源。需要一套与 API KEY 授权完全隔离、面向角色的一站式授权体系。

#### 核心设计：三层配置，两个角色

```
┌─────────────────────────────────────────────────────────────────┐
│                    谁配置什么，在哪配置，配置频率                    │
│                                                                 │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐  │
│  │ 配置项         │ 谁来配置      │ 在哪里配置    │ 频率          │  │
│  ├──────────────┼──────────────┼──────────────┼──────────────┤  │
│  │ ① PLATFORM   │ 系统管理员    │ 系统管理      │ 一次性         │  │
│  │    数据源     │              │ → 数据源管理   │               │  │
│  │   (ERP/HR)   │              │              │               │  │
│  ├──────────────┼──────────────┼──────────────┼──────────────┤  │
│  │ ② 概念→      │ 数据架构师    │ 系统管理      │ 一次性         │  │
│  │   数据库映射  │              │ → 概念本体     │ （概念稳定后   │  │
│  │   (mapping)  │              │ → 编辑器      │   很少改）     │  │
│  ├──────────────┼──────────────┼──────────────┼──────────────┤  │
│  │ ③ 概念→      │ 数据架构师    │ 系统管理      │ 按需           │  │
│  │   工具绑定   │              │ → 概念本体     │               │  │
│  │   (binding)  │              │ → 编辑器      │               │  │
│  ├──────────────┼──────────────┼──────────────┼──────────────┤  │
│  │ ④ 角色→      │ 系统管理员    │ 系统管理      │ 一次性         │  │
│  │   概念域权限  │              │ → 角色管理     │ （部门稳定后   │  │
│  │              │              │ → 概念权限面板  │   很少改）     │  │
│  └──────────────┴──────────────┴──────────────┴──────────────┘  │
│                                                                 │
│  ①②③ 是"建好基础设施"                                            │
│  ④ 是"谁能用"——管理员在角色里勾选域，角色下所有用户即可问数          │
└─────────────────────────────────────────────────────────────────┘
```

#### 为什么授权粒度是"概念域"而不是"数据源"或"工具"

```
概念是一个"业务能力包"，它自己知道要查什么数据、调什么工具：

  ┌─────────────────────────────────────────────────────┐
  │  概念: 员工（运营域）                                  │
  │                                                     │
  │  concept_mapping:                                   │
  │    员工.姓名 → HR_DB.employees.name                  │
  │    员工.部门 → HR_DB.employees.dept_id               │
  │    员工.入职日期 → HR_DB.employees.hire_date          │
  │                                                     │
  │  concept_tool_binding:                              │
  │    员工 → query_hr_employee (SQL 工具)                │
  │    员工 → get_employee_detail (API 工具)              │
  │                                                     │
  │  授权"员工"概念 = 自动获得以上所有数据源和工具的查询权限  │
  └─────────────────────────────────────────────────────┘

  授权一个域（如"运营域"）：
  → 该域下所有概念（员工、部门、薪资、考勤...）自动获得授权
  → 每个概念展开后自动获得对应的数据源和工具权限
  → 管理员只需勾选一个域，无需逐个概念配置
```

#### 三种权限体系对比

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│              │ API KEY 授权   │ REF 授权      │ 概念域授权      │
│              │ （体系A）      │ （体系B）      │ （体系C，新增） │
├──────────────┼──────────────┼──────────────┼──────────────┤
│ 授权对象      │ API KEY      │ 用户          │ 角色           │
│ 粒度          │ 逐个工具      │ 整个数据源     │ 角色 → 域 → 概念│
│ 谁操作        │ 用户申请      │ 用户申请       │ 管理员分配     │
│              │ →管理员审批   │ →管理员审批    │ 一次性配置     │
│ 适用场景      │ 外部程序调用   │ 开发者在开发中  │ 问数（部门级）  │
│              │              │ 使用数据源     │ 批量使用       │
│ 能查什么      │ 已授权的工具   │ 整个数据库     │ 域下的概念     │
│ 概念无关      │ 是            │ 是            │ 否（核心）     │
│ 能读表结构    │ 不能          │ 能            │ 能（通过概念映射）│
│ 能执行SQL     │ 不能          │ 能            │ 能（Agent生成） │
│ 能调API       │ 能（已授权工具）│ 不能          │ 能（通过工具绑定）│
└──────────────┴──────────────┴──────────────┴──────────────┘
```

> **关键约束**：概念域权限**仅问数 Agent 使用**。API KEY 调用、工作流、开发者工具调用不受此权限影响。概念域权限是问数 Agent 的专属授权通道，三种体系互不干扰。

#### 问数 Agent 完整校验链路

```
用户 A 问: "本月入职人数"
    │
    ▼
FAISS → LLM 消歧 → Jena 展开 → 确定概念: 员工
    │
    ▼
★ 权限校验 ★
  1. 查用户角色: SELECT * FROM user_role WHERE user_id = A
     → 角色: HR-问数
  2. 查角色概念域权限:
     SELECT * FROM role_concept_permission
     WHERE role_id = HR-问数 AND group_id = 运营域
     → 有 ✅
     （权限是以域为粒度，"员工"属于"运营域" → 自动通过）
    │
    ▼
概念自动展开:
  员工 → concept_mapping → HR_DB.employees
  员工 → concept_tool_binding → query_hr_employee
    │
    ▼
Agent 读取 HR_DB 表结构 → 读取 query_hr_employee 工具定义
    │
    ▼
Agent 动态生成 SQL → 执行 → 返回结果
    SELECT * FROM employees WHERE hire_date >= '2026-07-01'
```

#### 某概念无权限时的处理

```
用户 B 问: "本月营收"
    │
    ▼
Agent 识别概念: 营收（财务域）
    │
    ▼
★ 权限校验 ★
  用户 B 角色: HR-问数
  role_concept_permission:
    HR-问数 → 运营域 ✅
    HR-问数 → 财务域 ❌（未授权）
    │
    ▼
Agent 回复:
  "您的问题涉及「营收」概念，属于「财务域」。
   您当前没有该域的查询权限，请联系管理员开通。"

  → 不暴露表结构、不执行 SQL、不泄露任何配置信息
```

#### 数据模型

```sql
-- 角色概念权限（按域授权，一次勾选一个域下所有概念）
CREATE TABLE role_concept_permission (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    role_id BIGINT NOT NULL COMMENT '角色ID（关联现有角色表）',
    group_id BIGINT NOT NULL COMMENT '本体域ID（ontology_group.id），授权整个域的概念',
    granted_by BIGINT COMMENT '授权人ID',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_role_group (role_id, group_id),
    INDEX idx_role (role_id),
    INDEX idx_group (group_id)
) COMMENT '角色概念查询权限（按域授权，仅问数Agent使用）';
```

#### 角色管理页面（新增"概念权限"面板）

```
系统管理 → 角色管理 → 编辑角色 → [概念权限]
┌─────────────────────────────────────────────────────────┐
│ 角色: HR-问数                                            │
│                                                         │
│ [基本信息] [功能权限] [用户分配] [概念权限] ← 新增          │
│                                                         │
│ ┌── 概念查询权限 ────────────────────────────────────┐    │
│ │                                                    │    │
│ │ 此角色可查询以下本体域的概念：                         │    │
│ │                                                    │    │
│ │ ☑ 运营域 (15 个概念)                      [移除]     │    │
│ │    员工、部门、薪资、考勤、绩效、招聘...               │    │
│ │                                                    │    │
│ │ ☐ 营销域 (12 个概念)                                │    │
│ │    客户、订单、活动、渠道、转化...                     │    │
│ │                                                    │    │
│ │ ☐ 财务域 (8 个概念)                                 │    │
│ │    营收、成本、利润、预算...                          │    │
│ │                                                    │    │
│ │ [+ 添加本体域]  ← 下拉选择已创建的 ontology_group     │    │
│ │                                                    │    │
│ │ 已授权 1 个域，共 15 个概念           [保存]          │    │
│ └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

#### 概念编辑器中的映射与绑定配置入口

```
系统管理 → 概念本体 → 点击概念 → 右侧详情面板
┌─────────────────────────────────────────────────────────────────┐
│ 左: 域列表        中: 概念画布          右: 详情面板               │
│                  ┌──────────┐                                 │
│  运营域           │  员工     │    ┌── 概念详情 ──────────────┐  │
│  ├ 员工           │          │    │ 名称: 员工                │  │
│  ├ 部门           └──────────┘    │ 编码: EMPLOYEE            │  │
│  ├ 薪资                           │                          │  │
│  ...                              │ [基本信息] [属性] [映射] [工具] │
│                                   │           ──────────────  │  │
│                                   │  ┌── 数据映射 ──────────┐ │  │
│                                   │  │ 属性     → 表.字段    │ │  │
│                                   │  │ 姓名     → HR.emp.name│ │  │
│                                   │  │ 部门     → HR.emp.dept│ │  │
│                                   │  │ 入职日期 → HR.emp.hire│ │  │
│                                   │  │                      │ │  │
│                                   │  │ 数据源: HR_DB         │ │  │
│                                   │  │ 表:     employees    │ │  │
│                                   │  │                      │ │  │
│                                   │  │ [+ 添加映射属性]      │ │  │
│                                   │  └──────────────────────┘ │  │
│                                   │                          │  │
│                                   │ ┌── 工具绑定 ──────────┐ │  │
│                                   │ │ query_hr_employee [移除]│  │
│                                   │ │ get_employee_detail[...]│  │
│                                   │ │                      │ │  │
│                                   │ │ [+ 绑定工具]          │ │  │
│                                   │ └──────────────────────┘ │  │
│                                   └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

> **注意**：映射和绑定都由数据架构师在概念编辑器中配置，普通用户不可见。映射和绑定是基础设施配置，不是权限控制。用户只需在角色中被授予"可查询某域"的权限，该域下所有概念的映射和绑定自动生效。

#### 问数 Agent 权限校验代码

```java
// OntologyQueryAuthService.java
public boolean checkQueryPermission(Long userId, Long conceptId) {
    // 1. 查概念所属的域
    Concept concept = conceptRepository.findById(conceptId)
        .orElseThrow(() -> new IllegalArgumentException("概念不存在"));
    Long groupId = concept.getGroupId();

    // 2. 查用户角色
    List<Long> roleIds = userRoleRepository.findByUserId(userId)
        .stream().map(UserRole::getRoleId).toList();

    // 3. 查角色是否有该域的权限
    return roleConceptPermissionRepository
        .existsByRoleIdInAndGroupId(roleIds, groupId);
}

public List<Long> getAuthorizedConceptIds(Long userId, List<Long> conceptIds) {
    // 批量校验，返回有权限的概念ID列表
    // 问数时，仅对无权限的概念提示用户，有权限的继续执行
    Map<Long, Long> conceptToGroup = conceptRepository
        .findGroupIdsByIds(conceptIds);

    List<Long> roleIds = userRoleRepository.findByUserId(userId)
        .stream().map(UserRole::getRoleId).toList();

    Set<Long> authorizedGroups = roleConceptPermissionRepository
        .findByRoleIdIn(roleIds)
        .stream().map(RoleConceptPermission::getGroupId)
        .collect(Collectors.toSet());

    return conceptIds.stream()
        .filter(cid -> authorizedGroups.contains(conceptToGroup.get(cid)))
        .toList();
}
```

#### 与现有数据源 Slug 的关系

```
Datasource.slug 三种类型（现有，不变）:

  ┌──────────────┬──────────────────┬──────────────────────────┐
  │ Slug         │ 含义              │ 与问数的关系              │
  ├──────────────┼──────────────────┼──────────────────────────┤
  │ APPLICATION  │ 应用私有数据源     │ 问数不涉及                │
  ├──────────────┼──────────────────┼──────────────────────────┤
  │ PLATFORM     │ 组织共享数据源     │ 架构师在概念映射中引用     │
  │              │ 管理员配置        │ 作为映射的数据源目标        │
  ├──────────────┼──────────────────┼──────────────────────────┤
  │ REF          │ 用户引用数据源     │ 问数不涉及                │
  │              │ 开发者申请使用     │ 开发者开发时使用           │
  └──────────────┴──────────────────┴──────────────────────────┘

  问数数据源访问链路:
  用户角色 → 概念域权限 → 概念 → concept_mapping → PLATFORM 数据源配置
  （不经过 REF，直接通过概念映射找到 PLATFORM 数据源）
```

### 6.3 实施优先级

> **前置依赖**：六大能力实施前，必须先完成以下两项基础能力：
> 1. 第四章的"本体多域分层架构"（Group 基础能力），因为 concept 表的 group_id 需要关联 ontology_group 表，映射、模板、推理等都依赖 Group 的存在。
> 2. 后端 Agent 基础设施（6.2.11 节），因为自动发现、智能补全、语义路由都依赖 LLM 调用，Agent 是这些 AI 能力的统一调度层。

七大能力的实施顺序：

```
前置: 第四章 Phase 1 — Group 基础能力（数据库表 + CRUD API）
前置: 后端 Agent 基础设施 — OntologyAgentService + LLM 调用层（6.2.11）
    ↓
Phase 1: 概念→数据映射        ← 让本体"可查询"（最核心）
Phase 2: 本体自动发现          ← 让用户"零门槛起步"（数据源→概念，依赖 Agent）
Phase 3: 行业模板             ← 让用户"有内容"（降低门槛，导入依赖 Agent）
Phase 4: 语义路由引擎          ← 让问数"自动化"（体验质变，依赖 Agent）
Phase 5: 大规模性能优化        ← 让工业场景"跑得动"
Phase 6: 工具深度绑定          ← 让本体"能执行"
Phase 7: 本体治理体系          ← 让多团队"协作了"
```

**为什么不先做模板？** 因为模板是静态内容，映射层是动态能力。没有映射，导入模板后问数还是问不了，用户看不到价值。先做映射 + 自动发现，哪怕只有 10 个概念，问数就能跑通，价值立即可见。

### 6.4 行业落地最短路径（MVP）

**目标**：一个电信企业客户，2 周内用鲁班跑通第一个问数场景。

```
Week 1：平台能力（第四章 Phase 1 + Agent + 第六章 Phase 1/2/6）
  Day 1-2: Group 基础能力（ontology_group 表 + CRUD API，第四章 Phase 1）
  Day 3:   后端 Agent 基础设施（OntologyAgentService + LLM 调用层，6.2.11）
  Day 4:   概念→数据映射（concept_mapping 表 + 映射编辑器，第六章 Phase 1）
  Day 5:   本体自动发现 + 工具绑定（数据源→概念 反向推导 + concept_tool_binding 表，第六章 Phase 2/6）

Week 2：电信场景
  Day 1-2: 导入电信行业模板（客户域 + 产品域，约 50 个概念）
  Day 3:   配置映射（概念→客户 CRM 数据库、产品 ERP 数据库）
  Day 4:   配置工具绑定（SQL 查询工具）
  Day 5:   端到端验证：问"华东区上月客户数及产品分布"
```

**MVP 验证标准**：
- 用户导入电信模板后，能看到 50+ 概念和关系
- 配置 2 个数据源映射后，问数能正确生成 SQL 并返回结果
- 跨域概念（客户域→产品域）能正确关联查询

---

#### 6.2.7 行业模板来源（从哪里获取本体内容）

> 行业模板不是凭空造出来的，每个行业都有公开的标准本体可供参考。
> 本节列出每个行业可获取的**真实、公开、免费**的本体资源。

##### 6.2.7.1 电信行业

| 资源 | 类型 | 获取方式 | 内容量 |
|------|------|---------|--------|
| **TM Forum SID** | 信息框架 | [tmforum.org](https://www.tmforum.org/) 注册下载，部分公开 | 8 Domain, 数百 ABE |
| **TM Forum Open API** | REST API 规范 | [tmforum.org/apis](https://www.tmforum.org/apis/) 完全公开 | 20+ API 规范，含资源模型 |
| **3GPP TS 28.XXX** | 网络资源模型 | [3gpp.org](https://www.3gpp.org/) 完全公开 | NRM（Network Resource Model） |

**提取方法**：
1. TM Forum Open API 的每个 API 规范都有 `resourceModel` 章节，定义了实体的属性和关系。例如 `Customer Management API` 定义了 `Customer`、`CustomerAccount`、`ContactMedium` 等资源及其关联。
2. 从中提取：实体名 → 概念名，属性 → 概念属性，`@ref` 引用 → 概念关系。
3. 建议从 **Customer Management、Product Catalog、Service Ordering** 三个 API 开始提取，约 30 个概念。

**已有可复用内容**：
- TM Forum Open API 公开的 Swagger/OAS 规范可直接解析
- 每个 API 的 `resource` 定义 → 概念节点
- `@schemaLocation` 引用 → 概念关系

##### 6.2.7.2 工业制造

| 资源 | 类型 | 获取方式 | 内容量 |
|------|------|---------|--------|
| **IOF Core Ontology** | OWL 本体 | [industrialontologies.org](https://www.industrialontologies.org/) 完全公开 | 中层制造本体，100+ 类 |
| **ISA-95 (IEC 62264)** | 国际标准 | 标准文档公开，部分实现开源 | 设备、人员、物料、工艺段 4 大模型 |
| **OPC UA Information Models** | 信息模型 | [opcfoundation.org](https://opcfoundation.org/) 公开规范 | 设备、报警、历史数据等 Companion Specs |
| **BFO (Basic Formal Ontology)** | 上层本体 | [basic-formal-ontology.org](https://basic-formal-ontology.org/) 完全公开 | ISO/IEC 21838，350+ 项目采用 |

**提取方法**：
1. IOF Core 的 OWL 文件可直接用 Jena 解析，提取 `owl:Class` → 概念，`rdfs:subClassOf` → 父子关系，`owl:ObjectProperty` → 关系类型。
2. ISA-95 的 4 大模型（Equipment、Personnel、Material、Process Segment）有公开的 UML 图，可手动转化为概念树。
3. BFO 作为上层本体，提供最抽象的概念分类，适合作为"基础域"的骨架。

**已有可复用内容**：
- IOF 的 OWL 文件公开在 GitHub：[github.com/iofoundry](https://github.com/iofoundry/)
- BFO 2.0 OWL 文件可直接下载导入
- OPC UA 的 NodeSet2 XML 可解析为概念树

##### 6.2.7.3 金融行业

| 资源 | 类型 | 获取方式 | 内容量 |
|------|------|---------|--------|
| **FIBO** | OWL 本体 | [spec.edmcouncil.org/fibo](https://spec.edmcouncil.org/fibo/) 完全公开 | 1500 类，2500 属性 |
| **ISO 20022** | 报文标准 | [iso20022.org](https://www.iso20022.org/) 完全公开 | 金融业务模型字典 |
| **BIAN** | 服务架构 | [bian.org](https://bian.org/) 公开规范 | 银行业务能力模型 |

**提取方法**：
1. FIBO 是最完整的金融本体，OWL 文件可直接下载。建议从 `FND`（Foundation）和 `BE`（Business Entities）模块开始提取。
2. 每个 OWL 文件 ≈ 一个 Group，`owl:import` 依赖 → 跨 Group 引用。
3. 优先提取：`Loans`（贷款）、`Securities`（证券）、`BusinessEntities`（业务实体）、`Foundations`（基础）四个模块。

**已有可复用内容**：
- FIBO 的 OWL 文件完全公开在：[spec.edmcouncil.org](https://spec.edmcouncil.org/fibo/ontology/)
- 每个 `.rdf` 文件可直接用 Jena 加载和解析
- 已有完整的 `rdfs:label` 中文翻译（部分，社区贡献）

##### 6.2.7.4 通用模板（自建）

通用模板不依赖外部标准，由鲁班平台根据常见业务场景自行构建：

| 域 | 概念来源 | 数量 |
|----|---------|------|
| 基础域 | 企业信息系统通用实体（用户、组织、产品、订单、标签） | ~20 |
| 运营域 | 增长黑客模型（AARRR：获客、激活、留存、收入、传播） | ~15 |
| 营销域 | CRM 标准模型（客户、线索、机会、合同、活动） | ~15 |
| 财务域 | 基础会计科目（收入、成本、费用、资产、负债） | ~15 |

##### 6.2.7.5 模板导入工具

无论来自哪个行业标准，模板导入工具统一处理：

```
┌─────────────────────────────────────────────────────┐
│ 模板导入流程                                          │
│                                                     │
│ 输入: OWL 文件 / JSON 模板 / Swagger 规范 / UML 图     │
│    ↓                                                │
│ 1. 格式检测: 自动识别输入格式                          │
│    ↓                                                │
│ 2. 解析: 提取概念、属性、关系、层级                     │
│    ↓                                                │
│ 3. 去重: 与已有概念比较，标记冲突和新增                 │
│    ↓                                                │
│ 4. 预览: 用户确认导入哪些概念、分配到哪个 Group          │
│    ↓                                                │
│ 5. 导入: 批量创建概念+关系，保留溯源信息（来源标准+版本）  │
└─────────────────────────────────────────────────────┘
```

**关键设计**：
- 导入后概念标记 `source` 字段（如 `FIBO-2024Q1`），便于后续标准更新时增量同步
- 冲突处理：如果导入的概念名与已有概念冲突，提供"跳过/覆盖/重命名"三个选项
- 增量更新：标准发布新版本后，可对比差异，只导入新增/变更的概念

---

#### 6.2.8 补充能力：本体自动发现（从数据源反向生成概念）

> 原六大能力中缺少一个关键能力：**如果用户没有行业模板，也不想从零画概念，能不能自动从已有数据源反向生成本体？**

**场景**：一个电信企业接入 CRM 数据库后，系统自动分析数据库 Schema，生成初步的本体概念。

```
数据源 Schema → 概念本体

┌─────────────────────────────────────────────────────┐
│ 数据库: telecom_crm                                  │
│                                                     │
│ 表: customers                                       │
│   ├── id (PK)          → 概念: 客户                   │
│   ├── name             → 属性: 客户名称               │
│   ├── id_type          → 属性: 证件类型               │
│   ├── id_number        → 属性: 证件号码               │
│   ├── tier             → 属性: 客户等级               │
│   └── region           → 属性: 所属区域               │
│                                                     │
│ 表: accounts                                        │
│   ├── id (PK)          → 概念: 账户                   │
│   ├── customer_id (FK) → 关系: 客户 HAS 账户          │
│   ├── account_type     → 属性: 账户类型               │
│   └── balance          → 属性: 余额                   │
│                                                     │
│ 表: orders                                          │
│   ├── id (PK)          → 概念: 订单                   │
│   ├── customer_id (FK) → 关系: 客户 PLACES 订单       │
│   ├── account_id (FK)  → 关系: 账户 BILLED_TO 订单    │
│   ├── amount           → 属性: 订单金额               │
│   └── status           → 属性: 订单状态               │
│                                                     │
│ 自动生成结果:                                        │
│   概念: 客户、账户、订单                               │
│   关系: 客户 HAS 账户, 客户 PLACES 订单,              │
│         账户 BILLED_TO 订单                           │
│   属性: 各字段自动映射为概念属性                        │
└─────────────────────────────────────────────────────┘
```

**与"概念→数据映射"（6.2.2）的区别**：

| 能力 | 方向 | 输入 | 输出 |
|------|------|------|------|
| 概念→数据映射（6.2.2） | 概念 → 数据 | 已有概念 | 映射配置 |
| 本体自动发现（6.2.8） | 数据 → 概念 | 数据源 Schema | 新概念 |

两者互补：自动发现用于快速起步（Day 1），映射用于精确调优（Day 2+）。

**实施要点**：
- 外键自动解析为概念关系（FK → 关系类型推荐：customer_id → "HAS"、"BELONGS_TO"）
- 表名用 LLM 翻译为中文概念名（customers → 客户，`t_log_2024` → 跳过）
- 发现结果默认放入"自动发现"Group，用户确认后移动到正式域

---

#### 6.2.9 模板导入引导（Onboarding 流程）

> 用户打开鲁班后，需要一条清晰的路径来初始化行业模板，
> 而不是面对一个空画布不知所措。

##### 6.2.9.1 三种入口路径

```
用户首次进入概念本体 → 触发引导

路径 A：完全空白用户（新用户）
  ┌─────────────────────────────────────────────────────┐
  │ 🏗️ 欢迎使用概念本体                                   │
  │                                                     │
  │ 概念本体是鲁班的"企业知识库"，帮你定义业务概念          │
  │ 以及它们之间的关系，让 AI 准确理解你的业务问题。         │
  │                                                     │
  │ 快速开始：                                           │
  │                                                     │
  │ ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
  │ │ 📡 导入行业  │  │ 🔍 从数据源   │  │ ✏️ 从零    │  │
  │ │   标准模板   │  │   自动发现   │  │   创建     │  │
  │ │             │  │             │  │           │  │
  │ │ 电信/工业/   │  │ 连接数据库   │  │ 手动定义   │  │
  │ │ 金融/通用    │  │ 自动生成概念  │  │ 概念和关系  │  │
  │ └─────────────┘  └──────────────┘  └────────────┘  │
  │                                                     │
  │ [了解更多]                                           │
  └─────────────────────────────────────────────────────┘

路径 B：已有数据源，但无概念
  侧边栏顶部提示卡片：
  ┌──────────────────────────────────┐
  │ 💡 检测到 3 个已连接数据源         │
  │ 是否自动发现概念？                 │
  │                                  │
  │ [自动发现] [导入模板] [稍后]       │
  └──────────────────────────────────┘

路径 C：已有 Group 但概念少
  侧边栏底部"快速添加"区域：
  ┌──────────────────────────────────┐
  │ + 添加概念                        │
  │ 📡 导入行业模板 →                  │
  │ 🔍 从数据源发现 →                  │
  └──────────────────────────────────┘
```

##### 6.2.9.2 模板导入完整流程

```
用户点击"导入行业模板" → 进入模板选择向导

Step 1: 选择行业
┌─────────────────────────────────────────────────────┐
│ 导入行业模板                                          │
│                                                     │
│ 选择你的行业，我们将预置该行业的标准概念体系。            │
│                                                     │
│ ┌──────────────┐  ┌──────────────┐                  │
│ │ 📡 电信行业   │  │ 🏭 工业制造   │                  │
│ │              │  │              │                  │
│ │ 对标 TM Forum │  │ 对标 IOF +   │                  │
│ │ SID 标准     │  │ ISA-95 标准   │                  │
│ │              │  │              │                  │
│ │ 6 个域       │  │ 5 个域       │                  │
│ │ ~80 个概念   │  │ ~70 个概念   │                  │
│ │ [选择]       │  │ [选择]       │                  │
│ └──────────────┘  └──────────────┘                  │
│                                                     │
│ ┌──────────────┐  ┌──────────────┐                  │
│ │ 💰 金融行业   │  │ 📦 通用模板   │                  │
│ │              │  │              │                  │
│ │ 对标 FIBO    │  │ 适用于中小   │                  │
│ │ 标准         │  │ 企业通用场景  │                  │
│ │              │  │              │                  │
│ │ 5 个域       │  │ 4 个域       │                  │
│ │ ~90 个概念   │  │ ~65 个概念   │                  │
│ │ [选择]       │  │ [选择]       │                  │
│ └──────────────┘  └──────────────┘                  │
│                                                     │
│ 每个模板包含：概念定义 + 关系 + 属性 + 行业说明             │
│ [取消]                                         [下一步] │
└─────────────────────────────────────────────────────┘

Step 2: 选择域（可选，默认全选）
┌─────────────────────────────────────────────────────┐
│ 导入电信行业模板 — 选择域                              │
│                                                     │
│ ☑ 全选（6 个域，共 82 个概念）                        │
│ ─────────────────────────────────────                │
│ ☑ 基础域（Party, Location, TimePeriod...）12 个概念    │
│    通用横切概念，被其他域引用                           │
│ ☑ 客户域（Customer, Account, Interaction...）15 个概念 │
│    客户信息、账户、交互记录                             │
│ ☑ 产品域（ProductSpec, Offering, Instance...）14 个概念│
│    产品规格、目录、已订购实例                           │
│ ☑ 服务域（ServiceSpec, Instance, Usage...）13 个概念   │
│    服务定义、实例、使用量                               │
│ ☑ 资源域（Physical, Logical, Network...）16 个概念     │
│    物理设备、逻辑资源、网络拓扑                          │
│ ☑ 营销域（MarketSegment, Competitor...）12 个概念      │
│    市场细分、竞争对手、销售渠道                          │
│                                                     │
│ 已选: 82 个概念, 6 个域                              │
│ [返回] [预览导入]                                      │
└─────────────────────────────────────────────────────┘

Step 3: 预览确认
┌─────────────────────────────────────────────────────┐
│ 预览导入 — 电信行业模板                                │
│                                                     │
│ ┌── 将导入以下内容 ──────────────────────────┐        │
│ │                                             │        │
│ │ 域 Group（6 个）                             │        │
│ │ ├── 基础域        12 概念   0 冲突           │        │
│ │ ├── 客户域        15 概念   0 冲突           │        │
│ │ ├── 产品域        14 概念   0 冲突           │        │
│ │ ├── 服务域        13 概念   0 冲突           │        │
│ │ ├── 资源域        16 概念   1 冲突 ⚠️        │        │
│ │ └── 营销域        12 概念   0 冲突           │        │
│ │                                             │        │
│ │ 关系（126 条）                               │        │
│ │ 属性（328 个）                               │        │
│ │                                             │        │
│ │ ⚠️ 资源域「设备」概念与已有概念同名，导入后     │        │
│ │    将自动重命名为「设备(电信)」                 │        │
│ └─────────────────────────────────────────────┘        │
│                                                     │
│ 导入后你可以：                                        │
│ • 增删改任意概念和关系                                 │
│ • 导入的概念标记来源，后续标准更新可增量同步              │
│ • 在"资源域"管理冲突的概念                              │
│                                                     │
│ [返回修改] [确认导入]                                   │
└─────────────────────────────────────────────────────┘

Step 4: 导入完成
┌─────────────────────────────────────────────────────┐
│ ✅ 导入成功                                           │
│                                                     │
│ 已导入：6 个域, 82 个概念, 126 条关系, 328 个属性       │
│                                                     │
│ 下一步建议：                                         │
│                                                     │
│ 1️⃣ 配置数据源映射                                     │
│    将概念绑定到真实数据表，让问数能跑通                   │
│    [去配置映射]                                       │
│                                                     │
│ 2️⃣ 浏览概念                                          │
│    在画布中查看导入的概念关系和层级                      │
│    [打开画布]                                         │
│                                                     │
│ 3️⃣ 配置工具绑定                                       │
│    为概念绑定可执行的 SQL/API 工具                      │
│    [去配置工具]                                        │
│                                                     │
│ [关闭]                                                │
└─────────────────────────────────────────────────────┘
```

##### 6.2.9.3 模板说明与行业标准标注

每个模板卡片需要展示的信息：

```
┌─────────────────────────────────────────────┐
│ 📡 电信行业模板                               │
│                                             │
│ 对标标准: TM Forum SID (Information          │
│          Framework) Release 24.0             │
│ 标准官网: tmforum.org                        │
│ 概念来源: TM Forum Open API 资源模型          │
│ 版本: v1.0（2024 Q1）                        │
│                                             │
│ 包含域: 6 个                                 │
│  ├── 基础域: 12 概念（Party, Location...）    │
│  ├── 客户域: 15 概念（Customer, Account...）  │
│  ├── 产品域: 14 概念（ProductSpec...）        │
│  ├── 服务域: 13 概念（ServiceSpec...）        │
│  ├── 资源域: 16 概念（PhysicalResource...）   │
│  └── 营销域: 12 概念（MarketSegment...）      │
│                                             │
│ 适用场景: 电信运营商、ISP、通信设备商            │
│                                             │
│ [查看完整概念清单] [导入此模板]                 │
└─────────────────────────────────────────────┘
```

##### 6.2.9.4 空状态引导卡片（画布内）

当用户进入画布但 Group 为空时，在画布中央显示引导卡片：

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│              🏗️ 此域还没有概念                         │
│                                                     │
│     概念本体帮助你定义业务知识，让 AI 准确理解你的问题。     │
│                                                     │
│     ┌──────────────────┐  ┌──────────────────┐      │
│     │ 📡 导入行业模板    │  │ ✏️ 手动创建概念    │      │
│     │ 从预置模板开始     │  │ 从零定义业务概念   │      │
│     └──────────────────┘  └──────────────────┘      │
│                                                     │
│     ┌──────────────────────────────────────┐        │
│     │ 🔍 从数据源自动发现                      │        │
│     │ 连接数据库，自动生成概念和关系              │        │
│     └──────────────────────────────────────┘        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

#### 6.2.10 UI 设计总览（页面清单与信息架构）

> 概念本体模块需要以下页面和弹窗，每个页面的信息内容和操作如下。

##### 6.2.10.1 页面全景图

```
概念本体模块 = 3 个主页面 + 4 个弹窗/侧边栏

┌─────────────────────────────────────────────────────┐
│ 页面 1: 本体域列表页（首页）                           │
│ ├── 域的卡片列表                                      │
│ ├── 新建域 / 导入模板入口                             │
│ └── 点击域 → 进入编辑器                               │
│                                                     │
│ 页面 2: 概念本体编辑器（画布页）                        │
│ ├── 左侧: 域选择器 + 概念树                           │
│ ├── 中央: 概念关系图画布                              │
│ └── 右侧: 概念详情面板                                │
│                                                     │
│ 页面 3: 映射管理页                                   │
│ ├── 概念列表视图                                     │
│ ├── 每个概念的映射状态                                │
│ └── 点击进入映射编辑器                                │
│                                                     │
│ 弹窗 A: 模板导入向导                                 │
│ 弹窗 B: 映射编辑器（全屏弹窗）                         │
│ 弹窗 C: 本体自动发现结果确认                           │
│ 弹窗 D: 概念编辑弹窗                                 │
└─────────────────────────────────────────────────────┘
```

##### 6.2.10.2 页面 1：本体域列表页（首页）

```
┌─────────────────────────────────────────────────────┐
│ 概念本体                                    [导入模板] │
│                                                     │
│ ┌── 快速操作 ──────────────────────────────────┐     │
│ │ 📡 导入行业模板    🔍 从数据源发现    ＋ 新建域  │     │
│ └──────────────────────────────────────────────┘     │
│                                                     │
│ ┌ 基础域 ────────────────────────────── 12 概念 ─┐    │
│ │ 共享基础概念，被所有业务域引用                      │    │
│ │ 概念: 用户、产品、订单、标签、组织...               │    │
│ │ 映射: 8/12 已映射    工具: 5 个已绑定              │    │
│ │                                        [进入编辑] │    │
│ └────────────────────────────────────────────────┘    │
│                                                     │
│ ┌ 运营域 ────────────────────────────── 15 概念 ─┐    │
│ │ 活动运营、渠道管理、内容投放相关概念                  │    │
│ │ 概念: 活动、渠道、内容、人群、效果...               │    │
│ │ 映射: 3/15 已映射    工具: 2 个已绑定              │    │
│ │                                        [进入编辑] │    │
│ └────────────────────────────────────────────────┘    │
│                                                     │
│ ┌ 营销域 ────────────────────────────── 18 概念 ─┐    │
│ │ 客户管理、线索转化、销售机会相关概念                  │    │
│ │ 概念: 客户、线索、机会、合同、活动...               │    │
│ │ 映射: 12/18 已映射   工具: 4 个已绑定              │    │
│ │                                        [进入编辑] │    │
│ └────────────────────────────────────────────────┘    │
│                                                     │
│ ┌ 供应链域 ─────────────────────────────── 0 概念 ─┐  │
│ │ 供应商管理、采购、库存相关概念（空域）                │    │
│ │ ⚠️ 此域还没有概念，点击进入编辑或导入模板              │    │
│ │                                        [进入编辑] │    │
│ └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

**页面信息**：
- 每个域的卡片：名称、描述、概念数量、映射覆盖率、已绑定工具数
- 空域卡片有特殊样式（虚线边框 + 引导文案）
- 顶部操作栏：导入模板、自动发现、新建域

**页面操作**：
- 点击卡片 → 进入概念本体编辑器（页面 2）
- 点击"导入模板" → 打开模板导入向导（弹窗 A）
- 点击"从数据源发现" → 打开自动发现结果确认（弹窗 C）
- 点击"新建域" → 弹出域名输入框，创建后自动进入编辑器

##### 6.2.10.3 页面 2：概念本体编辑器（画布页）

```
┌── 顶部栏 ───────────────────────────────────────────┐
│ ← 返回列表    运营域 > 概念编辑器    [显示跨域链接] [保存] │
└─────────────────────────────────────────────────────┘
│        │                                   │        │
│ 左侧栏 │         中央画布                    │ 右侧栏  │
│        │                                   │        │
│ 域树   │  ┌───────────────────────────┐    │ 概念    │
│        │  │                           │    │ 详情    │
│ ├基础域 │  │   [活动]────[渠道]         │    │        │
│ │用户   │  │     │                  │    │ 名称:  │
│ │产品   │  │     │                  │    │ 活动    │
│ │订单   │  │   [内容]    [人群]       │    │        │
│        │  │     │        │         │    │ 描述:  │
│ ├运营域 │  │     └──[效果]──┘         │    │ 运营活动│
│ │●活动  │  │                │         │    │ 定义... │
│ │ 渠道  │  │       [营销域]活动效果    │    │        │
│ │ 内容  │  │       (虚线+域标签)       │    │ 属性:  │
│ │ 人群  │  │                           │    │ ├活动ID│
│ │ 效果  │  │                           │    │ ├名称  │
│        │  │                           │    │ ├类型  │
│ ├营销域 │  │                           │    │ └状态  │
│ │客户   │  │                           │    │        │
│ │线索   │  │                           │    │ 关系:  │
│ │机会   │  │                           │    │ ├HAS→ │
│        │  │                           │    │ │渠道  │
│        │  │                           │    │ ├USES→│
│        │  │                           │    │ │内容  │
│ [+新建] │  │                           │    │ └DRIVES│
│        │  │                           │    │ →营销域│
│        │  │                           │    │ .效果  │
│        │  └───────────────────────────┘    │        │
│        │                                   │ [编辑] │
│        │  工具栏: [+] [-放大] [-缩小] [适应]  │ [删除] │
└────────┴───────────────────────────────────┴────────┘
```

**左侧栏信息**：
- 域树：所有 Group 的层级列表，当前域高亮
- 每个域显示概念数量
- 当前域的概念树（可折叠）

**左侧栏操作**：
- 点击其他域 → 切换画布显示（保留当前域编辑状态）
- 点击概念 → 画布居中到该概念
- 拖拽概念到画布 → 创建新节点
- [+新建] → 创建新概念

**中央画布信息**：
- 当前域的概念节点（圆形/矩形）
- 域内关系（实线 + 关系类型标签）
- 跨域关系（虚线 + 域标签，如 `[营销域]活动效果`）
- 节点颜色：蓝色=普通概念，绿色=已映射概念，灰色=未映射概念

**中央画布操作**：
- 拖拽节点调整位置
- 双击节点 → 打开概念编辑弹窗（弹窗 D）
- 右键节点 → 上下文菜单（编辑/删除/创建关系/查看映射）
- 拖拽连线创建关系
- 点击关系线 → 显示关系详情
- 滚轮缩放、拖拽平移
- 顶栏"显示跨域链接"开关 → 切换跨域节点的显示/隐藏

**右侧栏信息**（选中概念后显示）：
- 概念名称、描述
- 属性列表（名称 + 类型 + 是否已映射）
- 关系列表（关系类型 + 目标概念 + 目标域）
- 映射状态（已映射/未映射，显示数据源和表名）
- 绑定工具列表

**右侧栏操作**：
- [编辑] → 打开概念编辑弹窗
- [删除] → 删除概念（需确认）
- 点击属性 → 跳转到映射编辑器
- 点击关系 → 画布聚焦到目标概念
- [配置映射] → 打开映射编辑器（弹窗 B）

##### 6.2.10.4 页面 3：映射管理页

```
┌─────────────────────────────────────────────────────┐
│ 映射管理    [全部概念 ▾] [全部域 ▾] [已映射/未映射 ▾]     │
│                                                     │
│ ┌ 未映射提醒 ──────────────────────────────────┐     │
│ │ ⚠️ 有 23 个概念未映射数据源，问数时无法查询        │     │
│ │ [一键自动发现] [导入模板映射]                    │     │
│ └──────────────────────────────────────────────┘     │
│                                                     │
│ 概念                域        映射状态    数据源       │
│ ─────────────────────────────────────────────────    │
│ 客户                 运营域     ✅ 已映射    CRM库      │
│   customers 表，5/5 属性已映射                [编辑]   │
│                                                     │
│ 客户账户             运营域     ✅ 已映射    CRM库      │
│   accounts 表，4/4 属性已映射                [编辑]   │
│                                                     │
│ 活动                 运营域     ⚠️ 部分映射  -         │
│   2/4 属性已映射，缺少"活动效果"、"活动预算"    [编辑]   │
│                                                     │
│ 渠道                 运营域     ❌ 未映射    -         │
│   点击配置映射                                 [编辑]   │
│                                                     │
│ 客户                 营销域     ✅ 已映射    ERP库     │
│   crm_customers 表，6/6 属性已映射            [编辑]   │
│                                                     │
│ 线索                 营销域     ❌ 未映射    -         │
│   点击配置映射                                 [编辑]   │
└─────────────────────────────────────────────────────┘
```

**页面信息**：
- 每个概念的映射状态（✅ 已映射 / ⚠️ 部分映射 / ❌ 未映射）
- 已映射概念显示：数据源名、表名、属性映射覆盖率（如 5/5）
- 顶部汇总：未映射概念总数、映射覆盖率百分比
- 筛选器：按域、按映射状态过滤

**页面操作**：
- 点击 [编辑] → 打开映射编辑器（弹窗 B）
- 点击"一键自动发现" → 对未映射概念批量调用 LLM 匹配
- 点击"导入模板映射" → 如果导入了行业模板，可导入模板中预置的映射配置
- 筛选器切换 → 过滤列表

##### 6.2.10.5 弹窗 A：模板导入向导

（详见 6.2.9.2，4 步流程：选择行业 → 选择域 → 预览确认 → 导入完成）

##### 6.2.10.6 弹窗 B：映射编辑器（全屏弹窗）

```
┌─────────────────────────────────────────────────────┐
│ 映射编辑器 — 概念: 客户（运营域）         [保存] [取消]  │
│                                                     │
│ ┌── 概念属性 ──┐              ┌── 数据源字段 ──┐      │
│ │               │              │               │      │
│ │ 客户ID        │──── 映射 ───▶│ customers.id  │      │
│ │ 客户名称      │──── 映射 ───▶│ customers.name│      │
│ │ 客户等级      │──── 映射 ───▶│ customers.tier│      │
│ │ 所属区域      │──── 映射 ───▶│ customers.region│    │
│ │ 创建时间      │──── 映射 ───▶│ customers.created_at││
│ │               │              │               │      │
│ │ + 添加属性     │              │               │      │
│ └───────────────┘              │ 数据源: CRM库  │      │
│                                │ 表: customers │      │
│ ┌── 关联概念 ──┐  ──JOIN──▶    └───────────────┘      │
│ │               │                                    │
│ │ 订单 (HAS)    │──── JOIN ──▶ orders                 │
│ │ 关联键: 客户ID │   ON customers.id = orders.customer_id│
│ │               │                                    │
│ │ 账户 (HAS)    │──── JOIN ──▶ accounts               │
│ │ 关联键: 客户ID │   ON customers.id = accounts.customer_id│
│ │               │                                    │
│ │ + 添加关联     │                                    │
│ └───────────────┘                                    │
│                                                     │
│ 高级选项:                                            │
│ ┌──────────────────────────────────────────────┐    │
│ │ 默认过滤条件: region IS NOT NULL                │    │
│ │ 数据源: [CRM库 ▾]         表: [customers ▾]    │    │
│ └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

**弹窗信息**：
- 左侧：概念的所有属性 + 关联概念
- 右侧：数据源的表结构（字段列表 + 类型）
- 连线表示映射关系
- 底部：高级选项（默认过滤条件、数据源选择）

**弹窗操作**：
- 拖拽属性到字段 → 建立映射
- 点击"添加属性" → 新增计算属性
- 点击"添加关联" → 配置 JOIN 关系
- 自动匹配按钮 → LLM 自动匹配全部属性
- 切换数据源/表 → 更换映射目标

##### 6.2.10.7 弹窗 C：本体自动发现结果确认

```
┌─────────────────────────────────────────────────────┐
│ 自动发现结果 — 数据源: 电信CRM库         [取消] [确认导入]│
│                                                     │
│ 从 telecom_crm 数据库发现以下概念:                     │
│                                                     │
│ ┌ 表: customers ──────────────────────────────┐     │
│ │ → 概念: 客户 (置信度 95%)                      │     │
│ │ ☑ 客户ID  ← customers.id                    │     │
│ │ ☑ 客户名称 ← customers.name                   │     │
│ │ ☑ 客户等级 ← customers.tier                   │     │
│ │ ☑ 所属区域 ← customers.region                 │     │
│ │ ☐ 证件类型 ← customers.id_type (低置信度 62%)  │     │
│ └──────────────────────────────────────────────┘     │
│                                                     │
│ ┌ 表: accounts ───────────────────────────────┐     │
│ │ → 概念: 账户 (置信度 88%)                      │     │
│ │ ☑ 账户ID  ← accounts.id                     │     │
│ │ ☑ 账户类型 ← accounts.account_type            │     │
│ │ ☑ 余额   ← accounts.balance                  │     │
│ └──────────────────────────────────────────────┘     │
│                                                     │
│ ┌ 关系 ────────────────────────────────────────┐     │
│ │ ☑ 客户 HAS 账户                               │     │
│ │   ON customers.id = accounts.customer_id      │     │
│ └──────────────────────────────────────────────┘     │
│                                                     │
│ 目标域: [运营域 ▾]  [新建域]                           │
│ 共发现 3 个概念, 2 条关系, 12 个属性映射                 │
│ 低置信度项可以取消勾选，或点击逐条审核                     │
└─────────────────────────────────────────────────────┘
```

**弹窗信息**：
- 按表分组展示发现的概念
- 每个属性的置信度
- 自动发现的关系（FK 推导）
- 汇总统计

**弹窗操作**：
- ☑/☐ 勾选/取消勾选概念和属性
- 低置信度项（<70%）默认不勾选，用户可手动勾选
- 选择目标域（下拉选择已有域或新建）
- [确认导入] → 批量创建概念 + 映射 + 关系
- [逐条审核] → 进入逐个确认模式

##### 6.2.10.8 弹窗 D：概念编辑弹窗

```
┌─────────────────────────────────────────────────────┐
│ 编辑概念 — 客户                          [保存] [取消] │
│                                                     │
│ 基本信息:                                            │
│ ┌──────────────────────────────────────────────┐    │
│ │ 概念名称: [客户                    ]            │    │
│ │ 概念编码: [customer                ]            │    │
│ │ 所属域:   [运营域 ▾]                            │    │
│ │ 描述:     [购买或使用电信服务的个人或组织  ]       │    │
│ └──────────────────────────────────────────────┘    │
│                                                     │
│ 属性列表:                        [+ 添加属性]         │
│ ┌────┬──────────┬────────┬──────┬──────┐           │
│ │ 序 │ 属性名    │ 类型    │ 必填  │ 操作  │           │
│ ├────┼──────────┼────────┼──────┼──────┤           │
│ │ 1  │ 客户ID   │ 字符串  │  ✓   │ ✏️ 🗑  │           │
│ │ 2  │ 客户名称 │ 字符串  │  ✓   │ ✏️ 🗑  │           │
│ │ 3  │ 客户等级 │ 枚举    │  -   │ ✏️ 🗑  │           │
│ │ 4  │ 所属区域 │ 字符串  │  -   │ ✏️ 🗑  │           │
│ └────┴──────────┴────────┴──────┴──────┘           │
│                                                     │
│ 关系列表:                        [+ 添加关系]         │
│ ┌────┬──────────┬──────────────┬──────┐             │
│ │ 关系类型     │ 目标概念       │ 目标域 │ 操作 │       │
│ ├────┼──────────┼──────────────┼──────┤             │
│ │ HAS │ 账户     │ 运营域        │ 🗑   │             │
│ │ HAS │ 订单     │ 运营域        │ 🗑   │             │
│ └────┴──────────┴──────────────┴──────┘             │
└─────────────────────────────────────────────────────┘
```

**弹窗信息**：
- 概念基本信息
- 属性列表（名称、类型、是否必填）
- 关系列表（关系类型、目标概念、目标域）

**弹窗操作**：
- 编辑名称、编码、描述、所属域
- 添加/编辑/删除属性
- 添加/删除关系（选择目标域 + 目标概念 + 关系类型）
- [保存] → 更新概念

##### 6.2.10.9 页面导航关系图

```
┌──────────────┐     点击域卡片     ┌──────────────┐
│ 本体域列表页  │ ───────────────▶  │ 概念本体编辑器 │
│ (页面 1)     │                   │ (页面 2)      │
│              │ ◀───────────────  │              │
│              │     ← 返回列表     │              │
└──────┬───────┘                   └──────┬───────┘
       │                                  │
       │ 点击[导入模板]                     │ 点击[配置映射]
       ▼                                  ▼
┌──────────────┐                   ┌──────────────┐
│ 模板导入向导  │                   │ 映射编辑器     │
│ (弹窗 A)     │                   │ (弹窗 B)      │
└──────────────┘                   └──────────────┘
       │                                  │
       │ 点击[从数据源发现]                  │ 从映射管理页
       ▼                                  ▼
┌──────────────┐                   ┌──────────────┐
│ 自动发现确认  │                   │ 映射管理页     │
│ (弹窗 C)     │                   │ (页面 3)      │
└──────────────┘                   └──────────────┘

编辑器内:
  双击概念节点 → 概念编辑弹窗 (弹窗 D)
  空白引导卡片 → 导入模板 / 自动发现 / 手动创建
```

##### 6.2.10.10 页面-操作一览表

| 页面 | 路径 | 核心信息 | 核心操作 |
|------|------|---------|---------|
| 本体域列表页 | `/ontology` | 域卡片列表、概念数、映射覆盖率、工具数 | 进入编辑器、导入模板、自动发现、新建域 |
| 概念本体编辑器 | `/ontology/:groupId` | 概念图、概念树、概念详情 | 编辑概念、连线、切换域、配置映射 |
| 映射管理页 | `/ontology/mappings` | 映射状态列表、覆盖率 | 编辑映射、一键自动发现、批量操作 |
| 模板导入向导 | 弹窗 | 行业选择、域选择、预览 | 选择→预览→确认导入 |
| 映射编辑器 | 弹窗 | 属性↔字段、JOIN 配置 | 拖拽映射、自动匹配、保存 |
| 自动发现确认 | 弹窗 | 发现的概念、置信度 | 勾选→确认导入/逐条审核 |
| 概念编辑弹窗 | 弹窗 | 概念信息、属性、关系 | 编辑基本信息、增删属性/关系 |

---

#### 6.2.11 Agent 设计（自动发现、智能补全、语义路由的 AI 能力）

> 自动发现、智能补全、语义路由都依赖 LLM 做语义匹配和推理。
> 这些能力不能硬编码在页面逻辑中，需要由 Agent 统一调度。
> **关键约束**：
> 1. 此 Agent 与开发模块的 Agent 完全隔离，运行在后端。
> 2. 问数用户和本体管理用户是不同角色，问数内部自动使用本体，但本体管理功能独立在系统管理菜单下。

##### 6.2.11.1 Agent 架构定位

```
鲁班 Agent 体系

┌── 前端 Agent（开发模块）──────────────────────┐
│ 运行位置: 浏览器端                              │
│ 职责: 代码生成、页面创建、流程设计               │
│ 技能: page:create, code:create, plan:create... │
│ 隔离: 与本体 Agent 完全无关，不共享任何技能       │
└──────────────────────────────────────────────┘

┌── 后端 Agent（问数 + 本体管理）─────────────────┐
│ 运行位置: 服务端（Java Service）                │
│ 职责: 数据查询、本体管理、语义推理               │
│                                                 │
│  问数调用链（自动，用户无感知）:                   │
│    用户问数 → concept:resolve（概念消歧）          │
│           → mapping:resolve（映射解析）           │
│           → SQL 生成 → 执行 → 返回结果            │
│                                                 │
│  本体管理调用链（手动，本体管理员操作）:             │
│    管理员操作 → concept:discover（自动发现）       │
│             → concept:complete（智能补全）        │
│             → concept:import（模板导入）          │
│             → concept:relate（关系推理）          │
│                                                 │
│  共享 LLM 调用基础设施，但入口和权限隔离            │
└─────────────────────────────────────────────────┘
```

**核心原则**：
- 前端开发 Agent 和本体 Agent **物理隔离**：不同运行环境、不同代码库、不同技能注册表
- 问数**内部自动调用**本体能力（概念消歧、映射解析），用户无需感知，也不需要"切换模式"
- 本体管理功能**独立在系统管理菜单下**，由本体管理员角色操作，问数用户不可见
- 问数用户和本体管理员是不同角色，权限分离

##### 6.2.11.2 技能分离设计

```
后端 Agent 技能集

问数侧技能（自动调用，用户无感知）:
  concept:search      搜索概念（向量检索）
  concept:resolve     概念消歧（自然语言 → 概念，每次问数自动调用）
  mapping:resolve     映射解析（概念 → SQL，问数链路自动调用）
  这些技能对问数用户透明，不需要额外授权

本体管理侧技能（手动触发，仅本体管理员可用）:
  concept:discover    Schema → 概念 自动发现
  concept:complete    智能补全未映射概念
  concept:import      从行业标准导入概念
  concept:relate      关系推理建议
  concept:validate    本体质量校验
  mapping:auto_match  自动匹配属性映射
  mapping:suggest     映射建议
  这些技能仅在系统管理 → 概念本体页面中触发，需要 connect:concepts 权限
```

**为什么不需要"问数模式/本体模式"切换？**
- 问数本身就用了本体（概念消歧、映射解析），这是问数引擎的内部实现，不是独立的"模式"
- 用户打开问数聊天 → 问数就是问数，不需要选模式
- 本体管理是后台配置工作，与问数使用者是不同角色，不应混在同一个界面

##### 6.2.11.3 新增技能详细设计

```
concept:discover（自动发现）
  ┌─────────────────────────────────────────────────────┐
  │ 输入: 数据源 ID + 数据库 Schema（表名、字段名、外键）    │
  │                                                     │
  │ 处理流程:                                            │
  │ 1. 读取数据库元数据（表列表、字段列表、FK 关系）         │
  │ 2. LLM 语义匹配: 表名 → 概念名（customers → 客户）     │
  │ 3. LLM 语义匹配: 字段名 → 属性名（tier → 客户等级）     │
  │ 4. 外键推导: FK → 概念关系（customer_id → HAS）       │
  │ 5. 置信度打分: 高置信度(>80%) 自动采纳，               │
  │    低置信度(50-80%) 标记待确认，<50% 丢弃               │
  │                                                     │
  │ 输出: List<{concept_name, attributes, relations,     │
  │            confidence, source_table}>                │
  │                                                     │
  │ 调用时机: 用户在"自动发现"弹窗点击"开始发现"            │
  │ 用户交互: 结果回显到弹窗 C，用户勾选确认后批量创建       │
  │ 权限要求: connect:concepts                           │
  └─────────────────────────────────────────────────────┘

concept:complete（智能补全）
  ┌─────────────────────────────────────────────────────┐
  │ 输入: 未映射的概念 ID + 所有可用数据源 Schema          │
  │                                                     │
  │ 处理流程:                                            │
  │ 1. 读取概念的 name、description、已有属性              │
  │ 2. 在所有数据源中搜索匹配的表（语义匹配）               │
  │ 3. 匹配字段到概念属性                                 │
  │ 4. 生成映射建议（含 JOIN 关系）                        │
  │                                                     │
  │ 输出: MappingSuggestion { table, column_mappings,    │
  │         join_mappings, confidence }                  │
  │                                                     │
  │ 调用时机: 用户在映射管理页点击"一键自动发现"            │
  │          或问数时发现未映射概念自动提示（但不自动补全）  │
  │ 权限要求: connect:concepts                           │
  └─────────────────────────────────────────────────────┘

concept:resolve（概念消歧，问数内部自动调用）
  ┌─────────────────────────────────────────────────────┐
  │ 输入: 自然语言问题 + 所有概念向量索引                   │
  │                                                     │
  │ 处理流程:                                            │
  │ 1. 从问题中提取实体词（"华东区"、"客户数"、"订单金额"）  │
  │ 2. 向量检索匹配概念（取 Top 5 候选）                   │
  │ 3. 上下文消歧: 置信度排序，返回最佳匹配                 │
  │ 4. 返回最佳匹配概念 + 映射信息                         │
  │                                                     │
  │ 输出: ResolvedConcept { concept_id, concept_name,    │
  │         mapping, confidence, alternatives }          │
  │                                                     │
  │ 调用时机: 语义路由引擎的第一步，每次问数都调用          │
  │ 权限要求: 无（问数链路自动调用，不可单独调用）           │
  └─────────────────────────────────────────────────────┘

concept:import（从标准导入）
  ┌─────────────────────────────────────────────────────┐
  │ 输入: 行业标准来源（OWL/JSON/Swagger）+ 目标 Group      │
  │                                                     │
  │ 处理流程:                                            │
  │ 1. 解析标准格式（OWL: Jena 解析, JSON: 直接解析）      │
  │ 2. 提取概念、属性、关系                               │
  │ 3. 与已有概念去重比较（名称 + 语义双重匹配）            │
  │ 4. 标记冲突并生成重命名建议                            │
  │                                                     │
  │ 输出: ImportPreview { concepts, relations,           │
  │         conflicts, suggestions }                    │
  │                                                     │
  │ 调用时机: 模板导入向导 Step 3 预览阶段                 │
  │ 权限要求: connect:concepts                           │
  └─────────────────────────────────────────────────────┘

concept:relate（关系推理建议）
  ┌─────────────────────────────────────────────────────┐
  │ 输入: 新增/修改的概念 ID + 当前域所有概念              │
  │                                                     │
  │ 处理流程:                                            │
  │ 1. 读取概念的 name、description、属性                  │
  │ 2. LLM 分析: 与域内其他概念的可能关系                  │
  │ 3. Jena 推理: 传递关系推导（A→B→C 则 A→C）            │
  │ 4. 生成关系建议列表                                   │
  │                                                     │
  │ 输出: List<RelationSuggestion { source, target,      │
  │         relation_type, reason, confidence }>         │
  │                                                     │
  │ 调用时机: 用户创建/编辑概念后，右侧面板显示建议          │
  │ 权限要求: connect:concepts                           │
  └─────────────────────────────────────────────────────┘
```

##### 6.2.11.4 前端入口：问数与本体管理分离

**决策：问数入口和本体管理入口完全分离，不设模式切换。**

理由：
- 问数的人**不是**管理本体的人，角色不同
- 问数内部自动使用本体能力（消歧、映射），这是引擎实现细节，不需要暴露为"模式"
- 本体管理是系统级配置，归属系统管理菜单，由管理员/数据架构师操作

**菜单结构**：

```
菜单结构（调整后）:

├── 工作中心（/work）
│   ├── 我的工作
│   └── 平台审核
│
├── 问数（/agent-chat）              ← 一级菜单，问数用户使用
│   问数内部自动调用 concept:resolve + mapping:resolve
│   用户无需关心本体是否存在，引擎自动处理
│   如遇未映射概念，引擎提示用户"该概念尚未配置数据映射，请联系管理员"
│
├── 应用开发（/apps）
│
├── 系统管理（/connect）              ← 一级菜单，管理员使用
│   ├── 系统管理（/connect/systems）   permission: connect:systems
│   ├── 工具注册表（/connect/tools）   permission: connect:tools
│   ├── 概念本体（/connect/concepts）  permission: connect:concepts
│   │   ├── 本体域列表页（首页）       ← 新增子页面
│   │   ├── 概念本体编辑器（画布）      ← 已有
│   │   └── 映射管理页               ← 新增子页面
│   ├── MCP 网关（/connect/gateway）  permission: connect:gateway
│   └── 我的 KEY（/connect/keys）     permission: connect:keys
│
├── 用户管理（/people）
└── 组织架构
```

**两种角色的交互关系**：

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  问数用户（角色: 业务分析员）                          │
│  ├── 入口: 一级菜单「问数」/agent-chat                 │
│  ├── 能力: 自然语言查询数据                           │
│  ├── 本体: 自动使用，无感知                           │
│  └── 不可见: 系统管理菜单、概念本体编辑器              │
│                                                     │
│  本体管理员（角色: 数据架构师）                        │
│  ├── 入口: 系统管理 → 概念本体 /connect/concepts       │
│  ├── 能力: 管理概念、配置映射、导入模板、自动发现       │
│  ├── 可见: 系统管理菜单全部内容                        │
│  └── 权限: connect:concepts                          │
│                                                     │
│  两者关系: 完全独立，通过数据层衔接                    │
│  ├── 管理员配置好概念和映射                            │
│  └── 问数用户查询时自动使用已配置的概念映射             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

##### 6.2.11.5 RBAC 权限模型扩展

与现有 `Permissions.java` 保持一致，本体管理使用已有的 `connect:concepts` 权限，不分子权限。

**权限定义**：

| 权限 Key | 权限名称 | 所属分组 | 说明 |
|---------|---------|---------|------|
| `connect:concepts` | 概念本体 | 系统管理 | 已有，访问概念本体页面及其所有操作 |

> 概念本体的所有操作（编辑概念、配置映射、导入模板、自动发现）共享同一个 `connect:concepts` 权限。权限在角色管理页面（/people/roles）中配置。

**角色建议**：

| 角色 | 建议权限 | 说明 |
|------|---------|------|
| 数据架构师 | `connect:concepts` | 完整的概念本体管理权限 |
| 业务分析员 | 无 `connect:concepts` | 只使用问数，不管理本体 |

**实施要点**：
- 权限在角色管理页面（/people/roles）中配置，管理员为角色勾选对应权限
- 前端通过 `PermissionGate` 组件控制页面/按钮的可见性
- 后端 API 层同样校验权限，防止绕过前端直接调用
- 问数侧的 `concept:resolve`、`mapping:resolve` 是引擎内部调用，不暴露为独立权限

##### 6.2.11.6 后端 Agent 服务设计

```
┌─────────────────────────────────────────────────────────────────┐
│              后端 Agent 服务（Java + Python 协作）                │
│                                                                 │
│ ┌─ Python embedding 服务 (port 8765) ──────────────────────────┐ │
│ │ 零 LLM 依赖，纯向量计算                                       │ │
│ │                                                              │ │
│ │ POST /v1/embeddings             ← embedding 生成（已有）       │ │
│ │ POST /v1/search/concepts        ← FAISS 向量搜索（新增）       │ │
│ │ POST /v1/index/concepts/rebuild ← 重建 FAISS 索引（新增）      │ │
│ │                                                              │ │
│ │ 内部: FAISS IndexFlatIP + sentence-transformers              │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                              │ HTTP                              │
│                              ▼                                   │
│ ┌─ Java Service ───────────────────────────────────────────────┐ │
│ │                                                              │ │
│ │ OntologyAgentService（仅本体管理侧）                           │ │
│ │ ├── discoverConcepts(datasourceId) → DiscoveryResult         │ │
│ │ ├── completeMapping(conceptId) → MappingSuggestion           │ │
│ │ ├── importFromStandard(source, groupId) → ImportPreview      │ │
│ │ ├── suggestRelations(conceptId) → RelationSuggestion[]       │ │
│ │ └── validateConcept(conceptId) → ValidationResult            │ │
│ │   所有方法需校验 connect:concepts 权限                         │ │
│ │                                                              │ │
│ │ QueryAgentService（问数侧，复用已有 LangGraph）                │ │
│ │ ├── resolveConcept(question) → 调用 Python FAISS 向量检索     │ │
│ │ │   → 内部调用 LLM 消歧（复用现有 LLM 配置）                    │ │
│ │ └── resolveMapping(conceptId) → Jena 关系展开 + 映射查表       │ │
│ │     内部调用，不暴露为独立 API                                 │ │
│ │                                                              │ │
│ │ 依赖:                                                        │ │
│ │ ├── LLM Client（LangGraph，一份配置，所有 LLM 调用走这里）      │ │
│ │ ├── EmbeddingPythonClient（调用 Python 向量检索）              │ │
│ │ ├── JenaReasoner（OWL 推理）                                  │ │
│ │ └── DatasourceMetadataScanner（数据源元数据扫描）               │ │
│ │                                                              │ │
│ │ 注意: Python 不做 LLM 调用，LLM 全部在 Java 侧                  │ │
│ └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**注意**：
- `OntologyAgentService` 和 `QueryAgentService` 是两个独立的 Service，职责和权限完全不同
- 问数服务不能调用本体管理的写操作，本体管理服务不能代替用户发起查询
- **所有 LLM 调用都在 Java 侧**（LangGraph），Python 只做向量检索，不重复配置 LLM 连接
- Python 端口 8765 是内部服务，不对外暴露

##### 6.2.11.7 技能-触发场景对照表

| 技能 | 触发场景 | 前端入口 | 权限要求 | 用户确认 |
|------|---------|---------|---------|:---:|
| `concept:discover` | 自动发现 | 弹窗 C | `connect:concepts` | ✅ |
| `concept:complete` | 智能补全 | 映射管理页 | `connect:concepts` | ✅ |
| `concept:resolve` | 概念消歧 | 问数链路自动调用 | 无（内部） | ❌ |
| `concept:import` | 模板导入 | 模板导入向导 Step 3 | `connect:concepts` | ✅ |
| `concept:relate` | 关系推理 | 编辑器右侧面板 | `connect:concepts` | ❌ 建议 |
| `concept:validate` | 质量校验 | 编辑器保存时 | `connect:concepts` | ❌ |
| `mapping:auto_match` | 属性自动匹配 | 映射编辑器按钮 | `connect:concepts` | ❌ 预览 |
| `mapping:suggest` | 映射建议 | 映射管理页 | `connect:concepts` | ✅ |
| `mapping:resolve` | 语义路由 | 问数链路自动调用 | 无（内部） | ❌ |

#### 6.2.12 数据库表结构设计（DDL）

> 基于现有 `concept` 表和 `concept_relation` 表的扩展，以及新增表。

##### 6.2.12.1 现有表改动

```sql
-- concept 表扩展（已有表：concept）
ALTER TABLE concept
    ADD COLUMN code VARCHAR(64) NULL COMMENT '概念编码，Group 内唯一，用于跨域引用',
    ADD COLUMN embedding BLOB NULL COMMENT '1536维 float32 向量',
    ADD COLUMN embedding_version VARCHAR(32) NULL COMMENT 'embedding 模型版本',
    ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT 'active/draft/archived',
    ADD COLUMN version INT NOT NULL DEFAULT 1 COMMENT '版本号',
    ADD COLUMN updated_by VARCHAR(64) NULL COMMENT '最后修改人',
    ADD UNIQUE INDEX uk_group_code (group_id, code);

-- concept_relation 表扩展（已有表：concept_relation）
ALTER TABLE concept_relation
    ADD COLUMN cross_group BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否跨域关系',
    ADD COLUMN updated_by VARCHAR(64) NULL COMMENT '最后修改人';

-- datasources 表扩展（已有表：datasources，支持 REF 数据源，开发者使用）
ALTER TABLE datasources
    ADD COLUMN source_datasource_id BIGINT NULL COMMENT 'REF 类型指向的 PLATFORM 数据源 ID（开发者申请使用）',
    ADD INDEX idx_source_datasource (source_datasource_id);
```

##### 6.2.12.2 新增表

```sql
-- ============================================================
-- 1. ontology_group：本体域/分组
-- ============================================================
CREATE TABLE ontology_group (
    id           BIGINT PRIMARY KEY AUTO_INCREMENT,
    name         VARCHAR(128) NOT NULL COMMENT '域名称',
    code         VARCHAR(64)  NOT NULL COMMENT '域编码，全局唯一',
    parent_id    BIGINT       NULL COMMENT '父域 ID，支持层级',
    description  VARCHAR(512) NULL COMMENT '域描述',
    industry     VARCHAR(32)  NULL COMMENT '所属行业: telecom/industrial/finance/general',
    icon         VARCHAR(64)  NULL COMMENT '图标',
    sort_order   INT          NOT NULL DEFAULT 0,
    is_base      BOOLEAN      NOT NULL DEFAULT FALSE COMMENT '是否为基础域（共享域）',
    status       VARCHAR(16)  NOT NULL DEFAULT 'active' COMMENT 'active/archived',
    created_by   VARCHAR(64)  NULL,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE INDEX uk_code (code),
    INDEX idx_parent (parent_id),
    INDEX idx_industry (industry)
) COMMENT '本体域/分组';

-- ============================================================
-- 2. concept_mapping：概念→数据源字段映射
-- ============================================================
CREATE TABLE concept_mapping (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    concept_id      BIGINT       NOT NULL COMMENT '概念 ID',
    datasource_id   BIGINT       NOT NULL COMMENT '数据源 ID',
    table_name      VARCHAR(128) NOT NULL COMMENT '数据表名',
    column_name     VARCHAR(128) NOT NULL COMMENT '字段名',
    attribute_name  VARCHAR(128) NULL COMMENT '概念属性名（概念属性→表字段）',
    mapping_type    VARCHAR(16)  NOT NULL DEFAULT 'direct' COMMENT 'direct/join/computed',
    join_condition  VARCHAR(512) NULL COMMENT 'JOIN 条件，如 orders.customer_id = customers.id',
    computed_expr   VARCHAR(512) NULL COMMENT '计算表达式，如 CONCAT(first_name, last_name)',
    confidence      DECIMAL(3,2) NULL COMMENT '映射置信度（自动发现）',
    is_auto         BOOLEAN      NOT NULL DEFAULT FALSE COMMENT '是否自动发现',
    is_required     BOOLEAN      NOT NULL DEFAULT FALSE COMMENT '是否必填映射',
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE INDEX uk_concept_attr_ds (concept_id, attribute_name, datasource_id),
    INDEX idx_datasource (datasource_id),
    INDEX idx_concept (concept_id)
) COMMENT '概念属性→数据源字段映射（属性级）';

-- ============================================================
-- 3. concept_join_mapping：概念关联JOIN映射
-- ============================================================
CREATE TABLE concept_join_mapping (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    concept_id      BIGINT       NOT NULL COMMENT '源概念ID',
    datasource_id   BIGINT       NOT NULL COMMENT '数据源ID',
    target_concept  VARCHAR(128) NOT NULL COMMENT '目标概念名称',
    relation_type   VARCHAR(32)  NOT NULL COMMENT '关系类型: HAS/BELONGS_TO/COMPUTED_FROM等',
    join_table      VARCHAR(128) NOT NULL COMMENT 'JOIN 的目标表名',
    join_condition  VARCHAR(512) NOT NULL COMMENT 'JOIN 条件，如 customers.id = orders.customer_id',
    join_type       VARCHAR(16)  NOT NULL DEFAULT 'LEFT' COMMENT 'JOIN 类型: LEFT/INNER/RIGHT',
    confidence      DECIMAL(3,2) NULL     COMMENT '自动发现置信度',
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE INDEX uk_concept_join (concept_id, target_concept, relation_type, datasource_id),
    INDEX idx_concept (concept_id),
    INDEX idx_datasource (datasource_id)
) COMMENT '概念关联JOIN映射';

-- ============================================================
-- 4. concept_tool_binding：概念→工具绑定
-- ============================================================
CREATE TABLE concept_tool_binding (
    id           BIGINT PRIMARY KEY AUTO_INCREMENT,
    concept_id   BIGINT       NOT NULL COMMENT '概念 ID',
    tool_id      BIGINT       NOT NULL COMMENT '工具 ID（关联 tool_definition.id）',
    binding_type VARCHAR(32)  NOT NULL COMMENT '绑定类型: QUERY/STAT/ACTION/EXPORT',
    is_default   BOOLEAN      NOT NULL DEFAULT FALSE COMMENT '是否默认工具',
    config       JSON         NULL COMMENT '绑定配置（参数映射等）',
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE INDEX uk_concept_tool_type (concept_id, tool_id, binding_type),
    INDEX idx_tool (tool_id)
) COMMENT '概念→工具绑定';

-- ============================================================
-- 5. concept_feedback：概念溯源用户反馈
-- ============================================================
CREATE TABLE concept_feedback (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id      VARCHAR(64)  NOT NULL COMMENT '问数会话 ID',
    message_id      VARCHAR(64)  NOT NULL COMMENT '消息 ID',
    user_question   TEXT         NOT NULL COMMENT '用户原始问题',
    reasoning       TEXT         NULL COMMENT 'LLM 思考过程',
    resolved_concepts JSON       NULL COMMENT '消歧匹配的概念列表',
    generated_sql   TEXT         NULL COMMENT '生成的 SQL',
    query_result    TEXT         NULL COMMENT '查询结果',
    user_feedback   TEXT         NOT NULL COMMENT '用户反馈：哪里不对',
    status          VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending/reviewed/resolved',
    reviewed_by     VARCHAR(64)  NULL,
    review_comment  TEXT         NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at     DATETIME     NULL,

    INDEX idx_session (session_id),
    INDEX idx_status (status)
) COMMENT '概念溯源用户反馈';

-- ============================================================
-- 6. concept_snapshot：本体版本快照
-- ============================================================
CREATE TABLE concept_snapshot (
    id           BIGINT PRIMARY KEY AUTO_INCREMENT,
    group_id     BIGINT       NOT NULL COMMENT '所属 Group',
    version      VARCHAR(32)  NOT NULL COMMENT '版本号，如 v1.0.0',
    snapshot     JSON         NOT NULL COMMENT '完整快照（概念+关系+映射）',
    change_log   JSON         NULL COMMENT '变更日志',
    created_by   VARCHAR(64)  NULL,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE INDEX uk_group_version (group_id, version),
    INDEX idx_group (group_id)
) COMMENT '本体版本快照（用于版本管理和回滚）';

-- ============================================================
-- 7. concept_import_log：模板导入记录
-- ============================================================
CREATE TABLE concept_import_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    industry        VARCHAR(32)  NOT NULL COMMENT '行业: telecom/industrial/finance',
    source          VARCHAR(128) NOT NULL COMMENT '来源标准: TM Forum SID/IOF Core/FIBO',
    target_group_id BIGINT       NOT NULL COMMENT '导入到的 Group ID',
    total_concepts  INT          NOT NULL DEFAULT 0,
    imported_count  INT          NOT NULL DEFAULT 0,
    skipped_count   INT          NOT NULL DEFAULT 0 COMMENT '因冲突跳过的数量',
    conflict_detail JSON         NULL COMMENT '冲突详情',
    imported_by     VARCHAR(64)  NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_group (target_group_id),
    INDEX idx_industry (industry)
) COMMENT '模板导入记录';

-- ============================================================
-- 8. concept_embedding_task：embedding 生成任务
-- ============================================================
CREATE TABLE concept_embedding_task (
    id           BIGINT PRIMARY KEY AUTO_INCREMENT,
    concept_id   BIGINT       NOT NULL,
    task_type    VARCHAR(16)  NOT NULL DEFAULT 'generate' COMMENT 'generate/regenerate',
    status       VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending/running/done/failed',
    error_msg    TEXT         NULL,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at  DATETIME     NULL,

    INDEX idx_concept (concept_id),
    INDEX idx_status (status)
) COMMENT 'embedding 生成任务（异步）';
```

```sql
-- 9. role_concept_permission：角色概念域查询权限
CREATE TABLE role_concept_permission (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    role_id     BIGINT   NOT NULL COMMENT '角色ID（关联现有角色表）',
    group_id    BIGINT   NOT NULL COMMENT '本体域ID（ontology_group.id），授权整个域的概念',
    granted_by  BIGINT   NULL     COMMENT '授权人ID',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uk_role_group (role_id, group_id),
    INDEX idx_role (role_id),
    INDEX idx_group (group_id)
) COMMENT '角色概念查询权限（按域授权，仅问数Agent使用）';
```

##### 6.2.12.3 表关系总览

```
ontology_group
    │
    ├── 1:N ── concept (group_id)
    │             │
    │             ├── 1:N ── concept_relation (source_concept_id)
    │             │
    │             ├── 1:N ── concept_mapping (concept_id)
    │             │             └── N:1 ── datasources (datasource_id)
    │             │
    │             ├── 1:N ── concept_join_mapping (concept_id)
    │             │             └── N:1 ── datasources (datasource_id)
    │             │
    │             ├── 1:N ── concept_tool_binding (concept_id)
    │             │             └── N:1 ── tool_definition (tool_id)
    │             │
    │             └── 1:N ── concept_embedding_task (concept_id)
    │
    ├── 1:N ── concept_snapshot (group_id)
    │
    ├── 1:N ── concept_import_log (target_group_id)
    │
    └── 1:N ── role_concept_permission (group_id)
                  └── N:1 ── 现有角色表 (role_id)

concept_feedback（独立，关联问数会话）
    └── 通过 session_id/message_id 关联问数会话
```

#### 6.2.13 REST API 契约

> 所有 API 遵循现有模式：`/api/v1/{resource}`，统一 `ApiResponse` 包装。
> 新增权限控制：本体管理相关 API 需 `connect:concepts` 系列权限。

##### 6.2.13.1 本体域（Ontology Group）

```
GET    /api/v1/ontology-groups
  权限: connect:concepts
  参数: ?industry=telecom&parentId=1
  返回: List<OntologyGroup>

GET    /api/v1/ontology-groups/{id}
  权限: connect:concepts
  返回: OntologyGroup

POST   /api/v1/ontology-groups
  权限: connect:concepts
  body: { name, code, parentId?, description?, industry?, isBase? }
  返回: OntologyGroup

PUT    /api/v1/ontology-groups/{id}
  权限: connect:concepts
  body: { name?, description?, industry?, icon?, sortOrder? }
  返回: OntologyGroup

DELETE /api/v1/ontology-groups/{id}
  权限: connect:concepts
  说明: 域下有概念时禁止删除，返回 409

GET    /api/v1/ontology-groups/{id}/stats
  权限: connect:concepts
  返回: { conceptCount, mappedCount, toolCount, relationCount }
```

##### 6.2.13.2 概念（Concept）— 现有 API 扩展

```
GET    /api/v1/concepts
  现有 + 新增参数: ?groupId=&keyword=&status=&page=&size=
  返回: { items: List<Concept>, total, page, size }

POST   /api/v1/concepts
  现有 body 扩展: { name, parentId?, groupId, code, description?, attributes? }
  说明: 创建时自动触发 embedding 生成任务

PUT    /api/v1/concepts/{id}
  现有 body 扩展: { name?, code?, description?, attributes? }
  说明: 名称/描述变更时自动重新生成 embedding

DELETE /api/v1/concepts/{id}
  说明: 被其他域引用时禁止删除，返回 409 + 引用列表

GET    /api/v1/concepts/semantic-search
  新增: 语义搜索概念
  权限: connect:concepts
  参数: ?q=客户数&groupId=1&k=10
  返回: [{ conceptId, name, score, groupName }, ...]
```

##### 6.2.13.3 概念映射（Concept Mapping）

```
GET    /api/v1/concepts/{id}/mappings
  权限: connect:concepts
  返回: List<ConceptMapping>

POST   /api/v1/concepts/{id}/mappings
  权限: connect:concepts
  body: { datasourceId, tableName, columnName, attributeName, mappingType?, joinCondition? }
  返回: ConceptMapping

PUT    /api/v1/concepts/{id}/mappings/{mappingId}
  权限: connect:concepts
  body: { tableName?, columnName?, mappingType?, joinCondition? }
  返回: ConceptMapping

DELETE /api/v1/concepts/{id}/mappings/{mappingId}
  权限: connect:concepts

POST   /api/v1/concepts/{id}/mappings/auto-match
  权限: connect:concepts
  说明: 调用 Agent 自动匹配属性映射
  返回: List<ConceptMapping>（含置信度，需用户确认后保存）

GET    /api/v1/concepts/unmapped
  权限: connect:concepts
  参数: ?groupId=
  返回: List<Concept>（未映射的概念列表）

POST   /api/v1/concepts/{id}/mappings/complete
  权限: connect:concepts
  说明: 智能补全：为未映射概念自动搜索匹配的数据表
  返回: { suggestions: List<MappingSuggestion> }
```

##### 6.2.13.4 概念→工具绑定（Concept Tool Binding）

```
GET    /api/v1/concepts/{id}/bindings
  权限: connect:concepts
  返回: List<ConceptToolBinding>

POST   /api/v1/concepts/{id}/bindings
  权限: connect:concepts
  body: { toolId, bindingType, isDefault?, config? }
  返回: ConceptToolBinding

PUT    /api/v1/concepts/{id}/bindings/{bindingId}
  权限: connect:concepts
  body: { bindingType?, isDefault?, config? }
  返回: ConceptToolBinding

DELETE /api/v1/concepts/{id}/bindings/{bindingId}
  权限: connect:concepts
```

##### 6.2.13.5 自动发现（Auto Discovery）

```
POST   /api/v1/concepts/discover
  权限: connect:concepts
  body: { datasourceId, groupId? }
  说明: 调用 concept:discover 技能，分析数据源 Schema 反向生成概念
  返回: { concepts: List<DiscoveredConcept>, totalTables, discoveredCount }

POST   /api/v1/concepts/discover/confirm
  权限: connect:concepts
  body: { concepts: [{ name, attributes, relations, sourceTable }], groupId }
  说明: 用户确认后批量创建概念
  返回: { createdCount, createdIds }
```

##### 6.2.13.6 模板导入（Template Import）

```
GET    /api/v1/concepts/templates
  权限: connect:concepts
  返回: [{ industry, name, source, domains, conceptCount, version }]

POST   /api/v1/concepts/templates/preview
  权限: connect:concepts
  body: { industry, domain, groupId }
  说明: 预览导入内容，检测冲突
  返回: { concepts, relations, conflicts, suggestions }

POST   /api/v1/concepts/templates/import
  权限: connect:concepts
  body: { industry, domain, groupId, resolvedConflicts? }
  说明: 执行导入，创建概念+关系+映射提示
  返回: { importedCount, skippedCount, importLogId }
```

##### 6.2.13.7 概念溯源反馈（Concept Feedback）

```
POST   /api/v1/concepts/feedback
  权限: 无（问数用户可提交）
  body: { sessionId, messageId, userQuestion, reasoning?, resolvedConcepts?,
          generatedSql?, queryResult?, userFeedback }
  返回: { id, status }

GET    /api/v1/concepts/feedback
  权限: connect:concepts
  参数: ?status=pending&page=&size=
  返回: { items: List<ConceptFeedback>, total }

PUT    /api/v1/concepts/feedback/{id}/review
  权限: connect:concepts
  body: { status: 'reviewed'|'resolved', reviewComment? }
  返回: ConceptFeedback
```

##### 6.2.13.8 版本快照（Snapshot）

```
GET    /api/v1/ontology-groups/{groupId}/snapshots
  权限: connect:concepts
  返回: List<{ id, version, createdBy, createdAt }>

POST   /api/v1/ontology-groups/{groupId}/snapshots
  权限: connect:concepts
  body: { changeLog? }
  说明: 创建当前 Group 的完整快照
  返回: { id, version }

GET    /api/v1/ontology-groups/{groupId}/snapshots/{id}/diff
  权限: connect:concepts
  参数: ?compareVersion=v1.0.0
  返回: { added, removed, modified }

POST   /api/v1/ontology-groups/{groupId}/snapshots/{id}/rollback
  权限: connect:concepts
  说明: 回滚到指定版本
  返回: { restoredCount, skippedCount }
```

##### 6.2.13.9 Embedding 管理

```
POST   /api/v1/concepts/{id}/embedding/regenerate
  权限: connect:concepts
  返回: { conceptId, version, status }

POST   /api/v1/concepts/embeddings/rebuild
  权限: connect:concepts
  返回: { total, success, failed }

GET    /api/v1/concepts/embeddings/status
  权限: connect:concepts
  返回: { totalConcepts, indexedCount, pendingCount, failedCount }
```

##### 6.2.13.10 问数 API 扩展（Agent Chat）

```
POST   /api/v1/agent/chat
  现有 body 扩展:
    { sessionId, message, systemId?, availableSystems, history }
  响应扩展:
    {
      answer: "...",
      toolCalls: [...],
      conceptTrace: {           // ← 新增
        status: "all_matched",
        concepts: [{ conceptId, conceptName, attributes, matched, confidence }],
        dataSources: ["ERP 数据库"]
      }
    }
```

##### 6.2.13.11 角色概念权限（Role Concept Permission）

```
GET    /api/v1/roles/{roleId}/concept-permissions
  权限: people:roles
  说明: 系统管理员在角色管理页面查看该角色已授权的概念域列表
  响应: {
    groups: [{ groupId, groupName, conceptCount }]
  }

PUT    /api/v1/roles/{roleId}/concept-permissions
  权限: people:roles
  body: { groupIds: [1, 3] }
  说明: 全量替换角色有权限的概念域列表（系统管理员在角色管理页面操作）

GET    /api/v1/roles/{roleId}/concept-permissions/check
  权限: 内部调用（无需外部权限）
  query: conceptIds=1,2,3
  响应: {
    authorized: [1, 3],
    denied: [{ conceptId: 2, conceptName: "营收", groupName: "财务域" }]
  }
  说明: 批量校验概念权限，问数 Agent 内部调用，不对外暴露
```