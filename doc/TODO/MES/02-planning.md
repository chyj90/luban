# 02 计划排产模块

## 1. 业务目标

将销售订单/预测需求转化为可执行的生产工单，通过排程算法确定工单在各工作中心/产线上的加工顺序与时间，实现：
- 交期承诺（ATP/CTP 查询）
- 产能负荷可视化
- 动态插单/改单响应
- 物料需求展开与缺料预警

## 2. 功能清单

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 主生产计划（MPS） | 按产品+工厂编制周期性主计划，平衡需求与产能 | P0 |
| 工单排程 | 甘特图拖拽排产、正向/反向排程、有限/无限产能模式 | P0 |
| 动态插单 | 紧急订单插入，自动重排受影响工单 | P0 |
| 产能负荷分析 | 按工作中心/产线展示负荷率、超欠产预警 | P0 |
| 物料需求展开 | 工单用料按 BOM 展开，与库存/在途对比，输出缺料清单 | P0 |
| 齐套检查 | 工单下达前检查物料是否齐套，不齐套禁止下达 | P0 |
| ATP/CTP 查询 | 可承诺量/可承诺产能查询，支持销售交期承诺 | P1 |
| 排程仿真 | What-If 场景模拟，对比不同排程方案 | P1 |
| 周期性排程 | 日/周/月排程周期，滚动排程窗口 | P1 |

## 3. 数据模型

### 3.1 主生产计划

```sql
CREATE TABLE plan_master_schedule (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    mps_code        VARCHAR(64)  NOT NULL COMMENT 'MPS编号',
    plant_id        BIGINT       NOT NULL COMMENT '工厂',
    product_id      BIGINT       NOT NULL COMMENT '产品物料ID',
    plan_period     VARCHAR(32)  NOT NULL COMMENT '计划周期 DAY/WEEK/MONTH',
    plan_date       DATE         NOT NULL COMMENT '计划日期',
    plan_qty        DECIMAL(12,2) NOT NULL COMMENT '计划数量',
    firm_qty        DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '确认数量(已下达工单)',
    demand_type     VARCHAR(32)  NOT NULL COMMENT 'ORDER/FORECAST/SAFETY_STOCK 订单/预测/安全库存',
    source_order_id BIGINT       NULL COMMENT '来源销售订单ID',
    source_order_no VARCHAR(64)  NULL COMMENT '来源销售订单号',
    due_date        DATE         NOT NULL COMMENT '需求日期',
    priority        INT          NOT NULL DEFAULT 5 COMMENT '优先级 1=最高 9=最低',
    status          VARCHAR(32)  NOT NULL DEFAULT 'PLANNED' COMMENT 'PLANNED/FIRMED/CLOSED',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_mps (mps_code, tenant_id),
    INDEX idx_plant_product (plant_id, product_id, plan_date)
) COMMENT '主生产计划';

CREATE TABLE plan_demand (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    demand_code     VARCHAR(64)  NOT NULL COMMENT '需求编号',
    plant_id        BIGINT       NOT NULL,
    product_id      BIGINT       NOT NULL COMMENT '需求物料',
    demand_qty      DECIMAL(12,2) NOT NULL COMMENT '需求数量',
    demand_date     DATE         NOT NULL COMMENT '需求日期',
    demand_type     VARCHAR(32)  NOT NULL COMMENT 'SALES_ORDER/FORECAST/SAFETY_STOCK/INTER_PLANT',
    source_id       BIGINT       NULL COMMENT '来源单据ID',
    source_no       VARCHAR(64)  NULL COMMENT '来源单据号',
    priority        INT          NOT NULL DEFAULT 5,
    allocated_qty   DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '已分配数量',
    status          VARCHAR(32)  NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN/PARTIALLY_ALLOCATED/FULLY_ALLOCATED',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_product_date (product_id, demand_date)
) COMMENT '需求池';
```

### 3.2 工单排程

```sql
CREATE TABLE plan_work_order (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_no        VARCHAR(64)  NOT NULL COMMENT '工单号，如WO202509050001',
    plant_id        BIGINT       NOT NULL COMMENT '工厂',
    product_id      BIGINT       NOT NULL COMMENT '产品物料ID',
    bom_id          BIGINT       NOT NULL COMMENT 'BOM ID',
    routing_id      BIGINT       NOT NULL COMMENT '工艺路线ID',
    order_type      VARCHAR(32)  NOT NULL COMMENT 'STANDARD/REWORK/DISMANTLE/SAMPLE 标准/返工/拆解/样品',
    order_qty       DECIMAL(12,2) NOT NULL COMMENT '工单数量',
    completed_qty   DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '完工数量',
    scrapped_qty    DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '报废数量',
    unit            VARCHAR(32)  NOT NULL COMMENT '单位',
    due_date        DATE         NOT NULL COMMENT '交期',
    priority        INT          NOT NULL DEFAULT 5 COMMENT '优先级',
    source_type     VARCHAR(32)  NULL COMMENT 'MPS/SALES_ORDER/MANUAL 来源类型',
    source_id       BIGINT       NULL COMMENT '来源单据ID',
    source_no       VARCHAR(64)  NULL COMMENT '来源单据号',
    planned_start   DATETIME(3)  NULL COMMENT '计划开始时间',
    planned_end     DATETIME(3)  NULL COMMENT '计划结束时间',
    actual_start    DATETIME(3)  NULL COMMENT '实际开始时间',
    actual_end      DATETIME(3)  NULL COMMENT '实际结束时间',
    status          VARCHAR(32)  NOT NULL DEFAULT 'CREATED' COMMENT 'CREATED/RELEASED/IN_PROGRESS/COMPLETED/CLOSED/CANCELLED',
    material_status VARCHAR(32)  NOT NULL DEFAULT 'NOT_CHECKED' COMMENT 'NOT_CHECKED/SHORTAGE/READY 物料状态',
    release_time    DATETIME(3)  NULL COMMENT '下达时间',
    release_by      VARCHAR(64)  NULL COMMENT '下达人',
    close_time      DATETIME(3)  NULL COMMENT '关闭时间',
    close_by        VARCHAR(64)  NULL COMMENT '关闭人',
    parent_order_id BIGINT       NULL COMMENT '父工单ID(拆单场景)',
    remarks         VARCHAR(512) NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_order_no (order_no, tenant_id),
    INDEX idx_plant_status (plant_id, status),
    INDEX idx_product (product_id),
    INDEX idx_due_date (due_date)
) COMMENT '工单';

CREATE TABLE plan_work_order_op (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT       NOT NULL COMMENT '工单ID',
    op_seq          INT          NOT NULL COMMENT '工序序号',
    op_code         VARCHAR(32)  NOT NULL COMMENT '工序代码',
    op_name         VARCHAR(128) NOT NULL COMMENT '工序名称',
    op_type         VARCHAR(32)  NOT NULL COMMENT 'PROCESS/INSPECT/TRANSIT/SUBCON',
    work_center_id  BIGINT       NOT NULL COMMENT '工作中心',
    station_id      BIGINT       NULL COMMENT '指定工位',
    equipment_id    BIGINT       NULL COMMENT '指定设备',
    plan_qty        DECIMAL(12,2) NOT NULL COMMENT '计划数量',
    completed_qty   DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '完工数量',
    scrapped_qty    DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '报废数量',
    setup_time_min  DECIMAL(8,2) NOT NULL COMMENT '准备时间(分钟)',
    run_time_min    DECIMAL(8,2) NOT NULL COMMENT '单件加工时间(分钟)',
    total_time_min  DECIMAL(10,2) NOT NULL COMMENT '总工时=准备+单件*数量',
    planned_start   DATETIME(3)  NULL COMMENT '计划开始',
    planned_end     DATETIME(3)  NULL COMMENT '计划结束',
    actual_start    DATETIME(3)  NULL COMMENT '实际开始',
    actual_end      DATETIME(3)  NULL COMMENT '实际结束',
    status          VARCHAR(32)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/IN_PROGRESS/COMPLETED/SKIPPED',
    is_rework       TINYINT      NOT NULL DEFAULT 0,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_order (order_id),
    INDEX idx_wc_date (work_center_id, planned_start)
) COMMENT '工单工序';

CREATE TABLE plan_scheduling_result (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    schedule_code   VARCHAR(64)  NOT NULL COMMENT '排程批次号',
    plant_id        BIGINT       NOT NULL,
    schedule_mode   VARCHAR(32)  NOT NULL COMMENT 'FORWARD/BACKWARD/FINITE/INFINITE 正向/反向/有限产能/无限产能',
    schedule_scope  VARCHAR(32)  NOT NULL COMMENT 'FULL/INCREMENTAL/WHAT_IF 全量/增量/仿真',
    schedule_date   DATE         NOT NULL COMMENT '排程基准日期',
    horizon_days    INT          NOT NULL COMMENT '排程窗口(天)',
    status          VARCHAR(32)  NOT NULL DEFAULT 'RUNNING' COMMENT 'RUNNING/COMPLETED/FAILED',
    started_at      DATETIME(3)  NOT NULL COMMENT '开始执行时间',
    completed_at    DATETIME(3)  NULL COMMENT '完成时间',
    affected_orders INT          NOT NULL DEFAULT 0 COMMENT '受影响工单数',
    conflict_count  INT          NOT NULL DEFAULT 0 COMMENT '冲突数(产能超载/交期冲突)',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0
) COMMENT '排程执行记录';
```

### 3.3 产能负荷

```sql
CREATE TABLE plan_capacity_load (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    work_center_id  BIGINT       NOT NULL COMMENT '工作中心',
    load_date       DATE         NOT NULL COMMENT '负荷日期',
    shift_id        BIGINT       NULL COMMENT '班次',
    available_cap   DECIMAL(12,2) NOT NULL COMMENT '可用产能(分钟)',
    required_cap    DECIMAL(12,2) NOT NULL COMMENT '需求产能(分钟)',
    load_pct        DECIMAL(5,2) NOT NULL COMMENT '负荷率(%)=需求/可用*100',
    order_count     INT          NOT NULL DEFAULT 0 COMMENT '占用工单数',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_wc_date_shift (work_center_id, load_date, shift_id)
) COMMENT '产能负荷';
```

### 3.4 物料需求展开

```sql
CREATE TABLE plan_material_requirement (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT       NOT NULL COMMENT '工单ID',
    op_id           BIGINT       NULL COMMENT '工序ID(工序级用料)',
    material_id     BIGINT       NOT NULL COMMENT '物料ID',
    required_qty    DECIMAL(12,2) NOT NULL COMMENT '需求数量',
    required_date   DATE         NOT NULL COMMENT '需求日期',
    on_hand_qty     DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '当前在库量',
    in_transit_qty  DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '在途量(已下单未到货)',
    allocated_qty   DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '已分配量(其他工单占用)',
    available_qty   DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '可用量=在库+在途-已分配',
    shortage_qty    DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '缺料量=需求-可用(若>0)',
    issue_type      VARCHAR(32)  NOT NULL DEFAULT 'PICK' COMMENT 'PICK/BACKFLUSH',
    bom_level       INT          NOT NULL DEFAULT 1 COMMENT 'BOM层级',
    bom_item_id     BIGINT       NULL COMMENT 'BOM行项目ID',
    status          VARCHAR(32)  NOT NULL DEFAULT 'NOT_READY' COMMENT 'NOT_READY/READY/ISSUED',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_order (order_id),
    INDEX idx_material_date (material_id, required_date)
) COMMENT '工单物料需求';
```

## 4. 核心业务流程

### 4.1 工单创建与下达

```
销售订单/预测 ──→ 需求池 ──→ MPS ──→ 生成工单(草稿)
                                        │
                                        ▼
                                   BOM展开+物料需求计算
                                        │
                                        ▼
                                   齐套检查 ──→ 不齐套 → 挂起+缺料预警
                                        │
                                      齐套
                                        │
                                        ▼
                                   排程(分配工作中心+时间)
                                        │
                                        ▼
                                   工单下达(RELEASED) ──→ 车间可执行
```

### 4.2 动态插单

```
紧急订单 ──→ 创建高优先级工单 ──→ 排程引擎重排
                                        │
                                        ▼
                               ┌──────────────────────┐
                               │ 受影响工单列表        │
                               │ - 延后工单(交期风险)  │
                               │ - 不变工单            │
                               └──────────────────────┘
                                        │
                                        ▼
                               人工确认/调整 ──→ 确认排程结果
```

## 5. 核心业务规则

| 编号 | 规则 | 说明 |
|------|------|------|
| P-R001 | 工单下达前必齐套 | material_status 必须为 READY 才允许 status 转为 RELEASED |
| P-R002 | 工单数量不可为负 | order_qty > 0，completed_qty + scrapped_qty ≤ order_qty |
| P-R003 | 工序完工不可超工单 | 工序 completed_qty 之和 ≤ order_qty |
| P-R004 | 排程冲突必须确认 | 排程结果 conflict_count > 0 时需人工确认后才生效 |
| P-R005 | 已下达工单不可删 | status ≥ RELEASED 后只能取消(CANCELLED)，不可物理删除 |
| P-R006 | 产能负荷超载预警 | load_pct > 90% 触发黄色预警，> 100% 触发红色预警 |
| P-R007 | BOM 展开含损耗 | 物料需求 = 用量 × (1 + scrap_rate/100) × 工单数量 |
| P-R008 | 倒冲料完工时自动扣减 | issue_type=BACKFLUSH 的物料在工序报工时自动生成扣料记录 |

## 6. 接口清单

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/work-orders | 创建工单 |
| GET | /api/v1/work-orders | 工单列表（分页+状态+工厂+日期筛选） |
| GET | /api/v1/work-orders/{id} | 工单详情（含工序+物料需求） |
| PUT | /api/v1/work-orders/{id} | 更新工单（仅 CREATED 状态） |
| POST | /api/v1/work-orders/{id}/release | 工单下达（含齐套检查） |
| POST | /api/v1/work-orders/{id}/cancel | 取消工单 |
| POST | /api/v1/work-orders/{id}/close | 关闭工单 |
| POST | /api/v1/work-orders/batch-release | 批量下达 |
| GET | /api/v1/work-orders/{id}/material-check | 齐套检查 |
| GET | /api/v1/work-orders/{id}/material-requirements | 物料需求展开 |
| POST | /api/v1/scheduling/run | 执行排程 |
| GET | /api/v1/scheduling/results/{code} | 排程结果查询 |
| GET | /api/v1/capacity/load | 产能负荷查询（按工作中心+日期范围） |
| GET | /api/v1/capacity/gantt | 甘特图数据（按产线/工作中心） |
| POST | /api/v1/scheduling/what-if | What-If 排程仿真 |
| GET | /api/v1/atp | ATP 可承诺量查询 |

## 6. 使用对象

| 角色 | 说明 | 使用频率 |
|------|------|---------|
| **PMC 计划员** | 编制主计划、创建/下达工单、排程调整、插单处理 | 日常高频（每日核心工作） |
| **生产调度** | 查看排程结果、调整工单优先级、处理排程冲突 | 日常高频 |
| **车间主任** | 查看本车间工单进度、产能负荷、缺料预警 | 日常中频 |
| **销售客服** | ATP/CTP 交期查询、订单进度跟踪 | 接单时查询 |
| **采购员** | 查看缺料清单、触发采购需求 | 工单下达后 |
| **仓管员** | 查看齐套检查结果、准备领料 | 工单下达后 |

## 7. 使用场景

### 场景 1：日排程（每日晨会前）

| 项目 | 内容 |
|------|------|
| **触发时间** | 每日 8:00 晨会前 |
| **前提条件** | ERP 销售订单已同步至需求池，前日工单完工数据已回写 |
| **操作人** | PMC 计划员 |
| **步骤** | ① 查看需求池（新订单+未完成订单） → ② 执行排程（有限产能模式） → ③ 查看排程结果+冲突列表 → ④ 人工调整冲突工单（拖拽甘特图） → ⑤ 确认排程 → ⑥ 批量下达齐套工单 |
| **完成标志** | 当日工单已下达至车间，排程甘特图无红色冲突 |

### 场景 2：紧急插单

| 项目 | 内容 |
|------|------|
| **触发时间** | 客户紧急订单到达，需优先排产 |
| **前提条件** | 需求已录入需求池，优先级设为 1 |
| **操作人** | PMC 计划员 |
| **步骤** | ① 创建高优先级工单 → ② 执行增量排程 → ③ 查看受影响工单（延后列表+交期风险） → ④ 确认插单 → ⑤ 通知受影响订单的销售跟进 |
| **风险** | 插单可能导致其他订单延后，需销售确认 |

### 场景 3：齐套检查与下达

| 项目 | 内容 |
|------|------|
| **触发时间** | 工单排程确认后，准备下达前 |
| **前提条件** | 工单状态为 CREATED，BOM 已展开物料需求 |
| **操作人** | PMC 计划员 |
| **步骤** | ① 选择待下达工单 → ② 点击「齐套检查」 → ③ 查看结果：齐套率 100%→可下达 / 缺料→查看缺料清单 → ④ 缺料时：通知采购跟进 / 部分齐套时可选择部分下达 → ⑤ 齐套工单点击「下达」 |
| **约束** | 齐套率 < 100% 时系统警告，可配置是否强制允许下达 |

### 场景 4：ATP 交期承诺

| 项目 | 内容 |
|------|------|
| **触发时间** | 销售接单时需向客户承诺交期 |
| **前提条件** | 物料主数据含采购提前期，工作中心产能已配置 |
| **操作人** | 销售客服 |
| **步骤** | ① 输入产品+数量 → ② 系统计算 ATP（可用库存+计划产出-已分配） → ③ 若 ATP 不足，计算 CTP（考虑产能+采购提前期的最早可交日期） → ④ 返回可承诺交期 |
| **输出** | 可交数量 + 最早交期 + 产能瓶颈提示 |

## 8. 使用方法

### 8.1 工单创建与下达

1. 进入「计划排产 → 工单管理」
2. 点击「新建工单」：选择产品、数量、交期、优先级
3. 系统自动加载默认 BOM 和工艺路线
4. 保存后状态为 CREATED
5. 点击「齐套检查」，确认物料齐套
6. 点击「下达」，工单状态变为 RELEASED，车间可见

### 8.2 甘特图排程

1. 进入「计划排产 → 排程看板」
2. 选择工厂+日期范围，加载甘特图
3. 横轴=时间（按小时），纵轴=工作中心/产线
4. 工单以色块显示（绿色=正常/黄色=临近交期/红色=逾期）
5. 拖拽工单色块调整排程
6. 双击色块查看工单详情
7. 点击「执行排程」让系统自动优化
8. 确认排程结果

### 8.3 产能负荷查看

1. 进入「计划排产 → 产能分析」
2. 选择工作中心+日期范围
3. 柱状图展示：可用产能(蓝色) vs 需求产能(橙色)
4. 负荷率 > 90% 黄色预警，> 100% 红色预警
5. 点击柱状图下钻到具体工单

## 9. UI 示意

### 9.1 工单列表

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  计划排产 > 工单管理                                                              │
├──────────────────────────────────────────────────────────────────────────────────┤
│  筛选: [工厂▼] [状态▼] [优先级▼] [交期: __至__]  搜索: [____________] 🔍         │
│                                                    [新建工单] [批量下达] [导出] │
├────┬────────────┬──────────┬──────┬──────┬────────┬────────┬──────┬─────────────┤
│ ☐  │ 工单号      │ 产品     │ 数量  │ 交期  │ 优先级  │ 物料状态│ 状态 │ 操作        │
├────┼────────────┼──────────┼──────┼──────┼────────┼────────┼──────┼─────────────┤
│ ☐  │WO2509050001│伺服电机  │ 500  │09/15 │ P1-紧急│ ✅齐套  │已下达│ [详情][进度]│
│ ☐  │WO2509050002│驱动模组  │ 200  │09/20 │ P3-普通│ ✅齐套  │已下达│ [详情][进度]│
│ ☐  │WO2509050003│控制板    │ 1000 │09/18 │ P2-较急│ ⚠️缺料  │草稿  │ [齐套][下达]│
│ ☐  │WO2509050004│传感器    │ 300  │09/25 │ P5-普通│ ✅齐套  │草稿  │ [齐套][下达]│
├────┴────────────┴──────────┴──────┴──────┴────────┴────────┴──────┴─────────────┤
│  共 56 条  < 1  2  3 ... 6 >                                                    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 排程甘特图

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  计划排产 > 排程看板        工厂: [华东工厂▼]  日期: [09/05 ── 09/12]         │
│                                              [自动排程] [What-If] [确认]   │
├──────────────┬───────────────────────────────────────────────────────────────┤
│              │  09/05        09/06        09/07        09/08        09/09    │
│              │  8  12 16 20  8  12 16 20  8  12 16 20  8  12 16 20  8  12  │
├──────────────┼───────────────────────────────────────────────────────────────┤
│ WC-CNC01     │ ████████████░░░░░░░░████████████████                        │
│  (负荷 87%)  │ ^WO001(500)      ^WO002(200)                               │
├──────────────┼───────────────────────────────────────────────────────────────┤
│ WC-CNC02     │ ░░░░████████████████░░░░░░░░████████                       │
│  (负荷 72%)  │     ^WO003(1000)          ^WO004(300)                      │
├──────────────┼───────────────────────────────────────────────────────────────┤
│ WC-ASM01     │ ░░░░░░░░░░░░░░████████████████████████████                 │
│  (负荷 95%)⚠│              ^WO001(500)→装配                               │
├──────────────┼───────────────────────────────────────────────────────────────┤
│ WC-TEST      │ ░░░░░░░░░░░░░░░░░░░░░░████████████████████                │
│  (负荷 60%)  │                      ^WO001(500)→测试                      │
├──────────────┼───────────────────────────────────────────────────────────────┤
│  ██ 已排工单  ░░ 空闲  ⚠ 超载预警   拖拽色块可调整排程                      │
└──────────────┴───────────────────────────────────────────────────────────────┘
```

### 9.3 齐套检查结果

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  齐套检查结果  工单: WO2509050003  产品: 控制板  数量: 1000                  │
├──────────┬──────────┬──────┬──────┬──────┬──────┬──────┬────────────────────┤
│ 物料编码  │ 物料名称  │ 需求量│ 在库  │ 在途  │已分配 │ 缺料  │ 状态             │
├──────────┼──────────┼──────┼──────┼──────┼──────┼──────┼────────────────────┤
│ M100001  │铝合金壳体 │ 800  │ 1200 │  0   │ 500  │  0   │ ✅ 齐套           │
│ M100002  │PCB主板   │ 1000 │  600 │ 300  │ 200  │ 300  │ ❌ 缺料 300       │
│ C400001  │螺丝包    │ 1000 │ 2000 │  0   │ 800  │  0   │ ✅ 齐套           │
├──────────┴──────────┴──────┴──────┴──────┴──────┴──────┴────────────────────┤
│  齐套率: 66.7%  (2/3项齐套)    [通知采购] [部分下达] [关闭]                   │
└──────────────────────────────────────────────────────────────────────────────┘
```