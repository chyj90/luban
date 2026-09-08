-- ============================================================
-- 智能排产场景：SAP ERP 示例数据
-- 依赖：init-sap-erp-sample-db.sql 已执行（表结构和基础数据已存在）
--
-- 本文件补充排产前置检验 P1~P10 所需的完整测试数据：
--   - 工作中心（CRHD）+ 产能参数（CRCA）
--   - BOM 抬头/项目（STKO/STPO）
--   - 工艺路线抬头/工序（PLKO/PLPO）
--   - 生产订单扩展（AUFK/AFKO/AFPO）
--   - 设备可用率数据（EQUI 扩展）
--   - 物料库存扩展（MARD 扩展）
--
-- 执行方式：mysql -u root -p luban < init-scheduling-sample-data.sql
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- 1. 工作中心（CRHD）+ 产能参数（CRCA）
--    覆盖 P1 存在性、P2 可用性、P3 额定产能 > 0
-- ============================================================

-- CRHD: 工作中心抬头（补充排产专用工作中心）
INSERT IGNORE INTO CRHD (MANDT, OBJTY, OBJID, ARBPL, WERKS, VERWE, KAPAR, LEARR, KOSTL, LTXA1, HRELV) VALUES
('100', 'A', 1000001, 'LINE01', '1001', '0100', '0', 'L001', 'CC-PROD-01', '总装线A',       'X'),
('100', 'A', 1000002, 'LINE02', '1001', '0100', '0', 'L002', 'CC-PROD-01', '总装线B',       'X'),
('100', 'A', 1000003, 'LINE03', '1001', '0100', '0', 'L003', 'CC-PROD-02', '精加工线',     'X'),
('100', 'A', 1000004, 'CNC01',  '1001', '0100', '0', 'L004', 'CC-PROD-02', 'CNC加工中心1', 'X'),
('100', 'A', 1000005, 'CNC02',  '1001', '0100', '0', 'L005', 'CC-PROD-02', 'CNC加工中心2', 'X'),
('100', 'A', 1000006, 'PAINT01','1003', '0100', '1', 'L006', 'CC-PROD-02', '涂装线',       'X'),
-- 异常工作中心（用于 P2 可用性失败测试）
('100', 'A', 1000010, 'MAINT01','1001', '0200', '0', NULL,   'CC-PROD-01', '维修工作中心', NULL),
-- 零产能工作中心（用于 P3 额定产能失败测试）
('100', 'A', 1000011, 'IDLE01', '1001', '0100', '0', NULL,   'CC-PROD-01', '闲置产线',     'X');

-- CRCA: 工作中心产能（SAP 标准表，定义额定产能）
CREATE TABLE IF NOT EXISTS CRCA (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    OBJTY          VARCHAR(2)   NOT NULL DEFAULT 'A' COMMENT '对象类型',
    OBJID          INT          NOT NULL COMMENT '对象号',
    KAPAR          VARCHAR(1)   NOT NULL DEFAULT '0' COMMENT '产能类别:0=机器,1=人工',
    KAPPL          VARCHAR(2)   NOT NULL DEFAULT '00' COMMENT '产能应用',
    KBEWE          VARCHAR(2)   NOT NULL DEFAULT '01' COMMENT '产能版本',
    CANAZ          DECIMAL(7,2) NOT NULL DEFAULT 0 COMMENT '产能数量(额定日产能)',
    MEINI          VARCHAR(3)   NOT NULL DEFAULT 'EA' COMMENT '产能单位',
    SCHZU          VARCHAR(2)   NOT NULL DEFAULT '01' COMMENT '排产规则',
    PRIMARY KEY (MANDT, OBJTY, OBJID, KAPAR, KAPPL, KBEWE)
) COMMENT='CRCA-工作中心产能';

INSERT IGNORE INTO CRCA (MANDT, OBJTY, OBJID, KAPAR, KAPPL, KBEWE, CANAZ, MEINI, SCHZU) VALUES
('100', 'A', 1000001, '0', '00', '01', 1500.00, 'EA', '01'),
('100', 'A', 1000002, '0', '00', '01', 2000.00, 'EA', '01'),
('100', 'A', 1000003, '0', '00', '01', 1800.00, 'EA', '01'),
('100', 'A', 1000004, '0', '00', '01',  800.00, 'EA', '01'),
('100', 'A', 1000005, '0', '00', '01',  800.00, 'EA', '01'),
('100', 'A', 1000006, '1', '00', '01', 1200.00, 'EA', '01'),
('100', 'A', 1000010, '0', '00', '01',    0.00, 'EA', '01'),
('100', 'A', 1000011, '0', '00', '01',    0.00, 'EA', '01');

-- ============================================================
-- 2. BOM 抬头/项目（STKO/STPO）
--    覆盖 P4 BOM 存在性、P6 物料齐套率
-- ============================================================

INSERT IGNORE INTO STKO (MANDT, STLTY, STLNR, STLAL, DATUV, DATUB, STLST, STLAN, BMENG, BMEIN) VALUES
('100', 'M', '00000001', '01', '2024-01-01', '9999-12-31', '01', '01', 100.000, 'EA'),
('100', 'M', '00000002', '01', '2024-01-01', '9999-12-31', '01', '01', 100.000, 'EA'),
('100', 'M', '00000003', '01', '2024-01-01', '9999-12-31', '01', '01', 100.000, 'EA');

INSERT IGNORE INTO STPO (MANDT, STLTY, STLNR, STLKN, STVKN, IDNRK, POSNR, MENGE, MEINS, POSTP, AUSCH) VALUES
-- FG-MOTOR-01 BOM: 需要 3 种原材料
('100', 'M', '00000001', 1, 0, 'RM-STEEL-01',  10, 50.000, 'KG', 'L', 2.0),
('100', 'M', '00000001', 2, 0, 'RM-ALLOY-01',  20, 30.000, 'KG', 'L', 1.5),
('100', 'M', '00000001', 3, 0, 'PM-BEARING-01', 30, 4.000, 'EA', 'L', 0.0),
-- FG-GEARBOX-01 BOM: 需要 3 种原材料
('100', 'M', '00000002', 1, 0, 'RM-STEEL-01',  10, 80.000, 'KG', 'L', 2.0),
('100', 'M', '00000002', 2, 0, 'RM-ALLOY-01',  20, 20.000, 'KG', 'L', 1.5),
('100', 'M', '00000002', 3, 0, 'PM-BEARING-01', 30, 8.000, 'EA', 'L', 0.0),
-- FG-ASSEMBLY-01 BOM: 需要 2 种半成品
('100', 'M', '00000003', 1, 0, 'FG-MOTOR-01',   10, 1.000, 'EA', 'L', 0.0),
('100', 'M', '00000003', 2, 0, 'FG-GEARBOX-01', 20, 1.000, 'EA', 'L', 0.0);

-- MAST BOM 使用点（补充 FG-ASSEMBLY-01）
INSERT IGNORE INTO MAST (MANDT, MATNR, WERKS, STLAL, STLNR, STLTY) VALUES
('100', 'FG-ASSEMBLY-01', '1001', '01', '00000003', 'M');

-- ============================================================
-- 3. 工艺路线抬头/工序（PLKO/PLPO）
--    覆盖 P5 工艺路线存在性、P8 交期可达性
-- ============================================================

INSERT IGNORE INTO PLKO (MANDT, PLNTY, PLNNR, PLNAL, PLNTX, DATUV, DATUB, KTEXT, LOEKZ) VALUES
('100', 'N', '00000001', '01', '1', '2024-01-01', '9999-12-31', 'FG-MOTOR-01 工艺路线', NULL),
('100', 'N', '00000002', '01', '1', '2024-01-01', '9999-12-31', 'FG-GEARBOX-01 工艺路线', NULL),
('100', 'N', '00000003', '01', '1', '2024-01-01', '9999-12-31', 'FG-ASSEMBLY-01 工艺路线', NULL);

INSERT IGNORE INTO PLPO (MANDT, PLNTY, PLNNR, PLNKN, PLNAL, VORNR, VGVWZ, ARBID, LTXA1, BMSCH, MEINH, VGW01, VGW02, VGW03, VGW04, VGE01, VGE02, VGE03, SORTF) VALUES
-- FG-MOTOR-01 工艺路线: 3 道工序
('100', 'N', '00000001', 1, '01', '0010', 'Z001', 1000004, 'CNC粗加工',   100.000, 'EA', 30.00,  45.00,  0.00, 0.00, 'H', 'H', 'H', '001'),
('100', 'N', '00000001', 2, '01', '0020', 'Z002', 1000005, 'CNC精加工',   100.000, 'EA',  0.00,  60.00,  0.00, 0.00, 'H', 'H', 'H', '002'),
('100', 'N', '00000001', 3, '01', '0030', 'Z003', 1000001, '总装',         100.000, 'EA', 20.00,  30.00,  0.00, 0.00, 'H', 'H', 'H', '003'),
-- FG-GEARBOX-01 工艺路线: 3 道工序
('100', 'N', '00000002', 1, '01', '0010', 'Z001', 1000003, '精加工齿轮',  100.000, 'EA',  0.00,  90.00,  0.00, 0.00, 'H', 'H', 'H', '001'),
('100', 'N', '00000002', 2, '01', '0020', 'Z002', 1000002, '总装',         100.000, 'EA', 25.00,  40.00,  0.00, 0.00, 'H', 'H', 'H', '002'),
('100', 'N', '00000002', 3, '01', '0030', 'Z003', 1000006, '涂装',         100.000, 'EA',  0.00,  50.00, 30.00, 0.00, 'H', 'H', 'H', '003'),
-- FG-ASSEMBLY-01 工艺路线: 2 道工序
('100', 'N', '00000003', 1, '01', '0010', 'Z001', 1000001, '子件总装',     100.000, 'EA', 30.00,  60.00,  0.00, 0.00, 'H', 'H', 'H', '001'),
('100', 'N', '00000003', 2, '01', '0020', 'Z002', 1000006, '成品涂装',     100.000, 'EA',  0.00,  40.00, 20.00, 0.00, 'H', 'H', 'H', '002');

-- MAPL 物料-工艺路线（补充 FG-ASSEMBLY-01）
INSERT IGNORE INTO MAPL (MANDT, MATNR, WERKS, PLNTY, PLNNR, PLNAL, ZAEHL) VALUES
('100', 'FG-ASSEMBLY-01', '1001', 'N', '00000003', '01', 1);

-- ============================================================
-- 4. 生产订单扩展（AUFK/AFKO/AFPO）
--    覆盖 P7 已排产负荷、P10 在制订单冲突
-- ============================================================

-- AUFK: 生产订单（补充更多排产场景订单）
INSERT IGNORE INTO AUFK (MANDT, AUFNR, AUTYP, AUART, ERDAT, KOKRS, WERKS, ARBPL, PHAS0, PHAS1, PHAS2, GSTRP, GLTRP) VALUES
-- LINE01 已排产订单（在制）
('100', '000001000001', '10', 'PP01', '2026-07-05', '1000', '1001', 'LINE01', 'X', '1', NULL, '2026-07-06', '2026-07-20'),
('100', '000001000002', '10', 'PP01', '2026-07-10', '1000', '1001', 'LINE01', 'X', '1', NULL, '2026-07-11', '2026-07-25'),
-- LINE02 已排产订单（在制）
('100', '000001000003', '10', 'PP01', '2026-07-15', '1000', '1001', 'LINE02', 'X', '1', NULL, '2026-07-16', '2026-07-30'),
-- LINE03 已排产订单（已完工，不冲突）
('100', '000001000004', '10', 'PP01', '2026-06-01', '1000', '1001', 'LINE03', 'X', '1', '1',    '2026-06-02', '2026-06-15'),
-- CNC01 在制订单（用于 P10 冲突测试）
('100', '000001000005', '10', 'PP01', '2026-08-01', '1000', '1001', 'CNC01',  'X', '1', NULL, '2026-08-02', '2026-08-15');

-- AFKO: 生产订单抬头数据（补充）
INSERT IGNORE INTO AFKO (MANDT, AUFNR, PLNBEZ, PLNTY, PLNNR, PLNAL, STLTY, STLNR, STLAL, GAMNG, GMEIN, IGMNG, WEMNG, AUSCH) VALUES
('100', '000001000001', 'FG-MOTOR-01',  'N', '00000001', '01', 'M', '00000001', '01', 1000.000, 'EA', 980.000, 980.000, 2.0),
('100', '000001000002', 'FG-GEARBOX-01','N', '00000002', '01', 'M', '00000002', '01', 1000.000, 'EA', 950.000, 950.000, 5.0),
('100', '000001000003', 'FG-MOTOR-01',  'N', '00000001', '01', 'M', '00000001', '01', 1500.000, 'EA',   0.000,   0.000, 2.0),
('100', '000001000004', 'FG-GEARBOX-01','N', '00000002', '01', 'M', '00000002', '01',  800.000, 'EA', 800.000, 800.000, 3.0),
('100', '000001000005', 'FG-ASSEMBLY-01','N','00000003', '01', 'M', '00000003', '01',  500.000, 'EA',   0.000,   0.000, 1.0);

-- AFPO: 生产订单项目数据
INSERT IGNORE INTO AFPO (MANDT, AUFNR, POSNR, MATNR, WERKS, PAMNG, MEINS, WEMNG, AMNGM, DGLTP) VALUES
('100', '000001000001', 1, 'FG-MOTOR-01',   '1001', 1000.000, 'EA', 980.000, 20.000, '2026-07-20'),
('100', '000001000002', 1, 'FG-GEARBOX-01', '1001', 1000.000, 'EA', 950.000, 50.000, '2026-07-25'),
('100', '000001000003', 1, 'FG-MOTOR-01',   '1001', 1500.000, 'EA',   0.000,  0.000, '2026-07-30'),
('100', '000001000004', 1, 'FG-GEARBOX-01', '1001',  800.000, 'EA', 800.000,  0.000, '2026-06-15'),
('100', '000001000005', 1, 'FG-ASSEMBLY-01','1001',  500.000, 'EA',   0.000,  0.000, '2026-08-15');

-- ============================================================
-- 5. 物料库存扩展（MARD）
--    覆盖 P6 物料齐套率
-- ============================================================

INSERT IGNORE INTO MARD (MANDT, MATNR, WERKS, LGORT, LVORM, LABST, UMLME, INSME, SPEME) VALUES
-- 原材料库存（充足场景）
('100', 'RM-STEEL-01',  '1001', '0001', ' ', 50000.000, 0.000, 0.000, 0.000),
('100', 'RM-ALLOY-01',  '1001', '0001', ' ', 30000.000, 0.000, 0.000, 0.000),
('100', 'PM-BEARING-01','1001', '0001', ' ',  5000.000, 0.000, 0.000, 0.000),
-- 成品/半成品库存
('100', 'FG-MOTOR-01',  '1001', '0001', ' ',   200.000, 0.000, 0.000, 0.000),
('100', 'FG-GEARBOX-01','1001', '0001', ' ',   150.000, 0.000, 0.000, 0.000),
('100', 'FG-ASSEMBLY-01','1001','0001', ' ',    50.000, 0.000, 0.000, 0.000),
-- 缺料场景（库位 0002：库存不足）
('100', 'RM-STEEL-01',  '1001', '0002', ' ',   100.000, 0.000, 0.000, 0.000),
('100', 'RM-ALLOY-01',  '1001', '0002', ' ',    50.000, 0.000, 0.000, 0.000);

-- ============================================================
-- 6. 设备可用率数据（EQUI 扩展）
--    覆盖 P9 设备可用率阈值
-- ============================================================

-- 补充排产关键设备
INSERT IGNORE INTO EQUI (MANDT, EQUNR, TPLNR, EQKTX, BEGDT, ENDDT, HERST, TYPBZ, IWERK, SWERK) VALUES
('100', 'EQ-10004', 'FP-ASSEMBLY-01', 'CNC加工中心#1',   '2024-01-01', '9999-12-31', 'DMG MORI', 'NHX4000', '1001', '1001'),
('100', 'EQ-10005', 'FP-ASSEMBLY-01', 'CNC加工中心#2',   '2024-01-01', '9999-12-31', 'DMG MORI', 'NHX4000', '1001', '1001'),
('100', 'EQ-10006', 'FP-PAINT-01',    '涂装机器人#1',    '2024-01-01', '9999-12-31', 'ABB',      'IRB 5500', '1003', '1003');

-- 设备运行状态表（自定义扩展，用于 P9 可用率计算）
CREATE TABLE IF NOT EXISTS EQUI_STATUS (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    EQUNR          VARCHAR(18)  NOT NULL COMMENT '设备号',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '工厂',
    ARBPL          VARCHAR(8)   NOT NULL COMMENT '工作中心',
    CAL_DATE       DATE         NOT NULL COMMENT '统计日期',
    RUN_HOURS      DECIMAL(7,2) NOT NULL DEFAULT 0 COMMENT '运行时长(小时)',
    DOWN_HOURS     DECIMAL(7,2) NOT NULL DEFAULT 0 COMMENT '停机时长(小时)',
    IDLE_HOURS     DECIMAL(7,2) NOT NULL DEFAULT 0 COMMENT '待机时长(小时)',
    AVAIL_RATE     DECIMAL(5,4) NOT NULL DEFAULT 0 COMMENT '可用率=RUN/(RUN+DOWN+IDLE)',
    PRIMARY KEY (MANDT, EQUNR, CAL_DATE)
) COMMENT='设备运行状态(排产可用率)';

INSERT IGNORE INTO EQUI_STATUS (MANDT, EQUNR, WERKS, ARBPL, CAL_DATE, RUN_HOURS, DOWN_HOURS, IDLE_HOURS, AVAIL_RATE) VALUES
-- 正常设备（可用率 > 80%）
('100', 'EQ-10001', '1001', 'LINE01', '2026-09-01', 20.00,  2.00, 2.00, 0.8333),
('100', 'EQ-10002', '1001', 'LINE01', '2026-09-01', 21.00,  1.50, 1.50, 0.8750),
('100', 'EQ-10004', '1001', 'CNC01',  '2026-09-01', 22.00,  1.00, 1.00, 0.9167),
('100', 'EQ-10005', '1001', 'CNC02',  '2026-09-01', 21.50,  1.00, 1.50, 0.8958),
('100', 'EQ-10006', '1003', 'PAINT01','2026-09-01', 20.00,  2.00, 2.00, 0.8333),
-- 故障设备（可用率 < 80%，用于 P9 失败测试）
('100', 'EQ-10003', '1003', 'PAINT01','2026-09-02', 12.00,  8.00, 4.00, 0.5000);

-- ============================================================
-- 7. 概念映射（concept_mapping）
--    将排产相关概念映射到 SAP 表字段，供 LLM nl2sql 使用
--    datasource_id 需替换为实际数据源 ID
-- ============================================================

-- 以下映射需在数据源注册后执行，替换 @ds_id 为实际 datasource_id
-- INSERT INTO concept_mapping (concept_id, datasource_id, table_name, column_name, attribute_name, mapping_type, confidence, is_auto, is_required, created_at, updated_at) VALUES
-- (@c_work_center,   @ds_id, 'CRHD',  'ARBPL',  '工作中心代码', 'direct', 1.00, FALSE, TRUE,  NOW(), NOW()),
-- (@c_work_center,   @ds_id, 'CRHD',  'WERKS',  '工厂代码',     'direct', 1.00, FALSE, TRUE,  NOW(), NOW()),
-- (@c_work_center,   @ds_id, 'CRHD',  'LTXA1',  '工作中心描述', 'direct', 0.95, FALSE, FALSE, NOW(), NOW()),
-- (@c_work_center,   @ds_id, 'CRCA',  'CANAZ',  '额定日产能',   'direct', 1.00, FALSE, TRUE,  NOW(), NOW()),
-- (@c_work_center,   @ds_id, 'CRHD',  'VERWE',  '工作中心类别', 'direct', 0.90, FALSE, FALSE, NOW(), NOW()),
-- (@c_bom,           @ds_id, 'MAST',  'STLNR',  'BOM号',        'direct', 1.00, FALSE, TRUE,  NOW(), NOW()),
-- (@c_bom,           @ds_id, 'STPO',  'IDNRK',  '组件物料',     'direct', 1.00, FALSE, TRUE,  NOW(), NOW()),
-- (@c_bom,           @ds_id, 'STPO',  'MENGE',  '组件数量',     'direct', 1.00, FALSE, TRUE,  NOW(), NOW()),
-- (@c_routing,       @ds_id, 'MAPL',  'PLNNR',  '工艺路线号',   'direct', 1.00, FALSE, TRUE,  NOW(), NOW()),
-- (@c_routing,       @ds_id, 'PLPO',  'VORNR',  '工序号',       'direct', 1.00, FALSE, TRUE,  NOW(), NOW()),
-- (@c_routing,       @ds_id, 'PLPO',  'VGW02',  '机器工时',     'direct', 1.00, FALSE, TRUE,  NOW(), NOW()),
-- (@c_prod_order,    @ds_id, 'AUFK',  'AUFNR',  '生产订单号',   'direct', 1.00, FALSE, TRUE,  NOW(), NOW()),
-- (@c_prod_order,    @ds_id, 'AUFK',  'ARBPL',  '工作中心',     'direct', 1.00, FALSE, TRUE,  NOW(), NOW()),
-- (@c_prod_order,    @ds_id, 'AUFK',  'PHAS1',  '下达标志',     'direct', 1.00, FALSE, FALSE, NOW(), NOW()),
-- (@c_prod_order,    @ds_id, 'AFKO',  'GAMNG',  '订单总数量',   'direct', 1.00, FALSE, TRUE,  NOW(), NOW()),
-- (@c_avail_stock,   @ds_id, 'MARD',  'LABST',  '可用库存',     'direct', 1.00, FALSE, TRUE,  NOW(), NOW()),
-- (@c_equip_avail,   @ds_id, 'EQUI_STATUS', 'AVAIL_RATE', '设备可用率', 'direct', 1.00, FALSE, TRUE,  NOW(), NOW()),
-- (@c_capacity_util, @ds_id, 'CRCA',  'CANAZ',  '额定产能',     'direct', 1.00, FALSE, TRUE,  NOW(), NOW());

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 8. 验证
-- ============================================================

SELECT '── 智能排产示例数据验证 ──' AS '';

SELECT 'CRHD (工作中心)'   AS tbl, COUNT(*) AS cnt FROM CRHD   WHERE MANDT = '100'
UNION ALL
SELECT 'CRCA (产能)'       AS tbl, COUNT(*) AS cnt FROM CRCA   WHERE MANDT = '100'
UNION ALL
SELECT 'STKO (BOM抬头)'    AS tbl, COUNT(*) AS cnt FROM STKO   WHERE MANDT = '100'
UNION ALL
SELECT 'STPO (BOM项目)'    AS tbl, COUNT(*) AS cnt FROM STPO   WHERE MANDT = '100'
UNION ALL
SELECT 'PLKO (工艺路线抬头)' AS tbl, COUNT(*) AS cnt FROM PLKO WHERE MANDT = '100'
UNION ALL
SELECT 'PLPO (工序)'       AS tbl, COUNT(*) AS cnt FROM PLPO   WHERE MANDT = '100'
UNION ALL
SELECT 'AUFK (生产订单)'   AS tbl, COUNT(*) AS cnt FROM AUFK   WHERE MANDT = '100' AND AUTYP = '10'
UNION ALL
SELECT 'AFKO (订单抬头)'   AS tbl, COUNT(*) AS cnt FROM AFKO   WHERE MANDT = '100'
UNION ALL
SELECT 'MARD (库存)'       AS tbl, COUNT(*) AS cnt FROM MARD   WHERE MANDT = '100'
UNION ALL
SELECT 'EQUI_STATUS (设备状态)' AS tbl, COUNT(*) AS cnt FROM EQUI_STATUS WHERE MANDT = '100';

-- 预期结果：
--   CRHD:   >= 8  (含异常工作中心)
--   CRCA:   >= 8
--   STKO:   >= 3
--   STPO:   >= 8
--   PLKO:   >= 3
--   PLPO:   >= 8
--   AUFK:   >= 5  (生产订单)
--   AFKO:   >= 5
--   MARD:   >= 8
--   EQUI_STATUS: >= 6