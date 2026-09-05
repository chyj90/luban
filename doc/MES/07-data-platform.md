# 07 数据智能平台

## 1. 业务目标

汇聚全模块数据，提供实时看板、自定义报表、趋势分析、AI 异常检测能力，让管理层和一线人员都能从数据中获取洞察，驱动决策优化。

## 2. 功能清单

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 实时生产看板 | 工单进度/产线状态/OEE/异常汇总，秒级刷新 | P0 |
| 交付达成看板 | 订单准交率/逾期订单/交期偏差分析 | P0 |
| 质量看板 | 不良率趋势/缺陷帕累托/SPC 出控预警 | P0 |
| 设备看板 | 设备状态/OEE/MTBF/MTTR/停机损失 | P0 |
| 自定义报表 | 拖拽式报表设计器，支持多维分析+下钻+条件筛选 | P1 |
| 趋势分析 | 同比/环比/移动平均/趋势预测 | P1 |
| AI 异常检测 | 基于历史数据训练，自动识别异常模式（产量骤降/不良率突升） | P1 |
| 报表定时推送 | 定时生成报表并推送至邮箱/企业微信/钉钉 | P1 |
| 移动端看板 | 适配手机/平板的轻量看板，厂长/车间主任移动办公 | P1 |
| 数据导出 | 报表数据导出 Excel/PDF/CSV | P2 |

## 3. 数据模型

### 3.1 看板配置

```sql
CREATE TABLE dashboard_board (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    board_code      VARCHAR(64)  NOT NULL COMMENT '看板编码',
    board_name      VARCHAR(128) NOT NULL COMMENT '看板名称',
    board_type      VARCHAR(32)  NOT NULL COMMENT 'PRODUCTION/DELIVERY/QUALITY/EQUIPMENT/CUSTOM 生产/交付/质量/设备/自定义',
    layout_config   JSON         NOT NULL COMMENT '布局配置，含组件位置/大小/数据源绑定',
    refresh_interval INT         NOT NULL DEFAULT 30 COMMENT '刷新间隔(秒)',
    is_public       TINYINT      NOT NULL DEFAULT 0 COMMENT '是否公开(所有人可见)',
    owner_id        VARCHAR(64)  NOT NULL COMMENT '创建人',
    plant_id        BIGINT       NULL COMMENT '工厂(工厂级看板)',
    status          VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_board (board_code, tenant_id)
) COMMENT '看板';

CREATE TABLE dashboard_widget (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    widget_code     VARCHAR(64)  NOT NULL COMMENT '组件编码',
    widget_name     VARCHAR(128) NOT NULL COMMENT '组件名称',
    widget_type     VARCHAR(32)  NOT NULL COMMENT 'KPI_CARD/CHART/TABLE/GAUGE/TIMELINE/STATUS_GRID KPI卡片/图表/表格/仪表盘/时间线/状态网格',
    data_source     VARCHAR(128) NOT NULL COMMENT '数据源标识，如 production_oee/quality_defect_pareto',
    query_config    JSON         NOT NULL COMMENT '查询配置：维度/度量/筛选/排序',
    display_config  JSON         NULL COMMENT '显示配置：颜色/单位/小数位/阈值',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_widget (widget_code, tenant_id)
) COMMENT '看板组件';
```

### 3.2 自定义报表

```sql
CREATE TABLE report_definition (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    report_code     VARCHAR(64)  NOT NULL COMMENT '报表编码',
    report_name     VARCHAR(128) NOT NULL COMMENT '报表名称',
    report_category VARCHAR(32)  NOT NULL COMMENT 'PRODUCTION/QUALITY/EQUIPMENT/INVENTORY/CUSTOM',
    data_source     VARCHAR(128) NOT NULL COMMENT '数据源',
    dimension_config JSON        NOT NULL COMMENT '维度配置，如 [{field:"plant_id",label:"工厂",type:"select"}]',
    measure_config  JSON         NOT NULL COMMENT '度量配置，如 [{field:"oee",label:"OEE",agg:"avg",format:"percent"}]',
    filter_config   JSON         NULL COMMENT '筛选条件配置',
    sort_config     JSON         NULL COMMENT '排序配置',
    chart_type      VARCHAR(32)  NULL COMMENT 'TABLE/BAR/LINE/PIE/SCATTER 表格/柱图/折线/饼图/散点',
    is_drill_down   TINYINT      NOT NULL DEFAULT 0 COMMENT '是否支持下钻',
    drill_config    JSON         NULL COMMENT '下钻配置',
    owner_id        VARCHAR(64)  NOT NULL,
    status          VARCHAR(32)  NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/PUBLISHED',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)  NOT NULL,
    updated_by      VARCHAR(64)  NOT NULL,
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_report (report_code, tenant_id)
) COMMENT '报表定义';
```

### 3.3 AI 异常检测

```sql
CREATE TABLE ai_anomaly_rule (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    rule_code       VARCHAR(64)  NOT NULL COMMENT '规则编码',
    rule_name       VARCHAR(128) NOT NULL COMMENT '规则名称',
    target_metric   VARCHAR(64)  NOT NULL COMMENT '监控指标，如 production_output/defect_rate/oee',
    detection_method VARCHAR(32) NOT NULL COMMENT 'THRESHOLD/STATISTICAL/ML 阈值/统计/机器学习',
    threshold_config JSON       NULL COMMENT '阈值配置，如 {upper:100, lower:50, window:"1h"}',
    statistical_config JSON     NULL COMMENT '统计方法配置，如 {method:"zscore", sigma:3}',
    ml_model_id     BIGINT       NULL COMMENT 'ML模型ID',
    plant_id        BIGINT       NULL COMMENT '工厂(NULL=全局)',
    notify_channel  VARCHAR(32)  NOT NULL DEFAULT 'IN_APP' COMMENT 'IN_APP/EMAIL/WECHAT/DINGTALK 站内信/邮件/企微/钉钉',
    notify_users    JSON         NULL COMMENT '通知用户列表',
    is_enabled      TINYINT      NOT NULL DEFAULT 1,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_rule (rule_code, tenant_id)
) COMMENT '异常检测规则';

CREATE TABLE ai_anomaly_event (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    rule_id         BIGINT       NOT NULL COMMENT '规则ID',
    event_time      DATETIME(3)  NOT NULL COMMENT '发生时间',
    metric_value    DECIMAL(14,4) NOT NULL COMMENT '实际值',
    expected_value  DECIMAL(14,4) NULL COMMENT '期望值',
    deviation_pct   DECIMAL(5,2) NULL COMMENT '偏差百分比',
    severity        VARCHAR(32)  NOT NULL COMMENT 'WARNING/CRITICAL',
    context         JSON         NULL COMMENT '上下文数据(工单/设备/物料等)',
    status          VARCHAR(32)  NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN/ACKNOWLEDGED/RESOLVED',
    ack_by          VARCHAR(64)  NULL COMMENT '确认人',
    ack_time        DATETIME(3)  NULL,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_rule_time (rule_id, event_time),
    INDEX idx_status (status, tenant_id)
) COMMENT '异常事件';
```

### 3.4 定时推送

```sql
CREATE TABLE report_push_schedule (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    report_id       BIGINT       NOT NULL COMMENT '报表ID',
    schedule_cron   VARCHAR(64)  NOT NULL COMMENT 'Cron表达式，如 0 8 * * 1-5(工作日8点)',
    push_channel    VARCHAR(32)  NOT NULL COMMENT 'EMAIL/WECHAT/DINGTALK',
    push_targets    JSON         NOT NULL COMMENT '推送目标，如 {emails:["a@b.com"], wechat_groups:["g1"]}',
    push_format     VARCHAR(32)  NOT NULL DEFAULT 'PDF' COMMENT 'PDF/EXCEL/IMAGE',
    last_push_time  DATETIME(3)  NULL,
    is_enabled      TINYINT      NOT NULL DEFAULT 1,
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    is_deleted      TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_report (report_id)
) COMMENT '报表推送计划';
```

### 3.5 聚合指标（物化视图/定时计算）

```sql
CREATE TABLE agg_production_daily (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    plant_id        BIGINT       NOT NULL,
    line_id         BIGINT       NULL,
    record_date     DATE         NOT NULL,
    shift_id        BIGINT       NULL,
    order_count     INT          NOT NULL DEFAULT 0 COMMENT '工单数',
    completed_count INT          NOT NULL DEFAULT 0 COMMENT '完工工单数',
    total_output    DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '总产出',
    good_output     DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '合格产出',
    defect_rate     DECIMAL(5,4) NULL COMMENT '不良率',
    avg_oee         DECIMAL(5,4) NULL COMMENT '平均OEE',
    on_time_rate    DECIMAL(5,4) NULL COMMENT '准交率',
    cycle_time_min  DECIMAL(8,2) NULL COMMENT '平均周期时间',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_agg (plant_id, line_id, record_date, shift_id, tenant_id)
) COMMENT '生产日聚合';

CREATE TABLE agg_quality_daily (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    plant_id        BIGINT       NOT NULL,
    record_date     DATE         NOT NULL,
    inspect_count   INT          NOT NULL DEFAULT 0 COMMENT '检验批数',
    accept_count    INT          NOT NULL DEFAULT 0 COMMENT '合格批数',
    reject_count    INT          NOT NULL DEFAULT 0 COMMENT '不合格批数',
    first_pass_rate DECIMAL(5,4) NULL COMMENT '一次通过率(FPY)',
    defect_rate     DECIMAL(5,4) NULL COMMENT '不良率',
    scrap_rate      DECIMAL(5,4) NULL COMMENT '报废率',
    rework_rate     DECIMAL(5,4) NULL COMMENT '返工率',
    top_defects     JSON         NULL COMMENT 'TOP缺陷帕累托 [{code:"D001",count:15,pct:35.2}]',
    tenant_id       BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_agg (plant_id, record_date, tenant_id)
) COMMENT '质量日聚合';
```

## 4. 核心业务规则

| 编号 | 规则 | 说明 |
|------|------|------|
| D-R001 | 看板数据实时性 | 生产/设备看板数据延迟 ≤ 30秒，质量/库存看板 ≤ 5分钟 |
| D-R002 | 聚合数据日结 | 每日凌晨自动计算前日聚合指标，写入聚合表 |
| D-R003 | 异常检测实时 | 异常检测在数据写入后 1 分钟内完成判定和通知 |
| D-R004 | 报表权限 | 报表按创建人+公开标记控制可见性，非公开报表仅创建人可见 |
| D-R005 | 推送去重 | 同一异常规则 5 分钟内不重复通知同一用户 |

## 5. 接口清单

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/dashboards | 看板列表 |
| GET | /api/v1/dashboards/{id}/data | 看板数据（含所有组件数据） |
| POST | /api/v1/dashboards | 创建看板 |
| GET | /api/v1/widgets | 组件库列表 |
| GET | /api/v1/widgets/{code}/data | 组件数据查询 |
| GET | /api/v1/reports | 报表列表 |
| POST | /api/v1/reports | 创建报表 |
| GET | /api/v1/reports/{id}/data | 报表数据查询（含筛选+下钻） |
| POST | /api/v1/reports/{id}/export | 报表导出 |
| GET | /api/v1/anomaly-events | 异常事件列表 |
| PUT | /api/v1/anomaly-events/{id}/ack | 确认异常 |
| GET | /api/v1/aggregation/production | 生产聚合数据 |
| GET | /api/v1/aggregation/quality | 质量聚合数据 |

## 6. 使用对象

| 角色 | 说明 | 使用频率 |
|------|------|---------|
| **厂长/高管** | 综合运营看板（OEE/产出/良率/交付率）、经营指标趋势 | 每日高频 |
| **车间主任** | 车间级看板（工单进度/设备OEE/异常统计）、晨会投屏 | 每日极高频 |
| **PMC 计划员** | 交付达成率看板、缺料预警看板 | 每日高频 |
| **质量工程师** | 良率趋势看板、SPC异常看板、8D统计 | 每日中频 |
| **设备工程师** | OEE/MTBF/MTTR看板、停机损失看板 | 每日中频 |
| **财务/成本** | 库存金额趋势、制造成本分析报表 | 月频 |
| **IT 管理员** | 看板/报表配置、异常规则配置、数据源管理 | 低频配置 |

## 7. 使用场景

### 场景 1：晨会投屏

| 项目 | 内容 |
|------|------|
| **触发时间** | 每日 8:00 晨会 |
| **前提条件** | 看板已配置并投屏至车间大屏 |
| **操作人** | 车间主任（主持晨会） |
| **步骤** | ① 大屏自动刷新显示车间看板 → ② 查看昨日产出vs计划 → ③ 查看今日排程+齐套状态 → ④ 查看设备OEE+停机TOP3 → ⑤ 查看异常汇总+未闭环项 → ⑥ 针对异常逐项派发处理 |
| **设备** | 车间大屏（55寸+），自动轮播刷新 |

### 场景 2：自定义报表

| 项目 | 内容 |
|------|------|
| **触发时间** | 月度经营分析、周度生产总结、专项分析 |
| **前提条件** | 有报表创建权限 |
| **操作人** | 厂长/车间主任/质量工程师 |
| **步骤** | ① 进入「数据平台 → 报表中心」 → ② 新建报表 → ③ 拖拽组件（表格/图表/指标卡） → ④ 配置数据源+筛选条件 → ⑤ 预览 → ⑥ 保存+设置定时推送（邮件/钉钉） |

### 场景 3：异常预警推送

| 项目 | 内容 |
|------|------|
| **触发时间** | 实时（数据写入后1分钟内检测） |
| **前提条件** | 异常规则已配置并激活 |
| **操作人** | 系统（自动检测+推送），相关责任人（响应） |
| **步骤** | ① 系统实时检测数据 → ② 触发异常规则（如：OEE<60%、良率<95%、库存<安全值） → ③ 生成异常事件 → ④ 推送通知（APP/钉钉/邮件） → ⑤ 责任人确认+处理 → ⑥ 异常闭环 |

### 场景 4：数据下钻分析

| 项目 | 内容 |
|------|------|
| **触发时间** | 看板/报表中发现异常指标，需要定位根因 |
| **前提条件** | 看板组件支持下钻 |
| **操作人** | 厂长/车间主任/质量工程师 |
| **步骤** | ① 看板发现异常指标（如：某产线良率骤降） → ② 点击下钻 → ③ 按时间→工单→工序→设备逐层展开 → ④ 定位到具体工单/设备/时间段 → ⑤ 查看明细数据 |

## 8. 使用方法

### 8.1 看板查看

1. 进入「数据平台 → 看板中心」
2. 选择看板（综合运营/车间看板/设备看板/质量看板）
3. 看板自动刷新（生产数据30秒，库存5分钟）
4. 点击组件可下钻查看明细
5. 支持全屏模式（投屏用）

### 8.2 报表创建

1. 进入「数据平台 → 报表中心」
2. 点击「新建报表」
3. 选择模板（空白/常用模板）或从看板另存
4. 拖拽组件到画布，配置数据源
5. 设置筛选器+参数
6. 预览→保存→发布/定时推送

### 8.3 异常规则配置

1. 进入「数据平台 → 异常检测」
2. 点击「新建规则」
3. 选择指标+条件+阈值
4. 配置通知对象+渠道
5. 激活规则

## 9. UI 示意

### 9.1 综合运营看板

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  数据平台 > 综合运营看板  工厂: [华东▼]  时间: [今日▼]  🔄 30s自动刷新       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─ 今日产出 ─┐  ┌─ 综合良率 ─┐  ┌─ 交付达成 ─┐  ┌─ 平均OEE ─┐            │
│  │  1,280 PCS │  │  97.2%    │  │  95.5%    │  │  76.8%    │            │
│  │  ↑12% vs昨 │  │  ↑0.3%   │  │  ↓2.1%   │  │  ↑1.5%   │            │
│  └────────────┘  └──────────┘  └──────────┘  └──────────┘            │
│                                                                              │
│  ┌─ 产出趋势(7日) ──────────────────────────────────────────────────────┐    │
│  │ 1400│        ╱╲                                                      │    │
│  │ 1200│  ╱╲╱╲╱╲  ╲╱╲                                                │    │
│  │ 1000│╱╲╱      ╲╱                                                   │    │
│  │  800│╱                                                            │    │
│  │     └───周一──周二──周三──周四──周五──周六──周日──→                   │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─ 异常预警 ───────────────────────────────────────────────────────────┐    │
│  │ 🔴 SMT01 OEE=65.8% < 70%  (10:30)  [确认]                         │    │
│  │ 🟡 M100002 库存低于安全值  (09:15)  [确认]                         │    │
│  │ 🔴 WO003 交期风险 剩余2天完工率40%  (08:00)  [确认]                 │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 报表设计器

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  数据平台 > 报表中心 > 新建报表                                                │
├──────────┬───────────────────────────────────────────────────────────────────┤
│ 组件库    │  画布                                                            │
│          │                                                                  │
│ 📊 指标卡 │  ┌─ 今日产出 ─┐  ┌─ 良率 ─┐                                   │
│ 📈 折线图 │  │  1,280     │  │  97.2% │                                   │
│ 📉 柱状图 │  └────────────┘  └────────┘                                   │
│ 🥧 饼图   │                                                                  │
│ 📋 表格   │  ┌──────────────────────────────────────────────────────┐       │
│ 🔢 透视表 │  │  产出趋势折线图（拖拽到此处）                         │       │
│          │  │                                                    │       │
│          │  └──────────────────────────────────────────────────────┘       │
│ ──────── │                                                                  │
│ 筛选器    │  ┌──────────────────────────────────────────────────────┐       │
│ 📅 日期   │  │  工单明细表（拖拽到此处）                             │       │
│ 🏭 工厂   │  │                                                    │       │
│ 📦 物料   │  └──────────────────────────────────────────────────────┘       │
│          │                                                                  │
├──────────┴───────────────────────────────────────────────────────────────────┤
│  [预览]  [保存]  [发布]  [定时推送设置]                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```