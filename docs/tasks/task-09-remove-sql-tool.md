# Task-09: 删除 SQL 工具类型

## 涉及页面

| 页面 | 类型 | 说明 |
|------|------|------|
| `ToolListPage.tsx` | 修改 | 删除 SQL 工具创建/编辑 UI，删除 SQL 类型标签显示 |
| `ConceptEditorPage.tsx` | 修改 | 工具选择弹窗中不再出现 SQL 类型工具 |

## 新增页面

无

## 具体开发工作

### 后端

| 文件 | 工作内容 |
|------|----------|
| `ToolDefinition.java` | 校验逻辑修改：创建/更新工具时，拒绝 `toolType = "SQL"`，只允许 `"HTTP"`（MCP_PASSTHROUGH 是否保留需用户确认） |
| `ToolService.java` | `createTool()` 和 `updateTool()` 方法中增加类型校验：`if ("SQL".equals(toolType)) throw new BusinessException("SQL 工具类型已废弃")` |
| 数据库迁移脚本 | 处理已有 SQL 工具数据：<br/>  - 若有 SQL 工具 → 决定删除或标记为废弃（`status = 'DEPRECATED'`）<br/>  - 若有 SQL 工具关联的 ToolConcept → 清理关联数据<br/>  - 若有 SQL 工具关联的 ApiKeyTool → 清理关联数据 |

### 前端

| 文件 | 工作内容 |
|------|----------|
| `ToolListPage.tsx` | 1. 删除 `TOOL_TYPE_LABELS` 中的 `SQL: 'SQL 查询'`<br/>2. 删除创建/编辑工具时 SQL 类型的配置表单（约 80 行代码）<br/>3. 工具类型筛选器中移除 SQL 选项<br/>4. 列表中的类型标签不再显示 SQL 类型 |
| `ConceptEditorPage.tsx` | 工具选择弹窗中过滤掉 SQL 类型工具，只展示 HTTP 类型 |

### 待确认项

| 问题 | 选项 | 建议 |
|------|------|------|
| MCP_PASSTHROUGH 是否保留 | 保留 / 删除 | 暂保留，后续根据实际使用情况决定 |
| 已有 SQL 工具数据如何处理 | 删除 / 标记废弃 | 标记废弃（保留数据，不从代码层面可用） |

## 最终目标

工具管理只维护 HTTP API 类型，SQL 工具类型从创建、编辑、列表、选择弹窗中完全移除，数据库已有 SQL 工具标记为废弃。