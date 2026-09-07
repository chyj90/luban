-- ============================================================
-- 智能排产场景：本体推导关系 + 算法概念绑定
-- 依赖：init-manufacturing-erp-ontology.sql 已执行（概念和基础关系已存在）
--
-- 本文件补充两部分内容：
--   1. 排产前置检验推导关系（DERIVED_FROM）—— P1~P10 的检验规则
--      ContextBuilder 在注入算法时，沿 INPUT_OF → Concept → DERIVED_FROM 链路
--      自动生成前置检验 prompt，LLM 据此执行 nl2sql 查询并判断
--   2. 排产算法概念绑定模板（ConceptToolBinding）—— 需在算法注册后执行
--
-- 执行方式：mysql -u root -p luban < init-scheduling-ontology.sql
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- 0. 绑定概念 ID 变量（复用 init-manufacturing-erp-ontology.sql 中的概念）
-- ============================================================

SET @industry_id = (SELECT id FROM industry WHERE name = 'manufacturing_erp');

SET @g_foundation   = (SELECT id FROM ontology_group WHERE name = 'mfg_erp_foundation');
SET @g_finance      = (SELECT id FROM ontology_group WHERE name = 'mfg_erp_finance');
SET @g_procurement  = (SELECT id FROM ontology_group WHERE name = 'mfg_erp_procurement');
SET @g_sales        = (SELECT id FROM ontology_group WHERE name = 'mfg_erp_sales');
SET @g_production   = (SELECT id FROM ontology_group WHERE name = 'mfg_erp_production');
SET @g_hr           = (SELECT id FROM ontology_group WHERE name = 'mfg_erp_hr');
SET @g_equipment    = (SELECT id FROM ontology_group WHERE name = 'mfg_erp_equipment');

SET @c_bom               = (SELECT id FROM concept WHERE name = 'BOM'       AND group_id = @g_production);
SET @c_routing           = (SELECT id FROM concept WHERE name = '工艺路线' AND group_id = @g_production);
SET @c_work_center       = (SELECT id FROM concept WHERE name = '工作中心' AND group_id = @g_production);
SET @c_prod_order        = (SELECT id FROM concept WHERE name = '生产订单' AND group_id = @g_production);
SET @c_oee               = (SELECT id FROM concept WHERE name = 'OEE'       AND group_id = @g_production);
SET @c_availability      = (SELECT id FROM concept WHERE name = '可用率'   AND group_id = @g_production);
SET @c_capacity_util     = (SELECT id FROM concept WHERE name = '产能利用率' AND group_id = @g_production);
SET @c_mrp_result        = (SELECT id FROM concept WHERE name = 'MRP结果'  AND group_id = @g_production);
SET @c_avail_stock       = (SELECT id FROM concept WHERE name = '可用库存'   AND group_id = @g_procurement);
SET @c_safety_stock      = (SELECT id FROM concept WHERE name = '安全库存'   AND group_id = @g_procurement);
SET @c_inventory         = (SELECT id FROM concept WHERE name = '库存'       AND group_id = @g_procurement);
SET @c_material          = (SELECT id FROM concept WHERE name = '物料'      AND group_id = @g_foundation);
SET @c_plant             = (SELECT id FROM concept WHERE name = '工厂'      AND group_id = @g_foundation);
SET @c_equip_avail       = (SELECT id FROM concept WHERE name = '设备可用率' AND group_id = @g_equipment);
SET @c_equipment         = (SELECT id FROM concept WHERE name = '设备'       AND group_id = @g_equipment);
SET @c_maint_order       = (SELECT id FROM concept WHERE name = '维修工单'   AND group_id = @g_equipment);

-- ============================================================
-- 1. 排产前置检验推导关系（DERIVED_FROM）
--    每条关系的 expression 字段编码了 LLM 可执行的检验指令：
--      - 检验条件（SQL 查询目标）
--      - 通过/失败判定规则
--      - 失败时的业务影响
--    ContextBuilder 沿 INPUT_OF → Concept → DERIVED_FROM 链路展开，
--    将这些 expression 注入 Agent prompt，LLM 据此生成 nl2sql 并判断
-- ============================================================

-- P1: 工作中心存在性
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_work_center, @c_plant, 'DERIVED_FROM',
 'PRE_CHECK[P1]: SELECT COUNT(*) FROM CRHD WHERE WERKS={plant} AND ARBPL={work_center}; 判定: count>0 → 通过, count=0 → 失败(工作中心不存在,排产无执行主体)',
 '排产前置P1-工作中心存在性', NOW());

-- P2: 工作中心可用性
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_work_center, @c_equip_avail, 'DERIVED_FROM',
 'PRE_CHECK[P2]: SELECT ARBPL, VERWE FROM CRHD WHERE ARBPL={work_center}; 判定: VERWE IN (active_category) → 通过, 否则 → 失败(工作中心非运行状态,无法排产)',
 '排产前置P2-工作中心可用性', NOW());

-- P3: 额定产能 > 0
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_capacity_util, @c_work_center, 'DERIVED_FROM',
 'PRE_CHECK[P3]: SELECT ARBPL, KAPAR FROM CRHD JOIN CRCA ON ... WHERE ARBPL={work_center}; 判定: 额定产能 > 0 → 通过, 额定产能 ≤ 0 → 失败(额定产能非正,算法除零风险)',
 '排产前置P3-额定产能须为正', NOW());

-- P4: BOM 存在性
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_bom, @c_material, 'DERIVED_FROM',
 'PRE_CHECK[P4]: SELECT COUNT(*) FROM MAST WHERE MATNR={material} AND WERKS={plant}; 判定: count>0 → 通过, count=0 → 失败(产品无BOM定义,无法确定用料结构)',
 '排产前置P4-BOM存在性', NOW());

-- P5: 工艺路线存在性
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_routing, @c_work_center, 'DERIVED_FROM',
 'PRE_CHECK[P5]: SELECT COUNT(*) FROM MAPL WHERE MATNR={material} AND WERKS={plant}; 判定: count>0 → 通过, count=0 → 失败(产品无工艺路线,无法确定加工步骤)',
 '排产前置P5-工艺路线存在性', NOW());

-- P6: 物料齐套率
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_bom, @c_avail_stock, 'DERIVED_FROM',
 'PRE_CHECK[P6]: SELECT STPO.IDNRK, STPO.MENGE, MARD.LABST FROM STPO JOIN MARD ON STPO.IDNRK=MARD.MATNR WHERE STPO.STLNR={bom_number}; 判定: ALL(sub.可用库存 >= sub.需求量*订单数量) → 通过, ANY(不足) → 失败(物料不齐套,缺料无法开工)',
 '排产前置P6-物料齐套率校验', NOW());

-- P7: 已排产负荷
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_capacity_util, @c_prod_order, 'DERIVED_FROM',
 'PRE_CHECK[P7]: SELECT SUM(AFKO.GAMNG) FROM AFKO JOIN AUFK ON AFKO.AUFNR=AUFK.AUFNR WHERE AUFK.ARBPL={work_center} AND AUFK.PHAS1=1; 判定: 已排产+新订单 ≤ 日产能×排产天数 → 通过, 否则 → 失败(产能负荷超限,产能不足)',
 '排产前置P7-已排产负荷校验', NOW());

-- P8: 交期可达性
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_routing, @c_prod_order, 'DERIVED_FROM',
 'PRE_CHECK[P8]: SELECT SUM(PLPO.VGW02/60) AS total_hours FROM PLPO WHERE PLPO.PLNNR={routing_number}; 判定: 最早开工日+CEIL(total_hours/日工作小时) ≤ 交期 → 通过, 否则 → 失败(交期不可达,无法按时交付)',
 '排产前置P8-交期可达性校验', NOW());

-- P9: 设备可用率阈值
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_equip_avail, @c_work_center, 'DERIVED_FROM',
 'PRE_CHECK[P9]: SELECT EQUI.EQUNR, (运行时长/(运行+停机+待机)) AS avail_rate FROM EQUI JOIN IFLOT ON EQUI.TPLNR=IFLOT.TPLNR WHERE 工作中心={work_center}; 判定: MIN(avail_rate) >= 0.8 → 通过, 否则 → 失败(设备可用率不足,故障风险高)',
 '排产前置P9-设备可用率阈值', NOW());

-- P10: 在制订单冲突
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_prod_order, @c_work_center, 'DERIVED_FROM',
 'PRE_CHECK[P10]: SELECT AUFK.AUFNR, AUFK.ARBPL FROM AUFK WHERE AUFK.ARBPL={work_center} AND AUFK.PHAS1=1 AND AUFK.PHAS2 IS NULL; 判定: count=0 → 通过, count>0 → 需检查工序是否冲突(在制订单与新订单可能工序干涉)',
 '排产前置P10-在制订单冲突检查', NOW());

-- ============================================================
-- 2. 排产算法概念绑定模板（ConceptToolBinding）
--    以下 SQL 需在算法注册后执行，将排产算法绑定到相关概念
--    排产可行性评估算法的 tool_definition.id 需替换 @algo_scheduling_id
--
--    排产算法只做约束优化求解，前置检验由 LLM 通过本体推导的
--    PRE_CHECK 指令执行（见上方 DERIVED_FROM 关系）
-- ============================================================

-- 概念 → 算法（INVOKES）：此概念的业务问题可调用排产算法
-- INSERT INTO concept_tool_binding (concept_id, tool_id, binding_type, created_at, updated_at) VALUES
-- (@c_work_center,   @algo_scheduling_id, 'INVOKES',  NOW(), NOW()),
-- (@c_prod_order,    @algo_scheduling_id, 'INVOKES',  NOW(), NOW());

-- 概念 → 算法（INPUT_OF）：此概念的数据是排产算法的输入
-- INSERT INTO concept_tool_binding (concept_id, tool_id, binding_type, created_at, updated_at) VALUES
-- (@c_work_center,   @algo_scheduling_id, 'INPUT_OF', NOW(), NOW()),
-- (@c_bom,           @algo_scheduling_id, 'INPUT_OF', NOW(), NOW()),
-- (@c_routing,       @algo_scheduling_id, 'INPUT_OF', NOW(), NOW()),
-- (@c_avail_stock,   @algo_scheduling_id, 'INPUT_OF', NOW(), NOW()),
-- (@c_capacity_util, @algo_scheduling_id, 'INPUT_OF', NOW(), NOW()),
-- (@c_equip_avail,   @algo_scheduling_id, 'INPUT_OF', NOW(), NOW()),
-- (@c_prod_order,    @algo_scheduling_id, 'INPUT_OF', NOW(), NOW());

-- 算法 → 概念（OUTPUT_OF）：排产算法的输出对应此概念
-- INSERT INTO concept_tool_binding (concept_id, tool_id, binding_type, created_at, updated_at) VALUES
-- (@c_capacity_util, @algo_scheduling_id, 'OUTPUT_OF', NOW(), NOW());

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 3. 验证
-- ============================================================

SELECT '── 智能排产本体推导关系验证 ──' AS '';

SELECT '排产前置检验关系' AS category, COUNT(*) AS cnt
FROM concept_relation
WHERE description LIKE '排产前置P%' AND source_concept_id IN (
    SELECT id FROM concept WHERE group_id IN (
        @g_production, @g_procurement, @g_equipment
    )
);

SELECT cr.id, c1.name AS source, c2.name AS target, cr.relation_type, cr.description
FROM concept_relation cr
JOIN concept c1 ON cr.source_concept_id = c1.id
JOIN concept c2 ON cr.target_concept_id = c2.id
WHERE cr.description LIKE '排产前置P%'
ORDER BY cr.id;

-- 预期结果：
--   排产前置检验关系: 10 条 (P1~P10)