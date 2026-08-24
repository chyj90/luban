# Task-02: 语义层扩展

## 涉及页面

无（纯后端改动）

## 新增页面

无

## 具体开发工作

### 后端

| 文件 | 工作内容 |
|------|----------|
| `OntologyService.java` | 1. 新增 `analyzeContext(conceptIds: List<Long>, question: String)` 方法，作为语义层统一出口<br/>2. 整合概念关系查询（ConceptRelation）：含扩展深度控制（1 跳必扩展、2 跳仅扩展 N:1/1:N、3 跳不扩展，总概念数上限 20）<br/>3. 整合工具绑定查询（ToolConcept）：概念路径（主）+ 工具向量路径（辅），总 API 上限 15<br/>4. 整合字段映射查询（ConceptMapping）：获取表名、字段名、字段类型<br/>5. 整合 JOIN 映射查询（ConceptJoinMapping）：获取 JOIN 条件、JOIN 类型<br/>6. 返回统一上下文对象：`{ concepts, apiTools, tableMappings, joinMappings, relations }` |
| `FaissService.java` | 确认 `search(embedding, topK)` 方法可用，支持批量概念检索 |
| `ToolEmbeddingService.java` | 确认 `search(groupId, embedding, topK)` 方法可用，作为工具向量检索补充路径 |

### 核心逻辑

```
question → FaissService.search(embedding, topK=10) → 概念列表
   → OntologyService.analyzeContext(conceptIds, question)
       ├─ 1 跳邻居：必扩展（Tutor → Student, Course）
       ├─ 2 跳邻居：仅扩展 N:1 或 1:N（Student → Class ✓, Student → Hobby ✗）
       ├─ 3 跳及以上：不扩展
       ├─ 总概念数 ≤ 20
       ├─ 概念路径取 ToolConcept → API 列表
       ├─ 工具向量路径补充遗漏 → 合并去重
       ├─ 总 API 数 ≤ 15
       └─ 取 ConceptMapping + ConceptJoinMapping → 表结构
   → 输出统一上下文
```

## 关于扩展深度的配置

扩展深度参数通过配置文件控制，不硬编码：

```yaml
semantic:
  expansion:
    max-depth: 2            # 最大扩展深度
    max-concepts: 20        # 总概念数上限
    max-api-tools: 15       # 总 API 工具数上限
    extend-nm-relations: false  # 是否扩展 N:M 关系
```

## 最终目标

`OntologyService.analyzeContext()` 成为语义层统一入口，一次调用返回 LLM 所需的全部上下文（概念、API 工具、表结构、JOIN 条件），控制上下文大小防止爆炸。