# 01 基础数据模块

## 1. 业务目标

为 MES 全模块提供统一的主数据基础，包括组织架构、工厂建模、物料主数据、BOM、工艺路线、工作中心、班次日历。基础数据的准确性和完整性直接决定计划排产、生产执行、质量追溯的可靠性。

## 2. 功能清单

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 组织架构管理 | 公司→事业部→工厂→车间→产线→工位，树形结构 | P0 |
| 工厂建模 | 工厂/车间/产线/工位四级建模，关联工作中心与库位 | P0 |
| 物料主数据 | 物料编码/类型/分类/单位/替代料/批次规则/有效期 | P0 |
| BOM 管理 | 多版本 BOM、替代料 BOM、工程 BOM→制造 BOM 转化 | P0 |
| 工艺路线管理 | 工序定义、工序参数、标准工时、并行工序、外协工序 | P0 |
| 工作中心管理 | 产能日历、可用产能、成本中心关联、人员/设备绑定 | P0 |
| 班次日历 | 多班制定义、排班规则、节假日日历 | P0 |
| 库位主数据 | 仓库/库区/储位三级建模，库位类型与存储策略 | P0 |
| 客户主数据 | 客户编码/分类/信用/发货地址 | P1 |
| 供应商主数据 | 供应商编码/分类/供货范围/评级 | P1 |

## 3. 数据模型

### 3.1 组织架构

```sql
CREATE TABLE org_company (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    company_code    VARCHAR(32)  NOT NULL COMMENT '公司代码，全局唯一',
    company_name    VARCHAR(128) NOT NULL COMMENT '公司名称',
    short_name      VARCHAR(64)  NULL COMMENT '简称',
    legal_entity    VARCHAR(128) NULL COMMENT '法人实体名称',
    currency        VARCHAR(16)  NOT NULL DEFAULT 'CNY' COMMENT '本位币',
    tax_id          VARCHAR(64)  NULL COMMENT '税号',
    status          VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE/INACTIVE',
    erp_code        VARCHAR(64)  NULL COMMENT 'ERP系统中的公司代码，如SAP Company Code',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_company_code (company_code, tenant_id)
) COMMENT '公司';

CREATE TABLE org_division (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    division_code   VARCHAR(32)  NOT NULL COMMENT '事业部编码',
    division_name   VARCHAR(128) NOT NULL COMMENT '事业部名称',
    company_id      BIGINT       NOT NULL COMMENT '所属公司',
    parent_id       BIGINT       NULL COMMENT '上级事业部，NULL表示顶级',
    manager_id      VARCHAR(64)  NULL COMMENT '负责人用户ID',
    sort_order      INT          NOT NULL DEFAULT 0,
    status          VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_company (company_id)
) COMMENT '事业部';
```

### 3.2 工厂建模

```sql
CREATE TABLE mfg_plant (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    plant_code      VARCHAR(32)  NOT NULL COMMENT '工厂编码，全局唯一',
    plant_name      VARCHAR(128) NOT NULL COMMENT '工厂名称',
    company_id      BIGINT       NOT NULL COMMENT '所属公司',
    division_id     BIGINT       NULL COMMENT '所属事业部',
    plant_type      VARCHAR(32)  NOT NULL COMMENT 'DISCRETE/PROCESS/MIXED 离散/流程/混合',
    address         VARCHAR(512) NULL COMMENT '地址',
    longitude       DECIMAL(10,6) NULL COMMENT '经度',
    latitude        DECIMAL(10,6) NULL COMMENT '纬度',
    timezone        VARCHAR(64)  NOT NULL DEFAULT 'Asia/Shanghai' COMMENT '时区',
    erp_code        VARCHAR(64)  NULL COMMENT 'ERP工厂代码',
    status          VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_plant_code (plant_code, tenant_id)
) COMMENT '工厂';

CREATE TABLE mfg_workshop (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    workshop_code   VARCHAR(32)  NOT NULL COMMENT '车间编码',
    workshop_name   VARCHAR(128) NOT NULL COMMENT '车间名称',
    plant_id        BIGINT       NOT NULL COMMENT '所属工厂',
    workshop_type   VARCHAR(32)  NULL COMMENT 'MACHINING/ASSEMBLY/PAINTING/TESTING 机加/装配/喷涂/测试',
    manager_id      VARCHAR(64)  NULL COMMENT '车间主任',
    sort_order      INT          NOT NULL DEFAULT 0,
    status          VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_workshop (workshop_code, plant_id, tenant_id)
) COMMENT '车间';

CREATE TABLE mfg_production_line (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    line_code       VARCHAR(32)  NOT NULL COMMENT '产线编码',
    line_name       VARCHAR(128) NOT NULL COMMENT '产线名称',
    workshop_id     BIGINT       NOT NULL COMMENT '所属车间',
    line_type       VARCHAR(32)  NULL COMMENT 'MANUAL/SEMI_AUTO/FULL_AUTO 手工/半自动/全自动',
    capacity_unit   VARCHAR(32)  NULL COMMENT '产能单位，如 PCS/HOUR',
    rated_capacity  DECIMAL(12,2) NULL COMMENT '额定产能',
    sort_order      INT          NOT NULL DEFAULT 0,
    status          VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_line (line_code, workshop_id, tenant_id)
) COMMENT '产线';

CREATE TABLE mfg_station (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    station_code    VARCHAR(32)  NOT NULL COMMENT '工位编码',
    station_name    VARCHAR(128) NOT NULL COMMENT '工位名称',
    line_id         BIGINT       NOT NULL COMMENT '所属产线',
    work_center_id  BIGINT       NULL COMMENT '关联工作中心',
    equipment_id    BIGINT       NULL COMMENT '绑定设备（可选，一个工位可对应一台设备）',
    station_type    VARCHAR(32)  NULL COMMENT 'PROCESS/INSPECT/PACK 加工/检验/包装',
    scan_mode       VARCHAR(32)  NOT NULL DEFAULT 'QRCODE' COMMENT 'QRCODE/BARCODE/NFC 扫码方式',
    sort_order      INT          NOT NULL DEFAULT 0,
    status          VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_station (station_code, line_id, tenant_id)
) COMMENT '工位';
```

### 3.3 物料主数据

```sql
CREATE TABLE mfg_material (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    material_code       VARCHAR(64)  NOT NULL COMMENT '物料编码，全局唯一',
    material_name       VARCHAR(256) NOT NULL COMMENT '物料名称',
    material_name_en    VARCHAR(256) NULL COMMENT '英文名称',
    material_type       VARCHAR(32)  NOT NULL COMMENT 'RAW/SEMI/FINISHED/CONSUMABLE/SPARE/PACKING 原材料/半成品/成品/消耗品/备件/包装物',
    material_group      VARCHAR(64)  NULL COMMENT '物料分组',
    base_unit           VARCHAR(32)  NOT NULL COMMENT '基本计量单位',
    alt_unit            VARCHAR(32)  NULL COMMENT '替代计量单位',
    alt_unit_ratio      DECIMAL(12,6) NULL COMMENT '替代单位换算率 base=alt*ratio',
    density             DECIMAL(12,6) NULL COMMENT '密度(g/cm³)，用于称重换算',
    weight              DECIMAL(12,4) NULL COMMENT '单重(kg)',
    volume              DECIMAL(12,4) NULL COMMENT '体积(cm³)',
    shelf_life_days     INT          NULL COMMENT '保质期(天)，NULL=无保质期',
    lot_tracking        TINYINT      NOT NULL DEFAULT 1 COMMENT '是否批次追踪 1=是 0=否',
    serial_tracking     TINYINT      NOT NULL DEFAULT 0 COMMENT '是否序列号追踪(一物一号)',
    inspection_type     VARCHAR(32)  NULL COMMENT 'INCOMING/IN_PROCESS/FINAL/SKIP 来料/过程/完工/免检',
    safety_stock        DECIMAL(12,2) NULL COMMENT '安全库存',
    min_order_qty       DECIMAL(12,2) NULL COMMENT '最小订货量',
    round_order_qty     DECIMAL(12,2) NULL COMMENT '订货倍量',
    lead_time_days      INT          NULL COMMENT '采购提前期(天)',
    make_or_buy         VARCHAR(16)  NOT NULL DEFAULT 'MAKE' COMMENT 'MAKE/BUY 自制/外购',
    bom_id              BIGINT       NULL COMMENT '默认BOM ID',
    routing_id          BIGINT       NULL COMMENT '默认工艺路线ID',
    drawing_no          VARCHAR(64)  NULL COMMENT '图号',
    drawing_rev         VARCHAR(32)  NULL COMMENT '图纸版本',
    erp_code            VARCHAR(64)  NULL COMMENT 'ERP物料编码',
    status              VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE/INACTIVE/OBSOLETE 在用/停用/淘汰',
    tenant_id           BIGINT       NOT NULL,
    created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by          VARCHAR(64)  NOT NULL,
    updated_by          VARCHAR(64)  NOT NULL,
    is_deleted          TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_material_code (material_code, tenant_id),
    INDEX idx_material_type (material_type, tenant_id),
    INDEX idx_material_group (material_group, tenant_id)
) COMMENT '物料主数据';

CREATE TABLE mfg_material_alt (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    material_id     BIGINT       NOT NULL COMMENT '主物料ID',
    alt_material_id BIGINT       NOT NULL COMMENT '替代物料ID',
    priority        INT          NOT NULL DEFAULT 1 COMMENT '替代优先级，1=最高',
    valid_from      DATE         NULL COMMENT '生效日期',
    valid_to        DATE         NULL COMMENT '失效日期',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_material (material_id)
) COMMENT '物料替代关系';
```

### 3.4 BOM（物料清单）

```sql
CREATE TABLE mfg_bom (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    bom_code        VARCHAR(64)  NOT NULL COMMENT 'BOM编码',
    bom_name        VARCHAR(128) NULL COMMENT 'BOM名称',
    product_id      BIGINT       NOT NULL COMMENT '成品/半成品物料ID',
    bom_type        VARCHAR(32)  NOT NULL COMMENT 'ENGINEERING/MANUFACTURING 工程/制造',
    bom_version     VARCHAR(32)  NOT NULL DEFAULT '1.0' COMMENT '版本号',
    is_default      TINYINT      NOT NULL DEFAULT 0 COMMENT '是否默认BOM',
    base_qty        DECIMAL(12,2) NOT NULL DEFAULT 1.00 COMMENT '基准数量(成品数量)',
    base_unit       VARCHAR(32)  NOT NULL COMMENT '基准单位',
    status          VARCHAR(32)  NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/APPROVED/OBSOLETE 草稿/已审批/淘汰',
    approved_at     DATETIME(3)  NULL COMMENT '审批时间',
    approved_by     VARCHAR(64)  NULL COMMENT '审批人',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_bom (bom_code, bom_version, tenant_id),
    INDEX idx_product (product_id)
) COMMENT 'BOM头';

CREATE TABLE mfg_bom_item (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    bom_id          BIGINT       NOT NULL COMMENT '所属BOM',
    parent_item_id  BIGINT       NULL COMMENT '父级BOM项ID，NULL表示顶层',
    level_no        INT          NOT NULL COMMENT 'BOM层级，1=第一层',
    material_id     BIGINT       NOT NULL COMMENT '子项物料ID',
    component_qty   DECIMAL(12,6) NOT NULL COMMENT '用量(相对BOM基准数量)',
    component_unit  VARCHAR(32)  NOT NULL COMMENT '用量单位',
    scrap_rate      DECIMAL(5,2) NOT NULL DEFAULT 0.00 COMMENT '损耗率(%)',
    is_phantom      TINYINT      NOT NULL DEFAULT 0 COMMENT '是否虚拟件(不入库、不领料)',
    is_bulk_issue   TINYINT      NOT NULL DEFAULT 0 COMMENT '是否倒冲(按完工反扣)',
    issue_type      VARCHAR(32)  NOT NULL DEFAULT 'PICK' COMMENT 'PICK/BACKFLUSH 领料/倒冲',
    bom_position    VARCHAR(32)  NULL COMMENT 'BOM位号，如PCB上的U1/R2',
    alt_group       VARCHAR(32)  NULL COMMENT '替代组，同组内可互替',
    effective_from  DATE         NULL COMMENT '生效日期',
    effective_to    DATE         NULL COMMENT '失效日期',
    sort_order      INT          NOT NULL DEFAULT 0,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_bom (bom_id),
    INDEX idx_parent (parent_item_id),
    INDEX idx_material (material_id)
) COMMENT 'BOM行项目';
```

### 3.5 工艺路线

```sql
CREATE TABLE mfg_routing (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    routing_code    VARCHAR(64)  NOT NULL COMMENT '工艺路线编码',
    routing_name    VARCHAR(128) NULL COMMENT '工艺路线名称',
    product_id      BIGINT       NOT NULL COMMENT '产品物料ID',
    routing_type    VARCHAR(32)  NOT NULL COMMENT 'PRIMARY/ALTERNATIVE 主路线/替代路线',
    routing_version VARCHAR(32)  NOT NULL DEFAULT '1.0',
    is_default      TINYINT      NOT NULL DEFAULT 0,
    base_qty        DECIMAL(12,2) NOT NULL DEFAULT 1.00 COMMENT '基准数量',
    status          VARCHAR(32)  NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/APPROVED/OBSOLETE',
    approved_at     DATETIME(3)  NULL,
    approved_by     VARCHAR(64)  NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_routing (routing_code, routing_version, tenant_id),
    INDEX idx_product (product_id)
) COMMENT '工艺路线头';

CREATE TABLE mfg_routing_operation (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    routing_id          BIGINT       NOT NULL COMMENT '所属工艺路线',
    op_seq              INT          NOT NULL COMMENT '工序序号，如10/20/30',
    op_code             VARCHAR(32)  NOT NULL COMMENT '工序代码，如OP10/OP20',
    op_name             VARCHAR(128) NOT NULL COMMENT '工序名称，如CNC铣削/装配/检验',
    op_type             VARCHAR(32)  NOT NULL COMMENT 'PROCESS/INSPECT/TRANSIT/SUBCON 加工/检验/转运/外协',
    work_center_id      BIGINT       NOT NULL COMMENT '工作中心',
    setup_time_min      DECIMAL(8,2) NOT NULL DEFAULT 0 COMMENT '准备时间(分钟)',
    run_time_min        DECIMAL(8,2) NOT NULL COMMENT '单件加工时间(分钟/件)',
    run_time_unit       VARCHAR(32)  NOT NULL DEFAULT 'MIN_PCS' COMMENT 'MIN_PCS/MIN_BATCH/HOUR_PCS',
    wait_time_min       DECIMAL(8,2) NOT NULL DEFAULT 0 COMMENT '等待时间(分钟)',
    move_time_min       DECIMAL(8,2) NOT NULL DEFAULT 0 COMMENT '转运时间(分钟)',
    base_qty            DECIMAL(12,2) NOT NULL DEFAULT 1 COMMENT '基准批量',
    overlap_pct         DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT '重叠百分比(%)，>0表示并行工序',
    next_op_id          BIGINT       NULL COMMENT '下一工序ID(显式指定，NULL则按序号)',
    is_milestone        TINYINT      NOT NULL DEFAULT 0 COMMENT '是否里程碑工序(完工触发报工)',
    is_rework           TINYINT      NOT NULL DEFAULT 0 COMMENT '是否返工工序',
    is_outside          TINYINT      NOT NULL DEFAULT 0 COMMENT '是否外协工序',
    outside_vendor_id   BIGINT       NULL COMMENT '外协供应商ID',
    control_code        VARCHAR(32)  NULL COMMENT '工序控制码 START/END/START_END 报工控制点',
    key_resource_id     BIGINT       NULL COMMENT '关键资源(设备)ID，排程约束',
    tenant_id           BIGINT       NOT NULL,
    created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by          VARCHAR(64)  NOT NULL,
    updated_by          VARCHAR(64)  NOT NULL,
    is_deleted          TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_routing (routing_id),
    INDEX idx_work_center (work_center_id)
) COMMENT '工艺路线工序';

CREATE TABLE mfg_routing_op_param (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    op_id           BIGINT       NOT NULL COMMENT '工序ID',
    param_code      VARCHAR(64)  NOT NULL COMMENT '参数代码，如TEMP/PRESSURE/SPEED',
    param_name      VARCHAR(128) NOT NULL COMMENT '参数名称',
    param_unit      VARCHAR(32)  NULL COMMENT '参数单位',
    standard_value  VARCHAR(128) NULL COMMENT '标准值',
    lower_limit     VARCHAR(128) NULL COMMENT '下限',
    upper_limit     VARCHAR(128) NULL COMMENT '上限',
    is_recorded     TINYINT      NOT NULL DEFAULT 1 COMMENT '是否需要报工录入',
    sort_order      INT          NOT NULL DEFAULT 0,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_op (op_id)
) COMMENT '工序参数';
```

### 3.6 工作中心

```sql
CREATE TABLE mfg_work_center (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    wc_code         VARCHAR(32)  NOT NULL COMMENT '工作中心编码',
    wc_name         VARCHAR(128) NOT NULL COMMENT '工作中心名称',
    plant_id        BIGINT       NOT NULL COMMENT '所属工厂',
    workshop_id     BIGINT       NULL COMMENT '所属车间',
    wc_type         VARCHAR(32)  NOT NULL COMMENT 'MACHINE/LINE/WORKSTATION/LAB 机器/产线/工位/实验室',
    capacity_unit   VARCHAR(32)  NOT NULL COMMENT '产能单位 PCS/HOUR/KG/HOUR',
    rated_capacity  DECIMAL(12,2) NULL COMMENT '额定产能(每班)',
    efficiency_pct  DECIMAL(5,2) NOT NULL DEFAULT 100.00 COMMENT '效率百分比(%)',
    utilization_pct DECIMAL(5,2) NOT NULL DEFAULT 85.00 COMMENT '利用率百分比(%)',
    cost_center_id  BIGINT       NULL COMMENT '关联成本中心',
    shift_model_id  BIGINT       NULL COMMENT '班次模型ID',
    calendar_id     BIGINT       NULL COMMENT '工作日历ID',
    status          VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_wc (wc_code, plant_id, tenant_id)
) COMMENT '工作中心';

CREATE TABLE mfg_work_center_resource (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    wc_id           BIGINT       NOT NULL COMMENT '工作中心ID',
    resource_type   VARCHAR(32)  NOT NULL COMMENT 'EQUIPMENT/PERSON/TOOL 设备/人员/工装',
    resource_id     BIGINT       NOT NULL COMMENT '资源ID(设备表/人员表/工装表)',
    is_primary      TINYINT      NOT NULL DEFAULT 0 COMMENT '是否主资源(排程约束)',
    from_date       DATE         NOT NULL COMMENT '生效日期',
    to_date         DATE         NOT NULL COMMENT '失效日期',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_wc (wc_id)
) COMMENT '工作中心资源绑定';
```

### 3.7 班次日历

```sql
CREATE TABLE mfg_shift_model (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    model_code      VARCHAR(32)  NOT NULL COMMENT '班次模型编码',
    model_name      VARCHAR(128) NOT NULL COMMENT '如"三班两运转"/"两班制"/"常白班"',
    shift_count     INT          NOT NULL COMMENT '每日班次数',
    cycle_days      INT          NOT NULL DEFAULT 1 COMMENT '排班周期(天)，如5天一循环',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0
) COMMENT '班次模型';

CREATE TABLE mfg_shift (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    model_id        BIGINT       NOT NULL COMMENT '班次模型ID',
    shift_code      VARCHAR(32)  NOT NULL COMMENT '班次代码 MORNING/AFTERNOON/NIGHT',
    shift_name      VARCHAR(64)  NOT NULL COMMENT '班次名称 早班/中班/晚班',
    start_time      TIME         NOT NULL COMMENT '上班时间',
    end_time        TIME         NOT NULL COMMENT '下班时间',
    break_minutes   INT          NOT NULL DEFAULT 0 COMMENT '休息时长(分钟)',
    cross_midnight  TINYINT      NOT NULL DEFAULT 0 COMMENT '是否跨午夜',
    sort_order      INT          NOT NULL DEFAULT 0,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0
) COMMENT '班次定义';

CREATE TABLE mfg_work_calendar (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    calendar_code   VARCHAR(32)  NOT NULL COMMENT '日历编码',
    calendar_name   VARCHAR(128) NOT NULL COMMENT '日历名称',
    plant_id        BIGINT       NOT NULL COMMENT '工厂',
    year            INT          NOT NULL COMMENT '年度',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0
) COMMENT '工作日历';

CREATE TABLE mfg_work_calendar_detail (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    calendar_id     BIGINT       NOT NULL COMMENT '日历ID',
    date_value      DATE         NOT NULL COMMENT '日期',
    day_type        VARCHAR(32)  NOT NULL COMMENT 'WORKDAY/HOLIDAY/WEEKEND 工作日/节假日/周末',
    shift_id        BIGINT       NULL COMMENT '当日班次，节假日为NULL',
    available_hours DECIMAL(5,2) NULL COMMENT '可用工时(小时)',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_cal_date (calendar_id, date_value)
) COMMENT '工作日历明细';
```

### 3.8 库位主数据

```sql
CREATE TABLE mfg_warehouse (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    wh_code         VARCHAR(32)  NOT NULL COMMENT '仓库编码',
    wh_name         VARCHAR(128) NOT NULL COMMENT '仓库名称',
    plant_id        BIGINT       NOT NULL COMMENT '所属工厂',
    wh_type         VARCHAR(32)  NOT NULL COMMENT 'RAW/WIP/FINISHED/SPARE/REJECT 原材料/在制品/成品/备件/不良品',
    is_managed      TINYINT      NOT NULL DEFAULT 1 COMMENT '是否库位管理(非库位管理仓库只记数量)',
    manager_id      VARCHAR(64)  NULL COMMENT '仓管员',
    status          VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_wh (wh_code, plant_id, tenant_id)
) COMMENT '仓库';

CREATE TABLE mfg_storage_location (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    wh_id           BIGINT       NOT NULL COMMENT '仓库ID',
    zone_code       VARCHAR(32)  NOT NULL COMMENT '库区编码',
    zone_name       VARCHAR(64)  NULL COMMENT '库区名称',
    bin_code        VARCHAR(32)  NOT NULL COMMENT '储位编码',
    bin_name        VARCHAR(64)  NULL COMMENT '储位名称',
    bin_type        VARCHAR(32)  NULL COMMENT 'STORAGE/PICKING/STAGING 存储位/拣选位/暂存位',
    max_weight      DECIMAL(12,2) NULL COMMENT '最大承重(kg)',
    max_volume      DECIMAL(12,2) NULL COMMENT '最大体积(cm³)',
    full_code       VARCHAR(128) NOT NULL COMMENT '全路径编码 仓库-库区-储位',
    status          VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_full_code (full_code, tenant_id)
) COMMENT '库位';
```

## 4. 核心业务规则

| 编号 | 规则 | 说明 |
|------|------|------|
| F-R001 | 物料编码唯一 | 同一租户内物料编码不可重复，删除后不可复用 |
| F-R002 | BOM 多版本共存 | 同一产品可存在多个BOM版本，仅一个为默认生效版本 |
| F-R003 | BOM 层级校验 | BOM 最多支持 10 层，禁止循环引用（A→B→A） |
| F-R004 | 工艺路线工序连续 | 工序序号必须递增，不可跳号；首工序无前序，末工序无后序 |
| F-R005 | 工作中心产能非负 | 额定产能、效率百分比、利用率百分比均 ≥ 0 |
| F-R006 | 物料替代互不循环 | 替代关系不可形成环（A替代B，B替代C，C替代A） |
| F-R007 | 库位全路径唯一 | 仓库-库区-储位组合在租户内唯一 |
| F-R008 | BOM 审批后只读 | BOM 状态为 APPROVED 后不可修改行项目，需创建新版本 |

## 5. 接口清单

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/materials | 物料列表（分页+筛选） |
| GET | /api/v1/materials/{id} | 物料详情 |
| POST | /api/v1/materials | 创建物料 |
| PUT | /api/v1/materials/{id} | 更新物料 |
| GET | /api/v1/boms | BOM 列表 |
| GET | /api/v1/boms/{id} | BOM 详情（含行项目树） |
| POST | /api/v1/boms | 创建 BOM |
| POST | /api/v1/boms/{id}/approve | 审批 BOM |
| POST | /api/v1/boms/{id}/explode | BOM 展开（按层级展开所有子项） |
| GET | /api/v1/routings | 工艺路线列表 |
| GET | /api/v1/routings/{id} | 工艺路线详情（含工序） |
| POST | /api/v1/routings | 创建工艺路线 |
| POST | /api/v1/routings/{id}/approve | 审批工艺路线 |
| GET | /api/v1/work-centers | 工作中心列表 |
| GET | /api/v1/work-centers/{id}/capacity | 工作中心产能查询 |
| GET | /api/v1/plants/{id}/structure | 工厂组织树（车间→产线→工位） |
| GET | /api/v1/work-calendars/{id}/detail | 工作日历明细查询 |
| POST | /api/v1/work-calendars/generate | 批量生成工作日历 |

## 6. 使用对象

| 角色 | 说明 | 使用频率 |
|------|------|---------|
| **系统管理员** | 负责租户级配置、组织架构搭建、权限分配 | 首次部署+低频维护 |
| **工艺工程师** | 维护 BOM、工艺路线、工作中心、标准工时 | 新品导入+变更时 |
| **主数据专员** | 物料主数据录入/维护、供应商/客户主数据 | 日常中频 |
| **车间主任** | 查看工厂建模、班次日历、工作中心产能 | 低频查看 |
| **PMC 计划员** | 查询工作中心产能、班次日历（为排产提供输入） | 日常高频 |

## 7. 使用场景

### 场景 1：新工厂/新产线初始化

| 项目 | 内容 |
|------|------|
| **触发时间** | 系统首次部署或工厂新增产线时 |
| **前提条件** | 已完成租户注册和组织架构规划 |
| **操作人** | 系统管理员 + 工艺工程师 |
| **步骤** | ① 创建公司→事业部→工厂 → ② 建模车间→产线→工位 → ③ 定义工作中心并绑定设备/人员 → ④ 配置班次模型+工作日历 → ⑤ 录入物料主数据 → ⑥ 创建 BOM+工艺路线 → ⑦ 审批 BOM/工艺路线 |
| **完成标志** | 工厂下至少有 1 条产线、1 个已审批 BOM、1 条已审批工艺路线 |

### 场景 2：新品导入（NPI）

| 项目 | 内容 |
|------|------|
| **触发时间** | 新产品试产/量产导入时 |
| **前提条件** | 工厂建模已完成，物料主数据已录入 |
| **操作人** | 工艺工程师 |
| **步骤** | ① 创建新品物料主数据 → ② 创建工程 BOM（可从 PLM 同步） → ③ 定义工艺路线+工序+标准工时 → ④ 内部审批 BOM+工艺路线 → ⑤ 转为制造 BOM（量产版本） |
| **完成标志** | 新品有 APPROVED 状态的 BOM 和工艺路线 |

### 场景 3：BOM/工艺变更

| 项目 | 内容 |
|------|------|
| **触发时间** | 工程变更通知（ECN）下发时 |
| **前提条件** | 变更已有审批通过的 BOM/工艺路线 |
| **操作人** | 工艺工程师 |
| **步骤** | ① 创建新版本 BOM/工艺路线 → ② 修改变更项 → ③ 提交审批 → ④ 审批通过后，新版本设为默认，旧版本 OBSOLETE |
| **约束** | 已下达工单仍使用原版本，新工单使用新版本 |

### 场景 4：日常物料主数据维护

| 项目 | 内容 |
|------|------|
| **触发时间** | 新物料编码申请/物料属性变更/物料淘汰 |
| **前提条件** | 无特殊前提 |
| **操作人** | 主数据专员 |
| **步骤** | ① 录入/导入物料基本信息 → ② 配置批次/序列号追踪规则 → ③ 设置检验类型(来料免检/抽检/全检) → ④ 维护替代料关系 → ⑤ 设置安全库存/采购提前期 |

## 8. 使用方法

### 8.1 物料主数据录入

1. 进入「基础数据 → 物料管理」，点击「新建物料」
2. 填写必填项：物料编码、名称、类型、基本单位、自制/外购
3. 按需填写：图号、版本、保质期、安全库存、采购提前期
4. 设置追踪规则：批次追踪(默认开启)、序列号追踪(一物一号)
5. 设置检验类型：来料免检/抽检/全检
6. 保存后状态为 ACTIVE，可立即被 BOM 引用

### 8.2 BOM 创建与审批

1. 进入「基础数据 → BOM 管理」，点击「新建 BOM」
2. 选择产品物料，填写基准数量和单位
3. 添加子项行：选择子物料、用量、损耗率、发料方式(领料/倒冲)
4. 支持多级 BOM：子项为半成品时，可继续展开其子 BOM
5. 保存为 DRAFT 状态
6. 点击「提交审批」，审批通过后状态变为 APPROVED，设为默认版本

### 8.3 工艺路线定义

1. 进入「基础数据 → 工艺路线」，点击「新建路线」
2. 选择产品物料，添加工序行
3. 每道工序设置：序号(10/20/30)、代码、名称、类型、工作中心
4. 填写时间标准：准备时间、单件加工时间、等待时间、转运时间
5. 设置并行工序：overlap_pct > 0 表示与下工序重叠百分比
6. 添加工序参数（温度/压力/速度等），设置标准值和上下限
7. 审批后生效

### 8.4 批量导入

1. 下载导入模板（Excel）
2. 按模板填写数据（支持物料/BOM/工艺路线批量导入）
3. 上传文件，系统校验（编码重复/必填项缺失/引用不存在）
4. 校验通过后批量写入，返回导入结果报告

## 9. UI 示意

### 9.1 工厂建模页面

```
┌─────────────────────────────────────────────────────────────────────────┐
│  基础数据 > 工厂建模                              [新建工厂] [导入]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  🏭 华东工厂                                              [编辑] [更多] │
│  ├── 🔧 机加工车间                                        [编辑] [更多] │
│  │   ├── 📏 CNC产线-A                                    [编辑] [更多] │
│  │   │   ├── ⚙ OP10-粗车工位    [加工]  扫码:QRCODE                   │
│  │   │   ├── ⚙ OP20-精车工位    [加工]  扫码:QRCODE                   │
│  │   │   └── ⚙ OP30-检验工位    [检验]  扫码:QRCODE                   │
│  │   └── 📏 CNC产线-B                                    [编辑] [更多] │
│  ├── 🔧 装配车间                                          [编辑] [更多] │
│  │   └── 📏 总装线                                       [编辑] [更多] │
│  └── 🔧 喷涂车间                                          [编辑] [更多] │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  💡 提示：拖拽可调整排序，点击[更多]可停用/删除                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 9.2 物料主数据列表

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  基础数据 > 物料管理                                                          │
├──────────────────────────────────────────────────────────────────────────────┤
│  筛选: [类型 ▼] [分组 ▼] [自制/外购 ▼] [状态 ▼]  搜索: [____________] 🔍    │
│                                                          [新建] [导入] [导出] │
├──────┬──────────┬────────────┬──────┬──────┬──────┬──────┬──────────────────┤
│  ☐   │ 物料编码  │ 物料名称    │ 类型  │ 单位  │自/外购│ 状态  │ 操作            │
├──────┼──────────┼────────────┼──────┼──────┼──────┼──────┼──────────────────┤
│  ☐   │ M100001  │ 铝合金壳体  │ 原材料│ KG   │ 外购  │ 在用  │ [详情][编辑][停用]│
│  ☐   │ M100002  │ PCB主板     │ 原材料│ PCS  │ 外购  │ 在用  │ [详情][编辑][停用]│
│  ☐   │ P200001  │ 驱动模组    │ 半成品│ PCS  │ 自制  │ 在用  │ [详情][编辑][停用]│
│  ☐   │ F300001  │ 伺服电机    │ 成品  │ PCS  │ 自制  │ 在用  │ [详情][编辑][停用]│
├──────┴──────────┴────────────┴──────┴──────┴──────┴──────┴──────────────────┤
│  共 1,234 条  < 1  2  3  4  5 ... 50 >     每页 [20▼]                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 9.3 BOM 编辑器

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  基础数据 > BOM管理 > 编辑                                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│  BOM编码: [BOM-2025-0012]  版本: [2.0]  状态: [草稿]                         │
│  产品: [F300001 伺服电机]  基准数量: [1] [PCS]     [设为默认BOM ☐]            │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─ 第1层 ──────────────────────────────────────────────────────────────┐    │
│  │ ① P200001 驱动模组     用量:1  损耗:0%  发料:领料  [替代料][删除]  │    │
│  │   ┌─ 第2层 ────────────────────────────────────────────────────┐    │    │
│  │   │ ② M100001 铝合金壳体  用量:0.8kg 损耗:2% 发料:领料 [删除]│    │    │
│  │   │ ③ M100002 PCB主板     用量:1   损耗:0% 发料:倒冲 [删除]  │    │    │
│  │   └────────────────────────────────────────────────────────────┘    │    │
│  │ ④ C400001 螺丝包       用量:1  损耗:0%  发料:领料  [删除]        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│                                              [添加子项] [保存] [提交审批]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 9.4 工艺路线编辑器

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  基础数据 > 工艺路线 > 编辑                                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│  路线编码: [RT-2025-0012]  版本: [1.0]  产品: [F300001 伺服电机]             │
├──────┬──────────┬──────────┬────────────┬──────────┬──────────┬──────────────┤
│ 序号 │ 工序代码  │ 工序名称  │ 类型       │ 工作中心  │ 标准工时  │ 操作         │
├──────┼──────────┼──────────┼────────────┼──────────┼──────────┼──────────────┤
│  10  │ OP10     │ CNC粗车  │ 加工       │ WC-CNC01 │ 准30+单5m │ [参数][编辑] │
│  20  │ OP20     │ CNC精车  │ 加工       │ WC-CNC01 │ 准15+单8m │ [参数][编辑] │
│  30  │ OP30     │ 首检     │ 检验       │ WC-QC01  │ 准0+单3m  │ [参数][编辑] │
│  40  │ OP40     │ 装配     │ 加工       │ WC-ASM01 │ 准20+单15m│ [参数][编辑] │
│  50  │ OP50     │ 功能测试 │ 检验       │ WC-TEST  │ 准10+单5m │ [参数][编辑] │
│  60  │ OP60     │ 包装     │ 加工       │ WC-PACK  │ 准0+单2m  │ [参数][编辑] │
├──────┴──────────┴──────────┴────────────┴──────────┴──────────┴──────────────┤
│  [添加工序] [从模板导入]                              [保存] [提交审批]      │
└──────────────────────────────────────────────────────────────────────────────┘
```