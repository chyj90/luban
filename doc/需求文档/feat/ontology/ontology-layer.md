# 概念本体层（Ontology Layer）需求文档

## 一、要解决的问题

### 1.1 问题背景

当前工具检索采用三级渐进式暴露机制：

```
Tier 1: 系统路由  → Agent 选定目标系统
Tier 2: 语义检索  → 向量相似度 / BM25 返回 top-5 工具
Tier 3: Schema 加载 → 全量工具兜底
```

Tier 2 的语义检索存在固有盲区：**检索只能找到语义相似的，找不到逻辑依赖的。**

### 1.2 典型场景：语义盲区

用户问"离职人员比例是多少？"，向量检索能找到：

| 工具 | 相似度 | 说明 |
|------|--------|------|
| get_resigned_count | 0.92 | 离职人数（分子） |
| get_employee_info | 0.78 | 员工信息 |
| ... | | |

但漏掉了完成计算所需的工具：

| 工具 | 相似度 | 说明 |
|------|--------|------|
| get_department_list | 0.12 | 部门列表（与"离职"语义无关） |
| get_department_headcount | 0.18 | 部门人数（分母） |

结果：Agent 拿到分子，拿不到分母，无法计算比例。

### 1.3 典型场景：工业生产隐含知识

工业生产中的隐含知识远不止简单的层级关系，以下场景均超出了当前语义检索的能力范围：

**场景 A：计算规则**

```
用户: "3号产线 OEE 是多少？"
  
  OEE = 可用率 × 性能率 × 质量率
  
  检索到: get_availability(0.85), get_performance(0.80), get_quality(0.78)
  漏掉:   无（三个工具都检索到了）
  
  但 Agent 不知道 OEE 的计算公式，可能自己瞎编一个公式。
```

**场景 B：跨系统等价**

```
用户: "本月合格品率？"（在 MES 系统中提问）

  MES 系统的"合格品数" 等价于 QMS 系统的"合格品数"
  但 QMS 的工具不在 MES 系统的检索范围内
  
  需要知道: MES.合格品数 ≡ QMS.合格品数（跨系统等价关系）
```

**场景 C：上下游传递**

```
用户: "工序B的投入量是多少？"

  工序B投入 = 工序A产出
  但"工序A产出"和"工序B投入"是两个不同的概念
  
  需要知道: 工序A产出 → 传递依赖 → 工序B投入
```

**场景 D：阈值语义**

```
用户: "哪些产线产能紧张？"

  产能紧张 = 产能利用率 > 90%
  
  检索到: get_capacity_utilization(0.88)
  
  但 Agent 不知道 90% 是阈值，"紧张"是一个语义标签而非工具名。
```

**场景 E：条件推导**

```
用户: "3号设备现在能用吗？"

  设备可用 = 设备状态≠停机 OR (设备状态=停机 AND 维修工单已完成)
  
  检索到: get_device_status(0.91)
  漏掉:   get_maintenance_order(0.23)（维修工单）
  
  需要知道: 设备状态=停机时，需要检查维修工单来推导"可用性"
```

### 1.4 当前方案的缺陷

当前依赖 Tier 3 全量加载兜底，但存在三个问题：

1. **过度依赖 LLM 判断**：Agent 需要自己判断"工具不够用"，然后升级到 Tier 3。LLM 可能误判、乱算，或在多轮迭代中陷入死循环。
2. **Token 浪费**：Tier 3 全量加载所有工具 schema，工具数量多时 prompt 冗长，增加延迟和成本。
3. **无法处理隐含知识**：即使全量加载了工具，LLM 也不知道 OEE 的计算公式、不知道 MES 和 QMS 的等价关系、不知道 90% 是产能紧张的阈值。

### 1.5 根本原因

**工具之间的关系（谁生产什么数据、谁消费什么数据）和领域隐含知识（计算公式、等价关系、传递依赖、阈值规则）没有被建模。** 语义检索只能理解文本相似度，无法理解领域逻辑。

---

## 二、解决思路

### 2.1 核心思想

不为工具之间的直接关系建模（O(N²) 爆炸），而是**为工具和领域概念之间的关系建模（O(N×M)）**。同时，将工业生产中的隐含知识（计算规则、等价关系、传递依赖等）显式化，存储在 Ontology 中。

### 2.2 技术选型：Apache Jena

选用 **Apache Jena** 作为 Ontology 框架，而非纯手搓 SQL。理由：

| 对比维度 | 纯手搓 SQL | Apache Jena |
|---------|-----------|-------------|
| 多级传递推理（父→子→孙→…） | 需手写递归 CTE 或 Java 循环 | `convertToTransitiveProperty()` 一行 |
| 等价关系推理（A=B, B=C → A=C） | 需手写递归函数 | 推理机自动推导 |
| 对称关系（A等价B → B等价A） | 需手写双向查询 | `convertToSymmetricProperty()` 一行 |
| 新增关系类型 | 每加一种关系，手写一个递归函数 | 声明 Property 特征即可 |
| 约束校验（不能循环继承等） | 需手写校验逻辑 | OWL 推理机自动校验 |
| 对接工业标准本体（ISA-95 等） | 无法对接 | 原生支持 OWL/RDF 导入导出 |
| 依赖体积 | 0 | 核心 ~8 个依赖，~6MB |

### 2.3 架构方案：Jena 内存模型

**当前阶段**采用 Jena 内存模型（In-Memory Model）：

```
启动时:
  MySQL (concept + concept_relation + tool_concept 表)
      │
      ▼ 全量加载
  Jena OntModel (内存中)
      │
      ▼ 推理机
  推理后的 OntModel（含隐含知识）
      │
      ▼ 查询接口
  ToolEmbeddingService 概念扩展
```

**优势**：
- 概念数据量小（几十到几百），全量内存加载无性能压力
- 推理机自动推导隐含关系，无需手写递归
- 零外部服务依赖，随应用启动

**未来演进**：当概念数量增长到数千级别，或需要跨应用共享本体时，可迁移至 Jena TDB 持久化方案：

```
未来: Jena + TDB 持久化
  MySQL → 仅存工具绑定数据
  TDB   → 存储本体模型（磁盘持久化 + 事务支持）
  Fuseki → 可选，提供 SPARQL HTTP 端点供外部查询
```

迁移时只需替换 Model 创建方式，上层查询接口不变。

### 2.4 关系类型体系

共支持 6 种关系类型，覆盖工业生产中的隐含知识：

| 关系类型 | 方向 | 含义 | 示例 | 推理特征 |
|---------|------|------|------|---------|
| PARENT_OF | 概念→概念 | 概念层级包含 | 员工总数 → 部门人数 | 传递性 |
| COMPUTED_FROM | 概念→概念 | 由其他概念计算得出 | 离职比例 → 离职人数, 员工总数 | 无 |
| EQUIVALENT_TO | 概念→概念 | 跨系统/跨域等价 | MES.良品数 ↔ QMS.合格品数 | 对称+传递 |
| PREREQUISITE_OF | 概念→概念 | 前置依赖 | 部门列表 → 部门人数 | 传递性 |
| DERIVED_FROM | 概念→概念 | 条件推导 | 设备可用 ← 设备状态+维修工单 | 无 |
| UPPER_STREAM_OF | 概念→概念 | 上下游传递 | 工序A产出 → 工序B投入 | 传递性 |
| PRODUCES | 工具→概念 | 工具产出该概念的数据 | get_resigned_count → 离职人数 | 无 |
| CONSUMES | 工具→概念 | 工具需要该概念的数据作为输入 | 计算离职比例 → 离职人数 | 无 |

### 2.5 概念示例

```
人力资源领域概念树：

员工总数
├── 部门人数          ← 由 get_department_headcount 生产
│   └── 部门列表      ← 由 get_department_list 生产，PREREQUISITE_OF 部门人数
├── 离职人数          ← 由 get_resigned_count 生产
├── 入职人数          ← 由 get_hired_count 生产
└── 在职人数          ← 由 get_active_count 生产

离职比例 ──COMPUTED_FROM──▶ 离职人数, 员工总数
  expression: "离职人数 / 员工总数"

制造领域：

OEE ──COMPUTED_FROM──▶ 可用率, 性能率, 质量率
  expression: "可用率 × 性能率 × 质量率"

产能紧张 ──DERIVED_FROM──▶ 产能利用率
  condition: "产能利用率 > 90%"

MES.合格品数 ──EQUIVALENT_TO──▶ QMS.合格品数

工序A产出 ──UPPER_STREAM_OF──▶ 工序B投入
```

### 2.6 检索时的行为

```
用户: "3号产线 OEE 是多少？"

语义检索 → [get_availability(0.85), get_performance(0.80), get_quality(0.78)]

Jena 本体推理:
  1. 查询 OEE 的 COMPUTED_FROM 关系
     → [可用率, 性能率, 质量率]
     expression: "可用率 × 性能率 × 质量率"
  
  2. 查询 PRODUCES 每个子概念的工具:
     可用率 → get_availability ✅ (已检索到)
     性能率 → get_performance ✅ (已检索到)
     质量率 → get_quality ✅ (已检索到)
  
  3. 工具齐全，无需补齐

结果:
  放入 prompt + 计算公式:
  "OEE = 可用率 × 性能率 × 质量率，已加载 get_availability、
   get_performance、get_quality 三个工具，请调用后按公式计算"
```

```
用户: "离职人员比例"

语义检索 → [get_resigned_count(0.92)]

Jena 本体推理:
  1. 查询"离职比例"的 COMPUTED_FROM 关系
     → [离职人数, 员工总数]
  
  2. 员工总数通过传递性 PARENT_OF 展开:
     → 部门人数, 离职人数, 入职人数, 在职人数
  
  3. 部门人数通过 PREREQUISITE_OF 展开:
     → 部门列表
  
  4. 查询 PRODUCES 每个概念的工具:
     离职人数 → get_resigned_count ✅
     部门人数 → get_department_headcount ⬅ 补齐
     部门列表 → get_department_list ⬅ 补齐

结果:
  补齐: [get_resigned_count, get_department_headcount, get_department_list]
  prompt 附带公式: "离职比例 = 离职人数 / 员工总数"
```

---

## 三、数据模型

### 3.1 MySQL 持久化表（存事实数据）

```sql
CREATE TABLE concept (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    name        VARCHAR(64)  NOT NULL COMMENT '概念名称',
    parent_id   BIGINT       NULL     COMMENT '父概念ID，支持树形层级',
    group_id    BIGINT       NULL     COMMENT '所属系统ID，NULL表示全局概念',
    description VARCHAR(256) NULL     COMMENT '概念描述',
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NULL     ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_parent (parent_id),
    INDEX idx_group (group_id),
    UNIQUE KEY uk_name_group (name, group_id)
);

CREATE TABLE concept_relation (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    source_concept_id   BIGINT      NOT NULL COMMENT '源概念ID',
    target_concept_id   BIGINT      NOT NULL COMMENT '目标概念ID',
    relation_type       VARCHAR(32) NOT NULL COMMENT '关系类型',
    expression          TEXT        NULL     COMMENT '计算表达式或条件（COMPUTED_FROM/DERIVED_FROM时使用）',
    description         VARCHAR(256) NULL    COMMENT '关系说明',
    created_at          DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_source (source_concept_id),
    INDEX idx_target (target_concept_id),
    UNIQUE KEY uk_relation (source_concept_id, target_concept_id, relation_type)
);

CREATE TABLE tool_concept (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    tool_id     BIGINT      NOT NULL COMMENT '工具ID',
    concept_id  BIGINT      NOT NULL COMMENT '概念ID',
    relation    VARCHAR(16) NOT NULL COMMENT 'PRODUCES 或 CONSUMES',
    created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_tool (tool_id),
    INDEX idx_concept (concept_id),
    UNIQUE KEY uk_tool_concept_relation (tool_id, concept_id, relation)
);
```

### 3.2 Jena 内存模型（运行时推理）

启动时从 MySQL 加载数据，构建 Jena OntModel：

```java
@Service
public class OntologyService {

    private OntModel ontologyModel;
    private static final String NS = "http://luban.ai/ontology#";

    @PostConstruct
    public void init() {
        ontologyModel = ModelFactory.createOntologyModel(
            OntModelSpec.OWL_MEM_MICRO_RULE_INF  // 内存模型 + 微型推理机
        );
        loadFromDatabase();
    }

    private void loadFromDatabase() {
        // 1. 从 concept 表加载为 OWL Classes
        List<Concept> concepts = conceptRepository.findAll();
        Map<Long, OntClass> classMap = new HashMap<>();
        for (Concept c : concepts) {
            OntClass cls = ontologyModel.createClass(NS + escapeUri(c.getName()));
            classMap.put(c.getId(), cls);
            if (c.getParentId() != null && classMap.containsKey(c.getParentId())) {
                classMap.get(c.getParentId()).addSubClass(cls);
            }
        }

        // 2. 从 concept_relation 表加载为 ObjectProperties
        List<ConceptRelation> relations = conceptRelationRepository.findAll();
        for (ConceptRelation r : relations) {
            ObjectProperty prop = getOrCreateProperty(r.getRelationType());
            // 声明推理特征
            if (r.getRelationType().equals("PARENT_OF")
                || r.getRelationType().equals("PREREQUISITE_OF")
                || r.getRelationType().equals("UPPER_STREAM_OF")) {
                prop.convertToTransitiveProperty();  // 传递性
            }
            if (r.getRelationType().equals("EQUIVALENT_TO")) {
                prop.convertToSymmetricProperty();   // 对称性
                prop.convertToTransitiveProperty();  // 传递性
            }
            // 创建关系实例
            OntClass source = classMap.get(r.getSourceConceptId());
            OntClass target = classMap.get(r.getTargetConceptId());
            // 通过 Individual 绑定关系
            Individual sourceInd = source.createIndividual(NS + "i_" + r.getId());
            Individual targetInd = target.createIndividual(NS + "i_" + r.getId() + "_t");
            sourceInd.addProperty(prop, targetInd);
        }

        // 3. 从 tool_concept 表加载为 DataProperties
        // ...（类似逻辑）
    }
}
```

### 3.3 概念扩展查询

```java
public List<ToolDefinition> expandByConcepts(List<ToolDefinition> topK, int maxExpanded) {
    Set<ToolDefinition> result = new LinkedHashSet<>(topK);

    // 收集 topK 中工具的 CONSUMES 概念
    Set<String> consumedConcepts = new HashSet<>();
    for (ToolDefinition tool : topK) {
        for (ToolConcept tc : toolConceptRepository.findByToolIdAndRelation(tool.getId(), "CONSUMES")) {
            consumedConcepts.add(tc.getConceptName());
        }
    }

    if (consumedConcepts.isEmpty()) {
        return topK;
    }

    // 使用 Jena 推理机展开所有子概念（传递性自动处理）
    for (String conceptName : consumedConcepts) {
        OntClass cls = ontologyModel.getOntClass(NS + escapeUri(conceptName));
        if (cls == null) continue;

        // 获取所有子概念（包括间接子概念，推理机已自动展开）
        for (ExtendedIterator<OntClass> it = cls.listSubClasses(); it.hasNext(); ) {
            OntClass sub = it.next();
            if (sub.isAnon()) continue;  // 跳过匿名类
            consumedConcepts.add(sub.getLocalName());
        }
    }

    // 查找 PRODUCES 这些概念的工具
    for (String conceptName : consumedConcepts) {
        if (result.size() >= maxExpanded) break;
        List<ToolConcept> producers = toolConceptRepository
            .findByConceptNameAndRelation(conceptName, "PRODUCES");
        for (ToolConcept tc : producers) {
            if (result.size() >= maxExpanded) break;
            result.add(toolDefinitionRepository.findById(tc.getToolId()).orElse(null));
        }
    }

    return new ArrayList<>(result);
}
```

### 3.4 Entity 定义

```java
@Entity
@Table(name = "concept")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Concept {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 64)
    private String name;

    @Column(name = "parent_id")
    private Long parentId;

    @Column(name = "group_id")
    private Long groupId;

    @Column(length = 256)
    private String description;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}

@Entity
@Table(name = "concept_relation")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ConceptRelation {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "source_concept_id", nullable = false)
    private Long sourceConceptId;

    @Column(name = "target_concept_id", nullable = false)
    private Long targetConceptId;

    @Column(name = "relation_type", nullable = false, length = 32)
    private String relationType;

    @Column(columnDefinition = "TEXT")
    private String expression;

    @Column(length = 256)
    private String description;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}

@Entity
@Table(name = "tool_concept")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ToolConcept {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "tool_id", nullable = false)
    private Long toolId;

    @Column(name = "concept_id", nullable = false)
    private Long conceptId;

    @Column(nullable = false, length = 16)
    private String relation;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
```

---

## 四、核心逻辑

### 4.1 概念扩展算法

```
输入: topK 个工具 (语义检索结果)
输出: 扩展后的工具列表 (原 topK + 概念依赖补齐)

算法:
1. 收集 topK 中每个工具的 CONSUMES 概念 → 得到概念集合 S
2. 对 S 中每个概念，通过 Jena 推理机获取所有子概念（传递性自动展开）
3. 对 S 中每个概念，查询 COMPUTED_FROM 关系，加入依赖的概念
4. 对 S 中每个概念，查询 DERIVED_FROM 关系，加入条件依赖的概念
5. 查询 EQUIVALENT_TO 关系，加入跨系统等价概念（对称+传递自动展开）
6. 查找 PRODUCES 每个扩展概念的工具 → 得到工具集合 T
7. 返回 topK ∪ T（去重，限制总数 ≤ 20）
```

### 4.2 集成到 ToolEmbeddingService

```java
public class ToolEmbeddingService {

    private final OntologyService ontologyService;

    public List<ToolDefinition> search(Long groupId, String query, int topK) {
        List<ToolDefinition> tools = toolDefinitionRepository.findByGroupIdAndStatus(groupId, "ENABLED");
        if (tools.isEmpty()) {
            return Collections.emptyList();
        }

        List<ToolDefinition> topResults;
        if (embeddingModel != null
                && tools.stream().anyMatch(t -> t.getEmbedding() != null && !t.getEmbedding().isEmpty())) {
            topResults = searchByEmbedding(tools, query, topK);
        } else {
            topResults = searchByKeyword(tools, query, topK);
        }

        if (ontologyService.isEnabled()) {
            return ontologyService.expandByConcepts(topResults, 20);
        }

        return topResults;
    }
}
```

---

## 五、UI 设计

### 5.1 设计理念：图编辑代替表单

概念与关系管理不应是机械的表单填写，而应像**在白板上画图**一样直观。采用**图编辑（Graph Canvas）**作为主交互模式：

- 概念 = 画布上的**节点（气泡）**
- 关系 = 节点之间的**连线（箭头）**
- 层级 = 节点之间的**父子嵌套**
- 创建 = 点击空白处**新建节点**，从节点**拖拽出线**连到另一个节点
- 编辑 = 双击节点/连线 **就地编辑**

### 5.2 图编辑主页面

**路由**: `/connect/concepts`

**页面布局**:
```
┌──────────────────────────────────────────────────────────────────────────┐
│  概念本体编辑器                                                             │
│  [HR系统 ▼] [制造系统 ▼] [全部]    [+ 新建概念] [树形视图] [📥 导入本体]      │
├──────────────────────────────────┬───────────────────────────────────────┤
│                                  │                                       │
│   ┌──────┐  PARENT_OF   ┌──────┐│  右侧面板（点击节点/连线后显示）            │
│   │ 员工  │─────────────▶│ 部门  ││                                       │
│   │ 总数  │              │ 人数  ││  ┌─────────────────────────────────┐  │
│   └──┬───┘              └──┬───┘│  │ 概念: 离职比例                     │  │
│      │ PARENT_OF           │    │  │ 描述: 离职人数/员工总数              │  │
│      ▼                     │    │  │ 系统: 全局概念                     │  │
│   ┌──────┐  COMPUTED_FROM  │    │  │                                   │  │
│   │ 离职  │◀───────────────┤    │  │ 关系:                             │  │
│   │ 人数  │                │    │  │ ┌─ COMPUTED_FROM ← 离职人数         │  │
│   └──┬───┘                │    │  │ │  表达式: "a / b"           [✕]   │  │
│      │                    │    │  │ ├─ COMPUTED_FROM ← 员工总数         │  │
│      │ COMPUTED_FROM      │    │  │ │  表达式: "a / b"           [✕]   │  │
│      ▼                    │    │  │ └─ [+ 添加关系]                     │  │
│   ┌──────┐                │    │  │                                   │  │
│   │ 离职  │                │    │  │ 生产工具:                          │  │
│   │ 比例  │                │    │  │ （无，通过计算得出）                  │  │
│   └──────┘                │    │  │                                   │  │
│                           │    │  │ 消费工具:                          │  │
│                           │    │  │ ┌─ generate_hr_report       [✕]   │  │
│      ┌──────────┐         │    │  │ └─ [+ 绑定工具]                    │  │
│      │ 产能利用率 │         │    │  │                                   │  │
│      └────┬─────┘         │    │  └─────────────────────────────────┘  │
│           │ DERIVED_FROM  │    │                                       │
│           ▼               │    │                                       │
│      ┌──────────┐         │    │                                       │
│      │ 产能紧张  │         │    │                                       │
│      │ >90%     │         │    │                                       │
│      └──────────┘         │    │                                       │
│                           │    │                                       │
│   ┌──────┐ EQUIVALENT_TO  │    │                                       │
│   │ MES  │◀─────────────▶ │    │                                       │
│   │合格品│                │    │                                       │
│   └──────┘                │    │                                       │
│                           │    │                                       │
│   ┌──────┐ UPPER_STREAM_OF│    │                                       │
│   │工序A │───────────────▶│    │                                       │
│   │ 产出 │                │    │                                       │
│   └──────┘                │    │                                       │
│                           │    │                                       │
│                     ┌──────┐   │                                       │
│                     │工序B │   │                                       │
│                     │ 投入 │   │                                       │
│                     └──────┘   │                                       │
│                                  │                                       │
│  画布（可拖拽、缩放）              │                                       │
├──────────────────────────────────┴───────────────────────────────────────┤
│  底部栏: 6 个概念 | 8 条关系 | 缩放: 100% | [适配画布] [导出图片]             │
└──────────────────────────────────────────────────────────────────────────┘
```

### 5.3 核心交互操作

#### 5.3.1 新建概念（在画布上加点）

```
操作: 双击画布空白处
效果: 出现一个空节点，光标自动聚焦到名称输入框
      ┌─────────────┐
      │ [输入名称]   │  ← 输入框，回车确认
      └─────────────┘
      
操作: 右键画布空白处 → "新建概念"
效果: 同上，在右键位置创建节点

操作: 点击顶部 [+ 新建概念] 按钮
效果: 在画布中央创建节点
```

#### 5.3.2 建立关系（点与点连线）

连线是核心操作，也是门槛最高的地方。不暴露技术术语，改用**自然语言引导 + 智能推断**。

```
操作: 从一个节点的边缘拖拽出一条线，连到另一个节点
      
      ① 鼠标悬停节点边缘 → 出现连线锚点（小圆点）
      ② 按住锚点拖拽 → 出现跟随鼠标的虚线箭头
      ③ 拖到目标节点上释放 → 弹出自然语言引导面板
      
      ┌──────┐                          ┌──────┐
      │ 离职  │─────── 拖拽中 ────────▶  │ 离职  │
      │ 人数  │       (虚线箭头)          │ 比例  │
      └──────┘                          └──────┘
      
      ④ 释放后弹出引导面板（自然语言，无技术术语）:
      
      ┌─────────────────────────────────────┐
      │  "离职人数" 和 "离职比例" 是什么关系？  │
      │                                     │
      │  ○ 离职比例 包含 离职人数             │
      │    （离职人数是离职比例的一部分）       │
      │                                     │
      │  ● 离职比例 由 离职人数 计算得出       │
      │    （通过公式 / 表达式）               │
      │    公式: [离职人数 / 员工总数_______]  │
      │                                     │
      │  ○ 离职比例 等同于 离职人数           │
      │    （两个概念是同一个东西）             │
      │                                     │
      │  ○ 离职人数 是 离职比例 的前提条件      │
      │    （必须先有离职人数才能算离职比例）    │
      │                                     │
      │  ○ 离职人数 达到条件后变成 离职比例     │
      │    （满足某个条件时触发）               │
      │    条件: [________________________]  │
      │                                     │
      │  ○ 离职人数 的上游产出是 离职比例      │
      │    （工序间传递）                     │
      │                                     │
      │              [取消]  [确定]           │
      └─────────────────────────────────────┘
```

**智能推断**：系统根据两个节点的特征，自动高亮最可能的选项：

| 场景 | 自动推断 | 理由 |
|------|---------|------|
| 两个节点名相似（如"离职人数"→"离职比例"） | 高亮"由...计算得出" | 比例通常由数量算出 |
| 一个节点名包含另一个（如"员工总数"→"部门人数"） | 高亮"包含" | 明显的包含关系 |
| 跨系统节点（如 MES.良品数→QMS.合格品数） | 高亮"等同于" | 跨系统同名概念 |
| 节点名含"产出"→"投入" | 高亮"上游产出" | 工序上下游 |
| 节点名含"紧张"/"异常"等状态词 | 高亮"达到条件后变成" | 条件推导 |

**连线标签**：确定后连线上的标签使用自然语言，而非技术枚举名：

```
┌──────┐   由...计算得出    ┌──────┐
│ 离职  │ ─ ─ ─ ─ ─ ─ ─ ▶  │ 离职  │
│ 人数  │   离职人数/员工总数  │ 比例  │
└──────┘                    └──────┘

┌──────┐      包含       ┌──────┐
│ 员工  │───────────────▶│ 部门  │
│ 总数  │                │ 人数  │
└──────┘                └──────┘

┌──────┐      等同于      ┌──────┐
│ MES  │◀──────────────▶ │ QMS  │
│合格品 │                │合格品 │
└──────┘                └──────┘
```

**自然语言 ↔ 技术枚举映射**（内部使用，用户不可见）：

| 自然语言（界面显示） | 技术枚举（存储） |
|-------------------|----------------|
| "包含" / "属于" | PARENT_OF |
| "由...计算得出" | COMPUTED_FROM |
| "等同于" / "就是" | EQUIVALENT_TO |
| "...的前提条件" | PREREQUISITE_OF |
| "达到条件后变成" | DERIVED_FROM |
| "上游产出" | UPPER_STREAM_OF |

#### 5.3.3 编辑概念

```
操作: 双击节点
效果: 节点名称变为可编辑状态，直接修改

操作: 单击节点 → 右侧面板显示详情
      - 修改名称、描述
      - 拖动到另一个节点上 → 设为父子关系（自动创建 PARENT_OF）
      - 删除（连带删除所有连线）
```

#### 5.3.4 编辑关系

```
操作: 单击连线
效果: 连线高亮，右侧面板显示关系详情（自然语言描述）
      - 修改关系类型（用自然语言选项）
      - 编辑公式/条件
      - 删除关系

操作: 双击连线上的标签
效果: 就地编辑公式或条件表达式
```

#### 5.3.5 建立层级（父子嵌套）

```
操作: 将一个节点拖入另一个节点内部
效果: 自动创建"包含"关系，子节点在父节点内部显示
      
      ┌──────────────────┐
      │ 员工总数          │
      │  ┌──────┐ ┌────┐ │
      │  │ 部门  │ │离职│ │
      │  │ 人数  │ │人数│ │
      │  └──────┘ └────┘ │
      └──────────────────┘
      
      父节点可折叠/展开，折叠时只显示父节点名称和子节点数量
```

#### 5.3.6 画布操作

```
- 滚轮缩放: 放大/缩小画布
- 拖拽空白处: 平移画布
- 框选: 按住 Shift 拖拽矩形框选多个节点
- 右键菜单: 新建概念、居中视图、适配画布
- 快捷键:
    Delete/Backspace → 删除选中节点/连线
    Ctrl+D → 复制选中节点
    Ctrl+Z → 撤销
    Ctrl+Shift+Z → 重做
    F → 聚焦选中节点
```

### 5.4 视觉设计规范

#### 5.4.1 节点样式

```
普通概念节点:
┌──────────────┐
│  🔵 离职人数  │  ← 圆角矩形，浅蓝底色
└──────────────┘

计算概念节点（有 COMPUTED_FROM 关系）:
┌──────────────┐
│  📐 离职比例  │  ← 浅紫底色，计算器图标
└──────────────┘

条件概念节点（有 DERIVED_FROM 关系）:
┌──────────────┐
│  ⚡ 产能紧张  │  ← 浅橙底色，闪电图标
└──────────────┘

全局概念节点:
┌──────────────┐
│  🌐 员工总数  │  ← 浅绿底色，地球图标
└──────────────┘

系统专属概念:
┌──────────────┐
│  📦 良品数   │  ← 灰色底色，包裹图标
│   MES        │
└──────────────┘
```

#### 5.4.2 连线样式

连线上显示自然语言标签，不同类型用不同颜色区分：

```
包含:           ───────────▶  实线，灰色，箭头，标签"包含"
由...计算得出:   ─ ─ ─ ─ ─ ▶  虚线，紫色，箭头，标签"计算得出"，线上标注公式
等同于:         ◀───────▶    实线，绿色，双向箭头，标签"等同于"
前提条件:       ────────▷    实线，橙色，空心三角箭头，标签"前提条件"
达到条件后变成:  ─ ─ ─ ─ ▷    虚线，橙色，空心三角箭头，标签"条件触发"，线上标注条件
上游产出:       ────────▶    实线，蓝色，箭头，标签"上游产出"
工具生产:       ────────▶    实线，黑色，箭头，标签"生产数据"
工具消费:       ────────▶    实线，红色，箭头，标签"使用数据"
```

### 5.5 树形视图（辅助模式）

图编辑是主模式，但保留树形视图作为辅助，方便快速浏览层级结构：

```
操作: 点击顶部 [树形视图] 按钮
效果: 画布切换为树形列表，概念按 PARENT_OF 层级展开

┌──────────────────────────────────────────────────────────────────┐
│  概念管理                          [图编辑视图]  [+ 新建概念]        │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─ 员工总数 (全局概念)                                            │
│  │  ├─ 部门人数                      ──前提条件──▶ 部门列表          │
│  │  │  └─ 部门列表                                               │
│  │  ├─ 离职人数                      ──计算得出──▶ 离职比例          │
│  │  │  └─ 离职比例  公式: "离职人数 / 员工总数"                     │
│  │  ├─ 入职人数                                                 │
│  │  └─ 在职人数                                                 │
│  └─ MES.合格品数                    ──等同于──▶ QMS.合格品数        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

树形视图中的操作:
  - 点击节点 → 图编辑视图聚焦该节点
  - 右键节点 → 编辑、删除、新建子节点
  - 拖拽节点 → 调整层级关系
```

### 5.6 工具绑定面板

在图编辑视图中，选中概念节点后，右侧面板可绑定工具：

```
┌─────────────────────────────────────────┐
│ 概念: 离职人数                           │
│                                         │
│ 生产该概念的工具:                         │
│ ┌─────────────────────────────────────┐ │
│ │ get_resigned_count    离职人员数量    │ │
│ │                          [✕ 解绑]   │ │
│ │ get_resigned_by_dept   按部门离职统计  │ │
│ │                          [✕ 解绑]   │ │
│ └─────────────────────────────────────┘ │
│ [+ 绑定工具] ← 弹出工具选择器             │
│                                         │
│ 消费该概念的工具:                         │
│ ┌─────────────────────────────────────┐ │
│ │ calc_resigned_rate    离职比例计算    │ │
│ │                          [✕ 解绑]   │ │
│ └─────────────────────────────────────┘ │
│ [+ 绑定工具]                             │
└─────────────────────────────────────────┘
```

### 5.7 工具详情页集成

在工具注册/详情页中，新增"概念绑定" Tab，以小型图视图展示该工具的概念关联：

```
┌──────────────────────────────────────────────────────────────────┐
│  ［基本信息］［参数Schema］［概念绑定］［测试］                          │
│                                                                  │
│  工具: get_resigned_count                                        │
│     │                                                            │
│     │ PRODUCES                                                   │
│     ▼                                                            │
│  ┌──────┐  COMPUTED_FROM  ┌──────┐                               │
│  │ 离职  │◀───────────────│ 离职  │                               │
│  │ 人数  │                │ 比例  │                               │
│  └──┬───┘                └──────┘                               │
│     │ PARENT_OF                                                   │
│     ▼                                                            │
│  ┌──────┐                                                       │
│  │ 员工  │                                                       │
│  │ 总数  │                                                       │
│  └──────┘                                                       │
│                                                                  │
│  [+ 绑定概念]  [跳转到完整图编辑]                                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 六、API 设计

### 6.1 概念 CRUD

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/concepts` | 获取概念列表（支持 groupId、keyword 过滤） |
| GET | `/api/v1/concepts/{id}` | 获取概念详情（含关系和工具绑定） |
| POST | `/api/v1/concepts` | 新建概念 |
| PUT | `/api/v1/concepts/{id}` | 更新概念 |
| DELETE | `/api/v1/concepts/{id}` | 删除概念（级联删除绑定和关系） |
| GET | `/api/v1/concepts/tree` | 获取概念树（按 groupId，含关系标注） |

### 6.2 概念关系

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/concepts/{id}/relations` | 获取概念的所有关系 |
| POST | `/api/v1/concepts/{id}/relations` | 新建概念关系 |
| PUT | `/api/v1/concepts/{id}/relations/{relId}` | 更新关系 |
| DELETE | `/api/v1/concepts/{id}/relations/{relId}` | 删除关系 |

### 6.3 工具-概念绑定

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/tools/{toolId}/concepts` | 获取工具绑定的概念 |
| POST | `/api/v1/tools/{toolId}/concepts` | 绑定概念到工具 |
| DELETE | `/api/v1/tools/{toolId}/concepts/{bindId}` | 解绑 |
| GET | `/api/v1/concepts/{conceptId}/tools` | 获取概念关联的工具 |

### 6.4 请求/响应 DTO

```java
public class CreateConceptRequest {
    @NotBlank
    private String name;
    private Long parentId;
    private Long groupId;
    private String description;
}

public class CreateRelationRequest {
    @NotNull
    private Long targetConceptId;
    @NotBlank
    private String relationType;
    private String expression;
    private String description;
}

public class BindToolConceptRequest {
    @NotNull
    private Long conceptId;
    @NotBlank
    private String relation;
}

public class ConceptTreeResponse {
    private Long id;
    private String name;
    private String description;
    private List<RelationInfo> relations;
    private List<ConceptTreeResponse> children;
}

public class RelationInfo {
    private Long id;
    private String relationType;
    private Long targetConceptId;
    private String targetConceptName;
    private String expression;
    private String description;
}
```

---

## 七、使用流程

### 7.1 管理员初始化概念

1. 进入「概念管理」页面（`/connect/concepts`）
2. 根据领域知识创建概念树，如：
   - 员工总数
     - 部门人数
     - 离职人数
     - 入职人数
   - 订单金额
     - 订单数量
     - 客单价
   - 设备状态
     - 运行状态
     - 故障状态
     - 维修状态
3. 概念可指定所属系统，或设为全局概念

### 7.2 管理员定义概念关系

1. 为概念间建立关系，如：
   - 离职比例 COMPUTED_FROM 离职人数, 员工总数（表达式：离职人数/员工总数）
   - OEE COMPUTED_FROM 可用率, 性能率, 质量率（表达式：可用率×性能率×质量率）
   - MES.合格品数 EQUIVALENT_TO QMS.合格品数
   - 产能紧张 DERIVED_FROM 产能利用率（条件：>90%）
   - 工序A产出 UPPER_STREAM_OF 工序B投入
2. 系统自动根据关系类型启用推理特征（传递性、对称性）

### 7.3 管理员绑定工具

1. 进入工具详情页 → 概念绑定 Tab
2. 为每个工具标注：
   - 生产哪些概念（PRODUCES）
   - 消费哪些概念（CONSUMES）
3. 或在概念详情页统一批量绑定

### 7.4 Agent 自动使用

1. 用户提问 → Agent 执行 Tier 2 语义检索
2. ToolEmbeddingService 调用 OntologyService 执行概念扩展
3. Jena 推理机自动推导隐含关系（传递、对称、等价）
4. 补齐依赖工具后放入 prompt（附带计算公式））
5. Agent 一次调用完成组合计算

### 7.5 典型用例

**用例 1：离职比例**

```
前置条件:
  概念: 离职人数、员工总数、部门人数、部门列表、离职比例
  关系: 员工总数 PARENT_OF 部门人数
        部门人数 PREREQUISITE_OF 部门列表
        离职比例 COMPUTED_FROM 离职人数, 员工总数
  绑定: get_resigned_count → PRODUCES → 离职人数
        get_department_headcount → PRODUCES → 部门人数
        get_department_list → PRODUCES → 部门列表

用户: "最近一个月离职比例是多少？"

Agent 流程:
  1. Tier 1: 选定 HR 系统
  2. Tier 2: 语义检索 → [get_resigned_count(0.92), ...]
  3. Jena 推理:
     - 离职比例 COMPUTED_FROM [离职人数, 员工总数]
     - 员工总数 传递展开 → 部门人数
     - 部门人数 PREREQUISITE_OF 展开 → 部门列表
     - PRODUCES 部门人数 → get_department_headcount
     - PRODUCES 部门列表 → get_department_list
  4. 补齐: [get_resigned_count, get_department_headcount, get_department_list]
  5. prompt 附带: "离职比例 = 离职人数 / 员工总数"
  6. Agent 调用 3 个工具 → 计算比例 → 返回结果
```

**用例 2：OEE 计算**

```
前置条件:
  概念: OEE、可用率、性能率、质量率
  关系: OEE COMPUTED_FROM 可用率, 性能率, 质量率
        expression: "可用率 × 性能率 × 质量率"
  绑定: get_availability → PRODUCES → 可用率
        get_performance → PRODUCES → 性能率
        get_quality → PRODUCES → 质量率

用户: "3号产线 OEE 是多少？"

Agent 流程:
  1. Tier 1: 选定 MES 系统
  2. Tier 2: 语义检索 → [get_availability(0.85), get_performance(0.80), get_quality(0.78)]
  3. Jena 推理:
     - OEE COMPUTED_FROM [可用率, 性能率, 质量率]
     - 三个概念的工具均已检索到 → 无需补齐
  4. prompt 附带: "OEE = 可用率 × 性能率 × 质量率"
  5. Agent 调用 3 个工具 → 按公式计算 → 返回结果
```

**用例 3：跨系统等价**

```
前置条件:
  概念: MES.合格品数、QMS.合格品数、合格品率
  关系: MES.合格品数 EQUIVALENT_TO QMS.合格品数
        合格品率 COMPUTED_FROM 合格品数, 总产出数
  绑定: mes.get_output_count → PRODUCES → 总产出数
        qms.get_qualified_count → PRODUCES → QMS.合格品数

用户: "本月合格品率？"（在 MES 系统中提问）

Agent 流程:
  1. Tier 1: 选定 MES 系统
  2. Tier 2: 语义检索 → [mes.get_output_count(0.88), ...]
  3. Jena 推理:
     - 合格品率 COMPUTED_FROM [合格品数, 总产出数]
     - 合格品数 EQUIVALENT_TO QMS.合格品数（对称性自动推导）
     - PRODUCES QMS.合格品数 → qms.get_qualified_count（跨系统工具）
  4. 补齐: [mes.get_output_count, qms.get_qualified_count]
  5. Agent 跨系统调用 MES 和 QMS 工具 → 计算合格品率 → 返回结果
```

---

## 八、实施计划

### Phase 1: 后端核心（本次）

| 任务 | 文件 | 说明 |
|------|------|------|
| 新增 pom.xml 依赖 | `pom.xml` | 添加 Apache Jena 核心依赖 |
| 新增 Concept Entity | `entity/Concept.java` | 概念实体 |
| 新增 ConceptRelation Entity | `entity/ConceptRelation.java` | 概念关系实体 |
| 新增 ToolConcept Entity | `entity/ToolConcept.java` | 工具-概念绑定实体 |
| 新增 ConceptRepository | `repository/ConceptRepository.java` | 概念数据访问 |
| 新增 ConceptRelationRepository | `repository/ConceptRelationRepository.java` | 关系数据访问 |
| 新增 ToolConceptRepository | `repository/ToolConceptRepository.java` | 绑定数据访问 |
| 新增 ConceptService | `service/ConceptService.java` | 概念 CRUD 业务逻辑 |
| 新增 ConceptController | `controller/ConceptController.java` | 概念 API |
| 新增 OntologyService | `service/OntologyService.java` | Jena 内存模型管理 + 推理查询 |
| 改造 ToolEmbeddingService | `service/ToolEmbeddingService.java` | 集成概念扩展逻辑 |
| 种子数据 | `config/PlatformSeedDataInitializer.java` | 内置通用概念 + 关系 |

### Phase 2: 前端 UI（后续）

| 任务 | 文件 | 说明 |
|------|------|------|
| 概念管理页面 | `pages/ConceptPage.tsx` | 概念树形管理 + 关系可视化 |
| 概念详情面板 | `components/ConceptDetail/` | 关系列表 + 工具绑定 |
| 新建关系弹窗 | `components/RelationDialog/` | 选择关系类型 + 目标概念 + 表达式 |
| 工具详情-概念绑定 | 改造 `ToolListPage.tsx` | Tab 新增概念绑定 |
| 绑定/解绑组件 | `components/ConceptBinding/` | 选择概念 + PRODUCES/CONSUMES |

### Phase 3: 自动发现 & 标准本体导入（远期）

| 任务 | 说明 |
|------|------|
| Schema 自动匹配 | 根据 input/output schema 字段名自动匹配概念 |
| 概念推荐 | 新工具创建时推荐可能的概念绑定 |
| 关系推荐 | 基于已有工具绑定，推荐可能的概念间关系 |
| ISA-95 标准本体导入 | 导入设备层级、产能指标等制造运营概念 |
| OPC UA 本体导入 | 导入设备状态、生产计数等设备通信概念 |
| FIBO 本体导入 | 导入组织架构、员工等金融/HR 领域概念 |
| SAREF/QUDT 本体导入 | 导入 IoT 设备模型、计量单位转换概念 |

### Phase 4: Jena TDB 迁移（远期，按需）

| 任务 | 说明 |
|------|------|
| 引入 TDB 依赖 | `pom.xml` 添加 jena-tdb |
| 替换 Model 创建 | `OntModelSpec.OWL_MEM_MICRO_RULE_INF` → `TDBFactory` |
| MySQL 数据同步 | 概念变更时同步写入 TDB |
| 可选：Fuseki 端点 | 提供 SPARQL HTTP 查询接口 |

---

## 九、验收标准

1. 创建概念树，层级关系正确展示，推理机能自动展开传递关系
2. COMPUTED_FROM 关系：检索到目标概念时，自动补齐依赖概念的工具
3. EQUIVALENT_TO 关系：跨系统等价概念能自动发现并补齐跨系统工具
4. DERIVED_FROM 关系：条件依赖的概念在检索时自动加入
5. 离职比例场景：Agent 调用 3 个工具，prompt 附带计算公式，一次完成
6. OEE 场景：Agent 调用 3 个工具，prompt 附带计算公式，一次完成
7. 概念扩展后工具总数不超过 20（防止 prompt 过长）
8. 无概念绑定的工具，检索行为不受影响
9. 概念扩展失败时，不影响原有语义检索逻辑，降级为原结果
10. Jena 内存模型启动时间 < 500ms（概念数 < 500 时）
11. 概念变更（新建/编辑/删除）后，Jena 模型 5 秒内重建完成

---

## 十、技术依赖

### 10.1 Maven 依赖

```xml
<dependency>
    <groupId>org.apache.jena</groupId>
    <artifactId>jena-core</artifactId>
    <version>5.1.0</version>
</dependency>
<dependency>
    <groupId>org.apache.jena</groupId>
    <artifactId>jena-arq</artifactId>
    <version>5.1.0</version>
</dependency>
```

仅需 `jena-core` + `jena-arq` 两个依赖，总共约 6MB，无需引入 TDB、Fuseki 等。

### 10.2 OWL 推理机规格

选用 `OWL_MEM_MICRO_RULE_INF`，特点：
- 内存存储，无需外部服务
- 支持传递性（transitive）、对称性（symmetric）、逆关系（inverse）推理
- 不支持完整的 OWL DL 推理（如基数约束），但本场景不需要
- 推理速度：500 个概念 + 1000 条关系，< 200ms

### 10.3 未来迁移路径

```
当前: OWL_MEM_MICRO_RULE_INF (内存)
  ↓ 概念数 > 1000 或需要跨应用共享
迁移: TDBFactory + OWL_MEM_MICRO_RULE_INF (磁盘持久化)
  ↓ 需要外部查询
可选: Fuseki (SPARQL HTTP 端点)
```

迁移时 OntologyService 的 `init()` 方法只需修改一行：

```java
// 当前
OntModel model = ModelFactory.createOntologyModel(OntModelSpec.OWL_MEM_MICRO_RULE_INF);

// 迁移后
Dataset ds = TDBFactory.createDataset("data/ontology");
OntModel model = ModelFactory.createOntologyModel(OntModelSpec.OWL_MEM_MICRO_RULE_INF, ds.getDefaultModel());
```

上层查询接口（`expandByConcepts`）无需任何修改。

---

## 十一、工业标准本体参考

### 11.1 概述

概念并非只能手动创建。工业领域有大量现成的标准本体（OWL/RDF 格式），可以直接导入 Jena 模型，与本地的概念本体合并使用。Jena 原生支持 OWL/RDF 文件导入，一行代码即可完成。

### 11.2 可导入的标准本体

| 标准 | 覆盖领域 | 规模 | 核心价值 | 官方来源 |
|------|---------|------|---------|---------|
| **ISA-95 / IEC 62264** | 制造运营管理 | 中等 | 设备层级（企业→工厂→产线→设备）、产能定义、物料模型 | ISA 标准文档 |
| **OPC UA** | 工业通信 | 大 | 设备状态（运行/停机/故障）、生产计数（良品/不良/总计）、设备 ID | OPC Foundation |
| **SAREF** | 智慧设备 | 小 | 设备-测量-状态关系模型、IoT 设备通用建模 | ETSI TS 103 264 |
| **QUDT** | 计量单位 | 大 | 物理量纲（温度、压力、速度）、单位转换（℃↔℉、MPa↔psi） | qudt.org |
| **FIBO** | 金融/组织 | 大 | 组织架构、部门、员工、薪酬、合同 | EDM Council |

### 11.3 对标分析

各标准本体对 Luban 场景的覆盖：

**ISA-95（制造运营）—— 最高优先级**

```
ISA-95 设备层级 → 映射到 Luban 概念:
  Enterprise   → 企业
  Site         → 工厂
  Area         → 车间
  WorkCenter   → 产线
  WorkUnit     → 设备

ISA-95 产能模型 → 映射到 Luban 概念:
  Availability → 可用率
  Performance  → 性能率
  Quality      → 质量率
  OEE          → COMPUTED_FROM [可用率, 性能率, 质量率]
```

**OPC UA（设备通信）—— 高优先级**

```
OPC UA 设备状态 → 映射到 Luban 概念:
  Running  → 运行中
  Stopped  → 停机
  Fault    → 故障

OPC UA 生产计数 → 映射到 Luban 概念:
  GoodCount → 良品数
  BadCount  → 不良品数
  TotalCount → 总产出
```

**FIBO（金融/组织）—— 高优先级**

```
FIBO 组织架构 → 映射到 Luban 概念:
  Organization → 公司
  Department   → 部门
  Employee     → 员工
  Position     → 岗位

FIBO 人事指标 → 映射到 Luban 概念:
  Headcount     → 员工总数
  Turnover      → 离职人数
  NewHire       → 入职人数
```

**SAREF（IoT 设备）—— 中优先级**

```
SAREF 核心模型 → 映射到 Luban 概念:
  Device       → 设备
  Measurement  → 测量值
  State        → 设备状态
  Command      → 控制指令
```

**QUDT（计量单位）—— 低优先级**

```
QUDT 单位转换 → 映射到 Luban 概念:
  Temperature  → 温度（℃ ↔ ℉）
  Pressure     → 压力（MPa ↔ psi ↔ bar）
  Speed        → 速度（RPM ↔ m/s）
  Weight       → 重量（kg ↔ lb）
```

### 11.4 导入方式

Jena 原生支持，一行代码导入 OWL/RDF 文件：

```java
// 导入 ISA-95 标准本体
OntModel industryModel = ModelFactory.createOntologyModel(
    OntModelSpec.OWL_MEM_MICRO_RULE_INF
);
industryModel.read("classpath:ontology/isa95-subset.owl");

// 合并到本地概念本体
ontologyModel.addSubModel(industryModel);
```

### 11.5 导入策略

| 阶段 | 策略 | 说明 |
|------|------|------|
| Phase 1 | 内置种子概念 | 参考 ISA-95 + FIBO 结构，手动创建精简版（10-20 个概念） |
| Phase 3 | 按需导入标准本体 | 管理员在 UI 中选择需要导入的标准本体，系统自动合并 |
| 长期 | 社区/行业共享 | 不同企业可导出自己的本体，形成行业模板库 |

### 11.6 导入注意事项

1. **精简导入**：标准本体通常很庞大（OPC UA 有数千个概念），建议只导入子集，避免模型膨胀
2. **命名空间隔离**：不同本体的命名空间天然隔离，不会与本地的概念冲突
3. **关系映射**：导入后需手动将标准概念与本地工具通过 PRODUCES/CONSUMES 绑定
4. **推理兼容**：导入的标准本体中的关系类型需映射到本地的 6 种关系类型，以启用推理特征