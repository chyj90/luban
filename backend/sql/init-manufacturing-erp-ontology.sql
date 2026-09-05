-- ============================================================
-- 制造行业 ERP 本体模板初始化
-- 覆盖 SAP FI/CO + MM + SD + PP + HCM + PM 六大模块
-- 兼容 SAP / 用友 U8/NCC / 金蝶 K/3 / 浪潮 GS
-- 概念用通用名，concept_mapping 层做术语适配
-- 覆盖企业 70% 日常问数场景
--
-- 执行方式：mysql -u root -p luban < init-manufacturing-erp-ontology.sql
-- 执行后需重启应用或调用 ontologyService.reload() 刷新 Jena 推理模型
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- 0. 行业（industry）
--    name 唯一，若已存在则跳过
-- ============================================================

INSERT IGNORE INTO industry (name, display_name, description, created_at, updated_at)
VALUES ('manufacturing_erp', '制造行业ERP', '覆盖SAP/用友/金蝶的制造企业核心概念，含FI/CO+MM+SD+PP+HCM+PM六大模块', NOW(), NOW());

SET @industry_id = (SELECT id FROM industry WHERE name = 'manufacturing_erp');

-- ============================================================
-- 1. 领域（ontology_group）
--    name 全局唯一，display_name 行业内可重复
--    is_system = TRUE 表示内置模板，不可通过 UI 删除
-- ============================================================

INSERT IGNORE INTO ontology_group (name, display_name, industry_id, description, sort_order, is_system, created_at, updated_at) VALUES
('mfg_erp_foundation',   '基础域', @industry_id, '跨域共享概念：SAP组织维度（公司代码/工厂/库位/销售组织/采购组织/会计期间）+ 通用实体（物料/客户/供应商）', 0, TRUE, NOW(), NOW()),
('mfg_erp_finance',      '财务域', @industry_id, 'SAP FI/CO — 营收/成本/利润/预算/应收应付/成本中心/利润中心', 1, TRUE, NOW(), NOW()),
('mfg_erp_procurement',  '采购域', @industry_id, 'SAP MM — 物料主数据/采购申请/采购订单/收货/发票校验/库存', 2, TRUE, NOW(), NOW()),
('mfg_erp_sales',        '销售域', @industry_id, 'SAP SD — 销售订单/交货单/开票/回款/定价（OTC全链路）', 3, TRUE, NOW(), NOW()),
('mfg_erp_production',   '生产域', @industry_id, 'SAP PP — BOM/工艺路线/工作中心/生产订单/OEE/良品率/产能利用率/MRP', 4, TRUE, NOW(), NOW()),
('mfg_erp_hr',           '人力域', @industry_id, 'SAP HCM — 员工/组织单元/薪资/考勤/离职率/人效', 5, TRUE, NOW(), NOW()),
('mfg_erp_equipment',    '设备域', @industry_id, 'SAP PM — 功能位置/设备/维修工单/设备可用率/MTBF/MTTR', 6, TRUE, NOW(), NOW());

SET @g_foundation   = (SELECT id FROM ontology_group WHERE name = 'mfg_erp_foundation');
SET @g_finance      = (SELECT id FROM ontology_group WHERE name = 'mfg_erp_finance');
SET @g_procurement  = (SELECT id FROM ontology_group WHERE name = 'mfg_erp_procurement');
SET @g_sales        = (SELECT id FROM ontology_group WHERE name = 'mfg_erp_sales');
SET @g_production   = (SELECT id FROM ontology_group WHERE name = 'mfg_erp_production');
SET @g_hr           = (SELECT id FROM ontology_group WHERE name = 'mfg_erp_hr');
SET @g_equipment    = (SELECT id FROM ontology_group WHERE name = 'mfg_erp_equipment');

-- ============================================================
-- 2. 概念（concept）
--    name 在 group_id 内应唯一
--    按 domain 分段插入，便于维护
-- ============================================================

-- ──────────────────────────────────────────────
-- 2.1 基础域（9 个概念）
-- ──────────────────────────────────────────────
INSERT INTO concept (name, group_id, description, created_at, updated_at) VALUES
('公司代码',   @g_foundation, 'SAP最高法人维度，对应独立核算的法人实体。用友称"立账组织"，金蝶称"核算组织"', NOW(), NOW()),
('工厂',       @g_foundation, 'MM/PP/PM的核心组织维度，对应物理生产场所或逻辑库存地', NOW(), NOW()),
('库位',       @g_foundation, '库存管理维度（仓库/储位），MM库存定位的最小单元', NOW(), NOW()),
('销售组织',   @g_foundation, 'SD组织维度（销售组织+分销渠道+产品组），决定定价和交货策略', NOW(), NOW()),
('采购组织',   @g_foundation, 'MM采购维度，负责供应商管理和采购策略', NOW(), NOW()),
('会计期间',   @g_foundation, 'FI/CO的期间维度（会计年度+会计月份），所有财务查询必带', NOW(), NOW()),
('物料',       @g_foundation, '所有物品统称（原材料/半成品/成品/备件/包装物），MM/PP/SD共用', NOW(), NOW()),
('客户',       @g_foundation, '购买产品或服务的个人或组织，SD/FI共用', NOW(), NOW()),
('供应商',     @g_foundation, '提供物料或服务的外部组织，MM/FI共用', NOW(), NOW());

-- ──────────────────────────────────────────────
-- 2.2 财务域（12 个概念）
-- ──────────────────────────────────────────────
INSERT INTO concept (name, group_id, description, created_at, updated_at) VALUES
('营收',         @g_finance, '企业经营活动产生的收入总额，由SD开票汇总而来', NOW(), NOW()),
('成本',         @g_finance, '为生产产品或提供服务发生的支出总额', NOW(), NOW()),
('直接材料成本', @g_finance, 'BOM用量×采购单价，PP生产订单结算时归集', NOW(), NOW()),
('直接人工成本', @g_finance, '实际工时×人工费率，按工作中心归集', NOW(), NOW()),
('制造费用',     @g_finance, '按成本中心分摊的间接费用（折旧/水电/辅料等）', NOW(), NOW()),
('利润',         @g_finance, '营收减去成本后的余额，按利润中心归集', NOW(), NOW()),
('成本中心',     @g_finance, '企业内部归集成本的组织单元，CO核心维度', NOW(), NOW()),
('利润中心',     @g_finance, '企业内部归集利润的组织单元，CO核心盈利维度', NOW(), NOW()),
('预算',         @g_finance, '计划期内的成本/收入限额，支持多版本对比', NOW(), NOW()),
('预算执行率',   @g_finance, '实际发生额占预算额的比率，超100%即超支', NOW(), NOW()),
('应收账款',     @g_finance, '客户欠款总额，SD开票后自动生成FI凭证', NOW(), NOW()),
('应付账款',     @g_finance, '欠供应商款项总额，MM收货后自动生成FI凭证', NOW(), NOW());

-- ──────────────────────────────────────────────
-- 2.3 采购域（9 个概念）
-- ──────────────────────────────────────────────
INSERT INTO concept (name, group_id, description, created_at, updated_at) VALUES
('物料主数据', @g_procurement, 'MM核心实体，所有模块共用的物料基础信息（类型/组/单位/价格）', NOW(), NOW()),
('采购申请',   @g_procurement, '需求发起凭证，MRP自动生成或手工创建，审批后转为采购订单', NOW(), NOW()),
('采购订单',   @g_procurement, '向供应商下达的正式采购指令，含物料/数量/价格/交期', NOW(), NOW()),
('收货',       @g_procurement, '实物入库确认（GR），基于采购订单收货，自动更新库存和应付', NOW(), NOW()),
('发票校验',   @g_procurement, '三单匹配校验（PO数量=GR数量=Invoice数量），通过后生成应付凭证', NOW(), NOW()),
('库存',       @g_procurement, '物料的在库数量和金额，按工厂+库位+物料类型管理', NOW(), NOW()),
('可用库存',   @g_procurement, '可用于销售/生产的库存=总库存-在途库存-冻结库存-质检库存', NOW(), NOW()),
('安全库存',   @g_procurement, '最低库存水位，低于此值触发采购申请', NOW(), NOW()),
('采购金额',   @g_procurement, '采购订单金额汇总，按供应商/物料组/期间统计', NOW(), NOW());

-- ──────────────────────────────────────────────
-- 2.4 销售域（6 个概念）
-- ──────────────────────────────────────────────
INSERT INTO concept (name, group_id, description, created_at, updated_at) VALUES
('销售订单', @g_sales, '客户下达的正式购买指令，含行项目/定价/交货计划', NOW(), NOW()),
('交货单',   @g_sales, '物流出库执行凭证，基于销售订单创建，触发库存扣减和发货', NOW(), NOW()),
('开票',     @g_sales, '向客户开具的发票，基于交货单创建，自动生成FI应收凭证', NOW(), NOW()),
('回款',     @g_sales, '客户支付的货款，FI清账后更新应收余额', NOW(), NOW()),
('销售金额', @g_sales, '销售开票金额汇总，按客户/产品/区域/期间统计', NOW(), NOW()),
('定价',     @g_sales, 'SD定价逻辑（净价/折扣/附加费/税额），PR00+MWST等条件类型', NOW(), NOW());

-- ──────────────────────────────────────────────
-- 2.5 生产域（11 个概念）
-- ──────────────────────────────────────────────
INSERT INTO concept (name, group_id, description, created_at, updated_at) VALUES
('BOM',         @g_production, '物料清单，定义产品的组成结构（父项→子项+用量）', NOW(), NOW()),
('工艺路线',   @g_production, '产品加工步骤和标准工时，定义工序→工作中心→基准量', NOW(), NOW()),
('工作中心',   @g_production, '产能计算单元（机器/产线/工位），含可用产能和产能单位', NOW(), NOW()),
('生产订单',   @g_production, '下达给车间的生产指令，状态流转：创建→下达→完工→结算', NOW(), NOW()),
('OEE',         @g_production, '设备综合效率=可用率×性能率×质量率，衡量产线综合表现', NOW(), NOW()),
('可用率',     @g_production, 'OEE可用率因子=实际运行时间/计划生产时间', NOW(), NOW()),
('性能率',     @g_production, 'OEE性能率因子=实际产出速度/标准产出速度', NOW(), NOW()),
('质量率',     @g_production, 'OEE质量率因子=合格品数量/总产出数量', NOW(), NOW()),
('良品率',     @g_production, '合格品数量占总产出数量的比率=完工数量/(完工数量+报废数量)', NOW(), NOW()),
('产能利用率', @g_production, '实际产出占额定产能的比率，>90%视为产能紧张', NOW(), NOW()),
('MRP结果',    @g_production, '物料需求计划运行结果，含计划订单/采购建议/缺料清单', NOW(), NOW());

-- ──────────────────────────────────────────────
-- 2.6 人力域（5 个概念）
-- ──────────────────────────────────────────────
INSERT INTO concept (name, group_id, description, created_at, updated_at) VALUES
('员工',     @g_hr, '企业雇用的人员，含员工编号/岗位/入职日期/组织归属', NOW(), NOW()),
('组织单元', @g_hr, '组织架构节点：公司→事业部→部门→科室，HCM核心维度', NOW(), NOW()),
('薪资',     @g_hr, '员工薪酬总额=基本工资+奖金+津贴+加班费', NOW(), NOW()),
('离职率',   @g_hr, '离职人数占平均在职人数的比率=离职人数/((期初人数+期末人数)/2)', NOW(), NOW()),
('人效',     @g_hr, '人均产出=营收/在职人数，衡量人力投入产出效率', NOW(), NOW());

-- ──────────────────────────────────────────────
-- 2.7 设备域（6 个概念）
-- ──────────────────────────────────────────────
INSERT INTO concept (name, group_id, description, created_at, updated_at) VALUES
('功能位置',   @g_equipment, '设备安装的层级结构位置（工厂→车间→产线→工位）', NOW(), NOW()),
('设备',       @g_equipment, '可独立维护的物理资产，含设备编号/类型/安装位置/状态', NOW(), NOW()),
('维修工单',   @g_equipment, '设备维修执行凭证，分纠正性维修（故障后）和预防性维修（计划内）', NOW(), NOW()),
('设备可用率', @g_equipment, '设备运行时长占日历时长的比率=运行时长/(运行+停机+待机)', NOW(), NOW()),
('MTBF',       @g_equipment, '平均故障间隔时间（Mean Time Between Failures），衡量可靠性', NOW(), NOW()),
('MTTR',       @g_equipment, '平均修复时间（Mean Time To Repair），衡量维修效率', NOW(), NOW());

-- ============================================================
-- 3. 概念 ID 变量绑定
--    后续创建关系需要引用，统一在此处绑定
-- ============================================================

-- 基础域
SET @c_company_code  = (SELECT id FROM concept WHERE name = '公司代码'  AND group_id = @g_foundation);
SET @c_plant         = (SELECT id FROM concept WHERE name = '工厂'      AND group_id = @g_foundation);
SET @c_storage_loc   = (SELECT id FROM concept WHERE name = '库位'      AND group_id = @g_foundation);
SET @c_sales_org     = (SELECT id FROM concept WHERE name = '销售组织'  AND group_id = @g_foundation);
SET @c_purch_org     = (SELECT id FROM concept WHERE name = '采购组织'  AND group_id = @g_foundation);
SET @c_fiscal_period = (SELECT id FROM concept WHERE name = '会计期间'  AND group_id = @g_foundation);
SET @c_material      = (SELECT id FROM concept WHERE name = '物料'      AND group_id = @g_foundation);
SET @c_customer      = (SELECT id FROM concept WHERE name = '客户'      AND group_id = @g_foundation);
SET @c_vendor        = (SELECT id FROM concept WHERE name = '供应商'    AND group_id = @g_foundation);

-- 财务域
SET @c_revenue           = (SELECT id FROM concept WHERE name = '营收'         AND group_id = @g_finance);
SET @c_cost              = (SELECT id FROM concept WHERE name = '成本'         AND group_id = @g_finance);
SET @c_direct_material   = (SELECT id FROM concept WHERE name = '直接材料成本' AND group_id = @g_finance);
SET @c_direct_labor      = (SELECT id FROM concept WHERE name = '直接人工成本' AND group_id = @g_finance);
SET @c_overhead          = (SELECT id FROM concept WHERE name = '制造费用'     AND group_id = @g_finance);
SET @c_profit            = (SELECT id FROM concept WHERE name = '利润'         AND group_id = @g_finance);
SET @c_cost_center       = (SELECT id FROM concept WHERE name = '成本中心'     AND group_id = @g_finance);
SET @c_profit_center     = (SELECT id FROM concept WHERE name = '利润中心'     AND group_id = @g_finance);
SET @c_budget            = (SELECT id FROM concept WHERE name = '预算'         AND group_id = @g_finance);
SET @c_budget_rate       = (SELECT id FROM concept WHERE name = '预算执行率'   AND group_id = @g_finance);
SET @c_ar                = (SELECT id FROM concept WHERE name = '应收账款'     AND group_id = @g_finance);
SET @c_ap                = (SELECT id FROM concept WHERE name = '应付账款'     AND group_id = @g_finance);

-- 采购域
SET @c_material_master   = (SELECT id FROM concept WHERE name = '物料主数据' AND group_id = @g_procurement);
SET @c_pur_req           = (SELECT id FROM concept WHERE name = '采购申请'   AND group_id = @g_procurement);
SET @c_pur_order         = (SELECT id FROM concept WHERE name = '采购订单'   AND group_id = @g_procurement);
SET @c_goods_receipt     = (SELECT id FROM concept WHERE name = '收货'       AND group_id = @g_procurement);
SET @c_invoice_verify    = (SELECT id FROM concept WHERE name = '发票校验'   AND group_id = @g_procurement);
SET @c_inventory         = (SELECT id FROM concept WHERE name = '库存'       AND group_id = @g_procurement);
SET @c_avail_stock       = (SELECT id FROM concept WHERE name = '可用库存'   AND group_id = @g_procurement);
SET @c_safety_stock      = (SELECT id FROM concept WHERE name = '安全库存'   AND group_id = @g_procurement);
SET @c_pur_amount        = (SELECT id FROM concept WHERE name = '采购金额'   AND group_id = @g_procurement);

-- 销售域
SET @c_sales_order       = (SELECT id FROM concept WHERE name = '销售订单' AND group_id = @g_sales);
SET @c_delivery          = (SELECT id FROM concept WHERE name = '交货单'   AND group_id = @g_sales);
SET @c_billing           = (SELECT id FROM concept WHERE name = '开票'     AND group_id = @g_sales);
SET @c_payment           = (SELECT id FROM concept WHERE name = '回款'     AND group_id = @g_sales);
SET @c_sales_amount      = (SELECT id FROM concept WHERE name = '销售金额' AND group_id = @g_sales);
SET @c_pricing           = (SELECT id FROM concept WHERE name = '定价'     AND group_id = @g_sales);

-- 生产域
SET @c_bom               = (SELECT id FROM concept WHERE name = 'BOM'       AND group_id = @g_production);
SET @c_routing           = (SELECT id FROM concept WHERE name = '工艺路线' AND group_id = @g_production);
SET @c_work_center       = (SELECT id FROM concept WHERE name = '工作中心' AND group_id = @g_production);
SET @c_prod_order        = (SELECT id FROM concept WHERE name = '生产订单' AND group_id = @g_production);
SET @c_oee               = (SELECT id FROM concept WHERE name = 'OEE'       AND group_id = @g_production);
SET @c_availability      = (SELECT id FROM concept WHERE name = '可用率'   AND group_id = @g_production);
SET @c_performance       = (SELECT id FROM concept WHERE name = '性能率'   AND group_id = @g_production);
SET @c_quality_rate      = (SELECT id FROM concept WHERE name = '质量率'   AND group_id = @g_production);
SET @c_yield_rate        = (SELECT id FROM concept WHERE name = '良品率'   AND group_id = @g_production);
SET @c_capacity_util     = (SELECT id FROM concept WHERE name = '产能利用率' AND group_id = @g_production);
SET @c_mrp_result        = (SELECT id FROM concept WHERE name = 'MRP结果'  AND group_id = @g_production);

-- 人力域
SET @c_employee          = (SELECT id FROM concept WHERE name = '员工'     AND group_id = @g_hr);
SET @c_org_unit          = (SELECT id FROM concept WHERE name = '组织单元' AND group_id = @g_hr);
SET @c_salary            = (SELECT id FROM concept WHERE name = '薪资'     AND group_id = @g_hr);
SET @c_turnover_rate     = (SELECT id FROM concept WHERE name = '离职率'   AND group_id = @g_hr);
SET @c_productivity      = (SELECT id FROM concept WHERE name = '人效'     AND group_id = @g_hr);

-- 设备域
SET @c_func_location     = (SELECT id FROM concept WHERE name = '功能位置'   AND group_id = @g_equipment);
SET @c_equipment         = (SELECT id FROM concept WHERE name = '设备'       AND group_id = @g_equipment);
SET @c_maint_order       = (SELECT id FROM concept WHERE name = '维修工单'   AND group_id = @g_equipment);
SET @c_equip_avail       = (SELECT id FROM concept WHERE name = '设备可用率' AND group_id = @g_equipment);
SET @c_mtbf              = (SELECT id FROM concept WHERE name = 'MTBF'       AND group_id = @g_equipment);
SET @c_mttr              = (SELECT id FROM concept WHERE name = 'MTTR'       AND group_id = @g_equipment);

-- ============================================================
-- 4. 概念间关系（concept_relation）
--    关系类型必须已在 industry_relation 中注册
-- ============================================================

-- ──────────────────────────────────────────────
-- 4.1 COMPUTED_FROM — 隐含知识/计算公式
--    这些是 SAP 顾问脑子里的公式，不建模 LLM 会瞎算
-- ──────────────────────────────────────────────

-- 利润 = 营收 - 成本
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_profit,       @c_revenue, 'COMPUTED_FROM', '营收 - 成本', '利润=营收-成本', NOW()),
(@c_profit,       @c_cost,    'COMPUTED_FROM', '营收 - 成本', '利润=营收-成本（成本因子）', NOW());

-- 预算执行率 = 实际发生额 / 预算金额
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_budget_rate,  @c_budget,  'COMPUTED_FROM', '实际发生额 / 预算金额', '预算执行率=实际/预算', NOW()),
(@c_budget_rate,  @c_cost,    'COMPUTED_FROM', '实际发生额 / 预算金额', '预算执行率=实际/预算（成本因子）', NOW());

-- OEE = 可用率 × 性能率 × 质量率
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_oee,           @c_availability, 'COMPUTED_FROM', '可用率 * 性能率 * 质量率', 'OEE=可用率×性能率×质量率', NOW()),
(@c_oee,           @c_performance,  'COMPUTED_FROM', '可用率 * 性能率 * 质量率', 'OEE=可用率×性能率×质量率（性能率因子）', NOW()),
(@c_oee,           @c_quality_rate, 'COMPUTED_FROM', '可用率 * 性能率 * 质量率', 'OEE=可用率×性能率×质量率（质量率因子）', NOW());

-- 可用库存 = 总库存 - 在途库存 - 冻结库存 - 质检库存
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_avail_stock,   @c_inventory,    'COMPUTED_FROM', '总库存 - 在途库存 - 冻结库存 - 质检库存', '可用库存=总库存-在途-冻结-质检', NOW());

-- 采购金额 = SUM(采购订单.金额)
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_pur_amount,    @c_pur_order,    'COMPUTED_FROM', 'SUM(采购订单.净价 * 采购订单.数量)', '采购金额=订单金额汇总', NOW());

-- 销售金额 = SUM(开票.金额)
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_sales_amount,  @c_billing,      'COMPUTED_FROM', 'SUM(开票.净价 * 开票.数量)', '销售金额=开票金额汇总', NOW());

-- 人效 = 营收 / 在职人数
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_productivity,  @c_revenue,      'COMPUTED_FROM', '营收 / 在职人数', '人效=营收/在职人数', NOW()),
(@c_productivity,  @c_employee,    'COMPUTED_FROM', '营收 / 在职人数', '人效=营收/在职人数（员工数因子）', NOW());

-- 离职率 = 离职人数 / ((期初人数 + 期末人数) / 2)
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_turnover_rate,  @c_employee,    'COMPUTED_FROM', '离职人数 / ((期初人数 + 期末人数) / 2)', '离职率=离职人数/平均在职人数', NOW());

-- 设备可用率 = 运行时长 / (运行时长 + 停机时长 + 待机时长)
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_equip_avail,    @c_equipment,   'COMPUTED_FROM', '运行时长 / (运行时长 + 停机时长 + 待机时长)', '设备可用率=运行/(运行+停机+待机)', NOW());

-- MTBF = 总运行时间 / 故障次数
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_mtbf,           @c_maint_order, 'COMPUTED_FROM', '总运行时间 / 故障次数', 'MTBF=总运行时间/故障次数', NOW()),
(@c_mtbf,           @c_equipment,   'COMPUTED_FROM', '总运行时间 / 故障次数', 'MTBF=总运行时间/故障次数（设备因子）', NOW());

-- MTTR = 总修复时间 / 故障次数
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_mttr,           @c_maint_order, 'COMPUTED_FROM', '总修复时间 / 故障次数', 'MTTR=总修复时间/故障次数', NOW()),
(@c_mttr,           @c_equipment,   'COMPUTED_FROM', '总修复时间 / 故障次数', 'MTTR=总修复时间/故障次数（设备因子）', NOW());

-- 成本 = 直接材料成本 + 直接人工成本 + 制造费用
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_cost,          @c_direct_material, 'COMPUTED_FROM', '直接材料成本 + 直接人工成本 + 制造费用', '成本=材料+人工+制造费用', NOW()),
(@c_cost,          @c_direct_labor,    'COMPUTED_FROM', '直接材料成本 + 直接人工成本 + 制造费用', '成本=材料+人工+制造费用（人工因子）', NOW()),
(@c_cost,          @c_overhead,        'COMPUTED_FROM', '直接材料成本 + 直接人工成本 + 制造费用', '成本=材料+人工+制造费用（制造费用因子）', NOW());

-- 良品率 = 完工数量 / (完工数量 + 报废数量)
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_yield_rate,    @c_prod_order,   'COMPUTED_FROM', '完工数量 / (完工数量 + 报废数量)', '良品率=完工/(完工+报废)', NOW());

-- ──────────────────────────────────────────────
-- 4.2 DRILLS_INTO — 下钻维度 / 组织层级 / 业务流转
--    用户问"成本分析"→ 可下钻到直接材料/直接人工/制造费用
--    组织层级：公司代码→工厂→库位
--    业务流转：采购申请→采购订单→收货→发票校验，销售订单→交货单→开票→回款
-- ──────────────────────────────────────────────

-- 基础域：组织层级下钻
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_plant,         @c_company_code,  'DRILLS_INTO', NULL, '工厂可上卷到公司代码（法人维度）', NOW()),
(@c_storage_loc,   @c_plant,         'DRILLS_INTO', NULL, '库位可上卷到工厂（组织维度）', NOW()),
(@c_sales_org,     @c_company_code,  'DRILLS_INTO', NULL, '销售组织可上卷到公司代码', NOW()),
(@c_purch_org,     @c_company_code,  'DRILLS_INTO', NULL, '采购组织可上卷到公司代码', NOW());

-- 财务域：成本/利润下钻
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_cost,          @c_direct_material, 'DRILLS_INTO', NULL, '成本可下钻到直接材料成本', NOW()),
(@c_cost,          @c_direct_labor,    'DRILLS_INTO', NULL, '成本可下钻到直接人工成本', NOW()),
(@c_cost,          @c_overhead,        'DRILLS_INTO', NULL, '成本可下钻到制造费用', NOW()),
(@c_profit,        @c_revenue,         'DRILLS_INTO', NULL, '利润可下钻到营收', NOW()),
(@c_profit,        @c_cost,            'DRILLS_INTO', NULL, '利润可下钻到成本', NOW());

-- 采购域：库存下钻 + 业务流转下钻
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_inventory,     @c_avail_stock,     'DRILLS_INTO', NULL, '库存可下钻到可用库存', NOW()),
(@c_inventory,     @c_safety_stock,    'DRILLS_INTO', NULL, '库存可下钻到安全库存', NOW()),
(@c_pur_order,     @c_pur_req,         'DRILLS_INTO', NULL, '采购订单可下钻到采购申请（需求来源）', NOW()),
(@c_goods_receipt, @c_pur_order,       'DRILLS_INTO', NULL, '收货可下钻到采购订单（来源订单）', NOW()),
(@c_invoice_verify,@c_goods_receipt,   'DRILLS_INTO', NULL, '发票校验可下钻到收货（三单匹配）', NOW());

-- 销售域：OTC 业务流转下钻
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_delivery,      @c_sales_order,     'DRILLS_INTO', NULL, '交货单可下钻到销售订单（来源订单）', NOW()),
(@c_billing,       @c_delivery,        'DRILLS_INTO', NULL, '开票可下钻到交货单（出库来源）', NOW()),
(@c_payment,       @c_billing,         'DRILLS_INTO', NULL, '回款可下钻到开票（清账来源）', NOW());

-- 生产域：OEE下钻 + 生产结构下钻
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_oee,           @c_availability,    'DRILLS_INTO', NULL, 'OEE可下钻到可用率', NOW()),
(@c_oee,           @c_performance,     'DRILLS_INTO', NULL, 'OEE可下钻到性能率', NOW()),
(@c_oee,           @c_quality_rate,    'DRILLS_INTO', NULL, 'OEE可下钻到质量率', NOW()),
(@c_prod_order,    @c_bom,             'DRILLS_INTO', NULL, '生产订单可下钻到BOM（用料结构）', NOW()),
(@c_prod_order,    @c_routing,         'DRILLS_INTO', NULL, '生产订单可下钻到工艺路线（加工步骤）', NOW());

-- 人力域：组织层级下钻
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_employee,      @c_org_unit,        'DRILLS_INTO', NULL, '员工可上卷到组织单元（部门归属）', NOW()),
(@c_salary,        @c_org_unit,        'DRILLS_INTO', NULL, '薪资可上卷到组织单元（部门薪资）', NOW()),
(@c_turnover_rate, @c_org_unit,        'DRILLS_INTO', NULL, '离职率可上卷到组织单元（部门离职率）', NOW()),
(@c_productivity,  @c_org_unit,        'DRILLS_INTO', NULL, '人效可上卷到组织单元（部门人效）', NOW());

-- 设备域：设备层级下钻
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_equipment,     @c_func_location,   'DRILLS_INTO', NULL, '设备可上卷到功能位置（安装位置）', NOW()),
(@c_maint_order,   @c_equipment,       'DRILLS_INTO', NULL, '维修工单可下钻到设备（维修对象）', NOW());

-- ──────────────────────────────────────────────
-- 4.3 CORRELATED — 关联维度（交叉分析提示）
--    问"营收"时提示可关联"应收账款"做账龄分析
--    域内：概念间的业务关联
--    跨域：模块间的数据流关联
-- ──────────────────────────────────────────────

-- 基础域：组织维度间的关联
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_customer,      @c_sales_org,       'CORRELATED', NULL, '客户与销售组织关联，按销售区域分组', NOW()),
(@c_vendor,        @c_purch_org,       'CORRELATED', NULL, '供应商与采购组织关联，按采购范围分组', NOW()),
(@c_material,      @c_plant,           'CORRELATED', NULL, '物料与工厂关联，按生产场所分组', NOW());

-- 财务域：跨域关联
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_revenue,       @c_ar,              'CORRELATED', NULL, '营收与应收账款关联，可做账龄/回款分析', NOW()),
(@c_cost,          @c_budget,          'CORRELATED', NULL, '成本与预算关联，可做预算执行分析', NOW()),
(@c_cost,          @c_cost_center,     'CORRELATED', NULL, '成本与成本中心关联，按部门归集', NOW()),
(@c_profit,        @c_profit_center,   'CORRELATED', NULL, '利润与利润中心关联，按业务线归集', NOW()),
(@c_revenue,       @c_fiscal_period,   'CORRELATED', NULL, '营收与会计期间关联，按月度/季度趋势', NOW()),
(@c_cost,          @c_fiscal_period,   'CORRELATED', NULL, '成本与会计期间关联，按月度/季度趋势', NOW());

-- 采购域：域内业务关联 + 跨域关联
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_pur_amount,    @c_ap,              'CORRELATED', NULL, '采购金额与应付账款关联，可做付款分析', NOW()),
(@c_pur_order,     @c_vendor,          'CORRELATED', NULL, '采购订单与供应商关联，按供应商统计', NOW()),
(@c_pur_order,     @c_material,        'CORRELATED', NULL, '采购订单与物料关联，按物料统计', NOW()),
(@c_inventory,     @c_material,        'CORRELATED', NULL, '库存与物料关联，按物料类型统计', NOW()),
(@c_inventory,     @c_plant,           'CORRELATED', NULL, '库存与工厂关联，按仓库统计', NOW()),
(@c_pur_amount,    @c_fiscal_period,   'CORRELATED', NULL, '采购金额与会计期间关联，按月度趋势', NOW());

-- 销售域：域内业务关联 + 跨域关联
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_sales_amount,  @c_payment,         'CORRELATED', NULL, '销售金额与回款关联，可做回款率分析', NOW()),
(@c_sales_order,   @c_customer,        'CORRELATED', NULL, '销售订单与客户关联，按客户统计', NOW()),
(@c_sales_order,   @c_material,        'CORRELATED', NULL, '销售订单与物料关联，按产品统计', NOW()),
(@c_sales_amount,  @c_fiscal_period,   'CORRELATED', NULL, '销售金额与会计期间关联，按月度趋势', NOW()),
(@c_sales_order,   @c_sales_org,       'CORRELATED', NULL, '销售订单与销售组织关联，按区域统计', NOW());

-- 生产域：域内业务关联 + 跨域关联
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_oee,           @c_capacity_util,   'CORRELATED', NULL, 'OEE与产能利用率关联，可做产线效率分析', NOW()),
(@c_prod_order,    @c_work_center,     'CORRELATED', NULL, '生产订单与工作中心关联，按产线统计', NOW()),
(@c_bom,           @c_material,        'CORRELATED', NULL, 'BOM与物料关联，按产品结构统计', NOW()),
(@c_routing,       @c_work_center,     'CORRELATED', NULL, '工艺路线与工作中心关联，按加工步骤统计', NOW()),
(@c_mrp_result,    @c_material,        'CORRELATED', NULL, 'MRP结果与物料关联，按缺料情况统计', NOW()),
(@c_yield_rate,    @c_prod_order,      'CORRELATED', NULL, '良品率与生产订单关联，按订单/产品统计', NOW()),
(@c_prod_order,    @c_plant,           'CORRELATED', NULL, '生产订单与工厂关联，按生产场所统计', NOW());

-- 人力域：域内业务关联 + 跨域关联
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_productivity,  @c_turnover_rate,   'CORRELATED', NULL, '人效与离职率关联，可做人力健康度分析', NOW()),
(@c_salary,        @c_employee,        'CORRELATED', NULL, '薪资与员工关联，按人员统计', NOW()),
(@c_salary,        @c_cost,            'CORRELATED', NULL, '薪资与成本关联，人力成本占比分析', NOW()),
(@c_turnover_rate, @c_employee,        'CORRELATED', NULL, '离职率与员工关联，按人员变动统计', NOW()),
(@c_productivity,  @c_revenue,         'CORRELATED', NULL, '人效与营收关联，人均产出驱动分析', NOW());

-- 设备域：域内业务关联 + 跨域关联
INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_mtbf,          @c_mttr,            'CORRELATED', NULL, 'MTBF与MTTR关联，可做设备可靠性分析', NOW()),
(@c_equip_avail,   @c_equipment,       'CORRELATED', NULL, '设备可用率与设备关联，按设备统计', NOW()),
(@c_mtbf,          @c_equipment,       'CORRELATED', NULL, 'MTBF与设备关联，按设备类型统计', NOW()),
(@c_mttr,          @c_equipment,       'CORRELATED', NULL, 'MTTR与设备关联，按设备类型统计', NOW()),
(@c_maint_order,   @c_cost_center,     'CORRELATED', NULL, '维修工单与成本中心关联，维修成本归集', NOW()),
(@c_equipment,     @c_plant,           'CORRELATED', NULL, '设备与工厂关联，按生产场所统计', NOW());

-- ──────────────────────────────────────────────
-- 4.4 EQUIVALENT_TO — 跨系统/跨域等价
--    SAP 的"合格品数" = MES 的"合格品数" = QMS 的"合格品数"
-- ──────────────────────────────────────────────

INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_material_master, @c_material,      'EQUIVALENT_TO', NULL, 'MM物料主数据等价于基础域物料概念', NOW()),
(@c_yield_rate,      @c_quality_rate,  'EQUIVALENT_TO', NULL, 'PP良品率等价于OEE质量率（语义等价，计算口径可能不同）', NOW()),
(@c_cost_center,     @c_org_unit,      'EQUIVALENT_TO', NULL, 'SAP成本中心等价于HCM组织单元（财务口径vs人力口径）', NOW());

-- ──────────────────────────────────────────────
-- 4.5 DERIVED_FROM — 条件推导
--    "产能紧张" = 产能利用率 > 90%
--    "库存预警" = 可用库存 < 安全库存
-- ──────────────────────────────────────────────

INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_capacity_util,  @c_work_center,  'DERIVED_FROM', '产能利用率 > 0.9 → 产能紧张', '产能紧张=利用率>90%', NOW()),
(@c_avail_stock,    @c_safety_stock, 'DERIVED_FROM', '可用库存 < 安全库存 → 库存预警', '库存预警=可用<安全', NOW()),
(@c_budget_rate,    @c_budget,       'DERIVED_FROM', '预算执行率 > 1.0 → 超支预警', '超支=执行率>100%', NOW());

-- ============================================================
-- 5. 行业自定义关系类型注册（industry_relation）
--    系统内置 9 种 BuiltinRelation 通过 API 创建行业时自动注册，此处只注册非内置的自定义类型
--    is_builtin = FALSE 表示自定义，可通过 UI 管理
-- ============================================================

INSERT IGNORE INTO industry_relation (industry_id, relation_type, description, label, color, source_role, target_role, source_to_target, is_transitive, is_symmetric, sort_order, is_builtin, created_at) VALUES
(@industry_id, 'PRODUCES',   '源概念的业务动作产出目标概念的数据，SAP模块间自动集成', '产生',   '#13c2c2', '生产者', '产出物', TRUE,  TRUE,  FALSE, 100, FALSE, NOW()),
(@industry_id, 'CONSUMES',   '源概念的业务动作消耗目标概念的数据作为输入',           '消耗',   '#ff7a45', '消费者', '消耗物', TRUE,  TRUE,  FALSE, 101, FALSE, NOW()),
(@industry_id, 'FLOWS_TO',   '业务单据按流程流转到下游单据，P2P/OTC链路',           '流转到', '#597ef7', '上游单据', '下游单据', TRUE, TRUE, FALSE, 102, FALSE, NOW());

-- ──────────────────────────────────────────────
-- 5.1 PRODUCES — SAP 模块间自动集成（跨域数据产出）
--    SD.开票 → FI.应收账款
--    MM.收货 → FI.应付账款
--    PP.生产订单 → CO.成本中心（结算）
-- ──────────────────────────────────────────────

INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_billing,       @c_ar,            'PRODUCES', NULL, 'SD开票产生FI应收凭证（OTC链路：开票→应收）', NOW()),
(@c_goods_receipt, @c_ap,            'PRODUCES', NULL, 'MM收货产生FI应付凭证（P2P链路：收货→应付）', NOW()),
(@c_prod_order,    @c_cost_center,   'PRODUCES', NULL, 'PP生产订单结算产生CO成本中心凭证', NOW()),
(@c_delivery,      @c_inventory,     'PRODUCES', NULL, 'SD交货单产生库存出库（库存扣减）', NOW()),
(@c_goods_receipt, @c_inventory,     'PRODUCES', NULL, 'MM收货产生库存入库（库存增加）', NOW());

-- ──────────────────────────────────────────────
-- 5.2 CONSUMES — 业务动作消耗上游数据
--    PP.BOM → MM.物料
--    PP.生产订单 → MM.库存（领料出库）
--    SD.销售订单 → PP.MRP结果（MTO触发生产）
-- ──────────────────────────────────────────────

INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_bom,           @c_material,      'CONSUMES', NULL, 'BOM消耗物料（定义产品用料结构）', NOW()),
(@c_prod_order,    @c_inventory,     'CONSUMES', NULL, '生产订单消耗库存（领料出库）', NOW()),
(@c_sales_order,   @c_mrp_result,    'CONSUMES', NULL, '销售订单消耗MRP结果（MTO/MTS触发生产计划）', NOW()),
(@c_pur_order,     @c_budget,        'CONSUMES', NULL, '采购订单消耗预算（预算占用）', NOW()),
(@c_maint_order,   @c_inventory,     'CONSUMES', NULL, '维修工单消耗库存（领用备件）', NOW());

-- ──────────────────────────────────────────────
-- 5.3 FLOWS_TO — 业务单据流转链路
--    P2P：采购申请→采购订单→收货→发票校验
--    OTC：销售订单→交货单→开票→回款
-- ──────────────────────────────────────────────

INSERT INTO concept_relation (source_concept_id, target_concept_id, relation_type, expression, description, created_at) VALUES
(@c_pur_req,        @c_pur_order,     'FLOWS_TO', NULL, 'P2P：采购申请→采购订单（审批后转单）', NOW()),
(@c_pur_order,      @c_goods_receipt, 'FLOWS_TO', NULL, 'P2P：采购订单→收货（供应商交货）', NOW()),
(@c_goods_receipt,  @c_invoice_verify,'FLOWS_TO', NULL, 'P2P：收货→发票校验（三单匹配）', NOW()),
(@c_sales_order,    @c_delivery,      'FLOWS_TO', NULL, 'OTC：销售订单→交货单（仓库发货）', NOW()),
(@c_delivery,       @c_billing,      'FLOWS_TO', NULL, 'OTC：交货单→开票（出具发票）', NOW()),
(@c_billing,        @c_payment,      'FLOWS_TO', NULL, 'OTC：开票→回款（客户付款清账）', NOW());

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 6. 验证
--    执行后检查以下计数是否符合预期
-- ============================================================

SELECT '── 制造行业ERP本体初始化验证 ──' AS '';

SELECT 'industry'              AS tbl, COUNT(*) AS cnt FROM industry              WHERE name = 'manufacturing_erp'
UNION ALL
SELECT 'ontology_group'        AS tbl, COUNT(*) AS cnt FROM ontology_group        WHERE industry_id = @industry_id
UNION ALL
SELECT 'concept (基础域)'      AS tbl, COUNT(*) AS cnt FROM concept               WHERE group_id = @g_foundation
UNION ALL
SELECT 'concept (财务域)'      AS tbl, COUNT(*) AS cnt FROM concept               WHERE group_id = @g_finance
UNION ALL
SELECT 'concept (采购域)'      AS tbl, COUNT(*) AS cnt FROM concept               WHERE group_id = @g_procurement
UNION ALL
SELECT 'concept (销售域)'      AS tbl, COUNT(*) AS cnt FROM concept               WHERE group_id = @g_sales
UNION ALL
SELECT 'concept (生产域)'      AS tbl, COUNT(*) AS cnt FROM concept               WHERE group_id = @g_production
UNION ALL
SELECT 'concept (人力域)'      AS tbl, COUNT(*) AS cnt FROM concept               WHERE group_id = @g_hr
UNION ALL
SELECT 'concept (设备域)'      AS tbl, COUNT(*) AS cnt FROM concept               WHERE group_id = @g_equipment
UNION ALL
SELECT 'concept (合计)'        AS tbl, COUNT(*) AS cnt FROM concept               WHERE group_id IN (@g_foundation, @g_finance, @g_procurement, @g_sales, @g_production, @g_hr, @g_equipment)
UNION ALL
SELECT 'concept_relation'      AS tbl, COUNT(*) AS cnt FROM concept_relation      WHERE source_concept_id IN (SELECT id FROM concept WHERE group_id IN (@g_foundation, @g_finance, @g_procurement, @g_sales, @g_production, @g_hr, @g_equipment))
UNION ALL
SELECT 'industry_relation'     AS tbl, COUNT(*) AS cnt FROM industry_relation     WHERE industry_id = @industry_id;

-- 预期结果：
--   industry:          1
--   ontology_group:    7
--   concept (基础域):  9
--   concept (财务域):  12
--   concept (采购域):  9
--   concept (销售域):  6
--   concept (生产域):  11
--   concept (人力域):  5
--   concept (设备域):  6
--   concept (合计):    58
--   concept_relation:  110
--   industry_relation: 3