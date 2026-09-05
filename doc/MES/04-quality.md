# 04 质量管理模块

## 1. 业务目标

实现制造全过程的质量管控，从来料检验（IQC）→ 过程检验（IPQC）→ 完工检验（FQC）→ 出库检验（OQC）全链路覆盖，支持 SPC 统计过程控制、8D 问题闭环、正反向全批次追溯。

## 2. 功能清单

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 检验标准管理 | SIP 结构化（检验项/抽样方案/判定基准/AQL） | P0 |
| 来料检验（IQC） | 采购收货后触发，合格→入库，不合格→退货/让步接收 | P0 |
| 过程检验（IPQC） | 首检/巡检/工序完工检，与报工联动 | P0 |
| 完工检验（FQC） | 工单完工后终检，合格→入库，不合格→返工/报废 | P0 |
| 不良处理 | 不良判定→隔离→返工/报废/让步，8D 报告闭环 | P0 |
| 质量追溯 | 正向（物料→成品）+ 反向（成品→物料/设备/人员/工艺） | P0 |
| SPC 统计过程控制 | 控制图（X̄-R/X̄-S/P/C/U）、Cpk/Ppk 计算 | P1 |
| 缺陷代码库 | 标准化缺陷分类与代码，支撑不良分析 | P1 |
| CAPA 纠正预防 | 纠正措施与预防措施闭环管理 | P1 |
| 质量成本统计 | 预防成本+鉴定成本+内部故障+外部故障 | P2 |

## 3. 数据模型

### 3.1 检验标准

```sql
CREATE TABLE qc_inspection_plan (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    plan_code       VARCHAR(64)  NOT NULL COMMENT '检验标准编码',
    plan_name       VARCHAR(128) NOT NULL COMMENT '检验标准名称',
    material_id     BIGINT       NOT NULL COMMENT '适用物料ID',
    inspect_type    VARCHAR(32)  NOT NULL COMMENT 'IQC/IPQC/FQC/OQC',
    inspect_level   VARCHAR(32)  NOT NULL COMMENT 'NORMAL/TIGHTENED/REDUCED 正常/加严/放宽',
    aql_level       VARCHAR(16)  NULL COMMENT 'AQL检验水平，如II',
    aql_accept      DECIMAL(5,3) NULL COMMENT 'AQL合格判定数(%)，如0.65',
    sample_type     VARCHAR(32)  NOT NULL COMMENT 'FULL/SAMPLING/SKIP 全检/抽检/免检',
    sample_ratio    DECIMAL(5,2) NULL COMMENT '抽检比例(%)',
    min_sample_qty  INT          NULL COMMENT '最小抽样数',
    version         VARCHAR(32)  NOT NULL DEFAULT '1.0',
    status          VARCHAR(32)  NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/APPROVED/OBSOLETE',
    approved_at     DATETIME(3)  NULL,
    approved_by     VARCHAR(64)  NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_plan (plan_code, version, tenant_id),
    INDEX idx_material_type (material_id, inspect_type)
) COMMENT '检验标准';

CREATE TABLE qc_inspection_item (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    plan_id         BIGINT       NOT NULL COMMENT '检验标准ID',
    item_code       VARCHAR(32)  NOT NULL COMMENT '检验项代码',
    item_name       VARCHAR(128) NOT NULL COMMENT '检验项名称，如外观/尺寸/重量/电气性能',
    item_category   VARCHAR(32)  NOT NULL COMMENT 'APPEARANCE/DIMENSION/WEIGHT/ELECTRICAL/CHEMICAL/MECHANICAL/OTHER',
    inspect_method  VARCHAR(32)  NOT NULL COMMENT 'VISUAL/MEASURE/TEST 目视/测量/试验',
    target_value    VARCHAR(128) NULL COMMENT '目标值',
    upper_limit     VARCHAR(128) NULL COMMENT '规格上限(USL)',
    lower_limit     VARCHAR(128) NULL COMMENT '规格下限(LSL)',
    unit            VARCHAR(32)  NULL COMMENT '单位',
    is_critical     TINYINT      NOT NULL DEFAULT 0 COMMENT '是否关键特性(CTQ)',
    defect_code     VARCHAR(32)  NULL COMMENT '不合格时默认缺陷代码',
    sort_order      INT          NOT NULL DEFAULT 0,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_plan (plan_id)
) COMMENT '检验项';
```

### 3.2 检验执行

```sql
CREATE TABLE qc_inspection_order (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    inspect_no      VARCHAR(64)  NOT NULL COMMENT '检验单号，如QC202509050001',
    inspect_type    VARCHAR(32)  NOT NULL COMMENT 'IQC/IPQC/FQC/OQC',
    plan_id         BIGINT       NOT NULL COMMENT '检验标准ID',
    source_type     VARCHAR(32)  NOT NULL COMMENT 'WORK_ORDER/PO_RECEIPT/DELIVERY 工单/采购收货/发货',
    source_id       BIGINT       NOT NULL COMMENT '来源单据ID',
    source_no       VARCHAR(64)  NOT NULL COMMENT '来源单据号',
    source_op_id    BIGINT       NULL COMMENT '来源工序ID(IPQC时)',
    material_id     BIGINT       NOT NULL COMMENT '检验物料',
    batch_no        VARCHAR(64)  NULL COMMENT '批次号',
    lot_qty         DECIMAL(12,2) NOT NULL COMMENT '送检数量',
    sample_qty      DECIMAL(12,2) NOT NULL COMMENT '抽样数量',
    inspector_id    VARCHAR(64)  NOT NULL COMMENT '检验员',
    inspect_time    DATETIME(3)  NULL COMMENT '检验时间',
    result          VARCHAR(32)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/ACCEPTED/REJECTED/CONDITIONAL 待检/合格/不合格/让步接收',
    accept_qty      DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '合格数量',
    reject_qty      DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '不合格数量',
    rework_qty      DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '返工数量',
    scrap_qty       DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '报废数量',
    concession_qty  DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '让步接收数量',
    disposition     VARCHAR(32)  NULL COMMENT 'ACCEPT/REJECT/REWORK/SCRAP/CONCESSION 判定',
    disposition_by  VARCHAR(64)  NULL COMMENT '判定人',
    disposition_at  DATETIME(3)  NULL COMMENT '判定时间',
    status          VARCHAR(32)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/INSPECTING/JUDGED/CLOSED',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_inspect_no (inspect_no, tenant_id),
    INDEX idx_source (source_type, source_id),
    INDEX idx_material (material_id),
    INDEX idx_result (result)
) COMMENT '检验单';

CREATE TABLE qc_inspection_result (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    inspect_id      BIGINT       NOT NULL COMMENT '检验单ID',
    item_id         BIGINT       NOT NULL COMMENT '检验项ID',
    item_code       VARCHAR(32)  NOT NULL COMMENT '检验项代码',
    item_name       VARCHAR(128) NOT NULL COMMENT '检验项名称',
    sample_seq      INT          NOT NULL DEFAULT 1 COMMENT '样本序号(多次测量)',
    measured_value  VARCHAR(128) NULL COMMENT '实测值',
    numeric_value   DECIMAL(14,6) NULL COMMENT '数值型实测值(用于SPC计算)',
    target_value    VARCHAR(128) NULL COMMENT '目标值',
    upper_limit     VARCHAR(128) NULL COMMENT '规格上限',
    lower_limit     VARCHAR(128) NULL COMMENT '规格下限',
    unit            VARCHAR(32)  NULL,
    result          VARCHAR(32)  NOT NULL COMMENT 'PASS/FAIL/NA 合格/不合格/不适用',
    defect_code     VARCHAR(32)  NULL COMMENT '缺陷代码(不合格时)',
    defect_desc     VARCHAR(256) NULL COMMENT '缺陷描述',
    inspector_id    VARCHAR(64)  NOT NULL COMMENT '检验人',
    inspect_time    DATETIME(3)  NOT NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_inspect (inspect_id),
    INDEX idx_item (item_id)
) COMMENT '检验结果明细';
```

### 3.3 不良处理与 8D

```sql
CREATE TABLE qc_defect_code (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    defect_code     VARCHAR(32)  NOT NULL COMMENT '缺陷代码，如D001',
    defect_name     VARCHAR(128) NOT NULL COMMENT '缺陷名称，如划伤/尺寸超差/虚焊',
    defect_category VARCHAR(32)  NOT NULL COMMENT 'APPEARANCE/DIMENSION/PERFORMANCE/ASSEMBLY/OTHER',
    severity        VARCHAR(32)  NOT NULL COMMENT 'MINOR/MAJOR/CRITICAL 轻微/重大/致命',
    is_scrap        TINYINT      NOT NULL DEFAULT 0 COMMENT '是否直接报废',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_defect_code (defect_code, tenant_id)
) COMMENT '缺陷代码库';

CREATE TABLE qc_nonconformance (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    nc_no           VARCHAR(64)  NOT NULL COMMENT '不良品单号',
    inspect_id      BIGINT       NOT NULL COMMENT '关联检验单ID',
    material_id     BIGINT       NOT NULL,
    batch_no        VARCHAR(64)  NULL,
    nc_qty          DECIMAL(12,2) NOT NULL COMMENT '不良数量',
    defect_code     VARCHAR(32)  NOT NULL COMMENT '缺陷代码',
    defect_desc     VARCHAR(512) NULL COMMENT '缺陷描述',
    discovery_point VARCHAR(32)  NOT NULL COMMENT 'IQC/IPQC/FQC/CUSTOMER 发现环节',
    disposition     VARCHAR(32)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/REWORK/SCRAP/CONCESSION/RETURN 待处理/返工/报废/让步/退货',
    disposition_qty DECIMAL(12,2) NULL COMMENT '处理数量',
    disposition_by  VARCHAR(64)  NULL,
    disposition_at  DATETIME(3)  NULL,
    status          VARCHAR(32)  NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN/DISPOSED/PROCESSING/CLOSED',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_nc_no (nc_no, tenant_id),
    INDEX idx_inspect (inspect_id)
) COMMENT '不良品处理';

CREATE TABLE qc_8d_report (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    report_no       VARCHAR(64)  NOT NULL COMMENT '8D报告号',
    nc_id           BIGINT       NOT NULL COMMENT '关联不良品单ID',
    title           VARCHAR(256) NOT NULL COMMENT '问题描述',
    d1_team         TEXT         NULL COMMENT 'D1-成立团队',
    d2_problem      TEXT         NULL COMMENT 'D2-问题描述(5W2H)',
    d3_interim      TEXT         NULL COMMENT 'D3-临时遏制措施',
    d4_root_cause   TEXT         NULL COMMENT 'D4-根本原因分析(5Why/Fishbone)',
    d5_corrective   TEXT         NULL COMMENT 'D5-纠正措施',
    d6_preventive   TEXT         NULL COMMENT 'D6-预防措施',
    d7_verify       TEXT         NULL COMMENT 'D7-效果验证',
    d8_congratulate TEXT         NULL COMMENT 'D8-总结与祝贺',
    status          VARCHAR(32)  NOT NULL DEFAULT 'D1' COMMENT 'D1~D8/CLOSED',
    owner_id        VARCHAR(64)  NOT NULL COMMENT '负责人',
    due_date        DATE         NULL COMMENT '截止日期',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_report_no (report_no, tenant_id)
) COMMENT '8D报告';
```

### 3.4 质量追溯

```sql
CREATE TABLE qc_trace_link (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    trace_type      VARCHAR(32)  NOT NULL COMMENT 'MATERIAL_TO_PRODUCT/PRODUCT_TO_MATERIAL 正向/反向',
    from_type       VARCHAR(32)  NOT NULL COMMENT 'MATERIAL/BATCH/PRODUCT/SERIAL 源对象类型',
    from_id         BIGINT       NOT NULL COMMENT '源对象ID',
    from_code       VARCHAR(64)  NOT NULL COMMENT '源对象编码',
    to_type         VARCHAR(32)  NOT NULL COMMENT '目标对象类型',
    to_id           BIGINT       NOT NULL COMMENT '目标对象ID',
    to_code         VARCHAR(64)  NOT NULL COMMENT '目标对象编码',
    order_id        BIGINT       NULL COMMENT '关联工单',
    op_id           BIGINT       NULL COMMENT '关联工序',
    equipment_id    BIGINT       NULL COMMENT '关联设备',
    worker_id       VARCHAR(64)  NULL COMMENT '关联操作人',
    link_time       DATETIME(3)  NOT NULL COMMENT '关联时间',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_from (from_type, from_id),
    INDEX idx_to (to_type, to_id),
    INDEX idx_order (order_id)
) COMMENT '追溯链';
```

### 3.5 SPC

```sql
CREATE TABLE qc_spc_chart (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    chart_code      VARCHAR(64)  NOT NULL COMMENT '控制图编码',
    chart_name      VARCHAR(128) NOT NULL COMMENT '控制图名称',
    material_id     BIGINT       NOT NULL COMMENT '物料',
    item_id         BIGINT       NOT NULL COMMENT '检验项',
    chart_type      VARCHAR(32)  NOT NULL COMMENT 'XBAR_R/XBAR_S/P/C/U 均值-极差/均值-标准差/不合格率/缺陷数/单位缺陷数',
    subgroup_size   INT          NOT NULL COMMENT '子组大小',
    target_value    DECIMAL(14,6) NULL COMMENT '中心线(CL)',
    ucl             DECIMAL(14,6) NULL COMMENT '控制上限(UCL)',
    lcl             DECIMAL(14,6) NULL COMMENT '控制下限(LCL)',
    usl             DECIMAL(14,6) NULL COMMENT '规格上限',
    lsl             DECIMAL(14,6) NULL COMMENT '规格下限',
    cpk             DECIMAL(5,2) NULL COMMENT 'Cpk值',
    ppk             DECIMAL(5,2) NULL COMMENT 'Ppk值',
    status          VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_chart (chart_code, tenant_id)
) COMMENT 'SPC控制图';

CREATE TABLE qc_spc_data_point (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    chart_id        BIGINT       NOT NULL COMMENT '控制图ID',
    subgroup_seq    INT          NOT NULL COMMENT '子组序号',
    subgroup_time   DATETIME(3)  NOT NULL COMMENT '子组时间',
    sample_values   VARCHAR(512) NOT NULL COMMENT '子组内样本值，JSON数组如[10.01,10.02,10.00]',
    x_bar           DECIMAL(14,6) NOT NULL COMMENT '子组均值',
    range_val       DECIMAL(14,6) NULL COMMENT '子组极差(R)',
    sigma_val       DECIMAL(14,6) NULL COMMENT '子组标准差(S)',
    is_out_of_ctrl  TINYINT      NOT NULL DEFAULT 0 COMMENT '是否出控',
    ooc_rule        VARCHAR(32)  NULL COMMENT '违反的判异规则，如NELSON_RULE_1',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_chart_seq (chart_id, subgroup_seq)
) COMMENT 'SPC数据点';
```

## 4. 核心业务流程

### 4.1 检验执行流程

```
触发事件(收货/报工完工/工单完工/出库)
    │
    ▼
查找检验标准(物料+检验类型)
    │
    ├──→ 免检(SKIP) → 直接合格，放行
    │
    └──→ 全检/抽检 → 创建检验单
              │
              ▼
         检验员录入检验结果(逐项判定)
              │
              ▼
         汇总判定:
         ├── 全项合格 → ACCEPTED → 放行(入库/流转)
         ├── 存在不合格项 → REJECTED → 不良品处理
         └── 让步接收 → CONDITIONAL → 审批后放行
```

### 4.2 质量追溯流程

```
反向追溯（成品→原材料）:
  成品序列号/批次号
    → 查 trace_link (to_code=成品)
    → 获取所有 from_code (原材料批次/半成品批次)
    → 递归展开至最底层原材料
    → 同时获取关联的设备/人员/工艺参数

正向追溯（原材料→成品）:
  原材料批次号
    → 查 trace_link (from_code=原材料批次)
    → 获取所有 to_code (半成品/成品)
    → 递归展开至最顶层成品
    → 获取所有受影响的客户/订单
```

## 5. 核心业务规则

| 编号 | 规则 | 说明 |
|------|------|------|
| Q-R001 | 检验标准审批后只读 | APPROVED 状态的检验标准不可修改，需创建新版本 |
| Q-R002 | 不合格必须处理 | 检验结果 REJECTED 必须创建不良品处理单，不可直接放行 |
| Q-R003 | 让步接收需审批 | CONDITIONAL 判定需指定审批人确认后才生效 |
| Q-R004 | 追溯链不可断 | 每次投料/报工必须写入 trace_link，确保追溯链完整 |
| Q-R005 | SPC 出控报警 | 数据点出控时自动触发异常通知，并标记 is_out_of_ctrl=1 |
| Q-R006 | Cpk 阈值预警 | Cpk < 1.33 黄色预警，Cpk < 1.0 红色预警（过程能力不足） |
| Q-R007 | 关键特性全检 | is_critical=1 的检验项强制全检，不可设为抽检 |
| Q-R008 | 8D 必须闭环 | 不良品单关联 8D 报告时，8D 必须 D8 完成才可关闭不良品单 |

## 6. 接口清单

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/inspection-plans | 创建检验标准 |
| GET | /api/v1/inspection-plans | 检验标准列表 |
| POST | /api/v1/inspection-plans/{id}/approve | 审批检验标准 |
| POST | /api/v1/inspection-orders | 创建检验单 |
| GET | /api/v1/inspection-orders | 检验单列表 |
| GET | /api/v1/inspection-orders/{id} | 检验单详情（含结果明细） |
| POST | /api/v1/inspection-orders/{id}/results | 提交检验结果 |
| PUT | /api/v1/inspection-orders/{id}/judge | 判定（合格/不合格/让步） |
| POST | /api/v1/nonconformances | 创建不良品单 |
| PUT | /api/v1/nonconformances/{id}/dispose | 不良品处置 |
| POST | /api/v1/8d-reports | 创建8D报告 |
| PUT | /api/v1/8d-reports/{id}/update-step | 更新8D步骤 |
| GET | /api/v1/trace/forward | 正向追溯 |
| GET | /api/v1/trace/backward | 反向追溯 |
| GET | /api/v1/spc/charts | SPC控制图列表 |
| GET | /api/v1/spc/charts/{id}/data | SPC数据点查询 |
| POST | /api/v1/spc/charts/{id}/calculate | 重新计算控制限与Cpk |

## 6. 使用对象

| 角色 | 说明 | 使用频率 |
|------|------|---------|
| **质量工程师** | 维护检验标准、缺陷代码库、SPC 控制图配置、8D 报告 | 日常中频+异常时高频 |
| **检验员（IQC/IPQC/FQC）** | 执行来料/过程/完工检验，录入检验结果 | 每日极高频（核心操作） |
| **质量主管** | 不良品判定审批、让步接收审批、8D 报告审核 | 日常中频 |
| **一线操作工** | 首检/巡检时录入自检数据（移动端） | 每日高频 |
| **客户/销售** | 质量追溯查询（客诉时反向追溯） | 客诉时 |
| **工艺工程师** | 查看 SPC 控制图、Cpk 趋势，分析工艺稳定性 | 周频 |

## 7. 使用场景

### 场景 1：来料检验（IQC）

| 项目 | 内容 |
|------|------|
| **触发时间** | 采购收货入库时，物料检验类型≠免检 |
| **前提条件** | 入库单已创建，物料有检验标准(IQC) |
| **操作人** | IQC 检验员 |
| **步骤** | ① 收到检验任务通知 → ② 扫码识别来料批次 → ③ 按检验标准逐项检验 → ④ 录入检验结果（合格/不合格/实测值） → ⑤ 系统汇总判定 → ⑥ 合格→放行入库 / 不合格→创建不良品单 |
| **时效要求** | IQC 需在收货后 4 小时内完成 |

### 场景 2：过程检验（IPQC — 首检/巡检）

| 项目 | 内容 |
|------|------|
| **触发时间** | 首检：工序首件完工时；巡检：按巡检间隔自动触发 |
| **前提条件** | 工序报工完工触发，或巡检定时器触发 |
| **操作人** | IPQC 检验员 或 一线操作工(自检) |
| **步骤** | ① 首检：工序首件报工后自动创建检验单 → ② 检验员到工位取样 → ③ 按SIP逐项检验 → ④ 录入结果 → ⑤ 合格→工序可继续流转 / 不合格→停线，通知班组长 |
| **关键** | 首检不合格时，该工序暂停流转，必须处理后才可恢复 |

### 场景 3：完工检验（FQC）

| 项目 | 内容 |
|------|------|
| **触发时间** | 工单所有工序完工后 |
| **前提条件** | 工单状态=COMPLETED，产品有FQC检验标准 |
| **操作人** | FQC 检验员 |
| **步骤** | ① 工单完工触发FQC检验任务 → ② 按AQL抽样方案取样 → ③ 逐项检验 → ④ 判定：合格→入库 / 不合格→不良品处理(返工/报废/让步) |

### 场景 4：质量追溯（客诉场景）

| 项目 | 内容 |
|------|------|
| **触发时间** | 客户投诉产品存在质量问题 |
| **前提条件** | 成品有序列号或批次号 |
| **操作人** | 质量工程师 |
| **步骤** | ① 输入成品序列号/批次号 → ② 反向追溯：成品→半成品→原材料批次 → ③ 查看关联的设备/人员/工艺参数 → ④ 定位问题根因 → ⑤ 正向追溯：同一原材料批次还影响了哪些成品 → ⑥ 通知受影响客户 |

### 场景 5：SPC 监控

| 项目 | 内容 |
|------|------|
| **触发时间** | 每次检验结果写入后自动更新控制图 |
| **前提条件** | SPC控制图已配置并激活 |
| **操作人** | 质量工程师（查看+分析），系统（自动检测出控） |
| **步骤** | ① 系统自动将检验数据点加入控制图 → ② 检测是否出控（Nelson规则） → ③ 出控时自动通知 → ④ 质量工程师查看控制图+Cpk → ⑤ 分析原因，采取纠正措施 |

## 8. 使用方法

### 8.1 检验执行（移动端/PC）

1. 收到检验任务通知（站内信/APP推送）
2. 进入「质量管理 → 检验执行」，或移动端扫码进入
3. 查看检验标准：检验项列表+抽样方案
4. 逐项检验，录入结果：
   - 定性项（外观）：选择 PASS/FAIL
   - 定量项（尺寸/重量）：录入实测值，系统自动判定是否超差
5. 全部检验项完成后，系统汇总判定
6. 合格→确认放行；不合格→选择处置方式

### 8.2 质量追溯

1. 进入「质量管理 → 质量追溯」
2. 选择追溯方向：正向(物料→成品) / 反向(成品→物料)
3. 输入起始编号（序列号/批次号）
4. 系统展开追溯链，以树形/图形展示
5. 点击节点查看详情（设备/人员/参数/时间）

### 8.3 SPC 控制图查看

1. 进入「质量管理 → SPC 分析」
2. 选择控制图（物料+检验项）
3. 查看控制图：CL/UCL/LCL 线 + 数据点
4. 出控点红色标记，点击查看详情
5. 查看右侧 Cpk/Ppk 指标
6. Cpk < 1.33 黄色预警，< 1.0 红色预警

## 9. UI 示意

### 9.1 检验执行页面

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  质量管理 > 检验执行  检验单: QC202509050001                                  │
├──────────────────────────────────────────────────────────────────────────────┤
│  类型: IPQC(首检)  物料: 伺服电机  批次: B20250905  送检: 5  抽样: 5         │
│  工单: WO2509050001  工序: OP30 首检                                         │
├──────┬──────────────┬──────────┬──────────┬──────────┬──────┬────────────────┤
│ 序号 │ 检验项        │ 方法     │ 标准值   │ 实测值   │ 判定 │ 缺陷代码       │
├──────┼──────────────┼──────────┼──────────┼──────────┼──────┼────────────────┤
│  1   │ 外观-划伤     │ 目视     │ 无划伤   │ 无划伤   │ ✅   │                │
│  2   │ 外观-色差     │ 目视     │ 无色差   │ 无色差   │ ✅   │                │
│  3   │ 尺寸-外径     │ 测量     │ 52.0±0.1 │ 52.03   │ ✅   │                │
│  4   │ 尺寸-长度     │ 测量     │ 120±0.2  │ 120.35  │ ❌   │ D002 尺寸超差  │
│  5   │ 电气-绝缘     │ 测试     │ ≥100MΩ   │ 150MΩ   │ ✅   │                │
├──────┴──────────────┴──────────┴──────────┴──────────┴──────┴────────────────┤
│  汇总: 合格4项 / 不合格1项  → 判定: ❌ 不合格                                │
│                                                                              │
│  处置: ○ 返工  ○ 报废  ○ 让步接收  ● 创建不良品单                            │
│                                              [确认判定] [保存草稿]           │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 质量追溯树

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  质量管理 > 质量追溯  方向: [反向▼]  起始: [SN20250905001] [追溯]            │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  📦 SN20250905001 伺服电机(成品)                                             │
│  ├── 📦 B20250905-A 驱动模组(半成品)                                        │
│  │   ├── 📦 B20250903-M1 铝合金壳体(原材料)  供应商: 华铝                   │
│  │   │   └── 👤 操作: 张三  设备: CNC01  参数: 转速8000                     │
│  │   └── 📦 B20250903-M2 PCB主板(原材料)     供应商: 深南                    │
│  │       └── 👤 操作: 李四  设备: SMT02  参数: 回焊245°C                    │
│  └── 📦 B20250904-C1 螺丝包(消耗品)          供应商: 标件                    │
│                                                                              │
│  💡 同批次原材料 B20250903-M1 还用于:                                        │
│     → SN20250905002, SN20250905003 (共3台成品受影响)                         │
│                                                                              │
│  [导出追溯报告]  [正向追溯]                                                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 9.3 SPC 控制图

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  质量管理 > SPC分析  物料: [伺服电机▼]  检验项: [外径▼]  图类型: [X̄-R▼]      │
├──────────────────────────────────────────────────────────────────────────────┤
│  X̄ 控制图                                                                    │
│  UCL ─ 52.10 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│              │    ╲  ╱╲ ╱  ╲╱  ╲╱╲  ╱╲╱╲  ╱╲╱╲╱                        │
│  CL  ─ 52.00 ┄┄╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱ │
│              │  ╱  ╲╱  ╲╱    ╱    ╲╱    ╲╱  ╲╱                          │
│  LCL ─ 51.90 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│              └──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──→   │
│                 1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 子组  │
│                                                                              │
│  ┌─ 过程能力 ───────────────────────────────────────────────────────────┐    │
│  │ Cpk = 1.52 ✅  Ppk = 1.48  |  USL=52.10  LSL=51.90  σ=0.033       │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
```