# 06 设备管理模块

## 1. 业务目标

实现设备全生命周期管理，包括台账、运行监控、OEE 采集、维修闭环（纠正性+预防性）、保养计划、备件管理，为排程提供设备可用性约束，为生产提供设备状态实时反馈。

## 2. 功能清单

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 设备台账 | 设备档案、技术参数、附件/图纸、安装位置 | P0 |
| 运行状态监控 | 实时采集设备状态（运行/待机/故障/保养），状态看板 | P0 |
| OEE 采集与计算 | 可用率×性能率×质量率，按设备/产线/班次统计 | P0 |
| 故障报修 | 故障上报→派工→维修→验收闭环，记录停机时间 | P0 |
| 预防性维修 | 按时间/计数器触发保养计划，自动生成维修工单 | P0 |
| 设备保养 | 保养项目/标准、保养计划、保养执行记录 | P1 |
| 备件管理 | 备件库存、领用记录、最低库存预警 | P1 |
| MTBF/MTTR 统计 | 平均故障间隔时间/平均修复时间，衡量可靠性与维修效率 | P1 |
| 点检管理 | 日常点检标准、点检任务、异常处理 | P1 |
| 设备文档 | 操作规程、保养手册、图纸版本管理 | P2 |

## 3. 数据模型

### 3.1 设备台账

```sql
CREATE TABLE eqp_equipment (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    equip_code      VARCHAR(32)  NOT NULL COMMENT '设备编码',
    equip_name      VARCHAR(128) NOT NULL COMMENT '设备名称',
    equip_type      VARCHAR(32)  NOT NULL COMMENT 'CNC/INJECTION/PRESS/SMT/ASSEMBLY/TEST/OTHER 数控/注塑/冲压/贴片/装配/测试/其他',
    plant_id        BIGINT       NOT NULL COMMENT '所属工厂',
    workshop_id     BIGINT       NULL COMMENT '车间',
    line_id         BIGINT       NULL COMMENT '产线',
    station_id      BIGINT       NULL COMMENT '工位',
    functional_loc  VARCHAR(128) NULL COMMENT '功能位置路径 工厂>车间>产线>工位',
    brand           VARCHAR(64)  NULL COMMENT '品牌',
    model           VARCHAR(64)  NULL COMMENT '型号',
    serial_no       VARCHAR(64)  NULL COMMENT '出厂序列号',
    manufacturer    VARCHAR(128) NULL COMMENT '制造商',
    supplier_id     BIGINT       NULL COMMENT '供应商',
    purchase_date   DATE         NULL COMMENT '采购日期',
    install_date    DATE         NULL COMMENT '安装日期',
    warranty_date   DATE         NULL COMMENT '质保到期日',
    original_value  DECIMAL(14,2) NULL COMMENT '原值(元)',
    depreciation    DECIMAL(14,2) NULL COMMENT '累计折旧(元)',
    net_value       DECIMAL(14,2) NULL COMMENT '净值(元)',
    service_life    INT          NULL COMMENT '设计寿命(年)',
    status          VARCHAR(32)  NOT NULL DEFAULT 'IDLE' COMMENT 'RUNNING/IDLE/FAULT/MAINTENANCE/OVERHAUL/SCRAPPED 运行/待机/故障/维修/大修/报废',
    critical_level  VARCHAR(32)  NOT NULL DEFAULT 'B' COMMENT 'A/B/C 关键设备/重要设备/一般设备',
    meter_type      VARCHAR(32)  NULL COMMENT 'HOUR/COUNT/NONE 计时/计数/无',
    meter_reading   DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '当前计数器读数',
    last_meter_date DATE         NULL COMMENT '最后读数日期',
    erp_code        VARCHAR(64)  NULL COMMENT 'ERP设备编码',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_equip_code (equip_code, tenant_id),
    INDEX idx_plant (plant_id, status),
    INDEX idx_line (line_id)
) COMMENT '设备台账';

CREATE TABLE eqp_equipment_param (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    equip_id        BIGINT       NOT NULL COMMENT '设备ID',
    param_code      VARCHAR(64)  NOT NULL COMMENT '参数代码',
    param_name      VARCHAR(128) NOT NULL COMMENT '参数名称，如主轴转速/工作台尺寸/最大行程',
    param_value     VARCHAR(256) NOT NULL COMMENT '参数值',
    param_unit      VARCHAR(32)  NULL COMMENT '单位',
    param_category  VARCHAR(32)  NOT NULL COMMENT 'TECHNICAL/PERFORMANCE/PHYSICAL 技术/性能/物理',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_equip (equip_id)
) COMMENT '设备技术参数';
```

### 3.2 运行状态与 OEE

```sql
CREATE TABLE eqp_status_log (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    equip_id        BIGINT       NOT NULL COMMENT '设备ID',
    from_status     VARCHAR(32)  NULL COMMENT '原状态',
    to_status       VARCHAR(32)  NOT NULL COMMENT '新状态',
    change_time     DATETIME(3)  NOT NULL COMMENT '状态变更时间',
    duration_min    INT          NULL COMMENT '原状态持续时长(分钟)',
    reason          VARCHAR(256) NULL COMMENT '变更原因',
    operator_id     VARCHAR(64)  NULL COMMENT '操作人',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_equip_time (equip_id, change_time)
) COMMENT '设备状态变更日志';

CREATE TABLE eqp_oee_record (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    equip_id        BIGINT       NOT NULL COMMENT '设备ID',
    record_date     DATE         NOT NULL COMMENT '记录日期',
    shift_id        BIGINT       NULL COMMENT '班次',
    planned_time_min INT         NOT NULL COMMENT '计划生产时间(分钟)',
    run_time_min    INT          NOT NULL COMMENT '实际运行时间(分钟)',
    downtime_min    INT          NOT NULL COMMENT '停机时间(分钟)',
    ideal_cycle_sec DECIMAL(8,2) NOT NULL COMMENT '理想节拍(秒/件)',
    total_output    INT          NOT NULL COMMENT '总产出数量',
    good_output     INT          NOT NULL COMMENT '合格品数量',
    defect_output   INT          NOT NULL COMMENT '不良品数量',
    availability    DECIMAL(5,4) NOT NULL COMMENT '可用率=run_time/planned_time',
    performance     DECIMAL(5,4) NOT NULL COMMENT '性能率=(total_output*ideal_cycle/60)/run_time',
    quality         DECIMAL(5,4) NOT NULL COMMENT '质量率=good_output/total_output',
    oee             DECIMAL(5,4) NOT NULL COMMENT 'OEE=availability*performance*quality',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_equip_date_shift (equip_id, record_date, shift_id)
) COMMENT 'OEE记录';
```

### 3.3 维修管理

```sql
CREATE TABLE eqp_maintenance_order (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    mr_no           VARCHAR(64)  NOT NULL COMMENT '维修单号，如MR202509050001',
    equip_id        BIGINT       NOT NULL COMMENT '设备ID',
    mr_type         VARCHAR(32)  NOT NULL COMMENT 'CORRECTIVE/PREVENTIVE/PREDICTIVE/OVERHAUL 纠正性/预防性/预测性/大修',
    fault_code      VARCHAR(32)  NULL COMMENT '故障代码',
    fault_desc      TEXT         NOT NULL COMMENT '故障描述',
    fault_part      VARCHAR(128) NULL COMMENT '故障部位',
    severity        VARCHAR(32)  NOT NULL COMMENT 'LOW/MEDIUM/HIGH/CRITICAL',
    reporter_id     VARCHAR(64)  NOT NULL COMMENT '报修人',
    report_time     DATETIME(3)  NOT NULL COMMENT '报修时间',
    assignee_id     VARCHAR(64)  NULL COMMENT '维修人',
    assign_time     DATETIME(3)  NULL COMMENT '派工时间',
    start_time      DATETIME(3)  NULL COMMENT '维修开始时间',
    end_time        DATETIME(3)  NULL COMMENT '维修结束时间',
    downtime_min    INT          NULL COMMENT '停机时长(分钟)',
    repair_method   VARCHAR(32)  NULL COMMENT 'REPLACE/REPAIR/ADJUST/CALIBRATE 更换/修复/调整/校准',
    repair_desc     TEXT         NULL COMMENT '维修措施描述',
    root_cause      TEXT         NULL COMMENT '根本原因',
    verify_result   VARCHAR(32)  NULL COMMENT 'PASS/FAIL 验收结果',
    verify_by       VARCHAR(64)  NULL COMMENT '验收人',
    verify_time     DATETIME(3)  NULL COMMENT '验收时间',
    status          VARCHAR(32)  NOT NULL DEFAULT 'REPORTED' COMMENT 'REPORTED/ASSIGNED/IN_PROGRESS/COMPLETED/VERIFIED/CLOSED',
    source_type     VARCHAR(32)  NULL COMMENT 'MANUAL/AUTO_FAULT/AUTO_PLAN 手工/故障自动/计划自动',
    plan_id         BIGINT       NULL COMMENT '预防性维修计划ID',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_mr_no (mr_no, tenant_id),
    INDEX idx_equip (equip_id, status),
    INDEX idx_report_time (report_time)
) COMMENT '维修工单';

CREATE TABLE eqp_maintenance_part (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    mr_id           BIGINT       NOT NULL COMMENT '维修工单ID',
    material_id     BIGINT       NOT NULL COMMENT '备件物料ID',
    part_name       VARCHAR(128) NOT NULL COMMENT '备件名称',
    consumed_qty    DECIMAL(12,2) NOT NULL COMMENT '消耗数量',
    unit            VARCHAR(32)  NOT NULL,
    unit_cost       DECIMAL(14,6) NULL COMMENT '单价',
    total_cost      DECIMAL(14,2) NULL COMMENT '金额',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_mr (mr_id)
) COMMENT '维修用料';
```

### 3.4 预防性维修计划

```sql
CREATE TABLE eqp_pm_plan (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    plan_code       VARCHAR(64)  NOT NULL COMMENT '计划编码',
    plan_name       VARCHAR(128) NOT NULL COMMENT '计划名称',
    equip_id        BIGINT       NOT NULL COMMENT '设备ID',
    pm_type         VARCHAR(32)  NOT NULL COMMENT 'TIME_BASED/COUNTER_BASED/CONDITION_BASED 定期/计数器/状态',
    cycle_type      VARCHAR(32)  NULL COMMENT 'DAILY/WEEKLY/MONTHLY/QUARTERLY/YEARLY',
    cycle_value     INT          NULL COMMENT '周期值(如每3000小时)',
    cycle_unit      VARCHAR(32)  NULL COMMENT 'DAY/HOUR/COUNT',
    last_exec_date  DATE         NULL COMMENT '上次执行日期',
    last_exec_meter DECIMAL(12,2) NULL COMMENT '上次执行计数器值',
    next_exec_date  DATE         NULL COMMENT '下次计划执行日期',
    next_exec_meter DECIMAL(12,2) NULL COMMENT '下次计划执行计数器值',
    lead_time_days  INT          NOT NULL DEFAULT 3 COMMENT '提前生成天数',
    auto_create     TINYINT      NOT NULL DEFAULT 1 COMMENT '是否自动生成维修工单',
    status          VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE/INACTIVE',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_plan_code (plan_code, tenant_id),
    INDEX idx_equip (equip_id)
) COMMENT '预防性维修计划';

CREATE TABLE eqp_pm_item (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    plan_id         BIGINT       NOT NULL COMMENT '计划ID',
    item_code       VARCHAR(32)  NOT NULL COMMENT '保养项代码',
    item_name       VARCHAR(128) NOT NULL COMMENT '保养项名称，如润滑/紧固/清洁/校准',
    item_content    VARCHAR(512) NULL COMMENT '保养内容/标准',
    check_method    VARCHAR(32)  NULL COMMENT 'VISUAL/MEASURE/TEST 目视/测量/试验',
    standard_value  VARCHAR(128) NULL COMMENT '标准值',
    is_required     TINYINT      NOT NULL DEFAULT 1 COMMENT '是否必做',
    sort_order      INT          NOT NULL DEFAULT 0,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_plan (plan_id)
) COMMENT '保养项目';
```

### 3.5 点检

```sql
CREATE TABLE eqp_inspection_standard (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    standard_code   VARCHAR(64)  NOT NULL COMMENT '点检标准编码',
    standard_name   VARCHAR(128) NOT NULL COMMENT '点检标准名称',
    equip_id        BIGINT       NOT NULL COMMENT '设备ID',
    frequency       VARCHAR(32)  NOT NULL COMMENT 'DAILY/SHIFT/WEEKLY/MONTHLY',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_standard (standard_code, tenant_id)
) COMMENT '点检标准';

CREATE TABLE eqp_inspection_item (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    standard_id     BIGINT       NOT NULL,
    item_code       VARCHAR(32)  NOT NULL,
    item_name       VARCHAR(128) NOT NULL COMMENT '如主轴温度/液压压力/润滑位',
    check_method    VARCHAR(32)  NOT NULL COMMENT 'VISUAL/MEASURE/LISTEN 目视/测量/听诊',
    standard_value  VARCHAR(128) NULL COMMENT '标准值/正常范围',
    upper_limit     VARCHAR(128) NULL,
    lower_limit     VARCHAR(128) NULL,
    unit            VARCHAR(32)  NULL,
    sort_order      INT          NOT NULL DEFAULT 0,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_standard (standard_id)
) COMMENT '点检项目';

CREATE TABLE eqp_inspection_record (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    standard_id     BIGINT       NOT NULL COMMENT '点检标准ID',
    equip_id        BIGINT       NOT NULL,
    check_date      DATE         NOT NULL,
    shift_id        BIGINT       NULL,
    checker_id      VARCHAR(64)  NOT NULL COMMENT '点检人',
    check_time      DATETIME(3)  NOT NULL,
    status          VARCHAR(32)  NOT NULL DEFAULT 'NORMAL' COMMENT 'NORMAL/ABNORMAL 正常/异常',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_equip_date (equip_id, check_date)
) COMMENT '点检记录';

CREATE TABLE eqp_inspection_result (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    record_id       BIGINT       NOT NULL COMMENT '点检记录ID',
    item_id         BIGINT       NOT NULL COMMENT '点检项目ID',
    measured_value  VARCHAR(128) NULL COMMENT '实测值',
    result          VARCHAR(32)  NOT NULL COMMENT 'NORMAL/ABNORMAL',
    abnormal_desc   VARCHAR(256) NULL COMMENT '异常描述',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_record (record_id)
) COMMENT '点检结果';
```

### 3.6 备件

```sql
CREATE TABLE eqp_spare_part_stock (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    material_id     BIGINT       NOT NULL COMMENT '备件物料ID',
    plant_id        BIGINT       NOT NULL,
    wh_id           BIGINT       NOT NULL COMMENT '备件仓库',
    qty             DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '在库数量',
    allocated_qty   DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '已分配数量',
    safety_qty      DECIMAL(12,2) NULL COMMENT '安全库存',
    unit_cost       DECIMAL(14,6) NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_spare (material_id, plant_id, wh_id, tenant_id)
) COMMENT '备件库存';
```

## 4. 核心业务流程

### 4.1 故障报修闭环

```
设备故障(自动检测/人工上报)
    │
    ▼
创建维修工单(status=REPORTED)
    │
    ▼
设备状态→FAULT，关联工单工序挂起
    │
    ▼
派工(assignee) → status=ASSIGNED
    │
    ▼
维修开始 → status=IN_PROGRESS，记录start_time
    │
    ▼
维修执行(更换备件/修复/调整)
    │
    ├── 记录维修措施、根本原因
    ├── 记录备件消耗(扣减备件库存)
    └── 记录停机时长
    │
    ▼
维修完成 → status=COMPLETED，记录end_time
    │
    ▼
验收(设备试运行) → status=VERIFIED
    │
    ├── 验收通过 → 设备状态→IDLE/RUNNING，恢复挂起工单
    └── 验收不通过 → 重新派工
    │
    ▼
关闭 → status=CLOSED
```

### 4.2 预防性维修自动触发

```
定时任务(每日扫描)
    │
    ▼
遍历所有 ACTIVE 的 PM 计划:
    │
    ├── TIME_BASED: next_exec_date - lead_time ≤ 今天 → 触发
    └── COUNTER_BASED: next_exec_meter - 当前读数 ≤ 阈值 → 触发
    │
    ▼
自动创建维修工单(mr_type=PREVENTIVE, source_type=AUTO_PLAN)
    │
    ▼
更新 last_exec_date/last_exec_meter, 计算下次执行时间
```

## 5. 核心业务规则

| 编号 | 规则 | 说明 |
|------|------|------|
| E-R001 | 设备状态与工单联动 | 设备 FAULT 时自动挂起该设备上的未完工工序 |
| E-R002 | OEE 计算公式 | OEE = (run_time/planned_time) × (total_output×ideal_cycle/60/run_time) × (good_output/total_output) |
| E-R003 | 维修闭环 | 维修工单必须验收后才可关闭，不可跳过验收 |
| E-R004 | 停机时间计算 | downtime_min = end_time - report_time（含等待+维修时间） |
| E-R005 | MTBF 计算 | MTBF = Σ(故障间隔运行时间) / 故障次数 |
| E-R006 | MTTR 计算 | MTTR = Σ(维修耗时) / 维修次数 |
| E-R007 | 备件消耗扣库存 | 维修用料自动扣减备件库存，低于安全库存触发预警 |
| E-R008 | 点检异常触发 | 点检结果 ABNORMAL 自动创建异常上报，关键设备触发维修工单 |
| E-R009 | 计数器只增不减 | meter_reading 只允许递增，防止误操作 |

## 6. 接口清单

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/equipments | 设备列表 |
| GET | /api/v1/equipments/{id} | 设备详情 |
| POST | /api/v1/equipments | 创建设备 |
| PUT | /api/v1/equipments/{id} | 更新设备 |
| GET | /api/v1/equipments/{id}/status | 设备实时状态 |
| PUT | /api/v1/equipments/{id}/status | 更新设备状态 |
| GET | /api/v1/equipments/{id}/oee | OEE 查询（按日期范围） |
| POST | /api/v1/maintenance-orders | 创建维修工单 |
| GET | /api/v1/maintenance-orders | 维修工单列表 |
| PUT | /api/v1/maintenance-orders/{id}/assign | 派工 |
| PUT | /api/v1/maintenance-orders/{id}/complete | 维修完成 |
| PUT | /api/v1/maintenance-orders/{id}/verify | 验收 |
| GET | /api/v1/pm-plans | 预防性维修计划列表 |
| POST | /api/v1/pm-plans | 创建 PM 计划 |
| POST | /api/v1/inspection-records | 提交点检记录 |
| GET | /api/v1/equipments/{id}/mtbf-mttr | MTBF/MTTR 统计 |
| GET | /api/v1/spare-parts/stock | 备件库存查询 |
| GET | /api/v1/spare-parts/alert | 备件库存预警 |

## 7. 使用对象

| 角色 | 说明 | 使用频率 |
|------|------|---------|
| **设备工程师** | 设备台账维护、PM计划编制、维修工单管理、OEE分析 | 日常高频 |
| **维修技师** | 接收维修任务、执行维修、记录维修过程 | 每日高频（故障时极高频） |
| **一线操作工** | 设备点检、故障报修、设备状态查看 | 每日高频（点检/报修） |
| **班组长** | 查看本班组设备状态、停机影响、点检异常 | 每日中频 |
| **设备主管** | 维修验收、PM计划审批、OEE/MTBF/MTTR看板 | 日常中频 |
| **厂长** | 设备综合效率看板（OEE趋势/停机损失TOP5） | 周频 |

## 8. 使用场景

### 场景 1：班前点检（移动端）

| 项目 | 内容 |
|------|------|
| **触发时间** | 每班开班前（如 8:00 早班） |
| **前提条件** | 设备已配置点检项，当前班次未点检 |
| **操作人** | 一线操作工 |
| **步骤** | ① 打开APP → ② 扫描设备条码 → ③ 系统显示点检项清单 → ④ 逐项检查并录入结果（正常/异常+照片） → ⑤ 全部正常→设备状态=RUNNING / 有异常→自动创建异常上报+关键设备触发维修工单 |
| **时效** | 开班后 30 分钟内完成 |

### 场景 2：故障报修

| 项目 | 内容 |
|------|------|
| **触发时间** | 设备发生故障停机时 |
| **前提条件** | 无特殊前提 |
| **操作人** | 一线操作工（报修），设备工程师（派工），维修技师（执行） |
| **步骤** | ① 操作工点击「故障报修」→ ② 选择设备+故障现象+紧急程度 → ③ 提交 → ④ 系统自动：设备状态→FAULT，挂起该设备工单工序 → ⑤ 通知设备工程师 → ⑥ 工程师派工给维修技师 → ⑦ 技师到场维修 → ⑧ 维修完成→设备状态→IDLE → ⑨ 设备工程师验收→设备状态→RUNNING |

### 场景 3：预防性维修（PM）执行

| 项目 | 内容 |
|------|------|
| **触发时间** | PM计划到达执行时间（时间型）或计数器到达阈值（计数器型） |
| **前提条件** | PM计划已激活，设备当前非故障状态 |
| **操作人** | 系统（自动触发），维修技师（执行） |
| **步骤** | ① 系统自动创建维修工单(mr_type=PREVENTIVE) → ② 通知维修技师 → ③ 技师按PM清单逐项执行 → ④ 记录更换备件+消耗数量 → ⑤ 完成提交 → ⑥ 验收 → ⑦ 系统更新PM计划下次执行时间 |

### 场景 4：OEE 分析

| 项目 | 内容 |
|------|------|
| **触发时间** | 每日/每周/每月定期分析 |
| **前提条件** | 设备运行数据已采集（运行时间/产出/合格率） |
| **操作人** | 设备工程师 / 设备主管 |
| **步骤** | ① 进入「设备管理 → OEE 分析」 → ② 选择设备+时间范围 → ③ 查看OEE三因子分解：可用率×性能率×质量率 → ④ 识别瓶颈因子 → ⑤ 下钻查看停机原因TOP5 / 小停机分布 / 降速原因 |

## 9. 使用方法

### 9.1 移动端点检

1. 打开APP，进入「设备点检」
2. 扫描设备条码
3. 系统显示点检项清单（如：主轴温度/润滑油位/异响/漏油...）
4. 逐项检查，正常→打✅，异常→打❌+拍照+描述
5. 提交点检记录

### 9.2 故障报修

1. 打开APP，点击「故障报修」
2. 选择设备（扫码或从列表选）
3. 选择故障现象（预设选项+自定义描述）
4. 选择紧急程度（紧急/一般/低优）
5. 可拍照上传
6. 提交，等待派工

### 9.3 OEE 看板

1. 进入「设备管理 → OEE 看板」
2. 选择车间/产线
3. 查看设备OEE卡片：OEE值+三因子+趋势
4. 点击设备下钻：停机原因帕累托图+时间线

## 10. UI 示意

### 10.1 移动端点检

```
┌──────────────────────────┐
│  ← 设备点检               │
│                          │
│  设备: CNC01 数控车床     │
│  位置: 机加工-A线-03工位  │
│  班次: 早班 08:00-20:00  │
│                          │
│  ┌─ 点检项 ────────────┐  │
│  │ 1. 主轴温度    ✅   │  │
│  │ 2. 润滑油位    ✅   │  │
│  │ 3. 冷却液量    ✅   │  │
│  │ 4. 异响检查    ✅   │  │
│  │ 5. 漏油检查    ❌   │  │
│  │    └ 📷 拍照  主轴密封处渗油│
│  │ 6. 安全门锁    ✅   │  │
│  │ 7. 急停按钮    ✅   │  │
│  └──────────────────────┘  │
│                          │
│  结果: 6/7 正常, 1项异常  │
│  [提交点检]               │
└──────────────────────────┘
```

### 10.2 OEE 看板

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  设备管理 > OEE看板  车间: [机加工▼]  时间: [本月▼]                           │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─ CNC01 ──────────────────────────────────────────────────────────────┐    │
│  │ OEE: 72.5%  可用率:85%  性能率:88%  质量率:97%                      │    │
│  │ ████████████████░░░░░░░░░░░░                                        │    │
│  │ 停机TOP: 换模(3h) > 待料(2h) > 故障(1.5h)                          │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─ CNC02 ──────────────────────────────────────────────────────────────┐    │
│  │ OEE: 81.2%  可用率:90%  性能率:92%  质量率:98%                      │    │
│  │ ██████████████████░░░░░░░░░░                                        │    │
│  │ 停机TOP: 换模(2h) > 保养(1.5h) > 待料(1h)                          │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─ SMT01 ──────────────────────────────────────────────────────────────┐    │
│  │ OEE: 65.8%  可用率:78%  性能率:90%  质量率:94%                      │    │
│  │ █████████████░░░░░░░░░░░░░░░░                                      │    │
│  │ 停机TOP: 故障(5h) > 换线(3h) > 待料(2h)                            │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ⚠️ OEE < 70%: SMT01  |  MTBF: CNC01=480h CNC02=720h SMT01=200h         │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 10.3 维修工单

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  设备管理 > 维修工单  MR20250905001                                           │
├──────────────────────────────────────────────────────────────────────────────┤
│  设备: CNC01  类型: 纠正性  紧急: 🔴紧急  状态: 维修中                        │
│  报修人: 张三  报修时间: 09/05 10:30  派工: 李工(维修技师)                    │
├──────────────────────────────────────────────────────────────────────────────┤
│  故障现象: 主轴密封处漏油，加工时油液飞溅                                      │
│  故障原因: [待填写]                                                           │
│  维修措施: [待填写]                                                           │
├──────────────────────────────────────────────────────────────────────────────┤
│  ┌─ 维修用料 ───────────────────────────────────────────────────────────┐    │
│  │ 备件编码    │ 备件名称     │ 数量 │ 库存余量 │                          │    │
│  │ SP-001     │ 主轴密封圈   │  2   │   15    │                          │    │
│  │ SP-012     │ 润滑脂       │  1   │    8   │                          │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  停机时长: 2h30min (计算中...)                                                │
│  [维修完成] [转验收]                                                         │
└──────────────────────────────────────────────────────────────────────────────┘
```