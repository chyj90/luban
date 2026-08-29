-- ============================================================
-- 智能制造生产指标 - 建表脚本
-- 数据库: manufacturing_db
-- 用途: 验证用例 0.4 数据源，支撑 OEE 计算关系测试
-- ============================================================

CREATE DATABASE IF NOT EXISTS manufacturing_db
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE manufacturing_db;

-- 生产线信息
CREATE TABLE IF NOT EXISTS production_lines (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    line_code   VARCHAR(32)  NOT NULL UNIQUE COMMENT '产线编码',
    line_name   VARCHAR(128) NOT NULL COMMENT '产线名称',
    workshop    VARCHAR(64)  COMMENT '所属车间',
    status      VARCHAR(16)  NOT NULL DEFAULT 'active' COMMENT '状态: active/inactive',
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) COMMENT '生产线';

-- 生产指标明细（按日 + 产线粒度）
CREATE TABLE IF NOT EXISTS production_metrics (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    line_id                 INT          NOT NULL COMMENT '生产线ID',
    metric_date             DATE         NOT NULL COMMENT '指标日期',

    -- 可用率相关
    planned_running_time    DECIMAL(10,2) NOT NULL COMMENT '计划运行时间（分钟）',
    actual_running_time     DECIMAL(10,2) NOT NULL COMMENT '实际运行时间（分钟）',
    downtime                DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '停机时间（分钟）',

    -- 性能率相关
    theoretical_speed       DECIMAL(10,2) NOT NULL COMMENT '理论速度（件/分钟）',
    actual_output           INT          NOT NULL COMMENT '实际产出（件）',

    -- 质量率相关
    total_output            INT          NOT NULL COMMENT '总产出（件）',
    good_output             INT          NOT NULL COMMENT '合格品（件）',
    defect_output           INT          NOT NULL DEFAULT 0 COMMENT '不良品（件）',

    -- 计算指标（可由原始数据推导，也可直接存储）
    availability            DECIMAL(6,4) COMMENT '可用率 = actual_running_time / planned_running_time',
    performance             DECIMAL(6,4) COMMENT '性能率 = actual_output / (actual_running_time * theoretical_speed)',
    quality                 DECIMAL(6,4) COMMENT '质量率 = good_output / total_output',
    oee                     DECIMAL(6,4) COMMENT 'OEE = availability × performance × quality',

    created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_line_date (line_id, metric_date),
    FOREIGN KEY (line_id) REFERENCES production_lines(id)
) COMMENT '生产指标明细';

-- 停机记录（用于下钻分析可用率下降原因）
CREATE TABLE IF NOT EXISTS production_downtime (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    line_id         INT          NOT NULL COMMENT '生产线ID',
    downtime_date   DATE         NOT NULL COMMENT '停机日期',
    start_time      DATETIME     NOT NULL COMMENT '开始时间',
    end_time        DATETIME     COMMENT '结束时间（NULL=进行中）',
    duration_min    DECIMAL(10,2) NOT NULL COMMENT '持续时长（分钟）',
    reason          VARCHAR(64)  NOT NULL COMMENT '停机原因: maintenance/breakdown/setup/material',
    description     VARCHAR(256) COMMENT '详细描述',
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (line_id) REFERENCES production_lines(id)
) COMMENT '停机记录';