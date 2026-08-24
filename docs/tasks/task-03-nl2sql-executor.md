# Task-03: NL2SQL 执行器 + 安全加固

## 涉及页面

无（纯后端改动）

## 新增页面

无

## 具体开发工作

### 后端

| 文件 | 工作内容 |
|------|----------|
| `SqlSecurityValidator.java` | 1. 保留现有校验：禁止非 SELECT、禁止危险操作（DROP/ALTER/TRUNCATE/CREATE）、禁止危险函数（SLEEP/BENCHMARK/LOAD_FILE）、禁止注释注入、SQL 长度 ≤ 4096、表访问权限校验、数据源状态校验<br/>2. **新增执行层资源限制**：<br/>   - 执行超时 30 秒（JDBC Statement.setQueryTimeout）<br/>   - 返回行数上限 1000（自动追加 LIMIT 1000，若 LLM 未加）<br/>   - 结果集内存上限 10MB（序列化后超限则截断，标记 truncated=true）<br/>3. **新增独立连接池**：NL2SQL 查询使用独立连接池（max 5 连接），不跟业务查询混用 |
| `AgentService.java` | 新增 `executeNl2sql()` 方法：<br/>  1. 从 LLM 响应中提取 sql、concept_ids<br/>  2. 调用 `SqlSecurityValidator.validate()` 校验<br/>  3. 校验通过 → 执行 SQL（带资源限制）<br/>  4. 校验失败 → 抛出安全异常，回 agent 告知用户<br/>  5. 返回 `{ answer, conceptTrace, sql, data, executed, truncated }` |

### 三层防护总结

```
第一层：RBAC 权限过滤
  → 无权限的概念不进入 prompt，LLM 看不到

第二层：SqlSecurityValidator
  → 即使 LLM 生成了恶意 SQL，SQL 层面拦截

第三层：执行资源限制
  → 即使 SQL 合法，也不会拖垮数据库（超时/行数/内存上限）
```

## 最终目标

NL2SQL 执行器只做校验 + 执行（SQL 由 LLM 在一次调用中直接生成），三层防护确保 SQL 安全性，资源限制防止数据库被拖垮。