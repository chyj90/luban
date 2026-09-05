# 05 物料与仓储模块

## 1. 业务目标

实现物料从需求→采购→入库→领料→生产→完工入库→发货的全生命周期管理，包含 WMS 仓储作业（入库/出库/调拨/盘点）和厂内物流协同，与生产执行、质量管理深度联动。

## 2. 功能清单

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 入库管理 | 采购入库/生产入库/退货入库/调拨入库，扫码作业 | P0 |
| 出库管理 | 生产领料/销售出库/调拨出库/报废出库，扫码作业 | P0 |
| 库存查询 | 实时库存（按物料/仓库/批次/库位），可用库存计算 | P0 |
| 齐套检查 | 工单用料与库存/在途对比，输出齐套率和缺料清单 | P0 |
| 批次管理 | 批次号生成规则、批次追溯、效期管理、FIFO 策略 | P0 |
| 调拨管理 | 厂内仓库间/跨工厂调拨，审批+出入库联动 | P1 |
| 盘点管理 | 周期盘点/动态盘点/全盘，盘盈盘亏处理 | P1 |
| 厂内配送 | 配送任务生成、配送路径、AGV/人工协同 | P1 |
| 条码管理 | 条码/二维码生成、打印、解析规则 | P1 |
| 安全库存预警 | 低于安全库存自动触发采购建议 | P1 |

## 3. 数据模型

### 3.1 库存主数据

```sql
CREATE TABLE inv_stock (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    plant_id        BIGINT       NOT NULL COMMENT '工厂',
    wh_id           BIGINT       NOT NULL COMMENT '仓库',
    location_id     BIGINT       NULL COMMENT '库位(库位管理仓库)',
    material_id     BIGINT       NOT NULL COMMENT '物料',
    batch_no        VARCHAR(64)  NULL COMMENT '批次号(批次管理物料)',
    stock_status    VARCHAR(32)  NOT NULL DEFAULT 'AVAILABLE' COMMENT 'AVAILABLE/INSPECTING/FROZEN/REJECT 可用/质检中/冻结/不良',
    qty             DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '在库数量',
    allocated_qty   DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '已分配数量(工单占用)',
    in_transit_qty  DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '在途数量',
    available_qty   DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '可用数量=qty-allocated_qty',
    unit            VARCHAR(32)  NOT NULL COMMENT '单位',
    unit_cost       DECIMAL(14,6) NULL COMMENT '单位成本(移动加权平均)',
    total_cost      DECIMAL(14,2) NULL COMMENT '库存金额=qty*unit_cost',
    production_date DATE         NULL COMMENT '生产日期',
    expiry_date     DATE         NULL COMMENT '有效期至',
    supplier_id     BIGINT       NULL COMMENT '供应商(来料批次)',
    last_gr_date    DATE         NULL COMMENT '最后入库日期',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_stock (plant_id, wh_id, location_id, material_id, batch_no, stock_status, tenant_id),
    INDEX idx_material (material_id, plant_id),
    INDEX idx_batch (batch_no),
    INDEX idx_expiry (expiry_date)
) COMMENT '库存余额';

CREATE TABLE inv_stock_snapshot (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    snapshot_date   DATE         NOT NULL COMMENT '快照日期',
    plant_id        BIGINT       NOT NULL,
    wh_id           BIGINT       NOT NULL,
    material_id     BIGINT       NOT NULL,
    batch_no        VARCHAR(64)  NULL,
    qty             DECIMAL(12,2) NOT NULL,
    available_qty   DECIMAL(12,2) NOT NULL,
    total_cost      DECIMAL(14,2) NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_snapshot (snapshot_date, plant_id, wh_id, material_id, batch_no, tenant_id)
) COMMENT '库存快照(日结)';
```

### 3.2 入库

```sql
CREATE TABLE inv_goods_receipt (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    gr_no           VARCHAR(64)  NOT NULL COMMENT '入库单号，如GR202509050001',
    gr_type         VARCHAR(32)  NOT NULL COMMENT 'PURCHASE/PRODUCTION/RETURN/TRANSFER 采购/生产/退货/调拨',
    plant_id        BIGINT       NOT NULL COMMENT '工厂',
    wh_id           BIGINT       NOT NULL COMMENT '目标仓库',
    source_type     VARCHAR(32)  NULL COMMENT 'PO/WORK_ORDER/RETURN_ORDER/TRANSFER_ORDER',
    source_id       BIGINT       NULL COMMENT '来源单据ID',
    source_no       VARCHAR(64)  NULL COMMENT '来源单据号',
    status          VARCHAR(32)  NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/CONFIRMED/CANCELLED',
    confirm_time    DATETIME(3)  NULL COMMENT '确认时间',
    confirm_by      VARCHAR(64)  NULL,
    remarks         VARCHAR(512) NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_gr_no (gr_no, tenant_id),
    INDEX idx_source (source_type, source_id)
) COMMENT '入库单头';

CREATE TABLE inv_goods_receipt_item (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    gr_id           BIGINT       NOT NULL COMMENT '入库单ID',
    line_no         INT          NOT NULL COMMENT '行号',
    material_id     BIGINT       NOT NULL COMMENT '物料',
    batch_no        VARCHAR(64)  NULL COMMENT '批次号(系统生成或手工录入)',
    location_id     BIGINT       NULL COMMENT '库位',
    plan_qty        DECIMAL(12,2) NOT NULL COMMENT '计划入库数量',
    actual_qty      DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '实际入库数量',
    unit            VARCHAR(32)  NOT NULL,
    unit_cost       DECIMAL(14,6) NULL COMMENT '单位成本',
    production_date DATE         NULL COMMENT '生产日期',
    expiry_date     DATE         NULL COMMENT '有效期至',
    supplier_lot    VARCHAR(64)  NULL COMMENT '供应商批号',
    inspect_status  VARCHAR(32)  NOT NULL DEFAULT 'NOT_REQUIRED' COMMENT 'NOT_REQUIRED/PENDING/PASSED/FAILED 免检/待检/合格/不合格',
    inspect_id      BIGINT       NULL COMMENT '检验单ID',
    source_line_id  BIGINT       NULL COMMENT '来源单据行ID',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_gr (gr_id)
) COMMENT '入库单行';
```

### 3.3 出库

```sql
CREATE TABLE inv_goods_issue (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    gi_no           VARCHAR(64)  NOT NULL COMMENT '出库单号，如GI202509050001',
    gi_type         VARCHAR(32)  NOT NULL COMMENT 'PICK/BACKFLUSH/SALES/SCRAP/TRANSFER 领料/倒冲/销售/报废/调拨',
    plant_id        BIGINT       NOT NULL,
    wh_id           BIGINT       NOT NULL COMMENT '来源仓库',
    source_type     VARCHAR(32)  NULL COMMENT 'WORK_ORDER/SALES_ORDER/SCRAP_ORDER/TRANSFER_ORDER',
    source_id       BIGINT       NULL,
    source_no       VARCHAR(64)  NULL,
    status          VARCHAR(32)  NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/CONFIRMED/CANCELLED',
    confirm_time    DATETIME(3)  NULL,
    confirm_by      VARCHAR(64)  NULL,
    remarks         VARCHAR(512) NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_gi_no (gi_no, tenant_id),
    INDEX idx_source (source_type, source_id)
) COMMENT '出库单头';

CREATE TABLE inv_goods_issue_item (
    id              BIGINT       AUTO_INCREMENT PRIMARY KEY,
    gi_id           BIGINT       NOT NULL COMMENT '出库单ID',
    line_no         INT          NOT NULL,
    material_id     BIGINT       NOT NULL,
    batch_no        VARCHAR(64)  NULL COMMENT '出库批次(FIFO自动匹配或手工指定)',
    location_id     BIGINT       NULL COMMENT '库位',
    plan_qty        DECIMAL(12,2) NOT NULL COMMENT '计划出库数量',
    actual_qty      DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '实际出库数量',
    unit            VARCHAR(32)  NOT NULL,
    unit_cost       DECIMAL(14,6) NULL COMMENT '单位成本',
    order_id        BIGINT       NULL COMMENT '关联工单ID',
    order_op_id     BIGINT       NULL COMMENT '关联工序ID',
    source_line_id  BIGINT       NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_gi (gi_id)
) COMMENT '出库单行';
```

### 3.4 调拨

```sql
CREATE TABLE inv_transfer_order (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    transfer_no     VARCHAR(64)  NOT NULL COMMENT '调拨单号',
    from_plant_id   BIGINT       NOT NULL COMMENT '源工厂',
    from_wh_id      BIGINT       NOT NULL COMMENT '源仓库',
    to_plant_id     BIGINT       NOT NULL COMMENT '目标工厂',
    to_wh_id        BIGINT       NOT NULL COMMENT '目标仓库',
    transfer_type   VARCHAR(32)  NOT NULL COMMENT 'INTER_WH/INTER_PLANT 厂内/跨厂',
    status          VARCHAR(32)  NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/APPROVED/IN_TRANSIT/COMPLETED/CANCELLED',
    approved_by     VARCHAR(64)  NULL,
    approved_at     DATETIME(3)  NULL,
    completed_at    DATETIME(3)  NULL,
    remarks         VARCHAR(512) NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_transfer_no (transfer_no, tenant_id)
) COMMENT '调拨单';

CREATE TABLE inv_transfer_item (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    transfer_id     BIGINT       NOT NULL,
    line_no         INT          NOT NULL,
    material_id     BIGINT       NOT NULL,
    batch_no        VARCHAR(64)  NULL,
    transfer_qty    DECIMAL(12,2) NOT NULL,
    unit            VARCHAR(32)  NOT NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_transfer (transfer_id)
) COMMENT '调拨单行';
```

### 3.5 盘点

```sql
CREATE TABLE inv_count_order (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    count_no        VARCHAR(64)  NOT NULL COMMENT '盘点单号',
    plant_id        BIGINT       NOT NULL,
    wh_id           BIGINT       NULL COMMENT '仓库(NULL=全盘)',
    count_type      VARCHAR(32)  NOT NULL COMMENT 'FULL/CYCLE/DYNAMIC 全盘/周期盘点/动态盘点',
    count_date      DATE         NOT NULL COMMENT '盘点基准日期',
    status          VARCHAR(32)  NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/COUNTING/DIFF_REVIEW/COMPLETED/CANCELLED',
    count_by        VARCHAR(64)  NULL COMMENT '盘点人',
    review_by       VARCHAR(64)  NULL COMMENT '复盘人',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_count_no (count_no, tenant_id)
) COMMENT '盘点单';

CREATE TABLE inv_count_detail (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    count_id        BIGINT       NOT NULL COMMENT '盘点单ID',
    material_id     BIGINT       NOT NULL,
    batch_no        VARCHAR(64)  NULL,
    location_id     BIGINT       NULL,
    book_qty        DECIMAL(12,2) NOT NULL COMMENT '账面数量',
    actual_qty      DECIMAL(12,2) NULL COMMENT '实盘数量',
    diff_qty        DECIMAL(12,2) NULL COMMENT '差异数量=实盘-账面',
    diff_type       VARCHAR(32)  NULL COMMENT 'GAIN/LOSS/MATCH 盘盈/盘亏/无差异',
    is_recounted    TINYINT      NOT NULL DEFAULT 0 COMMENT '是否已复盘',
    recount_qty     DECIMAL(12,2) NULL COMMENT '复盘数量',
    adjust_status   VARCHAR(32)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/APPROVED/ADJUSTED',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_count (count_id)
) COMMENT '盘点明细';
```

### 3.6 厂内配送

```sql
CREATE TABLE inv_delivery_task (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_no         VARCHAR(64)  NOT NULL COMMENT '配送任务号',
    task_type       VARCHAR(32)  NOT NULL COMMENT 'LINE_FEEDING/WH_TRANSFER/OUTBOUND 线边配送/仓间转运/出库发货',
    from_location   VARCHAR(128) NOT NULL COMMENT '起点',
    to_location     VARCHAR(128) NOT NULL COMMENT '终点',
    carrier_type    VARCHAR(32)  NOT NULL COMMENT 'MANUAL/AGV/FORKLIFT 人工/AGV/叉车',
    carrier_id      VARCHAR(64)  NULL COMMENT '载具ID(AGV编号等)',
    status          VARCHAR(32)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/IN_PROGRESS/COMPLETED/CANCELLED',
    priority        INT          NOT NULL DEFAULT 5,
    planned_time    DATETIME(3)  NULL COMMENT '计划配送时间',
    actual_time     DATETIME(3)  NULL COMMENT '实际完成时间',
    order_id        BIGINT       NULL COMMENT '关联工单',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_task_no (task_no, tenant_id)
) COMMENT '配送任务';
```

### 3.7 条码

```sql
CREATE TABLE inv_barcode (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    barcode         VARCHAR(128) NOT NULL COMMENT '条码值',
    barcode_type    VARCHAR(32)  NOT NULL COMMENT 'QRCODE/BARCODE/DATAMATRIX',
    business_type   VARCHAR(32)  NOT NULL COMMENT 'MATERIAL/BATCH/CONTAINER/LOCATION 物料/批次/容器/库位',
    business_id     BIGINT       NOT NULL COMMENT '业务对象ID',
    business_code   VARCHAR(64)  NOT NULL COMMENT '业务对象编码',
    print_count     INT          NOT NULL DEFAULT 0 COMMENT '打印次数',
    is_active       TINYINT      NOT NULL DEFAULT 1,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_barcode (barcode, tenant_id)
) COMMENT '条码';
```

## 4. 核心业务流程

### 4.1 采购入库流程

```
ERP采购订单 → 收货通知
    │
    ▼
创建入库单(GR) ──→ 扫码确认收货
    │
    ▼
批次号生成(按规则: 年月日+流水)
    │
    ▼
来料检验(IQC)判断:
    ├── 免检 → 直接入库，库存状态=AVAILABLE
    ├── 需检 → 创建检验单，库存状态=INSPECTING
    │         ├── 检验合格 → 状态→AVAILABLE
    │         └── 检验不合格 → 状态→REJECT，不良品处理
    └── 紧急放行 → 状态=AVAILABLE(标记待补检)
```

### 4.2 生产领料流程

```
工单下达 → 物料需求展开
    │
    ▼
生成领料单(按工序+用料清单)
    │
    ▼
FIFO批次匹配(优先出早批次、近效期)
    │
    ▼
库位推荐(按存储策略自动推荐拣选库位)
    │
    ▼
仓管员扫码拣料 → 确认出库
    │
    ▼
库存扣减 + 分配量释放
    │
    ▼
配送任务(仓库→线边)
```

### 4.3 倒冲流程

```
工序报工完工
    │
    ▼
查找该工序倒冲料清单(issue_type=BACKFLUSH)
    │
    ▼
按报工数量计算消耗量 = 用量 × (1+损耗率) × 报工数量
    │
    ▼
自动创建出库单(gi_type=BACKFLUSH)
    │
    ▼
FIFO批次匹配 + 库存扣减
    │
    ▼
写入追溯链(投料→完工关联)
```

## 5. 核心业务规则

| 编号 | 规则 | 说明 |
|------|------|------|
| M-R001 | 可用库存计算 | available_qty = qty - allocated_qty，不可为负 |
| M-R002 | 出库不可超可用 | 出库数量 ≤ available_qty，否则拒绝 |
| M-R003 | FIFO 批次匹配 | 出库时优先选择生产日期最早的批次（先进先出） |
| M-R004 | 效期预警 | 距 expiry_date ≤ 30 天黄色预警，≤ 0 红色预警（过期） |
| M-R005 | 入库确认更新库存 | GR 确认时原子更新 inv_stock 对应行 |
| M-R006 | 出库确认扣减库存 | GI 确认时原子扣减 inv_stock.qty 和 allocated_qty |
| M-R007 | 盘点差异审批 | 盘盈/盘亏必须审批后才可调整库存 |
| M-R008 | 批次号唯一 | 同一物料+同一工厂内批次号不可重复 |
| M-R009 | 质检库存不可用 | stock_status=INSPECTING 的库存不计入 available_qty |
| M-R010 | 分配量释放 | 工单关闭/取消时，释放该工单占用的所有 allocated_qty |

## 6. 接口清单

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/goods-receipts | 创建入库单 |
| GET | /api/v1/goods-receipts | 入库单列表 |
| POST | /api/v1/goods-receipts/{id}/confirm | 确认入库 |
| POST | /api/v1/goods-issues | 创建出库单 |
| GET | /api/v1/goods-issues | 出库单列表 |
| POST | /api/v1/goods-issues/{id}/confirm | 确认出库 |
| GET | /api/v1/stock | 库存查询（多维度筛选） |
| GET | /api/v1/stock/available | 可用库存查询 |
| GET | /api/v1/stock/material-trace | 物料批次追溯 |
| POST | /api/v1/transfer-orders | 创建调拨单 |
| PUT | /api/v1/transfer-orders/{id}/approve | 审批调拨 |
| POST | /api/v1/count-orders | 创建盘点单 |
| POST | /api/v1/count-orders/{id}/submit | 提交盘点结果 |
| PUT | /api/v1/count-orders/{id}/adjust | 盘点调整 |
| POST | /api/v1/delivery-tasks | 创建配送任务 |
| GET | /api/v1/delivery-tasks | 配送任务列表 |
| POST | /api/v1/barcodes/generate | 生成条码 |
| POST | /api/v1/barcodes/parse | 解析条码 |
| GET | /api/v1/stock/safety-alert | 安全库存预警列表 |

## 6. 使用对象

| 角色 | 说明 | 使用频率 |
|------|------|---------|
| **仓管员** | 入库/出库扫码作业、盘点、配送任务执行 | 每日极高频（核心操作） |
| **PMC 计划员** | 查看库存/齐套/缺料、触发领料 | 每日高频 |
| **采购员** | 查看缺料预警、安全库存预警 | 每日中频 |
| **车间班组长** | 查看线边库存、申请补料 | 每日中频 |
| **财务/成本** | 查看库存金额、库存周转率 | 月频 |
| **厂长/高管** | 库存总览看板（库存金额/周转天数/呆滞料） | 周频 |

## 7. 使用场景

### 场景 1：采购入库（扫码作业）

| 项目 | 内容 |
|------|------|
| **触发时间** | 供应商送货到达，ERP采购订单已同步 |
| **前提条件** | 采购订单已确认，送货单与PO匹配 |
| **操作人** | 仓管员 |
| **步骤** | ① 扫码识别采购订单 → ② 逐行扫码确认物料+数量 → ③ 系统自动生成批次号 → ④ 需检物料→状态=INSPECTING / 免检物料→状态=AVAILABLE → ⑤ 确认入库 → ⑥ 打印入库标签贴至料架 |
| **设备** | PDA扫码枪 或 手机APP |

### 场景 2：生产领料出库

| 项目 | 内容 |
|------|------|
| **触发时间** | 工单下达后，仓管员收到领料任务 |
| **前提条件** | 工单已下达，物料需求已展开，齐套检查通过 |
| **操作人** | 仓管员 |
| **步骤** | ① 查看领料任务列表（按工单汇总） → ② 系统推荐拣选库位(FIFO) → ③ 扫码确认物料+批次+库位 → ④ 确认出库数量 → ⑤ 系统扣减库存+释放分配量 → ⑥ 生成配送任务(仓库→线边) |

### 场景 3：倒冲自动扣减

| 项目 | 内容 |
|------|------|
| **触发时间** | 工序报工完工时，该工序有倒冲料 |
| **前提条件** | 工序报工已提交，BOM中该物料issue_type=BACKFLUSH |
| **操作人** | 系统（自动触发，无需人工） |
| **步骤** | ① 报工提交后系统自动查找倒冲料清单 → ② 按报工数量计算消耗量 → ③ FIFO匹配批次 → ④ 自动创建出库单 → ⑤ 扣减库存 → ⑥ 写入追溯链 |
| **异常** | 倒冲料库存不足时，创建缺料异常通知 |

### 场景 4：盘点

| 项目 | 内容 |
|------|------|
| **触发时间** | 月末/季末周期盘点，或库存差异触发动态盘点 |
| **前提条件** | 盘点单已创建 |
| **操作人** | 仓管员盘点，财务复盘 |
| **步骤** | ① 创建盘点单（全盘/按库位/按物料分类） → ② 系统冻结盘点范围库存（禁止出入库） → ③ 仓管员逐位扫码实盘 → ④ 系统对比账面vs实盘 → ⑤ 有差异项→复盘 → ⑥ 盘盈盘亏审批 → ⑦ 调整库存 |

### 场景 5：安全库存预警

| 项目 | 内容 |
|------|------|
| **触发时间** | 实时（每次库存变动后检查） |
| **前提条件** | 物料主数据已设置安全库存 |
| **操作人** | 系统（自动检测），采购员（响应） |
| **步骤** | ① 库存变动后系统检查 available_qty < safety_stock → ② 触发预警通知 → ③ 采购员查看预警列表 → ④ 创建采购申请 |

## 8. 使用方法

### 8.1 扫码入库（移动端）

1. 打开APP，进入「入库作业」
2. 扫描采购订单条码或送货单条码
3. 逐行扫描物料条码，确认数量
4. 系统自动生成批次号，推荐入库库位
5. 确认入库，打印标签

### 8.2 扫码出库（移动端）

1. 打开APP，进入「出库作业」
2. 查看待处理领料任务
3. 按任务逐行扫码拣料
4. 系统校验：物料+批次+数量是否匹配
5. 确认出库

### 8.3 库存查询（PC）

1. 进入「物料仓储 → 库存查询」
2. 按物料/仓库/批次/库位筛选
3. 查看实时库存：在库量/已分配/可用/在途
4. 点击物料下钻查看批次明细+库位分布
5. 支持导出Excel

## 9. UI 示意

### 9.1 库存查询

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  物料仓储 > 库存查询                                                          │
├──────────────────────────────────────────────────────────────────────────────┤
│  工厂: [华东▼] 仓库: [全部▼] 类型: [全部▼]  搜索: [____________] 🔍          │
├──────────┬──────────┬──────┬──────┬──────┬──────┬──────┬────────────────────┤
│ 物料编码  │ 物料名称  │ 在库  │已分配│ 可用  │ 在途  │ 安全  │ 状态             │
├──────────┼──────────┼──────┼──────┼──────┼──────┼──────┼────────────────────┤
│ M100001  │铝合金壳体 │ 1200 │ 500  │ 700  │  0   │ 200  │ ✅ 正常           │
│ M100002  │PCB主板   │  600 │ 200  │ 400  │ 300  │ 500  │ ⚠️ 低于安全库存   │
│ C400001  │螺丝包    │ 2000 │ 800  │ 1200 │  0   │ 300  │ ✅ 正常           │
│ P200001  │驱动模组  │  150 │ 100  │  50  │  0   │ 100  │ 🔴 严重不足       │
├──────────┴──────────┴──────┴──────┴──────┴──────┴──────┴────────────────────┤
│  共 456 条  < 1  2  3 ... 23 >                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 移动端扫码入库

```
┌──────────────────────────┐
│  ← 入库作业               │
│                          │
│  采购单: PO20250905001   │
│  供应商: 华铝科技         │
│                          │
│  ┌─ 待入库 ────────────┐  │
│  │ ☐ M100001 铝合金壳体│  │
│  │   计划: 1000  已入: 0│  │
│  │ ☐ M100003 铜端子    │  │
│  │   计划: 5000  已入: 0│  │
│  └──────────────────────┘  │
│                          │
│  ┌──────────────────┐    │
│  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓  │    │
│  │  扫描物料条码     │    │
│  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓  │    │
│  └──────────────────┘    │
│                          │
│  批次号: B20250905 (自动) │
│  推荐库位: RAW-A-03      │
│                          │
│  [确认入库] [打印标签]    │
└──────────────────────────┘
```

### 9.3 盘点作业

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  物料仓储 > 盘点管理  盘点单: PD20250905                                      │
├──────────────────────────────────────────────────────────────────────────────┤
│  类型: 周期盘点  范围: 原材料仓  状态: 盘点中                                  │
├──────────┬──────────┬──────┬──────┬──────┬──────────┬────────────────────────┤
│ 物料编码  │ 物料名称  │ 账面数│ 实盘数│ 差异  │ 差异类型  │ 操作                │
├──────────┼──────────┼──────┼──────┼──────┼──────────┼────────────────────────┤
│ M100001  │铝合金壳体 │ 1200 │ 1198 │  -2  │ 盘亏      │ [复盘][调整]        │
│ M100002  │PCB主板   │  600 │  600 │   0  │ 无差异    │ ✅                  │
│ M100003  │铜端子    │ 5000 │ 5010 │ +10  │ 盘盈      │ [复盘][调整]        │
│ C400001  │螺丝包    │ 2000 │  —   │  —   │ 待盘      │ [扫码实盘]          │
├──────────┴──────────┴──────┴──────┴──────┴──────────┴────────────────────────┤
│  进度: 3/4 已盘  差异: 盘盈1项 盘亏1项    [提交复盘] [完成盘点]               │
└──────────────────────────────────────────────────────────────────────────────┘
```