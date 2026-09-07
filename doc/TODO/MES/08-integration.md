# 08 集成与权限模块

## 1. 业务目标

提供 MES 与外部系统（ERP/PLM/WMS/SCADA）的双向集成能力，以及多租户、多组织、字段级权限管控，确保数据安全与系统互操作性。

## 2. 功能清单

| 功能 | 说明 | 优先级 |
|------|------|--------|
| ERP 集成 | SAP/用友/金蝶 双向数据同步（订单/BOM/库存/完工反馈） | P0 |
| 开放 API | RESTful API + Webhook，供第三方系统调用 | P0 |
| 多租户隔离 | SaaS 租户数据隔离，租户级配置 | P0 |
| 角色权限 | RBAC 角色权限模型，菜单+按钮+数据范围+字段级 | P0 |
| PLM 集成 | 从 PLM 同步工程 BOM/图纸/工艺变更 | P1 |
| SCADA/设备对接 | OPC UA/Modbus/MTConnect 协议采集设备数据 | P1 |
| 消息通知 | 站内信+邮件+企微+钉钉多通道通知 | P1 |
| 审批流引擎 | 可配置审批流，支持多级审批+会签+或签 | P1 |
| 数据导入导出 | Excel 批量导入主数据，模板管理 | P1 |
| 操作日志 | 关键操作审计日志，支持追溯 | P2 |

## 3. 数据模型

### 3.1 集成配置

```sql
CREATE TABLE integration_channel (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    channel_code    VARCHAR(64)  NOT NULL COMMENT '通道编码',
    channel_name    VARCHAR(128) NOT NULL COMMENT '通道名称',
    channel_type    VARCHAR(32)  NOT NULL COMMENT 'ERP/PLM/WMS/SCADA/THIRD_PARTY',
    adapter_type    VARCHAR(32)  NOT NULL COMMENT 'SAP_IDOC/SAP_ODATA/U8_API/KINGDEE_API/OPC_UA/MODBUS/HTTP/WEBHOOK',
    endpoint_url    VARCHAR(512) NULL COMMENT '端点URL',
    auth_type       VARCHAR(32)  NOT NULL COMMENT 'BASIC/OAUTH2/API_KEY/CERTIFICATE/NONE',
    auth_config     JSON         NULL COMMENT '认证配置(加密存储)',
    sync_mode       VARCHAR(32)  NOT NULL DEFAULT 'EVENT_DRIVEN' COMMENT 'SCHEDULED/EVENT_DRIVEN/MANUAL 定时/事件驱动/手工',
    cron_expression VARCHAR(64)  NULL COMMENT '定时同步Cron',
    retry_count     INT          NOT NULL DEFAULT 3 COMMENT '重试次数',
    retry_interval  INT          NOT NULL DEFAULT 30 COMMENT '重试间隔(秒)',
    timeout_sec     INT          NOT NULL DEFAULT 30 COMMENT '超时(秒)',
    is_enabled      TINYINT      NOT NULL DEFAULT 1,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_channel (channel_code, tenant_id)
) COMMENT '集成通道';

CREATE TABLE integration_mapping (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    channel_id      BIGINT       NOT NULL COMMENT '通道ID',
    direction       VARCHAR(16)  NOT NULL COMMENT 'INBOUND/OUTBOUND 入站/出站',
    business_type   VARCHAR(64)  NOT NULL COMMENT '业务类型，如 SALES_ORDER/BOM/INVENTORY/COMPLETION',
    source_entity   VARCHAR(128) NOT NULL COMMENT '源端实体/接口',
    target_entity   VARCHAR(128) NOT NULL COMMENT '目标端实体/接口',
    field_mapping   JSON         NOT NULL COMMENT '字段映射 [{source:"MATNR",target:"material_code",transform:null}]',
    transform_rule  JSON         NULL COMMENT '转换规则(值映射/计算/拼接)',
    filter_rule     JSON         NULL COMMENT '过滤条件',
    is_enabled      TINYINT      NOT NULL DEFAULT 1,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_channel (channel_id)
) COMMENT '集成字段映射';

CREATE TABLE integration_sync_log (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    channel_id      BIGINT       NOT NULL,
    mapping_id      BIGINT       NOT NULL,
    direction       VARCHAR(16)  NOT NULL,
    sync_type       VARCHAR(32)  NOT NULL COMMENT 'FULL/INCREMENTAL/SINGLE 全量/增量/单条',
    status          VARCHAR(32)  NOT NULL COMMENT 'SUCCESS/PARTIAL_FAILED/FAILED',
    total_count     INT          NOT NULL DEFAULT 0 COMMENT '总记录数',
    success_count   INT          NOT NULL DEFAULT 0,
    fail_count      INT          NOT NULL DEFAULT 0,
    error_detail    TEXT         NULL COMMENT '错误详情(前N条)',
    started_at      DATETIME(3)  NOT NULL,
    completed_at    DATETIME(3)  NULL,
    duration_ms     INT          NULL COMMENT '耗时(毫秒)',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_channel_time (channel_id, started_at)
) COMMENT '同步日志';
```

### 3.2 Webhook

```sql
CREATE TABLE integration_webhook (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    webhook_code    VARCHAR(64)  NOT NULL,
    event_type      VARCHAR(64)  NOT NULL COMMENT '事件类型，如 WORK_ORDER_COMPLETED/INSPECT_RESULT/STOCK_CHANGED',
    callback_url    VARCHAR(512) NOT NULL COMMENT '回调URL',
    secret_key      VARCHAR(128) NOT NULL COMMENT '签名密钥',
    content_type    VARCHAR(32)  NOT NULL DEFAULT 'application/json',
    is_active       TINYINT      NOT NULL DEFAULT 1,
    failure_count   INT          NOT NULL DEFAULT 0 COMMENT '连续失败次数',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_webhook (webhook_code, tenant_id)
) COMMENT 'Webhook订阅';
```

### 3.3 权限模型

```sql
CREATE TABLE auth_role (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    role_code       VARCHAR(64)  NOT NULL COMMENT '角色编码',
    role_name       VARCHAR(128) NOT NULL COMMENT '角色名称',
    role_type       VARCHAR(32)  NOT NULL COMMENT 'SYSTEM/BUILTIN/CUSTOM 系统/内置/自定义',
    description     VARCHAR(256) NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_role (role_code, tenant_id)
) COMMENT '角色';

CREATE TABLE auth_permission (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    permission_code VARCHAR(128) NOT NULL COMMENT '权限编码，如 work_order:create / report:export',
    permission_name VARCHAR(128) NOT NULL COMMENT '权限名称',
    resource_type   VARCHAR(32)  NOT NULL COMMENT 'MENU/BUTTON/API/DATA/FIELD 菜单/按钮/API/数据/字段',
    resource_key    VARCHAR(128) NOT NULL COMMENT '资源标识',
    action          VARCHAR(32)  NOT NULL COMMENT 'READ/CREATE/UPDATE/DELETE/APPROVE/EXPORT',
    parent_id       BIGINT       NULL COMMENT '父权限ID',
    sort_order      INT          NOT NULL DEFAULT 0,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_permission (permission_code, tenant_id)
) COMMENT '权限';

CREATE TABLE auth_role_permission (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    role_id         BIGINT       NOT NULL,
    permission_id   BIGINT       NOT NULL,
    data_scope      VARCHAR(32)  NULL COMMENT 'ALL/PLANT/DEPARTMENT/SELF 数据范围',
    scope_config    JSON         NULL COMMENT '范围配置，如 {plant_ids:[1,2], dept_ids:[3]}',
    field_filter    JSON         NULL COMMENT '字段级过滤，如 {cost:{read:false}}',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_role_perm (role_id, permission_id)
) COMMENT '角色权限关联';

CREATE TABLE auth_user_role (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         VARCHAR(64)  NOT NULL COMMENT '用户ID',
    role_id         BIGINT       NOT NULL,
    plant_id        BIGINT       NULL COMMENT '工厂范围(角色可限定工厂)',
    valid_from      DATE         NULL,
    valid_to        DATE         NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_user (user_id),
    INDEX idx_role (role_id)
) COMMENT '用户角色关联';
```

### 3.4 审批流

```sql
CREATE TABLE approval_flow (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    flow_code       VARCHAR(64)  NOT NULL COMMENT '流程编码',
    flow_name       VARCHAR(128) NOT NULL COMMENT '流程名称',
    business_type   VARCHAR(64)  NOT NULL COMMENT '适用业务类型，如 BOM_APPROVE/SUPPLEMENT_APPROVE/CONCESSION_APPROVE',
    version         INT          NOT NULL DEFAULT 1,
    is_active       TINYINT      NOT NULL DEFAULT 1,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_flow (flow_code, version, tenant_id)
) COMMENT '审批流程';

CREATE TABLE approval_node (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    flow_id         BIGINT       NOT NULL,
    node_code       VARCHAR(32)  NOT NULL COMMENT '节点编码',
    node_name       VARCHAR(64)  NOT NULL COMMENT '节点名称',
    node_type       VARCHAR(32)  NOT NULL COMMENT 'START/APPROVE/COUNTERSIGN/OR_SIGN/AUTO_PASS/END 发起/审批/会签/或签/自动通过/结束',
    approver_type   VARCHAR(32)  NULL COMMENT 'FIXED_USER/ROLE/INITIATOR_MANAGER 固定人/角色/发起人主管',
    approver_config JSON         NULL COMMENT '审批人配置，如 {user_ids:["u1"], role_code:"qc_manager"}',
    timeout_hours   INT          NULL COMMENT '超时时间(小时)',
    timeout_action  VARCHAR(32)  NULL COMMENT 'AUTO_PASS/ESCALATE 自动通过/升级',
    sort_order      INT          NOT NULL DEFAULT 0,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_flow (flow_id)
) COMMENT '审批节点';

CREATE TABLE approval_instance (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    flow_id         BIGINT       NOT NULL,
    business_type   VARCHAR(64)  NOT NULL,
    business_id     BIGINT       NOT NULL,
    business_no     VARCHAR(64)  NOT NULL COMMENT '业务单据号',
    initiator_id    VARCHAR(64)  NOT NULL COMMENT '发起人',
    current_node_id BIGINT       NULL COMMENT '当前节点',
    status          VARCHAR(32)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/APPROVED/REJECTED/CANCELLED',
    completed_at    DATETIME(3)  NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_business (business_type, business_id),
    INDEX idx_initiator (initiator_id, status)
) COMMENT '审批实例';

CREATE TABLE approval_action_log (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    instance_id     BIGINT       NOT NULL,
    node_id         BIGINT       NOT NULL,
    approver_id     VARCHAR(64)  NOT NULL,
    action          VARCHAR(32)  NOT NULL COMMENT 'APPROVE/REJECT/DELEGATE/WITHDRAW 审批/驳回/委派/撤回',
    comment         VARCHAR(512) NULL,
    action_time     DATETIME(3)  NOT NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_instance (instance_id)
) COMMENT '审批操作日志';
```

### 3.5 消息通知

```sql
CREATE TABLE notification_template (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    template_code   VARCHAR(64)  NOT NULL,
    template_name   VARCHAR(128) NOT NULL,
    event_type      VARCHAR(64)  NOT NULL COMMENT '触发事件类型',
    channel         VARCHAR(32)  NOT NULL COMMENT 'IN_APP/EMAIL/WECHAT/DINGTALK/SMS',
    title_template  VARCHAR(256) NOT NULL COMMENT '标题模板，如 工单{order_no}已下达',
    body_template   TEXT         NOT NULL COMMENT '内容模板，支持变量替换',
    is_enabled      TINYINT      NOT NULL DEFAULT 1,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_template (template_code, tenant_id)
) COMMENT '通知模板';

CREATE TABLE notification_record (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    template_id     BIGINT       NOT NULL,
    recipient_id    VARCHAR(64)  NOT NULL,
    channel         VARCHAR(32)  NOT NULL,
    title           VARCHAR(256) NOT NULL,
    body            TEXT         NOT NULL,
    status          VARCHAR(32)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/SENT/READ/FAILED',
    sent_at         DATETIME(3)  NULL,
    read_at         DATETIME(3)  NULL,
    business_type   VARCHAR(64)  NULL,
    business_id     BIGINT       NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_recipient (recipient_id, status),
    INDEX idx_business (business_type, business_id)
) COMMENT '通知记录';
```

### 3.6 操作审计

```sql
CREATE TABLE audit_log (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         VARCHAR(64)  NOT NULL,
    user_name       VARCHAR(128) NOT NULL,
    action          VARCHAR(32)  NOT NULL COMMENT 'CREATE/UPDATE/DELETE/APPROVE/EXPORT/LOGIN',
    resource_type   VARCHAR(64)  NOT NULL COMMENT '资源类型，如 WORK_ORDER/INSPECTION_ORDER',
    resource_id     BIGINT       NULL,
    resource_no     VARCHAR(64)  NULL COMMENT '业务单据号',
    change_detail   JSON         NULL COMMENT '变更详情 {before:{...}, after:{...}}',
    ip_address      VARCHAR(64)  NULL,
    user_agent      VARCHAR(256) NULL,
    duration_ms     INT          NULL COMMENT '操作耗时(毫秒)',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_user_time (user_id, created_at),
    INDEX idx_resource (resource_type, resource_id),
    INDEX idx_time (created_at)
) COMMENT '操作审计日志';
```

## 4. 核心业务流程

### 4.1 ERP 集成数据流

```
┌─────────────── ERP ───────────────┐
│                                    │
│  出站(MES→ERP):                    │
│  工单完工 → 完工反馈(数量/工时/消耗) │
│  物料出入库 → 库存同步              │
│  检验结果 → 质量数据回写            │
│                                    │
│  入站(ERP→MES):                    │
│  销售订单 → 需求池                  │
│  BOM/工艺路线变更 → 主数据更新       │
│  采购订单 → 收货通知                │
│  物料主数据变更 → 物料同步           │
│                                    │
└────────────────────────────────────┘
```

### 4.2 审批流程

```
业务操作触发(如BOM提交审批)
    │
    ▼
查找匹配的审批流程(业务类型+版本)
    │
    ▼
创建审批实例，定位到首个审批节点
    │
    ▼
通知审批人
    │
    ▼
审批人操作:
    ├── APPROVE → 流转至下一节点
    │         └── 末节点审批通过 → 更新业务单据状态
    ├── REJECT → 流程终止，业务单据回退
    ├── DELEGATE → 委派他人审批
    └── 超时 → 按配置自动通过或升级通知
```

## 5. 核心业务规则

| 编号 | 规则 | 说明 |
|------|------|------|
| I-R001 | 租户数据隔离 | 所有业务查询必须带 tenant_id 条件，禁止跨租户访问 |
| I-R002 | 集成失败重试 | 同步失败后按 retry_count 和 retry_interval 自动重试 |
| I-R003 | Webhook 签名验证 | 出站 Webhook 使用 HMAC-SHA256 签名，接收方必须验签 |
| I-R004 | 权限校验前置 | 所有 API 请求必须经过权限拦截器校验，无权限返回 403 |
| I-R005 | 数据范围过滤 | 查询结果按角色的 data_scope 过滤（ALL/PLANT/DEPT/SELF） |
| I-R006 | 字段级权限 | field_filter 中标记不可见的字段在返回结果中脱敏或移除 |
| I-R007 | 审批不可跳级 | 审批必须按节点顺序流转，不可跳过中间节点 |
| I-R008 | 审计日志不可删 | audit_log 为只追加表，不允许 UPDATE/DELETE |
| I-R009 | 敏感配置加密 | auth_config、secret_key 等敏感字段必须加密存储 |
| I-R010 | 同步幂等性 | 集成同步操作必须幂等，重复调用不产生副作用 |

## 6. 接口清单

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/integration/channels | 集成通道列表 |
| POST | /api/v1/integration/channels | 创建集成通道 |
| POST | /api/v1/integration/channels/{id}/test | 测试连接 |
| POST | /api/v1/integration/sync | 手动触发同步 |
| GET | /api/v1/integration/sync-logs | 同步日志查询 |
| GET | /api/v1/webhooks | Webhook 列表 |
| POST | /api/v1/webhooks | 创建 Webhook |
| GET | /api/v1/roles | 角色列表 |
| POST | /api/v1/roles | 创建角色 |
| PUT | /api/v1/roles/{id}/permissions | 配置角色权限 |
| GET | /api/v1/permissions | 权限树 |
| GET | /api/v1/approval/instances | 审批实例列表 |
| POST | /api/v1/approval/instances/{id}/approve | 审批通过 |
| POST | /api/v1/approval/instances/{id}/reject | 审批驳回 |
| GET | /api/v1/notifications | 通知列表 |
| PUT | /api/v1/notifications/{id}/read | 标记已读 |
| GET | /api/v1/audit-logs | 审计日志查询 |

## 6. 使用对象

| 角色 | 说明 | 使用频率 |
|------|------|---------|
| **IT 管理员** | 集成通道配置、Webhook管理、同步监控、权限分配 | 首次部署+低频维护 |
| **系统管理员** | 角色管理、审批流配置、通知模板配置 | 低频配置 |
| **所有用户** | 接收通知、审批操作、查看审计日志 | 日常被动使用 |
| **部门经理** | 审批操作（BOM审批/工艺路线审批/让步接收审批等） | 日常中频 |
| **IT 运维** | 同步异常排查、日志分析、连接测试 | 异常时高频 |

## 7. 使用场景

### 场景 1：ERP 集成配置（首次部署）

| 项目 | 内容 |
|------|------|
| **触发时间** | 系统首次部署，需要与ERP建立数据同步 |
| **前提条件** | ERP侧已开放API接口，网络已打通 |
| **操作人** | IT 管理员 |
| **步骤** | ① 进入「集成管理 → 通道配置」 → ② 新建ERP通道（选择ERP类型：SAP/Oracle/金蝶/用友） → ③ 配置连接参数（URL/AppKey/AppSecret） → ④ 测试连接 → ⑤ 配置同步映射（ERP物料编码↔MES物料编码） → ⑥ 配置同步策略（实时/定时+方向） → ⑦ 激活通道 |
| **关键** | 首次同步建议全量拉取，后续增量同步 |

### 场景 2：同步异常处理

| 项目 | 内容 |
|------|------|
| **触发时间** | 同步任务失败（网络超时/数据格式错误/ERP侧异常） |
| **前提条件** | 同步日志中出现失败记录 |
| **操作人** | IT 运维 |
| **步骤** | ① 查看同步日志，定位失败记录 → ② 查看错误详情（响应码+错误消息） → ③ 修复问题（网络/数据/配置） → ④ 手动重试失败记录 → ⑤ 确认同步成功 |

### 场景 3：审批操作

| 项目 | 内容 |
|------|------|
| **触发时间** | 业务单据提交审批时（BOM/工艺路线/让步接收/盘盈盘亏等） |
| **前提条件** | 审批流已配置，当前用户是审批节点负责人 |
| **操作人** | 部门经理/质量主管/车间主任 |
| **步骤** | ① 收到审批通知（APP/钉钉/邮件） → ② 查看审批详情 → ③ 通过/驳回（驳回需填写原因） → ④ 系统流转至下一节点或回退至提交人 |

### 场景 4：权限配置

| 项目 | 内容 |
|------|------|
| **触发时间** | 新员工入职/角色变更/新模块上线 |
| **前提条件** | 角色和权限树已定义 |
| **操作人** | 系统管理员 |
| **步骤** | ① 进入「权限管理 → 角色管理」 → ② 选择角色 → ③ 配置菜单权限+按钮权限+数据范围 → ④ 保存 → ⑤ 将用户分配至角色 |

## 8. 使用方法

### 8.1 集成通道配置

1. 进入「集成管理 → 通道配置」
2. 点击「新建通道」，选择系统类型
3. 填写连接参数（URL/认证信息/超时设置）
4. 点击「测试连接」验证
5. 配置数据映射和同步策略
6. 激活通道，查看同步日志确认数据流通

### 8.2 审批操作

1. 收到审批通知（多渠道推送）
2. 进入「审批中心」或点击通知链接
3. 查看单据详情
4. 通过：点击「审批通过」
5. 驳回：点击「审批驳回」+填写驳回原因
6. 审批结果自动流转

### 8.3 权限管理

1. 进入「权限管理 → 角色管理」
2. 新建/编辑角色
3. 在权限树中勾选：菜单权限+按钮权限
4. 配置数据范围（本人/本部门/本部门及下级/全部）
5. 保存角色
6. 在「用户管理」中将用户绑定角色

## 9. UI 示意

### 9.1 集成通道配置

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  集成管理 > 通道配置                                                          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─ ERP-SAP ────────────────────────────────────────────────────────────┐    │
│  │ 类型: SAP S/4HANA  状态: 🟢 已连接  同步: 实时                       │    │
│  │ 上次同步: 2025-09-05 10:30:00  成功:1250  失败:3                    │    │
│  │ [编辑] [测试连接] [同步日志] [停用]                                   │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─ WMS-黑湖 ───────────────────────────────────────────────────────────┐    │
│  │ 类型: 黑湖WMS  状态: 🟢 已连接  同步: 定时(5min)                     │    │
│  │ 上次同步: 2025-09-05 10:25:00  成功:860  失败:0                     │    │
│  │ [编辑] [测试连接] [同步日志] [停用]                                   │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─ SCADA ──────────────────────────────────────────────────────────────┐    │
│  │ 类型: OPC-UA  状态: 🟡 未配置  同步: —                               │    │
│  │ [配置] [测试连接]                                                     │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  [+ 新建通道]                                                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 权限配置

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  权限管理 > 角色管理 > 编辑角色: 车间主任                                      │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─ 菜单权限 ───────────────────────────────────────────────────────────┐    │
│  │ ☑ 基础数据      ☑ 查看  ☐ 编辑  ☐ 删除                            │    │
│  │ ☑ 计划排程      ☑ 查看  ☐ 编辑  ☐ 删除                            │    │
│  │ ☑ 生产执行      ☑ 查看  ☑ 编辑  ☐ 删除                            │    │
│  │   ☑ 工单进度    ☑ 查看  ☑ 编辑                                    │    │
│  │   ☑ 派工管理    ☑ 查看  ☑ 编辑                                    │    │
│  │   ☐ 返工管理    ☐ 查看  ☐ 编辑                                    │    │
│  │ ☑ 质量管理      ☑ 查看  ☐ 编辑  ☐ 删除                            │    │
│  │ ☑ 设备管理      ☑ 查看  ☐ 编辑  ☐ 删除                            │    │
│  │ ☑ 数据平台      ☑ 查看  ☐ 编辑  ☐ 删除                            │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─ 数据范围 ───────────────────────────────────────────────────────────┐    │
│  │ ○ 本人  ● 本部门  ○ 本部门及下级  ○ 全部                           │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  [保存]  [取消]                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 9.3 审批中心

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  审批中心  待审: 5  已审: 128                                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│  [待我审批]  [我已审批]  [我发起的]                                            │
├──────┬──────────┬──────────┬──────────┬──────────┬──────────────────────────┤
│ 编号  │ 类型      │ 标题      │ 提交人   │ 提交时间  │ 操作                    │
├──────┼──────────┼──────────┼──────────┼──────────┼──────────────────────────┤
│ AP001│ BOM审批   │ 伺服电机V2│ 王工     │ 09/05 09:30│ [详情][通过][驳回]    │
│ AP002│ 工艺审批   │ 驱动模组  │ 李工     │ 09/05 08:15│ [详情][通过][驳回]    │
│ AP003│ 让步接收   │ 批次B0903 │ 张检     │ 09/04 16:00│ [详情][通过][驳回]    │
│ AP004│ 盘亏审批   │ 铜端子-2  │ 赵仓     │ 09/04 15:30│ [详情][通过][驳回]    │
│ AP005│ 返工审批   │ WO002返工 │ 刘班     │ 09/04 14:00│ [详情][通过][驳回]    │
├──────┴──────────┴──────────┴──────────┴──────────┴──────────────────────────┤
│  共 5 条待审批                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```