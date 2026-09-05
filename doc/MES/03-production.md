# 03 生产执行模块

## 1. 业务目标

实现工单在车间的执行过程数字化，包括派工、报工、工序流转、返工/补料、进度采集，确保生产现场信息实时透明，数据从工单→工序→报工→物料→质量全链路贯通。

## 2. 功能清单

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 工单派工 | 将工单工序分配给具体人员/设备/工位 | P0 |
| 扫码报工 | 一线工人扫码开工/完工/报异常，移动端优先 | P0 |
| 工序流转 | 工序完工后自动流转至下工序，含并行工序同步 | P0 |
| 返工流程 | 不良品判定后创建返工工单，指定返工工序路线 | P0 |
| 补料/补料 | 生产过程中缺料时申请补料，关联工单工序 | P0 |
| 异常上报 | 停机/缺料/质量异常实时上报，触发通知与处理流程 | P0 |
| 生产采集 | 工序参数采集（温度/压力/速度等），支持设备直连 | P1 |
| 工单拆分/合并 | 大工单拆分为多个子工单，或多个小工单合并执行 | P1 |
| 外协管理 | 外协工序发料/收货/质检闭环 | P1 |
| 电子签名 | 关键操作（开工/完工/检验）需电子签名确认 | P1 |

## 3. 数据模型

### 3.1 派工与报工

```sql
CREATE TABLE prod_dispatch (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    dispatch_no     VARCHAR(64)  NOT NULL COMMENT '派工单号',
    order_id        BIGINT       NOT NULL COMMENT '工单ID',
    order_op_id     BIGINT       NOT NULL COMMENT '工单工序ID',
    op_seq          INT          NOT NULL COMMENT '工序序号',
    op_name         VARCHAR(128) NOT NULL COMMENT '工序名称',
    work_center_id  BIGINT       NOT NULL COMMENT '工作中心',
    station_id      BIGINT       NULL COMMENT '工位',
    equipment_id    BIGINT       NULL COMMENT '设备',
    worker_id       VARCHAR(64)  NOT NULL COMMENT '操作人员用户ID',
    dispatch_qty    DECIMAL(12,2) NOT NULL COMMENT '派工数量',
    completed_qty   DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '已完工数量',
    scrapped_qty    DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '报废数量',
    planned_start   DATETIME(3)  NULL COMMENT '计划开始',
    planned_end     DATETIME(3)  NULL COMMENT '计划结束',
    status          VARCHAR(32)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/IN_PROGRESS/COMPLETED/CANCELLED',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_dispatch_no (dispatch_no, tenant_id),
    INDEX idx_order_op (order_id, order_op_id),
    INDEX idx_worker (worker_id, status)
) COMMENT '派工单';

CREATE TABLE prod_report (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    report_no       VARCHAR(64)  NOT NULL COMMENT '报工记录号',
    dispatch_id     BIGINT       NOT NULL COMMENT '派工单ID',
    order_id        BIGINT       NOT NULL COMMENT '工单ID',
    order_op_id     BIGINT       NOT NULL COMMENT '工单工序ID',
    op_seq          INT          NOT NULL COMMENT '工序序号',
    report_type     VARCHAR(32)  NOT NULL COMMENT 'START/COMPLETE/SCRAP/REWORK 开工/完工/报废/返工',
    report_qty      DECIMAL(12,2) NOT NULL COMMENT '报工数量',
    good_qty        DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '合格数量',
    scrap_qty       DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '报废数量',
    rework_qty      DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '返工数量',
    worker_id       VARCHAR(64)  NOT NULL COMMENT '报工人',
    station_id      BIGINT       NULL COMMENT '工位',
    equipment_id    BIGINT       NULL COMMENT '设备',
    shift_id        BIGINT       NULL COMMENT '班次',
    start_time      DATETIME(3)  NULL COMMENT '开工时间',
    end_time        DATETIME(3)  NULL COMMENT '完工时间',
    elapsed_min     DECIMAL(10,2) NULL COMMENT '实际耗时(分钟)',
    batch_no        VARCHAR(64)  NULL COMMENT '生产批次号',
    lot_no          VARCHAR(64)  NULL COMMENT '炉批号(同一炉次)',
    remarks         VARCHAR(512) NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_report_no (report_no, tenant_id),
    INDEX idx_dispatch (dispatch_id),
    INDEX idx_order (order_id),
    INDEX idx_time (created_at)
) COMMENT '报工记录';

CREATE TABLE prod_report_param (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    report_id       BIGINT       NOT NULL COMMENT '报工记录ID',
    param_code      VARCHAR(64)  NOT NULL COMMENT '参数代码',
    param_name      VARCHAR(128) NOT NULL COMMENT '参数名称',
    param_unit      VARCHAR(32)  NULL COMMENT '单位',
    param_value     VARCHAR(128) NOT NULL COMMENT '实际值',
    standard_value  VARCHAR(128) NULL COMMENT '标准值',
    lower_limit     VARCHAR(128) NULL COMMENT '下限',
    upper_limit     VARCHAR(128) NULL COMMENT '上限',
    is_out_of_spec  TINYINT      NOT NULL DEFAULT 0 COMMENT '是否超差',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_report (report_id)
) COMMENT '报工参数采集';
```

### 3.2 工序流转

```sql
CREATE TABLE prod_op_transfer (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT       NOT NULL COMMENT '工单ID',
    from_op_id      BIGINT       NOT NULL COMMENT '来源工序ID',
    to_op_id        BIGINT       NOT NULL COMMENT '目标工序ID',
    transfer_qty    DECIMAL(12,2) NOT NULL COMMENT '流转数量',
    transfer_type   VARCHAR(32)  NOT NULL COMMENT 'NORMAL/REWORK/SPLIT 正常/返工/拆分',
    batch_no        VARCHAR(64)  NULL COMMENT '批次号',
    operator_id     VARCHAR(64)  NOT NULL COMMENT '操作人',
    transfer_time   DATETIME(3)  NOT NULL COMMENT '流转时间',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_order (order_id)
) COMMENT '工序流转记录';
```

### 3.3 返工

```sql
CREATE TABLE prod_rework_order (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    rework_no       VARCHAR(64)  NOT NULL COMMENT '返工单号',
    source_order_id BIGINT       NOT NULL COMMENT '原工单ID',
    source_op_id    BIGINT       NOT NULL COMMENT '发现不良的工序ID',
    source_report_id BIGINT      NOT NULL COMMENT '触发返工的报工记录ID',
    product_id      BIGINT       NOT NULL COMMENT '物料ID',
    rework_qty      DECIMAL(12,2) NOT NULL COMMENT '返工数量',
    rework_reason   VARCHAR(32)  NOT NULL COMMENT 'DEFECT/REWORK_DECISION/CUSTOMER_RETURN',
    defect_code     VARCHAR(32)  NULL COMMENT '缺陷代码',
    rework_routing_id BIGINT     NULL COMMENT '返工工艺路线ID(可不同于原路线)',
    rework_start_op INT          NULL COMMENT '返工起始工序序号',
    status          VARCHAR(32)  NOT NULL DEFAULT 'CREATED' COMMENT 'CREATED/IN_PROGRESS/COMPLETED/CANCELLED',
    completed_qty   DECIMAL(12,2) NOT NULL DEFAULT 0,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_rework_no (rework_no, tenant_id),
    INDEX idx_source_order (source_order_id)
) COMMENT '返工单';
```

### 3.4 异常上报

```sql
CREATE TABLE prod_exception (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    exception_no    VARCHAR(64)  NOT NULL COMMENT '异常单号',
    order_id        BIGINT       NULL COMMENT '关联工单ID',
    op_id           BIGINT       NULL COMMENT '关联工序ID',
    exception_type  VARCHAR(32)  NOT NULL COMMENT 'MATERIAL_SHORTAGE/EQUIPMENT_DOWN/QUALITY/SAFETY/OTHER 缺料/停机/质量/安全/其他',
    severity        VARCHAR(32)  NOT NULL COMMENT 'LOW/MEDIUM/HIGH/CRITICAL',
    title           VARCHAR(256) NOT NULL COMMENT '异常标题',
    description     TEXT         NULL COMMENT '异常描述',
    reporter_id     VARCHAR(64)  NOT NULL COMMENT '上报人',
    station_id      BIGINT       NULL COMMENT '发生工位',
    equipment_id    BIGINT       NULL COMMENT '关联设备',
    status          VARCHAR(32)  NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN/PROCESSING/RESOLVED/CLOSED',
    handler_id      VARCHAR(64)  NULL COMMENT '处理人',
    resolve_time    DATETIME(3)  NULL COMMENT '解决时间',
    resolve_note    VARCHAR(512) NULL COMMENT '处理说明',
    downtime_min    INT          NULL COMMENT '停机时长(分钟)',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_exception_no (exception_no, tenant_id),
    INDEX idx_type_status (exception_type, status),
    INDEX idx_order (order_id)
) COMMENT '生产异常';
```

### 3.5 补料申请

```sql
CREATE TABLE prod_supplement_request (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    request_no      VARCHAR(64)  NOT NULL COMMENT '申请单号',
    order_id        BIGINT       NOT NULL COMMENT '工单ID',
    op_id           BIGINT       NULL COMMENT '工序ID',
    material_id     BIGINT       NOT NULL COMMENT '物料ID',
    request_qty     DECIMAL(12,2) NOT NULL COMMENT '申请数量',
    reason          VARCHAR(32)  NOT NULL COMMENT 'SHORTAGE/SCRAP_REPLENISH/ADDITION 缺料/报废补料/追加',
    status          VARCHAR(32)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/APPROVED/REJECTED/ISSUED',
    approver_id     VARCHAR(64)  NULL,
    approved_qty    DECIMAL(12,2) NULL COMMENT '审批数量',
    remarks         VARCHAR(512) NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_request_no (request_no, tenant_id),
    INDEX idx_order (order_id)
) COMMENT '补料申请';
```

### 3.6 电子签名

```sql
CREATE TABLE prod_electronic_signature (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_type   VARCHAR(32)  NOT NULL COMMENT 'REPORT_START/REPORT_COMPLETE/INSPECT/APPROVE 报工开工/报工完工/检验/审批',
    business_id     BIGINT       NOT NULL COMMENT '业务单据ID',
    signer_id       VARCHAR(64)  NOT NULL COMMENT '签名人用户ID',
    signer_name     VARCHAR(128) NOT NULL COMMENT '签名人姓名',
    sign_role       VARCHAR(64)  NULL COMMENT '签名角色',
    sign_time       DATETIME(3)  NOT NULL COMMENT '签名时间',
    sign_ip         VARCHAR(64)  NULL COMMENT '签名IP',
    sign_device     VARCHAR(64)  NULL COMMENT '签名设备标识',
    verify_code     VARCHAR(64)  NULL COMMENT '验证码/密码哈希',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_business (business_type, business_id)
) COMMENT '电子签名';
```

## 4. 核心业务流程

### 4.1 扫码报工流程

```
工人扫码(工单条码/工序条码/设备条码)
    │
    ▼
识别工单+工序+工位
    │
    ├──→ 首次扫码 → 开工报工(START)
    │         │
    │         ▼
    │    记录开工时间、更新工序状态=IN_PROGRESS
    │    更新工单状态=IN_PROGRESS(首次开工)
    │
    └──→ 再次扫码 → 完工报工(COMPLETE)
              │
              ▼
         录入完工数量/报废数量/工序参数
              │
              ▼
         保存报工记录 → 累加工单工序完工数
              │
              ▼
         触发后置动作:
         ├── 倒冲料自动扣减
         ├── 触发检验任务(如工序类型=INSPECT)
         ├── 工序流转(自动流转到下工序)
         └── 工单完工检查(所有工序完工→工单COMPLETED)
```

### 4.2 返工流程

```
报工时录入报废数量/返工数量
    │
    ▼
创建返工单(关联原工单+工序)
    │
    ▼
指定返工工艺路线+起始工序
    │
    ▼
返工单下达 → 返工执行(报工) → 返工完成
    │
    ▼
返工合格品并入原工单完工数量
返工仍不合格 → 最终报废
```

## 5. 核心业务规则

| 编号 | 规则 | 说明 |
|------|------|------|
| E-R001 | 报工数量不可超派工 | report_qty ≤ dispatch_qty - completed_qty |
| E-R002 | 完工数+报废数=报工数 | good_qty + scrap_qty + rework_qty = report_qty |
| E-R003 | 首次开工更新工单状态 | 工单首次报工 START 时，工单 status → IN_PROGRESS |
| E-R004 | 末工序完工触发工单完工 | 所有工序 completed_qty ≥ plan_qty 时，工单 status → COMPLETED |
| E-R005 | 检验工序必须判定 | 工序类型=INSPECT 时，必须关联检验结果才可流转 |
| E-R006 | 异常停机挂起工单 | 设备停机异常自动将相关工单工序状态挂起 |
| E-R007 | 返工单独立追踪 | 返工单有独立编号和状态流转，不影响原工单状态 |
| E-R008 | 倒冲料自动扣减 | issue_type=BACKFLUSH 的物料在报工时自动生成出库记录 |

## 6. 接口清单

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/dispatch | 创建派工单 |
| GET | /api/v1/dispatch | 派工单列表 |
| POST | /api/v1/dispatch/{id}/cancel | 取消派工 |
| POST | /api/v1/reports | 提交报工 |
| GET | /api/v1/reports | 报工记录查询 |
| POST | /api/v1/reports/scan | 扫码报工（移动端入口） |
| GET | /api/v1/reports/{id}/params | 报工参数查询 |
| POST | /api/v1/rework-orders | 创建返工单 |
| GET | /api/v1/rework-orders/{id} | 返工单详情 |
| POST | /api/v1/exceptions | 上报异常 |
| GET | /api/v1/exceptions | 异常列表 |
| PUT | /api/v1/exceptions/{id}/resolve | 处理异常 |
| POST | /api/v1/supplement-requests | 创建补料申请 |
| PUT | /api/v1/supplement-requests/{id}/approve | 审批补料 |
| GET | /api/v1/work-orders/{id}/progress | 工单进度（含各工序报工汇总） |
| POST | /api/v1/op-transfers | 工序流转 |

## 6. 使用对象

| 角色 | 说明 | 使用频率 |
|------|------|---------|
| **一线操作工** | 扫码报工（开工/完工）、异常上报、补料申请 | 每日极高频（核心操作） |
| **班组长** | 派工分配、返工判定、异常处理、查看本班组进度 | 每日高频 |
| **车间主任** | 查看车间工单进度、异常汇总、人员效率 | 每日中频 |
| **工艺工程师** | 查看报工参数采集数据、分析工艺偏差 | 异常时查看 |
| **PMC 计划员** | 查看工单实际进度vs计划、完工数量 | 每日中频 |

## 7. 使用场景

### 场景 1：扫码开工（移动端）

| 项目 | 内容 |
|------|------|
| **触发时间** | 工人到达工位，准备开始加工时 |
| **前提条件** | 工单已下达(RELEASED)，工序已派工给该工人，物料已领至线边 |
| **操作人** | 一线操作工 |
| **步骤** | ① 打开手机APP/微信小程序 → ② 扫描工单条码或工序条码 → ③ 系统识别工单+工序+工位 → ④ 确认开工 → ⑤ 系统记录开工时间，工序状态→IN_PROGRESS |
| **设备** | 手机（微信/APP）或工位平板 |

### 场景 2：扫码完工报工（移动端）

| 项目 | 内容 |
|------|------|
| **触发时间** | 工序加工完成，产出合格品/报废品时 |
| **前提条件** | 该工序已开工 |
| **操作人** | 一线操作工 |
| **步骤** | ① 扫码进入报工页面 → ② 录入合格数量、报废数量、返工数量 → ③ 如有工序参数需采集，录入实测值（温度/压力等） → ④ 确认提交 → ⑤ 系统触发：倒冲料扣减、检验任务、工序流转 |
| **注意** | 合格+报废+返工=报工数量，不可超额 |

### 场景 3：生产异常上报

| 项目 | 内容 |
|------|------|
| **触发时间** | 生产过程中发生停机/缺料/质量异常/安全事故 |
| **前提条件** | 无特殊前提，随时可上报 |
| **操作人** | 一线操作工 或 班组长 |
| **步骤** | ① 点击「异常上报」→ ② 选择异常类型（缺料/停机/质量/安全）→ ③ 选择严重程度 → ④ 描述异常 → ⑤ 提交 → ⑥ 系统通知相关人员（班组长/设备工程师/质量工程师） |
| **联动** | 设备停机异常自动挂起该设备上的工单工序 |

### 场景 4：返工流程

| 项目 | 内容 |
|------|------|
| **触发时间** | 报工时录入返工数量 > 0，或检验判定需返工 |
| **前提条件** | 工序已完工报工，存在不合格品 |
| **操作人** | 班组长 |
| **步骤** | ① 创建返工单，选择返工工艺路线 → ② 指定返工起始工序 → ③ 返工单下达 → ④ 工人按返工路线报工 → ⑤ 返工合格品并入原工单完工数 / 返工仍不合格→最终报废 |

### 场景 5：补料申请

| 项目 | 内容 |
|------|------|
| **触发时间** | 生产过程中发现物料不足（损耗超预期/报废补料） |
| **前提条件** | 工单正在执行中 |
| **操作人** | 一线操作工 申请，班组长 审批 |
| **步骤** | ① 选择工单+工序+缺料物料 → ② 输入申请数量和原因 → ③ 提交审批 → ④ 班组长审批 → ⑤ 仓管员备料配送 |

## 8. 使用方法

### 8.1 移动端扫码报工

1. 打开「黑湖智造」APP 或微信小程序
2. 首页显示「我的待办工单」列表
3. 点击扫码图标，扫描工单条码/工序条码/设备条码
4. 首次扫码→进入开工页面，确认开工
5. 再次扫码→进入完工页面，录入数量
6. 如有参数采集项，逐项填写实测值
7. 点击「提交」，系统自动触发后置动作

### 8.2 PC 端派工管理

1. 进入「生产执行 → 派工管理」
2. 选择工单+工序，查看可派工人员列表
3. 勾选人员，设置派工数量
4. 确认派工，工人移动端收到通知

### 8.3 工单进度查看

1. 进入「生产执行 → 工单进度」
2. 查看工单卡片：计划数/完工数/报废数/进度百分比
3. 点击工单进入详情：各工序报工记录、耗时、参数
4. 支持按车间/产线/状态筛选

## 9. UI 示意

### 9.1 移动端扫码报工

```
┌──────────────────────────┐
│  🏭 黑湖智造              │
│                          │
│  ┌────────────────────┐  │
│  │   📷 扫码报工       │  │
│  │                    │  │
│  │  ┌──────────────┐  │  │
│  │  │  ▓▓▓▓▓▓▓▓▓▓  │  │  │
│  │  │  扫描工单条码  │  │  │
│  │  │  ▓▓▓▓▓▓▓▓▓▓  │  │  │
│  │  └──────────────┘  │  │
│  └────────────────────┘  │
│                          │
│  📋 我的待办 (3)         │
│  ┌────────────────────┐  │
│  │ WO001 OP20 精车    │  │
│  │ 伺服电机 ×500      │  │
│  │ 状态: 待开工  ▶    │  │
│  └────────────────────┘  │
│  ┌────────────────────┐  │
│  │ WO002 OP40 装配    │  │
│  │ 驱动模组 ×200      │  │
│  │ 状态: 进行中  ▶    │  │
│  └────────────────────┘  │
│                          │
│  ⚠️ 异常上报             │
│  📦 补料申请             │
└──────────────────────────┘
```

### 9.2 移动端完工报工

```
┌──────────────────────────┐
│  ← 报工                   │
│                          │
│  工单: WO2509050001      │
│  工序: OP20 精车          │
│  产品: 伺服电机           │
│  计划: 500 PCS            │
│                          │
│  ┌─ 报工数量 ──────────┐  │
│  │ 合格数量: [480    ] │  │
│  │ 报废数量: [10     ] │  │
│  │ 返工数量: [10     ] │  │
│  │ 合计:     500       │  │
│  └──────────────────────┘  │
│                          │
│  ┌─ 工序参数 ──────────┐  │
│  │ 主轴转速: [8000  ]  │  │
│  │         标准:8000   │  │
│  │ 进给速度: [1200  ]  │  │
│  │         标准:1200   │  │
│  │ 表面粗糙度:[Ra0.8]  │  │
│  │         标准:≤Ra1.6 │  │
│  └──────────────────────┘  │
│                          │
│  [提交报工]               │
└──────────────────────────┘
```

### 9.3 PC 端工单进度看板

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  生产执行 > 工单进度        车间: [机加工▼]  状态: [进行中▼]                  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─ WO2509050001 伺服电机 ×500 ────────────────────────────────────────┐    │
│  │ 交期: 09/15  优先级: P1  状态: 进行中                                │    │
│  │  OP10 粗车  ████████████████████░░░░  400/500  80%                  │    │
│  │  OP20 精车  ██████████░░░░░░░░░░░░░  250/500  50%                  │    │
│  │  OP30 首检  ████████░░░░░░░░░░░░░░░  200/500  40%                  │    │
│  │  OP40 装配  ░░░░░░░░░░░░░░░░░░░░░░░    0/500   0%                  │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─ WO2509050002 驱动模组 ×200 ────────────────────────────────────────┐    │
│  │  交期: 09/20  优先级: P3  状态: 进行中                                │    │
│  │  OP10 CNC铣  ██████████████████████  180/200  90%                  │    │
│  │  OP20 装配   ████░░░░░░░░░░░░░░░░░░   40/200  20%                  │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```