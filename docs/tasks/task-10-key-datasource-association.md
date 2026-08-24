# Task-10: 应用绑 KEY + KEY 关联数据源

## 涉及页面

| 页面 | 类型 | 说明 |
|------|------|------|
| `ApiKeyPage.tsx` | 修改 | 新增"数据源权限"Tab 或面板 |
| 应用管理页面（如有） | 修改 | 新增"关联 KEY"功能 |

## 新增页面

无

## 具体开发工作

### 后端

| 文件 | 工作内容 |
|------|----------|
| 新建 `ApiKeyDatasource.java` | 实体，表名 `api_key_datasource`，字段：`id`、`apiKeyId`、`datasourceId`、`status`（PENDING/APPROVED/REJECTED）、`requestedBy`、`approvedBy`、`createdAt`、`approvedAt` |
| 新建 `ApiKeyDatasourceRepository.java` | JPA Repository，支持按 apiKeyId 查询、按 datasourceId 查询、按状态查询 |
| 新建 `ApplicationApiKey.java` | 实体，表名 `application_api_key`，字段：`id`、`applicationId`、`apiKeyId`、`createdAt` |
| 新建 `ApplicationApiKeyRepository.java` | JPA Repository，支持按 applicationId 查询、按 apiKeyId 查询 |
| `ApiKeyService.java` | 新增方法：<br/>  1. `requestDatasourcePermission(keyId, datasourceId)`：申请数据源权限，状态 PENDING<br/>  2. `approveDatasourcePermission(id)`：审批通过，状态 APPROVED<br/>  3. `rejectDatasourcePermission(id)`：审批拒绝，状态 REJECTED<br/>  4. `listKeyDatasources(keyId)`：查询 KEY 的数据源列表<br/>  5. `bindApplicationApiKey(applicationId, apiKeyId)`：应用绑定 KEY<br/>  6. `listApplicationApiKeys(applicationId)`：查询应用关联的 KEY 列表 |
| `ApiKeyController.java` | 新增接口：<br/>  - `POST /api/v1/api-keys/{keyId}/request-datasource`：申请数据源权限<br/>  - `GET /api/v1/api-keys/{keyId}/datasources`：查询 KEY 的数据源列表<br/>  - `POST /api/v1/api-keys/datasource-permission/{id}/approve`：审批通过<br/>  - `POST /api/v1/api-keys/datasource-permission/{id}/reject`：审批拒绝<br/>  - `POST /api/v1/api-keys/{keyId}/bind-application/{applicationId}`：绑定应用<br/>  - `GET /api/v1/api-keys/applications/{applicationId}/keys`：查询应用的 KEY 列表 |
| 新建 `ApiKeyAuthFilter.java` | KEY 鉴权过滤器：<br/>  1. 从请求头提取 KEY（`X-Api-Key` 或 `Authorization: Bearer xxx`）<br/>  2. 校验 KEY 状态（ACTIVE/REVOKED）<br/>  3. 校验 KEY 对目标资源（工具/数据源）的权限<br/>  4. 无权限或 KEY 无效 → 返回 401/403 |
| `QueryService.java` | 执行查询前校验 KEY 对数据源的权限 |
| `ToolExecutor.java` | 执行工具前校验 KEY 对工具的权限 |

### 前端

| 文件 | 工作内容 |
|------|----------|
| `ApiKeyPage.tsx` | 1. 新增"数据源权限"Tab 或面板<br/>2. 展示已申请的数据源列表（状态 + 操作）<br/>3. 新增"申请数据源权限"按钮 → 弹出数据源选择器<br/>4. 审批操作（通过/拒绝） |
| 应用管理页面（如有） | 1. 应用详情页新增"关联 KEY"功能<br/>2. 展示已关联的 KEY 列表<br/>3. 新增"绑定 KEY"按钮 → 弹出 KEY 选择器 |

### 数据模型

```
Application ──┬── ApplicationApiKey ──┬── ApiKey
              │   (application_id,    │   (id, key, status)
              │    api_key_id)        │
              │                      ├── ApiKeyTool
              │                      │   (api_key_id, tool_id, status)
              │                      │
              │                      └── ApiKeyDatasource (NEW)
              │                          (api_key_id, datasource_id, status)
              │
              └── Query
                  (application_id, datasource_id, sql, ...)
```

### 开发模块完整链路

```
开发者创建 Application
  → 绑定 KEY（ApplicationApiKey）
  → 为 KEY 申请 API 权限（ApiKeyTool）→ 超管审批
  → 为 KEY 申请数据源权限（ApiKeyDatasource）→ 超管审批
  → 开发者应用通过 KEY 调用 API 或查询数据源
  → ApiKeyAuthFilter 校验 KEY 权限
  → ToolExecutor / QueryService 校验资源权限
  → 通过 → 执行
```

## 最终目标

开发模块完整支持 KEY 权限体系：应用绑 KEY → KEY 申请 API 和数据源权限 → 超管审批 → 鉴权过滤器校验 → 资源执行层校验，形成完整的开发资源访问控制链路。