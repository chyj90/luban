-- ============================================================
-- SAP S/4HANA 真实表结构 + 示例数据
-- 为制造行业ERP本体提供可映射的表结构
-- 覆盖 FI/CO + MM + SD + PP + HCM + PM + QM + AM + PS + WM + FM + CO-PA 全域
--
-- 设计原则：
--   1. 表名 = SAP 真实表名（BKPF/BSEG/MARA/VBAK 等）
--   2. 字段名 = SAP 真实字段名（BELNR/BUKRS/KUNNR 等）
--   3. COMMENT = 中文业务含义，供自动映射 LLM 理解
--   4. S/4HANA 以 ACDOCA（统一日记账）为核心
--   5. 保留 ECC 兼容表（BKPF/BSEG），S/4 中它们是 CDS 视图
--   6. 字段类型和长度尽量贴近 SAP DDIC 定义
--
-- 执行方式：
--   mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS sap_erp_demo;"
--   mysql -u root -p sap_erp_demo < init-sap-erp-sample-db.sql
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- 0. 组织维度（基础域）
-- ============================================================

-- T001: 公司代码
CREATE TABLE IF NOT EXISTS T001 (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    BUKRS          VARCHAR(4)   NOT NULL COMMENT '公司代码(BUKRS)',
    BUTXT          VARCHAR(50)  NOT NULL COMMENT '公司名称(BUTXT)',
    ORT01          VARCHAR(35)  NULL     COMMENT '城市(ORT01)',
    LAND1          VARCHAR(3)   NOT NULL COMMENT '国家代码(LAND1)',
    WAERS          VARCHAR(5)   NOT NULL COMMENT '本位币(WAERS)',
    PERIV          VARCHAR(4)   NOT NULL COMMENT '会计年度变式(PERIV)',
    KTOPL          VARCHAR(4)   NOT NULL COMMENT '科目表(KTOPL)',
    PRIMARY KEY (MANDT, BUKRS)
) COMMENT='T001-公司代码';

-- T001W: 工厂
CREATE TABLE IF NOT EXISTS T001W (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '工厂(WERKS)',
    NAME1          VARCHAR(40)  NOT NULL COMMENT '工厂名称(NAME1)',
    BUKRS          VARCHAR(4)   NOT NULL COMMENT '公司代码(BUKRS)',
    ORT01          VARCHAR(35)  NULL     COMMENT '城市',
    LAND1          VARCHAR(3)   NOT NULL COMMENT '国家',
    REGIO          VARCHAR(3)   NULL     COMMENT '地区/省份(REGIO)',
    FABKL          VARCHAR(2)   NULL     COMMENT '工厂日历(FABKL)',
    PRIMARY KEY (MANDT, WERKS)
) COMMENT='T001W-工厂';

-- T001L: 库位
CREATE TABLE IF NOT EXISTS T001L (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '工厂',
    LGORT          VARCHAR(4)   NOT NULL COMMENT '库位(LGORT)',
    LGOBE          VARCHAR(20)  NOT NULL COMMENT '库位描述(LGOBE)',
    LGTYP          VARCHAR(3)   NULL     COMMENT '仓库类型(LGTYP)',
    PRIMARY KEY (MANDT, WERKS, LGORT)
) COMMENT='T001L-库位';

-- TVKO: 销售组织
CREATE TABLE IF NOT EXISTS TVKO (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    VKORG          VARCHAR(4)   NOT NULL COMMENT '销售组织(VKORG)',
    VTEXT          VARCHAR(30)  NOT NULL COMMENT '销售组织描述',
    BUKRS          VARCHAR(4)   NOT NULL COMMENT '公司代码',
    VKBUR          VARCHAR(4)   NULL     COMMENT '销售办公室(VKBUR)',
    PRIMARY KEY (MANDT, VKORG)
) COMMENT='TVKO-销售组织';

-- T024E: 采购组织
CREATE TABLE IF NOT EXISTS T024E (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    EKORG          VARCHAR(4)   NOT NULL COMMENT '采购组织(EKORG)',
    EKOTX          VARCHAR(30)  NOT NULL COMMENT '采购组织描述',
    BUKRS          VARCHAR(4)   NOT NULL COMMENT '公司代码',
    PRIMARY KEY (MANDT, EKORG)
) COMMENT='T024E-采购组织';

-- T009 / T009C: 会计期间
CREATE TABLE IF NOT EXISTS T009 (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    PERIV          VARCHAR(4)   NOT NULL COMMENT '会计年度变式',
    PERAZ          VARCHAR(10)  NOT NULL COMMENT '变式描述',
    PRIMARY KEY (MANDT, PERIV)
) COMMENT='T009-会计年度变式';

CREATE TABLE IF NOT EXISTS T009C (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    PERIV          VARCHAR(4)   NOT NULL COMMENT '会计年度变式',
    GJAHR          INT          NOT NULL COMMENT '会计年度(GJAHR)',
    POPER          INT          NOT NULL COMMENT '期间(POPER)',
    BUMON          INT          NOT NULL COMMENT '日历月份',
    RELJR          VARCHAR(1)   NOT NULL DEFAULT '1' COMMENT '1=开放,0=关闭(RELJR)',
    PRIMARY KEY (MANDT, PERIV, GJAHR, POPER)
) COMMENT='T009C-期间状态';

-- ============================================================
-- 1. 主数据（基础域 - 物料/客户/供应商）
-- ============================================================

-- MARA: 物料主数据 - 通用
CREATE TABLE IF NOT EXISTS MARA (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    MATNR          VARCHAR(18)  NOT NULL COMMENT '物料编号(MATNR)',
    ERSDA          DATE         NOT NULL COMMENT '创建日期(ERSDA)',
    ERNAM          VARCHAR(12)  NULL     COMMENT '创建人(ERNAM)',
    LAEDA          DATE         NULL     COMMENT '最后修改日期(LAEDA)',
    MTART          VARCHAR(4)   NOT NULL COMMENT '物料类型(MTART):FERT=成品,HALB=半成品,ROH=原材料,IBAU=备件',
    MATKL          VARCHAR(9)   NOT NULL COMMENT '物料组(MATKL)',
    MEINS          VARCHAR(3)   NOT NULL COMMENT '基本计量单位(MEINS)',
    BRGEW          DECIMAL(13,3) NULL    COMMENT '毛重(BRGEW)',
    NTGEW          DECIMAL(13,3) NULL    COMMENT '净重(NTGEW)',
    GEWEI          VARCHAR(3)   NULL     COMMENT '重量单位(GEWEI)',
    VOLUM          DECIMAL(13,3) NULL    COMMENT '体积(VOLUM)',
    VOLEH          VARCHAR(3)   NULL     COMMENT '体积单位(VOLEH)',
    BEGZU          VARCHAR(1)   NULL     COMMENT '危险标识(BEGZU)',
    SPART          VARCHAR(2)   NULL     COMMENT '产品组(SPART)',
    EXTWG          VARCHAR(18)  NULL     COMMENT '外部物料组(EXTWG)',
    PRIMARY KEY (MANDT, MATNR)
) COMMENT='MARA-物料主数据(通用)';

-- MARC: 物料主数据 - 工厂级
CREATE TABLE IF NOT EXISTS MARC (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    MATNR          VARCHAR(18)  NOT NULL COMMENT '物料编号',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '工厂',
    DISPO          VARCHAR(3)   NOT NULL COMMENT 'MRP控制者(DISPO)',
    DISMM          VARCHAR(2)   NOT NULL COMMENT 'MRP类型(DISMM):PD=MRP,NB=无MRP',
    DISLS          VARCHAR(2)   NOT NULL COMMENT '批量大小(DISLS):EX=精确批量',
    BESKZ          VARCHAR(1)   NOT NULL COMMENT '采购类型(BESKZ):E=自制,F=外购',
    SOBSL          VARCHAR(1)   NULL     COMMENT '特殊采购类型(SOBSL)',
    EISBE          DECIMAL(13,3) NOT NULL DEFAULT 0 COMMENT '安全库存(EISBE)',
    EILIF          VARCHAR(10)  NULL     COMMENT '固定供应商(EILIF)',
    MINBE          DECIMAL(13,3) NOT NULL DEFAULT 0 COMMENT '再订货点(MINBE)',
    FXHOR          INT          NULL     COMMENT '固定MRP范围天数(FXHOR)',
    PLIFZ          INT          NULL     COMMENT '计划交货天数(PLIFZ)',
    WEBAZ          INT          NULL     COMMENT '收货处理天数(WEBAZ)',
    PERKZ          VARCHAR(1)   NULL     COMMENT '期间标识(PERKZ):M=月',
    KZPER          VARCHAR(1)   NULL     COMMENT '周期标识(KZPER)',
    PRIMARY KEY (MANDT, MATNR, WERKS)
) COMMENT='MARC-物料主数据(工厂级)';

-- MARD: 物料主数据 - 库存级
CREATE TABLE IF NOT EXISTS MARD (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    MATNR          VARCHAR(18)  NOT NULL COMMENT '物料编号',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '工厂',
    LGORT          VARCHAR(4)   NOT NULL COMMENT '库位',
    LVORM          VARCHAR(1)   NULL     COMMENT '删除标志(LVORM)',
    INSME          DECIMAL(13,3) NOT NULL DEFAULT 0 COMMENT '质检库存(INSME)',
    EINME          DECIMAL(13,3) NOT NULL DEFAULT 0 COMMENT '受限使用库存(EINME)',
    SPEME          DECIMAL(13,3) NOT NULL DEFAULT 0 COMMENT '冻结库存(SPEME)',
    RETME          DECIMAL(13,3) NOT NULL DEFAULT 0 COMMENT '退货库存(RETME)',
    UMLME          DECIMAL(13,3) NOT NULL DEFAULT 0 COMMENT '在途库存(UMLME)',
    LABST          DECIMAL(13,3) NOT NULL DEFAULT 0 COMMENT '非限制使用库存(LABST)',
    PRIMARY KEY (MANDT, MATNR, WERKS, LGORT)
) COMMENT='MARD-物料主数据(库存级)';

-- MBEW: 物料估价
CREATE TABLE IF NOT EXISTS MBEW (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    MATNR          VARCHAR(18)  NOT NULL COMMENT '物料编号',
    BWKEY          VARCHAR(4)   NOT NULL COMMENT '估价范围/工厂(BWKEY)',
    BWTAR          VARCHAR(4)   NOT NULL DEFAULT '0000' COMMENT '估价类型(BWTAR)',
    LBKUM          DECIMAL(13,3) NOT NULL DEFAULT 0 COMMENT '总库存(LBKUM)',
    SALK3          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '估价总价值(SALK3)',
    VPRSV          VARCHAR(1)   NOT NULL COMMENT '价格控制(VPRSV):V=移动平均,S=标准',
    VERPR          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '移动平均价(VERPR)',
    STPRS          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '标准价格(STPRS)',
    PEINH          INT          NOT NULL DEFAULT 1 COMMENT '价格单位(PEINH)',
    BKLAS          VARCHAR(4)   NOT NULL COMMENT '估价类(BKLAS)',
    PRIMARY KEY (MANDT, MATNR, BWKEY, BWTAR)
) COMMENT='MBEW-物料估价';

-- KNA1: 客户主数据(通用)
CREATE TABLE IF NOT EXISTS KNA1 (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    KUNNR          VARCHAR(10)  NOT NULL COMMENT '客户编号(KUNNR)',
    NAME1          VARCHAR(40)  NOT NULL COMMENT '名称1(NAME1)',
    NAME2          VARCHAR(40)  NULL     COMMENT '名称2(NAME2)',
    ORT01          VARCHAR(35)  NULL     COMMENT '城市(ORT01)',
    ORT02          VARCHAR(35)  NULL     COMMENT '区域(ORT02)',
    REGIO          VARCHAR(3)   NULL     COMMENT '地区/省份(REGIO)',
    LAND1          VARCHAR(3)   NOT NULL COMMENT '国家(LAND1)',
    SPRAS          VARCHAR(1)   NULL     COMMENT '语言(SPRAS)',
    KTOKD          VARCHAR(4)   NOT NULL COMMENT '客户账户组(KTOKD)',
    BRSCH          VARCHAR(4)   NULL     COMMENT '行业代码(BRSCH)',
    STCEG          VARCHAR(20)  NULL     COMMENT '税号(STCEG)',
    LIFNR          VARCHAR(10)  NULL     COMMENT '供应商编号(如客户=供应商)',
    PRIMARY KEY (MANDT, KUNNR)
) COMMENT='KNA1-客户主数据(通用)';

-- KNVV: 客户主数据(销售级)
CREATE TABLE IF NOT EXISTS KNVV (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    KUNNR          VARCHAR(10)  NOT NULL COMMENT '客户编号',
    VKORG          VARCHAR(4)   NOT NULL COMMENT '销售组织',
    VTWEG          VARCHAR(2)   NOT NULL COMMENT '分销渠道(VTWEG)',
    SPART          VARCHAR(2)   NOT NULL COMMENT '产品组(SPART)',
    KDGRP          VARCHAR(2)   NULL     COMMENT '客户组(KDGRP)',
    KONDA          VARCHAR(2)   NULL     COMMENT '价格组(KONDA)',
    TAXKM          VARCHAR(1)   NULL     COMMENT '税分类1(TAXKM)',
    KZAZU          VARCHAR(1)   NULL     COMMENT '允许订单合并(KZAZU)',
    AUFSD          VARCHAR(1)   NULL     COMMENT '销售冻结(AUFSD)',
    LIFSD          VARCHAR(1)   NULL     COMMENT '交货冻结(LIFSD)',
    FAKSD          VARCHAR(1)   NULL     COMMENT '开票冻结(FAKSD)',
    PRIMARY KEY (MANDT, KUNNR, VKORG, VTWEG, SPART)
) COMMENT='KNVV-客户主数据(销售级)';

-- LFA1: 供应商主数据(通用)
CREATE TABLE IF NOT EXISTS LFA1 (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    LIFNR          VARCHAR(10)  NOT NULL COMMENT '供应商编号(LIFNR)',
    NAME1          VARCHAR(40)  NOT NULL COMMENT '名称1',
    NAME2          VARCHAR(40)  NULL     COMMENT '名称2',
    ORT01          VARCHAR(35)  NULL     COMMENT '城市',
    REGIO          VARCHAR(3)   NULL     COMMENT '地区/省份',
    LAND1          VARCHAR(3)   NOT NULL COMMENT '国家',
    KTOKK          VARCHAR(4)   NOT NULL COMMENT '供应商账户组(KTOKK)',
    STCEG          VARCHAR(20)  NULL     COMMENT '税号',
    SPERM          VARCHAR(1)   NULL     COMMENT '采购冻结(SPERM)',
    PRIMARY KEY (MANDT, LIFNR)
) COMMENT='LFA1-供应商主数据(通用)';

-- ============================================================
-- 2. 财务域（FI/CO — S/4HANA 核心 ACDOCA）
-- ============================================================

-- SKA1: 总账科目主数据(科目表级)
CREATE TABLE IF NOT EXISTS SKA1 (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    KTOPL          VARCHAR(4)   NOT NULL COMMENT '科目表(KTOPL)',
    SAKNR          VARCHAR(10)  NOT NULL COMMENT '总账科目号(SAKNR)',
    TXT20          VARCHAR(20)  NOT NULL COMMENT '科目短文本(TXT20)',
    TXT50          VARCHAR(50)  NULL     COMMENT '科目长文本(TXT50)',
    KTOKS          VARCHAR(2)   NOT NULL COMMENT '科目组(KTOKS)',
    XBILV          VARCHAR(1)   NULL     COMMENT '资产负债表科目(XBILV)',
    GVTYP          VARCHAR(1)   NULL     COMMENT '损益表科目类型(GVTYP)',
    PRIMARY KEY (MANDT, KTOPL, SAKNR)
) COMMENT='SKA1-总账科目主数据(科目表级)';

-- SKB1: 总账科目主数据(公司代码级)
CREATE TABLE IF NOT EXISTS SKB1 (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    BUKRS          VARCHAR(4)   NOT NULL COMMENT '公司代码',
    SAKNR          VARCHAR(10)  NOT NULL COMMENT '总账科目号',
    KTOPL          VARCHAR(4)   NOT NULL COMMENT '科目表',
    FWSKZ          VARCHAR(1)   NULL     COMMENT '字段状态组(FWSKZ)',
    MWSKZ          VARCHAR(1)   NULL     COMMENT '税务类型(MWSKZ)',
    XGKON          VARCHAR(1)   NULL     COMMENT '是否统驭科目(XGKON)',
    MITKZ          VARCHAR(1)   NULL     COMMENT '是否统驭科目(MITKZ)',
    PRIMARY KEY (MANDT, BUKRS, SAKNR)
) COMMENT='SKB1-总账科目主数据(公司代码级)';

-- CSKS: 成本中心主数据
CREATE TABLE IF NOT EXISTS CSKS (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    KOKRS          VARCHAR(4)   NOT NULL COMMENT '控制范围(KOKRS)',
    KOSTL          VARCHAR(10)  NOT NULL COMMENT '成本中心(KOSTL)',
    DATBI          DATE         NOT NULL COMMENT '有效期止(DATBI)',
    DATAB          DATE         NOT NULL COMMENT '有效期起(DATAB)',
    KTEXT          VARCHAR(20)  NOT NULL COMMENT '成本中心描述(KTEXT)',
    LTEXT          VARCHAR(40)  NULL     COMMENT '成本中心长文本(LTEXT)',
    KOSAR          VARCHAR(1)   NOT NULL COMMENT '成本中心类型(KOSAR):P=生产,L=管理',
    BUKRS          VARCHAR(4)   NOT NULL COMMENT '公司代码',
    WAERS          VARCHAR(5)   NOT NULL COMMENT '币种',
    KHVPR          VARCHAR(1)   NULL     COMMENT '层次区域(KHVPR)',
    VERAK          VARCHAR(12)  NULL     COMMENT '负责人(VERAK)',
    PRIMARY KEY (MANDT, KOKRS, KOSTL, DATBI)
) COMMENT='CSKS-成本中心主数据';

-- CEPC: 利润中心主数据
CREATE TABLE IF NOT EXISTS CEPC (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    KOKRS          VARCHAR(4)   NOT NULL COMMENT '控制范围',
    PRCTR          VARCHAR(10)  NOT NULL COMMENT '利润中心(PRCTR)',
    DATBI          DATE         NOT NULL COMMENT '有效期止',
    DATAB          DATE         NOT NULL COMMENT '有效期起',
    KTEXT          VARCHAR(20)  NOT NULL COMMENT '利润中心描述(KTEXT)',
    LTEXT          VARCHAR(40)  NULL     COMMENT '利润中心长文本',
    BUKRS          VARCHAR(4)   NOT NULL COMMENT '公司代码',
    PRIMARY KEY (MANDT, KOKRS, PRCTR, DATBI)
) COMMENT='CEPC-利润中心主数据';

-- ACDOCA: S/4HANA 统一日记账（核心！替代 BSEG+COEP+FAGLFLEXT 等）
-- S/4HANA 中 ACDOCA 是真实透明表，约 200+ 字段
-- BSEG/COEP 在 S/4 中降级为 CDS 兼容视图，底层读 ACDOCA
CREATE TABLE IF NOT EXISTS ACDOCA (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    RLDNR          VARCHAR(2)   NOT NULL COMMENT '分类账(RLDNR):0L=主导账,2L=集团账',
    RBUKRS         VARCHAR(4)   NOT NULL COMMENT '公司代码(RBUKRS)',
    GJAHR          INT          NOT NULL COMMENT '会计年度(GJAHR)',
    POPER          INT          NOT NULL COMMENT '期间(POPER)',
    DOCCT          VARCHAR(2)   NULL     COMMENT '凭证类别(DOCCT):RF=FI,KA=CO',
    AWTYP          VARCHAR(3)   NOT NULL COMMENT '参考交易类型(AWTYP):BKPF=FI,AUFK=CO,MKPF=MM',
    AWKEY          VARCHAR(20)  NOT NULL COMMENT '参考凭证号(AWKEY)=凭证号+年度',
    AWORG          VARCHAR(10)  NULL     COMMENT '参考组织单位(AWORG)',
    AWREF          VARCHAR(10)  NULL     COMMENT '参考参考(AWREF)',
    BELNR          VARCHAR(10)  NOT NULL COMMENT '凭证号(BELNR)',
    BUZEI          INT          NOT NULL COMMENT '行项目号(BUZEI)',
    BUZID          VARCHAR(1)   NULL     COMMENT '行项目标识(BUZID):空=主项,W=税项,C=现金折扣',
    BSTAT          VARCHAR(1)   NULL     COMMENT '凭证状态(BSTAT):空=过账,V=暂存',
    DOCTYPE        VARCHAR(2)   NULL     COMMENT '凭证类型(DOCTYPE):SA=总账,RE=供应商发票,DA=客户发票,KR=供应商,KZ=客户付款',
    RACCT          VARCHAR(10)  NOT NULL COMMENT '总账科目(RACCT)',
    RCNTR          VARCHAR(10)  NULL     COMMENT '成本中心(RCNTR)',
    RPCNT          VARCHAR(10)  NULL     COMMENT '利润中心(RPCNT)',
    RSEGMENT       VARCHAR(10)  NULL     COMMENT '段(RSEGMENT)',
    RBUSA          VARCHAR(4)   NULL     COMMENT '业务范围(RBUSA)',
    RFAREA         VARCHAR(4)   NULL     COMMENT '功能范围(RFAREA)',
    RMVCT          VARCHAR(4)   NULL     COMMENT 'CO业务事务(RMVCT)',
    KTOSL          VARCHAR(3)   NULL     COMMENT '交易类型码(KTOSL)',
    AUGBL          VARCHAR(10)  NULL     COMMENT '清账凭证号(AUGBL)',
    AUGBJ          INT          NULL     COMMENT '清账年度(AUGBJ)',
    AUGBT          VARCHAR(2)   NULL     COMMENT '清账凭证类型(AUGBT)',
    BUDAT          DATE         NOT NULL COMMENT '过账日期(BUDAT)',
    BLDAT          DATE         NULL     COMMENT '凭证日期(BLDAT)',
    CPUDT          DATE         NULL     COMMENT '录入日期(CPUDT)',
    CPUTM          VARCHAR(6)   NULL     COMMENT '录入时间(CPUTM)',
    USNAM          VARCHAR(12)  NULL     COMMENT '录入人(USNAM)',
    TCODE          VARCHAR(20)  NULL     COMMENT '事务代码(TCODE)',
    XBLNR          VARCHAR(16)  NULL     COMMENT '参考凭证号(XBLNR)',
    BKTXT          VARCHAR(20)  NULL     COMMENT '抬头文本(BKTXT)',
    WAERS          VARCHAR(5)   NULL     COMMENT '凭证币种(WAERS)',
    KURSF          DECIMAL(9,5) NULL     COMMENT '汇率(KURSF)',
    HSL            DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '本位币金额(HSL)-House Currency Second Local',
    TSL            DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '目标币金额(TSL)-Third Currency',
    KSL            DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '集团币金额(KSL)-Group Currency',
    OSL            DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '对象币金额(OSL)-Object Currency',
    MSL            DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '数量(MSL)',
    HWBAS          DECIMAL(15,2) NULL    COMMENT '本位币税基(HWBAS)',
    TWBAS          DECIMAL(15,2) NULL    COMMENT '目标币税基(TWBAS)',
    KWBAS          DECIMAL(15,2) NULL    COMMENT '集团币税基(KWBAS)',
    OWBAS          DECIMAL(15,2) NULL    COMMENT '对象币税基(OWBAS)',
    RWCUR          VARCHAR(5)   NULL     COMMENT '本位币(RWCUR)',
    RTCUR          VARCHAR(5)   NULL     COMMENT '目标币(RTCUR)',
    KCURR          VARCHAR(5)   NULL     COMMENT '集团币(KCURR)',
    OCURR          VARCHAR(5)   NULL     COMMENT '对象币(OCURR)',
    CURTP          VARCHAR(2)   NULL     COMMENT '货币类型(CURTP):10=公司代码,30=集团,40=硬编码',
    DRCRK          VARCHAR(1)   NOT NULL COMMENT '借/贷标识(DRCRK):S=借方,H=贷方',
    SHKZG          VARCHAR(1)   NULL     COMMENT '借/贷标识(SHKZG):S=借方,H=贷方(兼容BSEG)',
    KOART          VARCHAR(1)   NULL     COMMENT '账户类型(KOART):S=总账,D=客户,K=供应商,M=物料,A=资产',
    MWSKZ          VARCHAR(1)   NULL     COMMENT '税代码(MWSKZ)',
    TXBIT          VARCHAR(1)   NULL     COMMENT '税标识(TXBIT)',
    HKONT          VARCHAR(10)  NULL     COMMENT '总账科目(HKONT)',
    SAKNR          VARCHAR(10)  NULL     COMMENT '科目号(SAKNR-兼容)',
    KUNNR          VARCHAR(10)  NULL     COMMENT '客户编号(KUNNR)',
    LIFNR          VARCHAR(10)  NULL     COMMENT '供应商编号(LIFNR)',
    MATNR          VARCHAR(18)  NULL     COMMENT '物料编号(MATNR)',
    WERKS          VARCHAR(4)   NULL     COMMENT '工厂(WERKS)',
    LGORT          VARCHAR(4)   NULL     COMMENT '库位(LGORT)',
    CHARG          VARCHAR(10)  NULL     COMMENT '批次(CHARG)',
    BWTAR          VARCHAR(4)   NULL     COMMENT '估价类型(BWTAR)',
    BKLAS          VARCHAR(4)   NULL     COMMENT '估价类(BKLAS)',
    VVORG          VARCHAR(10)  NULL     COMMENT '销售组织(VVORG)',
    VTORG          VARCHAR(2)   NULL     COMMENT '分销渠道(VTORG)',
    VBUND          VARCHAR(2)   NULL     COMMENT '产品组(VBUND)',
    VKORG          VARCHAR(4)   NULL     COMMENT '销售组织(VKORG)',
    VTWEG          VARCHAR(2)   NULL     COMMENT '分销渠道(VTWEG)',
    SPART          VARCHAR(2)   NULL     COMMENT '产品组(SPART)',
    VBELN          VARCHAR(10)  NULL     COMMENT '销售/采购凭证号(VBELN)',
    POSNR          INT          NULL     COMMENT '行项目号(POSNR)',
    EBELN          VARCHAR(10)  NULL     COMMENT '采购订单号(EBELN)',
    EBELP          INT          NULL     COMMENT '采购订单行号(EBELP)',
    AUFNR          VARCHAR(12)  NULL     COMMENT '生产/PM订单号(AUFNR)',
    NPLNR          VARCHAR(12)  NULL     COMMENT '网络号(NPLNR)',
    AUFPL          INT          NULL     COMMENT '网络行号(AUFPL)',
    APLZL          INT          NULL     COMMENT '网络活动号(APLZL)',
    PROJK          VARCHAR(24)  NULL     COMMENT 'WBS元素(PROJK)',
    PSPNR          INT          NULL     COMMENT 'WBS元素内部号(PSPNR)',
    ANLN1          VARCHAR(12)  NULL     COMMENT '主资产号(ANLN1)',
    ANLN2          VARCHAR(4)   NULL     COMMENT '资产子号(ANLN2)',
    ANLKL          VARCHAR(4)   NULL     COMMENT '资产类(ANLKL)',
    AFABE          VARCHAR(2)   NULL     COMMENT '折旧范围(AFABE)',
    ZUONR          VARCHAR(18)  NULL     COMMENT '分配号(ZUONR)',
    SGTXT          VARCHAR(50)  NULL     COMMENT '项目文本(SGTXT)',
    XREF1          VARCHAR(12)  NULL     COMMENT '参考键1(XREF1)',
    XREF2          VARCHAR(12)  NULL     COMMENT '参考键2(XREF2)',
    XREF3          VARCHAR(20)  NULL     COMMENT '参考键3(XREF3)',
    FDLEV          VARCHAR(2)   NULL     COMMENT '财务凭证级别(FDLEV)',
    STAGR          VARCHAR(3)   NULL     COMMENT '统计关键指标(STAGR)',
    PERNR          INT          NULL     COMMENT '人员编号(PERNR)',
    OBJNR          VARCHAR(22)  NULL     COMMENT '对象号(OBJNR)',
    PPRCT          VARCHAR(10)  NULL     COMMENT '伙伴利润中心(PPRCT)',
    LOGVB          VARCHAR(1)   NULL     COMMENT '业务交易日志(LOGVB)',
    XNEGP          VARCHAR(1)   NULL     COMMENT '负过账标识(XNEGP)',
    XRAGL          VARCHAR(1)   NULL     COMMENT '统驭科目过账标识(XRAGL)',
    DMBTR          DECIMAL(15,2) NULL    COMMENT '本位币金额(DMBTR-兼容BSEG)',
    WRBTR          DECIMAL(15,2) NULL    COMMENT '凭证币金额(WRBTR-兼容BSEG)',
    PSWSL          VARCHAR(5)   NULL     COMMENT '凭证币种(PSWSL-兼容BSEG)',
    MEINS          VARCHAR(3)   NULL     COMMENT '基本单位(MEINS)',
    ERNAM          VARCHAR(12)  NULL     COMMENT '创建人(ERNAM)',
    ERDAT          DATE         NULL     COMMENT '创建日期(ERDAT)',
    AEDAT          DATE         NULL     COMMENT '修改日期(AEDAT)',
    BVORG          VARCHAR(10)  NULL     COMMENT '跨公司代码交易号(BVORG)',
    STTGY          VARCHAR(2)   NULL     COMMENT '税务交易类型(STTGY)',
    LDGRP          VARCHAR(4)   NULL     COMMENT '分类账组(LDGRP)',
    DOCID          INT          NULL     COMMENT '凭证ID(DOCID)',
    ACCPR          VARCHAR(3)   NULL     COMMENT '加速凭证号(ACCPR)',
    RELRD          VARCHAR(1)   NULL     COMMENT '释放标识(RELRD)',
    AUTYP_NEW      VARCHAR(4)   NULL     COMMENT '参考订单类型(AUTYP)',
    KNUMV          VARCHAR(10)  NULL     COMMENT '定价过程号(KNUMV)',
    KPOSN          INT          NULL     COMMENT '条件行号(KPOSN)',
    KSCHL          VARCHAR(4)   NULL     COMMENT '条件类型(KSCHL)',
    PRIMARY KEY (MANDT, RLDNR, RBUKRS, GJAHR, POPER, BELNR, BUZEI)
) COMMENT='ACDOCA-S/4HANA统一日记账(替代BSEG/COEP/FAGLFLEXT),约120字段(生产200+)';

-- BKPF: FI凭证抬头（S/4中为CDS视图，仍可查询）
CREATE TABLE IF NOT EXISTS BKPF (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    BUKRS          VARCHAR(4)   NOT NULL COMMENT '公司代码',
    BELNR          VARCHAR(10)  NOT NULL COMMENT '凭证号',
    GJAHR          INT          NOT NULL COMMENT '会计年度',
    BSTAT          VARCHAR(1)   NULL     COMMENT '凭证状态',
    BLART          VARCHAR(2)   NOT NULL COMMENT '凭证类型(BLART):SA=总账,RE=发票,DA=客户,KR=供应商',
    BLDAT          DATE         NOT NULL COMMENT '凭证日期(BLDAT)',
    CPUDT          DATE         NOT NULL COMMENT '录入日期(CPUDT)',
    BUDAT          DATE         NOT NULL COMMENT '过账日期(BUDAT)',
    MONAT          INT          NOT NULL COMMENT '期间(MONAT)',
    WAERS          VARCHAR(5)   NOT NULL COMMENT '币种(WAERS)',
    KURSF          DECIMAL(9,5) NULL     COMMENT '汇率(KURSF)',
    BKTXT          VARCHAR(20)  NULL     COMMENT '抬头文本(BKTXT)',
    USNAM          VARCHAR(12)  NULL     COMMENT '录入人',
    TCODE          VARCHAR(20)  NULL     COMMENT '事务代码(TCODE)',
    XBLNR          VARCHAR(16)  NULL     COMMENT '参考凭证号(XBLNR)',
    AWTYP          VARCHAR(3)   NULL     COMMENT '参考交易类型',
    AWKEY          VARCHAR(20)  NULL     COMMENT '参考凭证键',
    BVORG          VARCHAR(10)  NULL     COMMENT '跨公司代码交易号',
    PRIMARY KEY (MANDT, BUKRS, BELNR, GJAHR)
) COMMENT='BKPF-FI凭证抬头';

-- BSEG: FI凭证行项目（S/4中为CDS视图，仍可查询）
CREATE TABLE IF NOT EXISTS BSEG (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    BUKRS          VARCHAR(4)   NOT NULL COMMENT '公司代码',
    BELNR          VARCHAR(10)  NOT NULL COMMENT '凭证号',
    GJAHR          INT          NOT NULL COMMENT '会计年度',
    BUZEI          INT          NOT NULL COMMENT '行项目号(BUZEI)',
    BUZID          VARCHAR(1)   NULL     COMMENT '行项目标识(BUZID)',
    KOART          VARCHAR(1)   NOT NULL COMMENT '账户类型(KOART):S=总账,D=客户,K=供应商,M=物料',
    SHKZG          VARCHAR(1)   NOT NULL COMMENT '借/贷标识(SHKZG):S=借方,H=贷方',
    MWSKZ          VARCHAR(1)   NULL     COMMENT '税代码(MWSKZ)',
    DMBTR          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '本位币金额(DMBTR)',
    WRBTR          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '凭证币金额(WRBTR)',
    PSWSL          VARCHAR(5)   NULL     COMMENT '凭证币种',
    HWBAS          DECIMAL(15,2) NULL    COMMENT '本位币税基(HWBAS)',
    FWBAS          DECIMAL(15,2) NULL    COMMENT '凭证币税基(FWBAS)',
    HKONT          VARCHAR(10)  NULL     COMMENT '总账科目(HKONT)',
    KUNNR          VARCHAR(10)  NULL     COMMENT '客户编号',
    LIFNR          VARCHAR(10)  NULL     COMMENT '供应商编号',
    MATNR          VARCHAR(18)  NULL     COMMENT '物料编号',
    WERKS          VARCHAR(4)   NULL     COMMENT '工厂',
    KOSTL          VARCHAR(10)  NULL     COMMENT '成本中心(KOSTL)',
    PRCTR          VARCHAR(10)  NULL     COMMENT '利润中心(PRCTR)',
    GSBER          VARCHAR(4)   NULL     COMMENT '业务范围(GSBER)',
    SGTXT          VARCHAR(50)  NULL     COMMENT '项目文本(SGTXT)',
    AUGBL          VARCHAR(10)  NULL     COMMENT '清账凭证号',
    AUGGJ          INT          NULL     COMMENT '清账年度',
    AUGDT          DATE         NULL     COMMENT '清账日期(AUGDT)',
    ZUONR          VARCHAR(18)  NULL     COMMENT '分配号(ZUONR)',
    PRIMARY KEY (MANDT, BUKRS, BELNR, GJAHR, BUZEI)
) COMMENT='BSEG-FI凭证行项目';

-- BSID: 客户未清项
CREATE TABLE IF NOT EXISTS BSID (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    BUKRS          VARCHAR(4)   NOT NULL COMMENT '公司代码',
    BELNR          VARCHAR(10)  NOT NULL COMMENT '凭证号',
    GJAHR          INT          NOT NULL COMMENT '会计年度',
    BUZEI          INT          NOT NULL COMMENT '行项目号',
    KUNNR          VARCHAR(10)  NOT NULL COMMENT '客户编号',
    UMSKZ          VARCHAR(1)   NULL     COMMENT '特殊总账标识(UMSKZ)',
    SHKZG          VARCHAR(1)   NOT NULL COMMENT '借/贷标识',
    DMBTR          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '本位币金额',
    WRBTR          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '凭证币金额',
    WAERS          VARCHAR(5)   NULL     COMMENT '币种',
    BLART          VARCHAR(2)   NULL     COMMENT '凭证类型',
    BUDAT          DATE         NOT NULL COMMENT '过账日期',
    BLDAT          DATE         NULL     COMMENT '凭证日期',
    ZUONR          VARCHAR(18)  NULL     COMMENT '分配号',
    SGTXT          VARCHAR(50)  NULL     COMMENT '项目文本',
    PRIMARY KEY (MANDT, BUKRS, BELNR, GJAHR, BUZEI)
) COMMENT='BSID-客户未清项(应收账款)';

-- BSIK: 供应商未清项
CREATE TABLE IF NOT EXISTS BSIK (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    BUKRS          VARCHAR(4)   NOT NULL COMMENT '公司代码',
    BELNR          VARCHAR(10)  NOT NULL COMMENT '凭证号',
    GJAHR          INT          NOT NULL COMMENT '会计年度',
    BUZEI          INT          NOT NULL COMMENT '行项目号',
    LIFNR          VARCHAR(10)  NOT NULL COMMENT '供应商编号',
    UMSKZ          VARCHAR(1)   NULL     COMMENT '特殊总账标识',
    SHKZG          VARCHAR(1)   NOT NULL COMMENT '借/贷标识',
    DMBTR          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '本位币金额',
    WRBTR          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '凭证币金额',
    WAERS          VARCHAR(5)   NULL     COMMENT '币种',
    BLART          VARCHAR(2)   NULL     COMMENT '凭证类型',
    BUDAT          DATE         NOT NULL COMMENT '过账日期',
    BLDAT          DATE         NULL     COMMENT '凭证日期',
    ZUONR          VARCHAR(18)  NULL     COMMENT '分配号',
    SGTXT          VARCHAR(50)  NULL     COMMENT '项目文本',
    PRIMARY KEY (MANDT, BUKRS, BELNR, GJAHR, BUZEI)
) COMMENT='BSIK-供应商未清项(应付账款)';

-- ============================================================
-- 3. 采购域（MM - P2P 链路）
-- ============================================================

-- EBAN: 采购申请
CREATE TABLE IF NOT EXISTS EBAN (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    BANFN          VARCHAR(10)  NOT NULL COMMENT '采购申请号(BANFN)',
    BNPOS          INT          NOT NULL COMMENT '行项目号(BNPOS)',
    BANPR          VARCHAR(1)   NOT NULL COMMENT '处理状态(BANPR):N=新建,B=审批中,A=已审批,K=已转PO',
    BSART          VARCHAR(4)   NOT NULL COMMENT '凭证类型(BSART):NB=标准',
    MATNR          VARCHAR(18)  NULL     COMMENT '物料编号',
    TXZ01          VARCHAR(40)  NULL     COMMENT '短文本(TXZ01)',
    MENGE          DECIMAL(13,3) NOT NULL COMMENT '申请数量(MENGE)',
    MEINS          VARCHAR(3)   NOT NULL COMMENT '单位(MEINS)',
    BADAT          DATE         NOT NULL COMMENT '需求日期(BADAT)',
    FRGDT          DATE         NULL     COMMENT '审批日期(FRGDT)',
    EKORG          VARCHAR(4)   NULL     COMMENT '采购组织',
    EKGRP          VARCHAR(3)   NULL     COMMENT '采购组(EKGRP)',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '需求工厂',
    LFDAT          DATE         NULL     COMMENT '交货日期(LFDAT)',
    PREIS          DECIMAL(11,2) NULL    COMMENT '价格(PREIS)',
    PEINH          INT          NULL     COMMENT '价格单位(PEINH)',
    WAERS          VARCHAR(5)   NULL     COMMENT '币种',
    ERNAM          VARCHAR(12)  NULL     COMMENT '创建人',
    ERDAT          DATE         NULL     COMMENT '创建日期',
    AUFNR          VARCHAR(12)  NULL     COMMENT '生产订单号(来源)',
    PRIMARY KEY (MANDT, BANFN, BNPOS)
) COMMENT='EBAN-采购申请';

-- EKKO: 采购订单抬头
CREATE TABLE IF NOT EXISTS EKKO (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    EBELN          VARCHAR(10)  NOT NULL COMMENT '采购订单号(EBELN)',
    BSART          VARCHAR(4)   NOT NULL COMMENT '凭证类型(BSART):NB=标准PO',
    BUKRS          VARCHAR(4)   NOT NULL COMMENT '公司代码',
    EKORG          VARCHAR(4)   NOT NULL COMMENT '采购组织',
    EKGRP          VARCHAR(3)   NOT NULL COMMENT '采购组',
    LIFNR          VARCHAR(10)  NOT NULL COMMENT '供应商',
    WAERS          VARCHAR(5)   NOT NULL COMMENT '币种',
    KNUMV          VARCHAR(10)  NULL     COMMENT '定价过程号(KNUMV)',
    BSTYP          VARCHAR(1)   NOT NULL COMMENT '凭证类别(BSTYP):B=PO',
    STATU          VARCHAR(1)   NULL     COMMENT '状态',
    ERDAT          DATE         NOT NULL COMMENT '创建日期',
    ERNAM          VARCHAR(12)  NULL     COMMENT '创建人',
    BEDAT          DATE         NOT NULL COMMENT '凭证日期(BEDAT)',
    AEDAT          DATE         NULL     COMMENT '修改日期',
    LIFSD          VARCHAR(1)   NULL     COMMENT '交货冻结(LIFSD)',
    PRIMARY KEY (MANDT, EBELN)
) COMMENT='EKKO-采购订单抬头';

-- EKPO: 采购订单行项目
CREATE TABLE IF NOT EXISTS EKPO (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    EBELN          VARCHAR(10)  NOT NULL COMMENT '采购订单号',
    EBELP          INT          NOT NULL COMMENT '行项目号(EBELP)',
    LOEKZ          VARCHAR(1)   NULL     COMMENT '删除标志(LOEKZ)',
    STATU          VARCHAR(1)   NULL     COMMENT '状态',
    MATNR          VARCHAR(18)  NULL     COMMENT '物料编号',
    EMATN          VARCHAR(18)  NULL     COMMENT '目标物料(EMATN)',
    TXZ01          VARCHAR(40)  NULL     COMMENT '短文本',
    MENGE          DECIMAL(13,3) NOT NULL COMMENT '订单数量(MENGE)',
    MEINS          VARCHAR(3)   NOT NULL COMMENT '单位',
    BPRME          VARCHAR(3)   NULL     COMMENT '订单价格单位(BPRME)',
    NETPR          DECIMAL(11,2) NOT NULL DEFAULT 0 COMMENT '净价(NETPR)',
    PEINH          INT          NOT NULL DEFAULT 1 COMMENT '价格单位(PEINH)',
    NETWR          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '净值(NETWR)=净价×数量',
    EFFWR          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '有效值(EFFWR)=含税净值',
    MWSKZ          VARCHAR(1)   NULL     COMMENT '税代码',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '工厂',
    LGORT          VARCHAR(4)   NULL     COMMENT '库位',
    LIFNR          VARCHAR(10)  NULL     COMMENT '供应商(行级)',
    KONNR          VARCHAR(10)  NULL     COMMENT '合同号(KONNR)',
    KTPNR          INT          NULL     COMMENT '合同行号(KTPNR)',
    BANFN          VARCHAR(10)  NULL     COMMENT '来源采购申请号',
    BNPOS          INT          NULL     COMMENT '来源采购申请行号',
    ETKNR          VARCHAR(10)  NULL     COMMENT '报价号',
    LFDAT          DATE         NULL     COMMENT '交货日期',
    EINDT          DATE         NULL     COMMENT '承诺日期(EINDT)',
    WEPOS          DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT '收货容忍度%(WEPOS)',
    UEBPO          DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT '超交容忍度%(UEBPO)',
    ELIKZ          VARCHAR(1)   NULL     COMMENT '交货完成标志(ELIKZ)',
    REPOS          VARCHAR(1)   NULL     COMMENT '发票校验标志(REPOS)',
    PRIMARY KEY (MANDT, EBELN, EBELP)
) COMMENT='EKPO-采购订单行项目';

-- MKPF: 物料凭证抬头
CREATE TABLE IF NOT EXISTS MKPF (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    MBLNR          VARCHAR(10)  NOT NULL COMMENT '物料凭证号(MBLNR)',
    MJAHR          INT          NOT NULL COMMENT '物料凭证年度(MJAHR)',
    BUDAT          DATE         NOT NULL COMMENT '过账日期(BUDAT)',
    CPUDT          DATE         NOT NULL COMMENT '录入日期(CPUDT)',
    CPUTM          VARCHAR(6)   NULL     COMMENT '录入时间(CPUTM)',
    USNAM          VARCHAR(12)  NULL     COMMENT '录入人',
    VGART          VARCHAR(3)   NOT NULL COMMENT '移动类型事务(VGART)',
    BKTXT          VARCHAR(20)  NULL     COMMENT '抬头文本',
    XBLNR          VARCHAR(16)  NULL     COMMENT '参考凭证号',
    BLDAT          DATE         NULL     COMMENT '凭证日期',
    WAERS          VARCHAR(5)   NULL     COMMENT '币种',
    WWERT          DATE         NULL     COMMENT '汇率日期',
    PRIMARY KEY (MANDT, MBLNR, MJAHR)
) COMMENT='MKPF-物料凭证抬头';

-- MSEG: 物料凭证行项目
CREATE TABLE IF NOT EXISTS MSEG (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    MBLNR          VARCHAR(10)  NOT NULL COMMENT '物料凭证号',
    MJAHR          INT          NOT NULL COMMENT '物料凭证年度',
    ZEILE          INT          NOT NULL COMMENT '物料凭证行号(ZEILE)',
    BWART          VARCHAR(3)   NOT NULL COMMENT '移动类型(BWART):101=采购收货,311=转储,261=生产领料',
    INSMK          VARCHAR(1)   NULL     COMMENT '库存类型(INSMK):空=非限制,X=质检,S=冻结',
    SOBKZ          VARCHAR(1)   NULL     COMMENT '特殊库存标识(SOBKZ)',
    MATNR          VARCHAR(18)  NOT NULL COMMENT '物料编号',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '工厂',
    LGORT          VARCHAR(4)   NOT NULL COMMENT '库位',
    CHARG          VARCHAR(10)  NULL     COMMENT '批次(CHARG)',
    MENGE          DECIMAL(13,3) NOT NULL COMMENT '数量(MENGE)',
    MEINS          VARCHAR(3)   NOT NULL COMMENT '单位',
    DMBTR          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '本位币金额(DMBTR)',
    SHKZG          VARCHAR(1)   NOT NULL COMMENT '借/贷标识:S=入库,H=出库',
    EBELN          VARCHAR(10)  NULL     COMMENT '采购订单号',
    EBELP          INT          NULL     COMMENT '采购订单行号',
    AUFNR          VARCHAR(12)  NULL     COMMENT '生产订单号',
    KDAUF          VARCHAR(10)  NULL     COMMENT '销售订单号',
    KDPOS          INT          NULL     COMMENT '销售订单行号',
    SGTXT          VARCHAR(50)  NULL     COMMENT '项目文本',
    PRIMARY KEY (MANDT, MBLNR, MJAHR, ZEILE)
) COMMENT='MSEG-物料凭证行项目';

-- ============================================================
-- 4. 销售域（SD - OTC 链路）
-- ============================================================

-- VBAK: 销售凭证抬头
CREATE TABLE IF NOT EXISTS VBAK (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    VBELN          VARCHAR(10)  NOT NULL COMMENT '销售凭证号(VBELN)',
    VBART          VARCHAR(4)   NULL     COMMENT '销售凭证引用',
    AUART          VARCHAR(4)   NOT NULL COMMENT '销售凭证类型(AUART):OR=标准订单,RE=退货',
    VKORG          VARCHAR(4)   NOT NULL COMMENT '销售组织',
    VTWEG          VARCHAR(2)   NOT NULL COMMENT '分销渠道(VTWEG)',
    SPART          VARCHAR(2)   NOT NULL COMMENT '产品组(SPART)',
    VKBUR          VARCHAR(4)   NULL     COMMENT '销售办公室(VKBUR)',
    VKGRP          VARCHAR(3)   NULL     COMMENT '销售组(VKGRP)',
    KUNNR          VARCHAR(10)  NOT NULL COMMENT '售达方客户(KUNNR)',
    KUNWE          VARCHAR(10)  NULL     COMMENT '送达方客户(KUNWE)',
    BUKRS          VARCHAR(4)   NULL     COMMENT '公司代码',
    GSBER          VARCHAR(4)   NULL     COMMENT '业务范围',
    WAERK          VARCHAR(5)   NULL     COMMENT 'SD凭证币种(WAERK)',
    KNUMV          VARCHAR(10)  NULL     COMMENT '定价过程号(KNUMV)',
    VGBEL          VARCHAR(10)  NULL     COMMENT '参考凭证号',
    AUGRU          VARCHAR(3)   NULL     COMMENT '订单原因(AUGRU)',
    ERDAT          DATE         NOT NULL COMMENT '创建日期',
    ERZET          VARCHAR(6)   NULL     COMMENT '创建时间',
    ERNAM          VARCHAR(12)  NULL     COMMENT '创建人',
    AUDAT          DATE         NULL     COMMENT '凭证日期(客户请求日期)',
    TRVOG          VARCHAR(1)   NULL     COMMENT '事务活动(TRVOG)',
    LIFSK          VARCHAR(2)   NULL     COMMENT '总体交货冻结(LIFSK)',
    FAKSK          VARCHAR(2)   NULL     COMMENT '总体开票冻结(FAKSK)',
    NETWR          DECIMAL(15,2) NULL    COMMENT '净值(NETWR)',
    WAERK_NETWR    VARCHAR(5)   NULL     COMMENT '净值币种',
    PRIMARY KEY (MANDT, VBELN)
) COMMENT='VBAK-销售凭证抬头';

-- VBAP: 销售凭证行项目
CREATE TABLE IF NOT EXISTS VBAP (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    VBELN          VARCHAR(10)  NOT NULL COMMENT '销售凭证号',
    POSNR          INT          NOT NULL COMMENT '行项目号(POSNR)',
    MATNR          VARCHAR(18)  NOT NULL COMMENT '物料编号',
    MATWA          VARCHAR(18)  NULL     COMMENT '目标物料(MATWA)',
    MAKTL          VARCHAR(40)  NULL     COMMENT '物料描述(行级)',
    MATKL          VARCHAR(9)   NULL     COMMENT '物料组',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '工厂',
    LGORT          VARCHAR(4)   NULL     COMMENT '库位',
    KWMENG         DECIMAL(13,3) NOT NULL COMMENT '订单数量(KWMENG)',
    MEINS          VARCHAR(3)   NOT NULL COMMENT '销售单位(MEINS)',
    VRKME          VARCHAR(3)   NULL     COMMENT '销售单位(VRKME)',
    UMVKZ          INT          NULL     COMMENT '分子(UMVKZ)',
    UMVKN          INT          NULL     COMMENT '分母(UMVKN)',
    NETPR          DECIMAL(11,2) NOT NULL DEFAULT 0 COMMENT '净价(NETPR)',
    KZWI1          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '小计1(KZWI1)',
    KZWI2          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '小计2(KZWI2)',
    KZWI3          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '小计3(KZWI3)',
    KZWI4          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '小计4(KZWI4)',
    KZWI5          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '小计5(KZWI5)',
    KZWI6          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '小计6(KZWI6)',
    NETWR          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '净值(NETWR)',
    WAERK          VARCHAR(5)   NULL     COMMENT '币种',
    PEINH          INT          NOT NULL DEFAULT 1 COMMENT '价格单位(PEINH)',
    PSTYV          VARCHAR(4)   NULL     COMMENT '行项目类别(PSTYV)',
    UEPOS          INT          NULL     COMMENT '高级行项目号',
    PRSRE          VARCHAR(1)   NULL     COMMENT '定价相关(PRSRE)',
    VGBEL          VARCHAR(10)  NULL     COMMENT '参考凭证号',
    VGPOS          INT          NULL     COMMENT '参考行项目号',
    ERDAT          DATE         NULL     COMMENT '创建日期',
    EDATU          DATE         NULL     COMMENT '计划交货日期(EDATU)',
    PRGRS          VARCHAR(2)   NULL     COMMENT '进度(PRGRS)',
    PRIMARY KEY (MANDT, VBELN, POSNR)
) COMMENT='VBAP-销售凭证行项目';

-- VBUP: 销售凭证行项目状态
CREATE TABLE IF NOT EXISTS VBUP (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    VBELN          VARCHAR(10)  NOT NULL COMMENT '销售凭证号',
    POSNR          INT          NOT NULL COMMENT '行项目号',
    RFGSA          VARCHAR(1)   NULL     COMMENT '参考状态',
    LFSTA          VARCHAR(1)   NOT NULL COMMENT '总体交货状态(LFSTA):A=未处理,B=部分,C=完全',
    FKSTA          VARCHAR(1)   NOT NULL COMMENT '总体开票状态(FKSTA):A=未处理,B=部分,C=完全',
    GBSTA          VARCHAR(1)   NOT NULL COMMENT '总体处理状态(GBSTA)',
    UVALS          VARCHAR(1)   NULL     COMMENT '不完全标志',
    BESTA          VARCHAR(1)   NULL     COMMENT 'PO状态',
    WBSTA          VARCHAR(1)   NULL     COMMENT '拣配状态',
    PKSTA          VARCHAR(1)   NULL     COMMENT '包装状态',
    LVSTA          VARCHAR(1)   NULL     COMMENT '装运状态',
    PRIMARY KEY (MANDT, VBELN, POSNR)
) COMMENT='VBUP-销售凭证行项目状态';

-- LIKP: 交货抬头
CREATE TABLE IF NOT EXISTS LIKP (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    VBELN          VARCHAR(10)  NOT NULL COMMENT '交货单号(VBELN)',
    VBTYP          VARCHAR(1)   NULL     COMMENT '凭证类别',
    LFART          VARCHAR(4)   NOT NULL COMMENT '交货类型(LFART):LF=出库交货',
    VKORG          VARCHAR(4)   NULL     COMMENT '销售组织',
    KUNNR          VARCHAR(10)  NULL     COMMENT '售达方',
    KUNWE          VARCHAR(10)  NOT NULL COMMENT '送达方',
    KUNAG          VARCHAR(10)  NULL     COMMENT '付款方',
    WERKS          VARCHAR(4)   NULL     COMMENT '工厂',
    LDDAT          DATE         NULL     COMMENT '装载日期(LDDAT)',
    WADAT          DATE         NULL     COMMENT '发货日期(WADAT)',
    WADAT_IST      DATE         NULL     COMMENT '实际发货日期',
    ERDAT          DATE         NOT NULL COMMENT '创建日期',
    ERNAM          VARCHAR(12)  NULL     COMMENT '创建人',
    BLDAT          DATE         NULL     COMMENT '凭证日期',
    KNUMV          VARCHAR(10)  NULL     COMMENT '定价过程号',
    WAERK          VARCHAR(5)   NULL     COMMENT '币种',
    NETWR          DECIMAL(15,2) NULL    COMMENT '净值',
    BTGEW          DECIMAL(13,3) NULL    COMMENT '总重量',
    GEWEI          VARCHAR(3)   NULL     COMMENT '重量单位',
    VOLME          DECIMAL(13,3) NULL    COMMENT '总体积',
    VOLEH          VARCHAR(3)   NULL     COMMENT '体积单位',
    PKSTK          VARCHAR(1)   NULL     COMMENT '拣配状态(PKSTK):A=未处理,C=已拣配',
    WBSTK          VARCHAR(1)   NOT NULL DEFAULT 'A' COMMENT '发货过账状态(WBSTK):A=未处理,B=部分,C=已过账',
    FKSTK          VARCHAR(1)   NULL     COMMENT '开票状态(FKSTK)',
    PRIMARY KEY (MANDT, VBELN)
) COMMENT='LIKP-交货抬头';

-- LIPS: 交货行项目
CREATE TABLE IF NOT EXISTS LIPS (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    VBELN          VARCHAR(10)  NOT NULL COMMENT '交货单号',
    POSNR          INT          NOT NULL COMMENT '行项目号',
    MATNR          VARCHAR(18)  NOT NULL COMMENT '物料编号',
    MAKTL          VARCHAR(40)  NULL     COMMENT '物料描述',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '工厂',
    LGORT          VARCHAR(4)   NOT NULL COMMENT '库位',
    CHARG          VARCHAR(10)  NULL     COMMENT '批次',
    LFIMG          DECIMAL(13,3) NOT NULL COMMENT '交货数量(LFIMG)',
    VRKME          VARCHAR(3)   NOT NULL COMMENT '销售单位',
    MEINS          VARCHAR(3)   NULL     COMMENT '基本单位',
    UMVKZ          INT          NULL     COMMENT '分子',
    UMVKN          INT          NULL     COMMENT '分母',
    NETPR          DECIMAL(11,2) NULL    COMMENT '净价',
    NETWR          DECIMAL(15,2) NULL    COMMENT '净值',
    WAERK          VARCHAR(5)   NULL     COMMENT '币种',
    VGBEL          VARCHAR(10)  NOT NULL COMMENT '参考凭证号(销售订单)',
    VGPOS          INT          NOT NULL COMMENT '参考行项目号',
    PSTYV          VARCHAR(4)   NULL     COMMENT '行项目类别',
    PKMNG          DECIMAL(13,3) NULL    COMMENT '拣配数量(PKMNG)',
    NTGEW          DECIMAL(13,3) NULL    COMMENT '净重',
    BRGEW          DECIMAL(13,3) NULL    COMMENT '毛重',
    GEWEI          VARCHAR(3)   NULL     COMMENT '重量单位',
    PRIMARY KEY (MANDT, VBELN, POSNR)
) COMMENT='LIPS-交货行项目';

-- VBRK: 开票凭证抬头
CREATE TABLE IF NOT EXISTS VBRK (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    VBELN          VARCHAR(10)  NOT NULL COMMENT '开票凭证号(VBELN)',
    FKART          VARCHAR(4)   NOT NULL COMMENT '开票类型(FKART):F2=商业发票,S1=贷项凭证',
    FKDAT          DATE         NOT NULL COMMENT '开票日期(FKDAT)',
    BLDAT          DATE         NULL     COMMENT '凭证日期',
    ERDAT          DATE         NOT NULL COMMENT '创建日期',
    ERNAM          VARCHAR(12)  NULL     COMMENT '创建人',
    KUNRG          VARCHAR(10)  NOT NULL COMMENT '付款方(KUNRG)',
    KUNNR          VARCHAR(10)  NOT NULL COMMENT '售达方',
    BUKRS          VARCHAR(4)   NOT NULL COMMENT '公司代码',
    WAERK          VARCHAR(5)   NOT NULL COMMENT '币种',
    KNUMV          VARCHAR(10)  NULL     COMMENT '定价过程号',
    NETWR          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '净值(NETWR)',
    MWSBK          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '税额(MWSBK)',
    SFWID          DECIMAL(15,2) NULL    COMMENT '总值(含税)',
    FKSTO          VARCHAR(1)   NULL     COMMENT '取消标志(FKSTO)',
    SFAK           VARCHAR(1)   NULL     COMMENT '开票冻结(SFAK)',
    VKORG          VARCHAR(4)   NULL     COMMENT '销售组织',
    VTWEG          VARCHAR(2)   NULL     COMMENT '分销渠道',
    SPART          VARCHAR(2)   NULL     COMMENT '产品组',
    KNUMA          VARCHAR(10)  NULL     COMMENT '条件合同号',
    GJAHR          INT          NULL     COMMENT '会计年度',
    POPER          INT          NULL     COMMENT '期间',
    PRIMARY KEY (MANDT, VBELN)
) COMMENT='VBRK-开票凭证抬头';

-- VBRP: 开票凭证行项目
CREATE TABLE IF NOT EXISTS VBRP (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    VBELN          VARCHAR(10)  NOT NULL COMMENT '开票凭证号',
    POSNR          INT          NOT NULL COMMENT '行项目号',
    FKIMG          DECIMAL(13,3) NOT NULL COMMENT '开票数量(FKIMG)',
    VRKME          VARCHAR(3)   NOT NULL COMMENT '销售单位',
    MEINS          VARCHAR(3)   NULL     COMMENT '基本单位',
    UMVKZ          INT          NULL     COMMENT '分子',
    UMVKN          INT          NULL     COMMENT '分母',
    NETPR          DECIMAL(11,2) NOT NULL DEFAULT 0 COMMENT '净价(NETPR)',
    NETWR          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '净值(NETWR)',
    MWSBP          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '税额(MWSBP)',
    WAERK          VARCHAR(5)   NULL     COMMENT '币种',
    MATNR          VARCHAR(18)  NOT NULL COMMENT '物料编号',
    MAKTL          VARCHAR(40)  NULL     COMMENT '物料描述',
    MATKL          VARCHAR(9)   NULL     COMMENT '物料组',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '工厂',
    KUNNR          VARCHAR(10)  NULL     COMMENT '售达方',
    KUNWE          VARCHAR(10)  NULL     COMMENT '送达方',
    VKORG          VARCHAR(4)   NULL     COMMENT '销售组织',
    VTWEG          VARCHAR(2)   NULL     COMMENT '分销渠道',
    SPART          VARCHAR(2)   NULL     COMMENT '产品组',
    AUBEL          VARCHAR(10)  NULL     COMMENT '来源销售订单号(AUBEL)',
    AUPOS          INT          NULL     COMMENT '来源销售订单行号(AUPOS)',
    VGBEL          VARCHAR(10)  NULL     COMMENT '参考凭证号(交货单)',
    VGPOS          INT          NULL     COMMENT '参考行项目号',
    PSTYV          VARCHAR(4)   NULL     COMMENT '行项目类别',
    KONDM          VARCHAR(2)   NULL     COMMENT '物料定价组(KONDM)',
    KTGRM          VARCHAR(2)   NULL     COMMENT '账户分配组(KTGRM)',
    PROFIT         DECIMAL(15,2) NULL    COMMENT '利润(PROFIT)',
    KZWI1          DECIMAL(15,2) NULL    COMMENT '小计1',
    KZWI2          DECIMAL(15,2) NULL    COMMENT '小计2',
    KZWI3          DECIMAL(15,2) NULL    COMMENT '小计3',
    KZWI4          DECIMAL(15,2) NULL    COMMENT '小计4',
    KZWI5          DECIMAL(15,2) NULL    COMMENT '小计5',
    KZWI6          DECIMAL(15,2) NULL    COMMENT '小计6',
    PRIMARY KEY (MANDT, VBELN, POSNR)
) COMMENT='VBRP-开票凭证行项目';

-- PRCD_ELEMENTS: S/4HANA 定价条件（替代 KONV）
CREATE TABLE IF NOT EXISTS PRCD_ELEMENTS (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    KNUMV          VARCHAR(10)  NOT NULL COMMENT '条件号/定价号(KNUMV)',
    KPOSN          INT          NOT NULL COMMENT '行项目号',
    STUNR          INT          NOT NULL COMMENT '步骤号(STUNR)',
    ZAEHK          INT          NOT NULL DEFAULT 1 COMMENT '计数器(ZAEHK)',
    KSCHL          VARCHAR(4)   NOT NULL COMMENT '条件类型(KSCHL):PR00=价格,MWST=税,VPRS=成本',
    KHERK          VARCHAR(1)   NULL     COMMENT '条件来源(KHERK):A=手工,C=复制',
    KRECH          VARCHAR(1)   NULL     COMMENT '正/负标识(KRECH):A=正,B=负',
    KAWRT          DECIMAL(15,2) NULL    COMMENT '条件基础值(KAWRT)',
    KBETR          DECIMAL(11,2) NOT NULL DEFAULT 0 COMMENT '条件率/金额(KBETR)',
    KPEIN          INT          NOT NULL DEFAULT 1 COMMENT '条件定价单位(KPEIN)',
    KMEIN          VARCHAR(3)   NULL     COMMENT '条件单位(KMEIN)',
    KWERT          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '条件值(KWERT)',
    KKURS          DECIMAL(9,5) NULL    COMMENT '汇率',
    KSTBS          DECIMAL(15,2) NULL    COMMENT '条件基础(本位币)',
    KWAE2          VARCHAR(5)   NULL     COMMENT '条件币种',
    PRIMARY KEY (MANDT, KNUMV, KPOSN, STUNR, ZAEHK)
) COMMENT='PRCD_ELEMENTS-S/4HANA定价条件(替代KONV)';

-- ============================================================
-- 5. 生产域（PP）
-- ============================================================

-- STKO: BOM抬头
CREATE TABLE IF NOT EXISTS STKO (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    STLTY          VARCHAR(1)   NOT NULL COMMENT 'BOM类别(STLTY):M=物料BOM',
    STLNR          VARCHAR(8)   NOT NULL COMMENT 'BOM号(STLNR)',
    STLAL          VARCHAR(2)   NOT NULL DEFAULT '01' COMMENT '替代BOM(STLAL)',
    STLAN          VARCHAR(1)   NOT NULL DEFAULT '1' COMMENT 'BOM用途(STLAN):1=生产',
    DATUV          DATE         NOT NULL COMMENT '有效期起(DATUV)',
    DATUB          DATE         NOT NULL DEFAULT '9999-12-31' COMMENT '有效期止(DATUB)',
    BMENG          DECIMAL(13,3) NOT NULL DEFAULT 1 COMMENT '基本数量(BMENG)',
    BMEIN          VARCHAR(3)   NOT NULL DEFAULT 'EA' COMMENT '基本单位(BMEIN)',
    STLST          VARCHAR(2)   NULL     COMMENT 'BOM状态(STLST)',
    PRIMARY KEY (MANDT, STLTY, STLNR, STLAL)
) COMMENT='STKO-BOM抬头';

-- STPO: BOM项目
CREATE TABLE IF NOT EXISTS STPO (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    STLTY          VARCHAR(1)   NOT NULL COMMENT 'BOM类别',
    STLNR          VARCHAR(8)   NOT NULL COMMENT 'BOM号',
    STLKN          INT          NOT NULL COMMENT 'BOM项目号(STLKN)',
    STVKN          INT          NOT NULL COMMENT 'BOM项目内部号(STVKN)',
    IDNRK          VARCHAR(18)  NOT NULL COMMENT '组件物料编号(IDNRK)',
    POSNR          INT          NOT NULL COMMENT '项目号(POSNR)',
    MENGE          DECIMAL(13,3) NOT NULL COMMENT '组件数量(MENGE)',
    MEINS          VARCHAR(3)   NOT NULL COMMENT '组件单位(MEINS)',
    POSTP          VARCHAR(1)   NOT NULL COMMENT '项目类别(POSTP):L=库存项目,N=非库存',
    AUSCH          DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT '废品率%(AUSCH)',
    VGWTS          VARCHAR(4)   NULL     COMMENT '变量大小(VGWTS)',
    SANKA          VARCHAR(1)   NULL     COMMENT '成本核算相关(SANKA)',
    BEWEK          VARCHAR(1)   NULL     COMMENT '移动类型(BEWEK)',
    PRIMARY KEY (MANDT, STLTY, STLNR, STLKN)
) COMMENT='STPO-BOM项目';

-- CRHD: 工作中心抬头
CREATE TABLE IF NOT EXISTS CRHD (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    OBJTY          VARCHAR(2)   NOT NULL DEFAULT 'A' COMMENT '对象类型(OBJTY)',
    OBJID          INT          NOT NULL COMMENT '对象号(OBJID)',
    ARBPL          VARCHAR(8)   NOT NULL COMMENT '工作中心(ARBPL)',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '工厂',
    VERWE          VARCHAR(2)   NOT NULL COMMENT '工作中心类别(VERWE)',
    KAPAR          VARCHAR(1)   NOT NULL DEFAULT '0' COMMENT '产能类别(KAPAR):0=机器,1=人工',
    LEARR          VARCHAR(6)   NULL     COMMENT '活动类型(LEARR)',
    KOSTL          VARCHAR(10)  NULL     COMMENT '成本中心',
    LTXA1          VARCHAR(40)  NULL     COMMENT '工作中心描述(LTXA1)',
    HRELV          VARCHAR(1)   NULL     COMMENT '相关标识(HRELV)',
    PRIMARY KEY (MANDT, OBJTY, OBJID)
) COMMENT='CRHD-工作中心抬头';

-- PLKO: 任务清单抬头(工艺路线)
CREATE TABLE IF NOT EXISTS PLKO (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    PLNTY          VARCHAR(1)   NOT NULL COMMENT '任务清单类型(PLNTY):N=工艺路线',
    PLNNR          VARCHAR(8)   NOT NULL COMMENT '任务清单组号(PLNNR)',
    PLNAL          VARCHAR(2)   NOT NULL COMMENT '组计数器(PLNAL)',
    PLNTX          VARCHAR(2)   NULL     COMMENT '任务清单用途',
    DATUV          DATE         NOT NULL COMMENT '有效期起',
    DATUB          DATE         NOT NULL DEFAULT '9999-12-31' COMMENT '有效期止',
    KTEXT          VARCHAR(20)  NULL     COMMENT '任务清单描述(KTEXT)',
    LOEKZ          VARCHAR(1)   NULL     COMMENT '删除标志',
    PRIMARY KEY (MANDT, PLNTY, PLNNR, PLNAL)
) COMMENT='PLKO-任务清单抬头(工艺路线)';

-- PLPO: 任务清单操作(工序)
CREATE TABLE IF NOT EXISTS PLPO (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    PLNTY          VARCHAR(1)   NOT NULL COMMENT '任务清单类型',
    PLNNR          VARCHAR(8)   NOT NULL COMMENT '任务清单组号',
    PLNKN          INT          NOT NULL COMMENT '任务清单节点号(PLNKN)',
    PLNAL          VARCHAR(2)   NOT NULL COMMENT '组计数器',
    VORNR          VARCHAR(4)   NOT NULL COMMENT '工序号(VORNR)',
    VGVWZ          VARCHAR(4)   NULL     COMMENT '工序控制键(VGVWZ)',
    ARBID          INT          NOT NULL COMMENT '工作中心对象号',
    LTXA1          VARCHAR(40)  NULL     COMMENT '工序描述(LTXA1)',
    BMSCH          DECIMAL(13,3) NOT NULL DEFAULT 1 COMMENT '基本数量(BMSCH)',
    MEINH          VARCHAR(3)   NOT NULL DEFAULT 'EA' COMMENT '基本单位',
    VGW01          DECIMAL(7,2) NOT NULL DEFAULT 0 COMMENT '标准值1-准备(VGW01)',
    VGW02          DECIMAL(7,2) NOT NULL DEFAULT 0 COMMENT '标准值2-机器(VGW02)',
    VGW03          DECIMAL(7,2) NOT NULL DEFAULT 0 COMMENT '标准值3-人工(VGW03)',
    VGW04          DECIMAL(7,2) NOT NULL DEFAULT 0 COMMENT '标准值4-拆卸(VGW04)',
    VGE01          VARCHAR(3)   NULL     COMMENT '单位1(VGE01):H=小时',
    VGE02          VARCHAR(3)   NULL     COMMENT '单位2',
    VGE03          VARCHAR(3)   NULL     COMMENT '单位3',
    SORTF          VARCHAR(10)  NULL     COMMENT '排序字符串(SORTF)',
    PRIMARY KEY (MANDT, PLNTY, PLNNR, PLNKN)
) COMMENT='PLPO-任务清单操作(工序)';

-- AUFK: 订单主数据(生产/PM)
CREATE TABLE IF NOT EXISTS AUFK (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    AUFNR          VARCHAR(12)  NOT NULL COMMENT '订单号(AUFNR)',
    AUTYP          VARCHAR(4)   NOT NULL COMMENT '订单类型(AUTYP):10=生产,30=PM纠正,40=PM预防',
    AUART          VARCHAR(4)   NOT NULL COMMENT '订单类型代码(AUART):PP01=生产,PM01=纠正,PM02=预防',
    ERDAT          DATE         NOT NULL COMMENT '创建日期',
    ERNAM          VARCHAR(12)  NULL     COMMENT '创建人',
    KOKRS          VARCHAR(4)   NOT NULL COMMENT '控制范围',
    BUKRS          VARCHAR(4)   NULL     COMMENT '公司代码',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '工厂',
    KOSTL          VARCHAR(10)  NULL     COMMENT '成本中心',
    SOWRK          VARCHAR(4)   NULL     COMMENT '工作中心工厂',
    ARBPL          VARCHAR(8)   NULL     COMMENT '主工作中心',
    PHAS0          VARCHAR(1)   NULL     COMMENT '创建标志(PHAS0)',
    PHAS1          VARCHAR(1)   NULL     COMMENT '下达标志(PHAS1)',
    PHAS2          VARCHAR(1)   NULL     COMMENT '完工确认标志(PHAS2)',
    PHAS3          VARCHAR(1)   NULL     COMMENT '结算标志(PHAS3)',
    OBJNR          VARCHAR(22)  NULL     COMMENT '对象号(OBJNR)',
    PLGKZ          VARCHAR(1)   NULL     COMMENT '计划标志',
    GSTRP          DATE         NULL     COMMENT '计划开始日期(GSTRP)',
    GLTRP          DATE         NULL     COMMENT '计划完成日期(GLTRP)',
    GSTRI          DATE         NULL     COMMENT '实际开始日期(GSTRI)',
    GETRI          DATE         NULL     COMMENT '实际完成日期(GETRI)',
    IDAT2          DATE         NULL     COMMENT '确认日期(IDAT2)',
    LOEKZ          VARCHAR(1)   NULL     COMMENT '删除标志(LOEKZ)',
    PRIMARY KEY (MANDT, AUFNR)
) COMMENT='AUFK-订单主数据(生产/PM)';

-- AFKO: 生产订单抬头数据
CREATE TABLE IF NOT EXISTS AFKO (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    AUFNR          VARCHAR(12)  NOT NULL COMMENT '生产订单号',
    PLNBEZ          VARCHAR(18) NOT NULL COMMENT '生产物料编号(PLNBEZ)',
    PLNTY          VARCHAR(1)   NULL     COMMENT '任务清单类型',
    PLNNR          VARCHAR(8)   NULL     COMMENT '任务清单组号',
    PLNAL          VARCHAR(2)   NULL     COMMENT '组计数器',
    STLTY          VARCHAR(1)   NULL     COMMENT 'BOM类别',
    STLNR          VARCHAR(8)   NULL     COMMENT 'BOM号',
    STLAL          VARCHAR(2)   NULL     COMMENT '替代BOM',
    GAMNG          DECIMAL(13,3) NOT NULL COMMENT '订单总数量(GAMNG)',
    GMEIN          VARCHAR(3)   NOT NULL COMMENT '基本单位(GMEIN)',
    IGMNG          DECIMAL(13,3) NOT NULL DEFAULT 0 COMMENT '确认产量(IGMNG)',
    CONF_CNT       INT          NOT NULL DEFAULT 0 COMMENT '确认次数',
    WEMNG          DECIMAL(13,3) NOT NULL DEFAULT 0 COMMENT '收货数量(WEMNG)',
    AUSCH          DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT '废品率%(AUSCH)',
    DISPO          VARCHAR(3)   NULL     COMMENT 'MRP控制者',
    TERKZ          VARCHAR(1)   NULL     COMMENT '可用性检查(TERKZ)',
    PRIMARY KEY (MANDT, AUFNR)
) COMMENT='AFKO-生产订单抬头数据';

-- AFPO: 生产订单项目数据
CREATE TABLE IF NOT EXISTS AFPO (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    AUFNR          VARCHAR(12)  NOT NULL COMMENT '生产订单号',
    POSNR          INT          NOT NULL DEFAULT 1 COMMENT '订单项目号',
    MATNR          VARCHAR(18)  NOT NULL COMMENT '物料编号',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '工厂',
    PAMNG          DECIMAL(13,3) NOT NULL COMMENT '订单数量(PAMNG)',
    MEINS          VARCHAR(3)   NOT NULL COMMENT '单位',
    WEMNG          DECIMAL(13,3) NOT NULL DEFAULT 0 COMMENT '收货数量(WEMNG)',
    AMNGM          DECIMAL(13,3) NOT NULL DEFAULT 0 COMMENT '废品数量(AMNGM)',
    DGLTP          DATE         NULL     COMMENT '计划交货日期',
    PRIMARY KEY (MANDT, AUFNR, POSNR)
) COMMENT='AFPO-生产订单项目数据';

-- MDKP: MRP清单抬头
CREATE TABLE IF NOT EXISTS MDKP (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    MDNUM          INT          NOT NULL COMMENT 'MRP清单号(MDNUM)',
    MATNR          VARCHAR(18)  NOT NULL COMMENT '物料编号',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '工厂',
    PLSCN          VARCHAR(3)   NOT NULL DEFAULT '000' COMMENT '计划场景(PLSCN)',
    MDKZU          VARCHAR(1)   NULL     COMMENT 'MRP清单标志',
    PRIMARY KEY (MANDT, MDNUM)
) COMMENT='MDKP-MRP清单抬头';

-- MDPS: MRP清单元素
CREATE TABLE IF NOT EXISTS MDPS (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    MDNUM          INT          NOT NULL COMMENT 'MRP清单号',
    DEL00          VARCHAR(1)   NULL     COMMENT '删除标志',
    DELKZ          VARCHAR(1)   NOT NULL COMMENT '元素类型(DELKZ):AR=收货,BE=需求,SB=安全库存',
    MNG01          DECIMAL(13,3) NOT NULL DEFAULT 0 COMMENT 'MRP数量(MNG01)',
    MEINS          VARCHAR(3)   NULL     COMMENT '单位',
    DAT00          DATE         NOT NULL COMMENT '日期(DAT00)',
    ENT00          DECIMAL(13,3) NOT NULL DEFAULT 0 COMMENT '累计可用量(ENT00)',
    PLUMI          VARCHAR(1)   NULL     COMMENT '正/负标识',
    AUSKT          DATE         NULL     COMMENT '覆盖日期(AUSKT)',
    LOEFE          VARCHAR(1)   NULL     COMMENT '处理标志',
    PRIMARY KEY (MANDT, MDNUM, DELKZ, DAT00)
) COMMENT='MDPS-MRP清单元素';

-- ============================================================
-- 6. 人力域（HCM）
-- ============================================================

-- HRP1000: InfoType 1000 - 对象
CREATE TABLE IF NOT EXISTS HRP1000 (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    PLVAR          VARCHAR(2)   NOT NULL COMMENT '计划版本(PLVAR):01=当前计划',
    OTYPE          VARCHAR(2)   NOT NULL COMMENT '对象类型(OTYPE):O=组织单元,S=岗位,C=成本中心,P=人员',
    OBJID          INT          NOT NULL COMMENT '对象号(OBJID)',
    ISTAT          VARCHAR(2)   NOT NULL DEFAULT '1' COMMENT '对象状态(ISTAT):1=活动',
    BEGDA          DATE         NOT NULL COMMENT '有效期起(BEGDA)',
    ENDDA          DATE         NOT NULL COMMENT '有效期止(ENDDA)',
    SHORT          VARCHAR(12)  NULL     COMMENT '对象缩写(SHORT)',
    STEXT          VARCHAR(40)  NOT NULL COMMENT '对象名称(STEXT)',
    LANGU          VARCHAR(1)   NOT NULL DEFAULT '1' COMMENT '语言(LANGU):1=中文',
    PRIMARY KEY (MANDT, PLVAR, OTYPE, OBJID, ISTAT, BEGDA)
) COMMENT='HRP1000-InfoType1000(对象)';

-- HRP1001: InfoType 1001 - 关系
CREATE TABLE IF NOT EXISTS HRP1001 (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    PLVAR          VARCHAR(2)   NOT NULL COMMENT '计划版本',
    OTYPE          VARCHAR(2)   NOT NULL COMMENT '对象类型',
    OBJID          INT          NOT NULL COMMENT '对象号',
    ISTAT          VARCHAR(2)   NOT NULL DEFAULT '1' COMMENT '对象状态',
    BEGDA          DATE         NOT NULL COMMENT '有效期起',
    ENDDA          DATE         NOT NULL COMMENT '有效期止',
    RSIGN          VARCHAR(1)   NOT NULL COMMENT '关系方向(RSIGN):A=正向,B=反向',
    RELAT          VARCHAR(3)   NOT NULL COMMENT '关系类型(RELAT):002=汇报给,003=包含,008=持有',
    SCLAS          VARCHAR(2)   NOT NULL COMMENT '相关对象类型(SCLAS)',
    SOBID          INT          NOT NULL COMMENT '相关对象号(SOBID)',
    PRIMARY KEY (MANDT, PLVAR, OTYPE, OBJID, ISTAT, BEGDA, RSIGN, RELAT, SCLAS, SOBID)
) COMMENT='HRP1001-InfoType1001(关系)';

-- PA0001: InfoType 0001 - 组织分配
CREATE TABLE IF NOT EXISTS PA0001 (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    PERNR          INT          NOT NULL COMMENT '人员编号(PERNR)',
    SUBTY          VARCHAR(4)   NOT NULL DEFAULT '0000' COMMENT '子类型(SUBTY)',
    OBJPS          VARCHAR(2)   NOT NULL DEFAULT '00' COMMENT '对象标识(OBJPS)',
    SPRPS          VARCHAR(1)   NOT NULL DEFAULT '' COMMENT '锁定标识(SPRPS)',
    ENDDA          DATE         NOT NULL COMMENT '有效期止(ENDDA)',
    BEGDA          DATE         NOT NULL COMMENT '有效期起(BEGDA)',
    SEQNR          INT          NOT NULL DEFAULT 0 COMMENT '序号(SEQNR)',
    AEDTM          DATE         NULL     COMMENT '变更日期',
    UNAME          VARCHAR(12)  NULL     COMMENT '变更人',
    BUKRS          VARCHAR(4)   NOT NULL COMMENT '公司代码',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '人事范围/工厂(WERKS)',
    PERSG          VARCHAR(1)   NOT NULL COMMENT '员工组(PERSG):1=正式,2=合同',
    PERSK          VARCHAR(2)   NOT NULL COMMENT '员工子组(PERSK)',
    ORGEH          INT          NULL     COMMENT '组织单元(ORGEH)',
    PLANS          INT          NULL     COMMENT '岗位(PLANS)',
    STELL          VARCHAR(8)   NULL     COMMENT '职务(STELL)',
    KOSTL          VARCHAR(10)  NULL     COMMENT '成本中心',
    GSBER          VARCHAR(4)   NULL     COMMENT '业务范围',
    ABKRS          VARCHAR(2)   NULL     COMMENT '工资核算范围(ABKRS)',
    PRIMARY KEY (MANDT, PERNR, SUBTY, OBJPS, SPRPS, ENDDA, BEGDA, SEQNR)
) COMMENT='PA0001-InfoType0001(组织分配)';

-- PA0002: InfoType 0002 - 个人数据
CREATE TABLE IF NOT EXISTS PA0002 (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    PERNR          INT          NOT NULL COMMENT '人员编号',
    SUBTY          VARCHAR(4)   NOT NULL DEFAULT '0000' COMMENT '子类型',
    OBJPS          VARCHAR(2)   NOT NULL DEFAULT '00' COMMENT '对象标识',
    SPRPS          VARCHAR(1)   NOT NULL DEFAULT '' COMMENT '锁定标识',
    ENDDA          DATE         NOT NULL COMMENT '有效期止',
    BEGDA          DATE         NOT NULL COMMENT '有效期起',
    SEQNR          INT          NOT NULL DEFAULT 0 COMMENT '序号',
    NACHN          VARCHAR(40)  NOT NULL COMMENT '姓氏(NACHN)',
    VORNA          VARCHAR(40)  NOT NULL COMMENT '名字(VORNA)',
    MIDNM          VARCHAR(40)  NULL     COMMENT '中间名(MIDNM)',
    GBDAT          DATE         NOT NULL COMMENT '出生日期(GBDAT)',
    GESCH          VARCHAR(1)   NOT NULL COMMENT '性别(GESCH):1=男,2=女',
    NATSL          VARCHAR(3)   NULL     COMMENT '国籍(NATSL)',
    SPRAS          VARCHAR(1)   NULL     COMMENT '语言',
    FAMDT          DATE         NULL     COMMENT '婚姻状况日期(FAMDT)',
    FAMST          VARCHAR(1)   NULL     COMMENT '婚姻状况(FAMST)',
    PRIMARY KEY (MANDT, PERNR, SUBTY, OBJPS, SPRPS, ENDDA, BEGDA, SEQNR)
) COMMENT='PA0002-InfoType0002(个人数据)';

-- PA0008: InfoType 0008 - 基本工资
CREATE TABLE IF NOT EXISTS PA0008 (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    PERNR          INT          NOT NULL COMMENT '人员编号',
    SUBTY          VARCHAR(4)   NOT NULL DEFAULT '0000' COMMENT '子类型',
    OBJPS          VARCHAR(2)   NOT NULL DEFAULT '00' COMMENT '对象标识',
    SPRPS          VARCHAR(1)   NOT NULL DEFAULT '' COMMENT '锁定标识',
    ENDDA          DATE         NOT NULL COMMENT '有效期止',
    BEGDA          DATE         NOT NULL COMMENT '有效期起',
    SEQNR          INT          NOT NULL DEFAULT 0 COMMENT '序号',
    TRFAR          VARCHAR(2)   NOT NULL COMMENT '工资类型(TRFAR)',
    TRFGB          VARCHAR(2)   NOT NULL COMMENT '工资范围(TRFGB)',
    TRFGR          VARCHAR(8)   NOT NULL COMMENT '工资等级(TRFGR)',
    TRFST          VARCHAR(2)   NULL     COMMENT '工资级别(TRFST)',
    ANZ01          DECIMAL(5,2) NULL    COMMENT '比例/数量(ANZ01)',
    BET01          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '金额/工资项1(BET01)',
    BET02          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '金额/工资项2(BET02)',
    BET03          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '金额/工资项3(BET03)',
    BET04          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '金额/工资项4(BET04)',
    WAERS          VARCHAR(5)   NULL     COMMENT '币种',
    BSGRD          DECIMAL(5,2) NULL    COMMENT '基本工资比例(BSGRD)',
    PRIMARY KEY (MANDT, PERNR, SUBTY, OBJPS, SPRPS, ENDDA, BEGDA, SEQNR)
) COMMENT='PA0008-InfoType0008(基本工资)';

-- ============================================================
-- 7. 设备域（PM - Plant Maintenance）
-- ============================================================

-- IFLOT: 功能位置
CREATE TABLE IF NOT EXISTS IFLOT (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    TPLNR          VARCHAR(30)  NOT NULL COMMENT '功能位置(TPLNR)',
    HEQUI          VARCHAR(30)  NULL     COMMENT '上级功能位置(HEQUI)',
    FLTVD          VARCHAR(1)   NULL     COMMENT '功能位置类别(FLTVD)',
    BEGDT          DATE         NOT NULL COMMENT '有效期起(BEGDT)',
    ENDDT          DATE         NOT NULL DEFAULT '9999-12-31' COMMENT '有效期止(ENDDT)',
    PLTXT          VARCHAR(40)  NOT NULL COMMENT '功能位置描述(PLTXT)',
    IWERK          VARCHAR(4)   NOT NULL COMMENT '计划工厂(IWERK)',
    INGRP          VARCHAR(3)   NULL     COMMENT '计划员组(INGRP)',
    RBNR           VARCHAR(9)   NULL     COMMENT '目录概况(RBNR)',
    VKGRP          VARCHAR(3)   NULL     COMMENT '计划组(VKGRP)',
    OBJNR          VARCHAR(22)  NULL     COMMENT '对象号(OBJNR)',
    PRIMARY KEY (MANDT, TPLNR)
) COMMENT='IFLOT-功能位置';

-- EQUI: 设备主记录
CREATE TABLE IF NOT EXISTS EQUI (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    EQUNR          VARCHAR(18)  NOT NULL COMMENT '设备编号(EQUNR)',
    HEQUI          VARCHAR(18)  NULL     COMMENT '上级设备(HEQUI)',
    TPLNR          VARCHAR(30)  NULL     COMMENT '功能位置(TPLNR)',
    EQART          VARCHAR(2)   NULL     COMMENT '设备类别(EQART)',
    EQKTX          VARCHAR(40)  NOT NULL COMMENT '设备描述(EQKTX)',
    BEGDT          DATE         NOT NULL COMMENT '有效期起(BEGDT)',
    ENDDT          DATE         NOT NULL DEFAULT '9999-12-31' COMMENT '有效期止(ENDDT)',
    HERST          VARCHAR(20)  NULL     COMMENT '制造商(HERST)',
    TYPBZ          VARCHAR(20)  NULL     COMMENT '型号(TYPBZ)',
    BAUJJ          INT          NULL     COMMENT '制造年份(BAUJJ)',
    SERGE          VARCHAR(20)  NULL     COMMENT '序列号(SERGE)',
    ANLNR          VARCHAR(12)  NULL     COMMENT '固定资产号(ANLNR)',
    IWERK          VARCHAR(4)   NOT NULL COMMENT '计划工厂',
    INGRP          VARCHAR(3)   NULL     COMMENT '计划员组',
    RBNR           VARCHAR(9)   NULL     COMMENT '目录概况',
    SWERK          VARCHAR(4)   NULL     COMMENT '维护工厂',
    KOSTL          VARCHAR(10)  NULL     COMMENT '成本中心',
    WERKS          VARCHAR(4)   NULL     COMMENT '工厂',
    MATNR          VARCHAR(18)  NULL     COMMENT '物料编号',
    OBJNR          VARCHAR(22)  NULL     COMMENT '对象号',
    EQTYP          VARCHAR(1)   NULL     COMMENT '设备类型(EQTYP)',
    DATAB          DATE         NULL     COMMENT '技术开始日期',
    DATBI          DATE         NULL     COMMENT '技术结束日期',
    PRIMARY KEY (MANDT, EQUNR)
) COMMENT='EQUI-设备主记录';

-- MHIO: 维护计划抬头
CREATE TABLE IF NOT EXISTS MHIO (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    WAPNR          VARCHAR(12)  NOT NULL COMMENT '维护计划号(WAPNR)',
    WAPTZ          VARCHAR(1)   NOT NULL COMMENT '计划类型(WAPTZ):1=基于时间,2=基于性能',
    STRAT          VARCHAR(3)   NOT NULL COMMENT '策略(STRAT)',
    ZYKLA          INT          NOT NULL DEFAULT 1 COMMENT '周期(ZYKLA)',
    TSTMP          DATE         NULL     COMMENT '起始日期(TSTMP)',
    HOEHI          VARCHAR(12)  NULL     COMMENT '上级计划',
    TERMI          DATE         NULL     COMMENT '下次计划日期(TERMI)',
    ABSTA          VARCHAR(1)   NULL     COMMENT '状态(ABSTA)',
    WERKS          VARCHAR(4)   NULL     COMMENT '工厂',
    PRIMARY KEY (MANDT, WAPNR)
) COMMENT='MHIO-维护计划抬头';

-- PMCO: PM/CS 订单成本
CREATE TABLE IF NOT EXISTS PMCO (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团',
    AUFNR          VARCHAR(12)  NOT NULL COMMENT '订单号',
    KOKRS          VARCHAR(4)   NOT NULL COMMENT '控制范围',
    WRTTP          VARCHAR(1)   NOT NULL DEFAULT '4' COMMENT '值类型(WRTTP):4=实际,1=计划',
    KSTAR          VARCHAR(6)   NOT NULL COMMENT '成本要素(KSTAR)',
    BEKNZ          VARCHAR(1)   NOT NULL COMMENT '借/贷标识(BEKNZ):A=借方,L=贷方',
    OWAP           DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '对象货币金额(OWAP)',
    OWAE           VARCHAR(5)   NULL     COMMENT '对象货币',
    KWAP           DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '控制范围货币金额(KWAP)',
    KWAE           VARCHAR(5)   NULL     COMMENT '控制范围货币',
    GJAHR          INT          NOT NULL COMMENT '年度',
    PERBL          INT          NOT NULL DEFAULT 0 COMMENT '期间块(PERBL)',
    PRIMARY KEY (MANDT, AUFNR, KOKRS, WRTTP, KSTAR, BEKNZ, GJAHR, PERBL)
) COMMENT='PMCO-PM/CS订单成本';

-- ============================================================
-- 8. 质量管理域（QM）
-- ============================================================

-- QALS: 检验批抬头
CREATE TABLE IF NOT EXISTS QALS (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    QPLOS          VARCHAR(12)  NOT NULL COMMENT '检验批号(QPLOS)',
    MATNR          VARCHAR(18)  NOT NULL COMMENT '物料编号(MATNR)',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '工厂(WERKS)',
    CHARG          VARCHAR(10)  NULL     COMMENT '批次(CHARG)',
    LIFNR          VARCHAR(10)  NULL     COMMENT '供应商(LIFNR)',
    EBELN          VARCHAR(10)  NULL     COMMENT '采购订单号(EBELN)',
    EBELP          INT          NULL     COMMENT '采购订单行号(EBELP)',
    VBELN          VARCHAR(10)  NULL     COMMENT '交货单号(VBELN)',
    VBELP          INT          NULL     COMMENT '交货行号(VBELP)',
    AUFNR          VARCHAR(12)  NULL     COMMENT '生产订单号(AUFNR)',
    ENSTEHDAT      DATE         NOT NULL COMMENT '创建日期(ENSTEHDAT)',
    ENSTEHZEI      VARCHAR(6)   NULL     COMMENT '创建时间(ENSTEHZEI)',
    ENTSTEHER      VARCHAR(12)  NULL     COMMENT '创建人(ENTSTEHER)',
    QPLVL          VARCHAR(1)   NULL     COMMENT '检验批来源(QPLVL):01=来料,02=过程,03=成品',
    LAGORTCHRG     VARCHAR(4)   NULL     COMMENT '检验库位(LAGORTCHRG)',
    STAT35         VARCHAR(22)  NULL     COMMENT '系统状态(STAT35)',
    VEKAT          VARCHAR(2)   NULL     COMMENT '检验类别(VEKAT)',
    QKZVERF        VARCHAR(1)   NULL     COMMENT '检验方法(QKZVERF)',
    MENGENBR       DECIMAL(13,3) NULL    COMMENT '检验批量(MENGENBR)',
    MEINH          VARCHAR(3)   NULL     COMMENT '单位(MEINH)',
    LMENGEZUB      DECIMAL(13,3) NULL    COMMENT '已决策数量(LMENGEZUB)',
    LZUGELMGE     DECIMAL(13,3) NULL    COMMENT '已确认数量(LZUGELMGE)',
    PRIMARY KEY (MANDT, QPLOS)
) COMMENT='QALS-检验批抬头';

-- QAMV: 检验特性
CREATE TABLE IF NOT EXISTS QAMV (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    QPLOS          VARCHAR(12)  NOT NULL COMMENT '检验批号(QPLOS)',
    ZAEHLKAT       INT          NOT NULL COMMENT '特性计数器(ZAEHLKAT)',
    MERKNR         VARCHAR(8)   NOT NULL COMMENT '主检验特性号(MERKNR)',
    VERWMERKM      VARCHAR(8)   NULL     COMMENT '检验特性(VERWMERKM)',
    KURZTEXT       VARCHAR(40)  NULL     COMMENT '特性短文本(KURZTEXT)',
    QPMK_WERKS     VARCHAR(4)   NULL     COMMENT '特性工厂(QPMK_WERKS)',
    QPMK_VERSION   VARCHAR(2)   NULL     COMMENT '特性版本(QPMK_VERSION)',
    MSTHB          VARCHAR(1)   NULL     COMMENT '计量标识(MSTHB):X=定量,空=定性',
    SOLLWERT       DECIMAL(13,3) NULL    COMMENT '目标值(SOLLWERT)',
    TOLERANZOB     DECIMAL(13,3) NULL    COMMENT '规格上限(TOLERANZOB)',
    TOLERANZUN     DECIMAL(13,3) NULL    COMMENT '规格下限(TOLERANZUN)',
    SWERTEINH      VARCHAR(3)   NULL     COMMENT '计量单位(SWERTEINH)',
    STEUKZML       VARCHAR(1)   NULL     COMMENT '特性状态(STEUKZML)',
    VORGABENR      INT          NULL     COMMENT '样本大小(VORGABENR)',
    PRIMARY KEY (MANDT, QPLOS, ZAEHLKAT)
) COMMENT='QAMV-检验特性';

-- QAMR: 检验结果
CREATE TABLE IF NOT EXISTS QAMR (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    QPLOS          VARCHAR(12)  NOT NULL COMMENT '检验批号(QPLOS)',
    ZAEHLKAT       INT          NOT NULL COMMENT '特性计数器(ZAEHLKAT)',
    SATZNR         INT          NOT NULL COMMENT '结果记录号(SATZNR)',
    VORGNR         VARCHAR(8)   NULL     COMMENT '操作号(VORGNR)',
    MERKNR         VARCHAR(8)   NULL     COMMENT '检验特性号(MERKNR)',
    KURZTEXT       VARCHAR(40)  NULL     COMMENT '特性短文本(KURZTEXT)',
    MITTELWERT     DECIMAL(13,3) NULL    COMMENT '平均值/结果值(MITTELWERT)',
    MBEWERTG       VARCHAR(1)   NULL     COMMENT '评估代码(MBEWERTG):A=接受,R=拒绝',
    REIFEGRAD      VARCHAR(1)   NULL     COMMENT '成熟度(REIFEGRAD)',
    ORIGINAL_EH    VARCHAR(3)   NULL     COMMENT '原始单位(ORIGINAL_EH)',
    PRIMARY KEY (MANDT, QPLOS, ZAEHLKAT, SATZNR)
) COMMENT='QAMR-检验结果';

-- QPLO: 检验操作
CREATE TABLE IF NOT EXISTS QPLO (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    QPLOS          VARCHAR(12)  NOT NULL COMMENT '检验批号(QPLOS)',
    VORGNR         VARCHAR(8)   NOT NULL COMMENT '操作号(VORGNR)',
    VORGLFNR       INT          NOT NULL COMMENT '操作计数器(VORGLFNR)',
    KTSCH          VARCHAR(4)   NULL     COMMENT '操作短文本(KTSCH)',
    LTEXTNR        INT          NULL     COMMENT '长文本号(LTEXTNR)',
    ARBPL          VARCHAR(8)   NULL     COMMENT '工作中心(ARBPL)',
    WERKS          VARCHAR(4)   NULL     COMMENT '工厂(WERKS)',
    STEUS          VARCHAR(4)   NULL     COMMENT '控制码(STEUS)',
    VORGB          VARCHAR(1)   NULL     COMMENT '操作用途(VORGB)',
    ZAEHLER        INT          NULL     COMMENT '特性计数器(ZAEHLER)',
    PRIMARY KEY (MANDT, QPLOS, VORGNR, VORGLFNR)
) COMMENT='QPLO-检验操作';

-- ============================================================
-- 9. 资产会计域（AM - Asset Accounting）
-- ============================================================

-- ANLA: 资产主记录
CREATE TABLE IF NOT EXISTS ANLA (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    BUKRS          VARCHAR(4)   NOT NULL COMMENT '公司代码(BUKRS)',
    ANLN1          VARCHAR(12)  NOT NULL COMMENT '主资产号(ANLN1)',
    ANLN2          VARCHAR(4)   NOT NULL COMMENT '资产子号(ANLN2)',
    ANLKL          VARCHAR(4)   NULL     COMMENT '资产类(ANLKL)',
    ANLHT          VARCHAR(20)  NULL     COMMENT '资产主号文本(ANLHT)',
    TXT50          VARCHAR(50)  NULL     COMMENT '资产描述(TXT50)',
    AKTIV          DATE         NULL     COMMENT '资本化日期(AKTIV)',
    DEAKT          DATE         NULL     COMMENT '停用日期(DEAKT)',
    ZUJHR          INT          NULL     COMMENT '购置年度(ZUJHR)',
    GJAHR          INT          NULL     COMMENT '当前年度(GJAHR)',
    AFASL          VARCHAR(4)   NULL     COMMENT '折旧码(AFASL)',
    URWRT          DECIMAL(15,2) NULL    COMMENT '购置值(URWRT)',
    ANBTR          DECIMAL(15,2) NULL    COMMENT '账面净值(ANBTR)',
    KANSW          DECIMAL(15,2) NULL    COMMENT '累计折旧(KANSW)',
    WAERS          VARCHAR(5)   NULL     COMMENT '币种(WAERS)',
    KTOGR          VARCHAR(4)   NULL     COMMENT '科目定位码(KTOGR)',
    KOSTL          VARCHAR(10)  NULL     COMMENT '成本中心(KOSTL)',
    PRCTR          VARCHAR(10)  NULL     COMMENT '利润中心(PRCTR)',
    GSBER          VARCHAR(4)   NULL     COMMENT '业务范围(GSBER)',
    ERDAT          DATE         NULL     COMMENT '创建日期(ERDAT)',
    ERNAM          VARCHAR(12)  NULL     COMMENT '创建人(ERNAM)',
    PRIMARY KEY (MANDT, BUKRS, ANLN1, ANLN2)
) COMMENT='ANLA-资产主记录';

-- ANLZ: 资产期间值
CREATE TABLE IF NOT EXISTS ANLZ (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    BUKRS          VARCHAR(4)   NOT NULL COMMENT '公司代码(BUKRS)',
    ANLN1          VARCHAR(12)  NOT NULL COMMENT '主资产号(ANLN1)',
    ANLN2          VARCHAR(4)   NOT NULL COMMENT '资产子号(ANLN2)',
    GJAHR          INT          NOT NULL COMMENT '会计年度(GJAHR)',
    AFABE          VARCHAR(2)   NOT NULL COMMENT '折旧范围(AFABE)',
    PERAF          INT          NOT NULL COMMENT '期间(PERAF)',
    KANSW          DECIMAL(15,2) NULL    COMMENT '累计购置值(KANSW)',
    KNAFA          DECIMAL(15,2) NULL    COMMENT '累计普通折旧(KNAFA)',
    KAAFA          DECIMAL(15,2) NULL    COMMENT '累计特别折旧(KAAFA)',
    KASAF          DECIMAL(15,2) NULL    COMMENT '累计计划内重估(KASAF)',
    NAFAP          DECIMAL(15,2) NULL    COMMENT '本期间普通折旧(NAFAP)',
    AAFAP          DECIMAL(15,2) NULL    COMMENT '本期间特别折旧(AAFAP)',
    ANSWL          DECIMAL(15,2) NULL    COMMENT '账面净值(ANSWL)',
    PRIMARY KEY (MANDT, BUKRS, ANLN1, ANLN2, GJAHR, AFABE, PERAF)
) COMMENT='ANLZ-资产期间值';

-- ANEP: 资产行项目（折旧过账）
CREATE TABLE IF NOT EXISTS ANEP (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    BUKRS          VARCHAR(4)   NOT NULL COMMENT '公司代码(BUKRS)',
    ANLN1          VARCHAR(12)  NOT NULL COMMENT '主资产号(ANLN1)',
    ANLN2          VARCHAR(4)   NOT NULL COMMENT '资产子号(ANLN2)',
    GJAHR          INT          NOT NULL COMMENT '会计年度(GJAHR)',
    AFABE          VARCHAR(2)   NOT NULL COMMENT '折旧范围(AFABE)',
    LNANR          VARCHAR(6)   NOT NULL COMMENT '资产凭证号(LNANR)',
    LNRAN          INT          NOT NULL COMMENT '资产行号(LNRAN)',
    BELNR          VARCHAR(10)  NULL     COMMENT 'FI凭证号(BELNR)',
    BUZEI          INT          NULL     COMMENT 'FI行项目号(BUZEI)',
    BZDAT          DATE         NOT NULL COMMENT '过账日期(BZDAT)',
    ANBTR          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '金额(ANBTR)',
    DRCRK          VARCHAR(1)   NULL     COMMENT '借/贷标识(DRCRK)',
    AWANL          VARCHAR(4)   NULL     COMMENT '交易类型(AWANL):01=购置,02=普通折旧,03=特别折旧,04=报废',
    WAERS          VARCHAR(5)   NULL     COMMENT '币种(WAERS)',
    PRIMARY KEY (MANDT, BUKRS, ANLN1, ANLN2, GJAHR, AFABE, LNANR, LNRAN)
) COMMENT='ANEP-资产行项目(折旧过账)';

-- ============================================================
-- 10. 项目系统域（PS - Project System）
-- ============================================================

-- PROJ: 项目定义
CREATE TABLE IF NOT EXISTS PROJ (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    PSPNR          INT          NOT NULL COMMENT '项目内部号(PSPNR)',
    PSPID          VARCHAR(24)  NOT NULL COMMENT '项目定义(PSPID)',
    POST1          VARCHAR(40)  NULL     COMMENT '项目描述(POST1)',
    VERNR          VARCHAR(3)   NULL     COMMENT '负责人(VERNR)',
    VPROF          VARCHAR(7)   NULL     COMMENT '项目参数文件(VPROF)',
    PLFAZ          DATE         NULL     COMMENT '计划开始(PLFAZ)',
    PLFEZ          DATE         NULL     COMMENT '计划结束(PLFEZ)',
    ISTAZ          DATE         NULL     COMMENT '实际开始(ISTAZ)',
    ISTEZ          DATE         NULL     COMMENT '实际结束(ISTEZ)',
    OBJNR          VARCHAR(22)  NULL     COMMENT '对象号(OBJNR)',
    KOKRS          VARCHAR(4)   NULL     COMMENT '控制范围(KOKRS)',
    BUKRS          VARCHAR(4)   NULL     COMMENT '公司代码(BUKRS)',
    PRCTR          VARCHAR(10)  NULL     COMMENT '利润中心(PRCTR)',
    FKSTK          VARCHAR(1)   NULL     COMMENT '释放标识(FKSTK)',
    PHAI0          VARCHAR(1)   NULL     COMMENT 'TECO标识(PHAI0)',
    PRIMARY KEY (MANDT, PSPNR)
) COMMENT='PROJ-项目定义';

-- PRPS: WBS元素
CREATE TABLE IF NOT EXISTS PRPS (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    PSPNR          INT          NOT NULL COMMENT 'WBS内部号(PSPNR)',
    POSID          VARCHAR(24)  NOT NULL COMMENT 'WBS元素(POSID)',
    POST1          VARCHAR(40)  NULL     COMMENT 'WBS描述(POST1)',
    PSPHI          INT          NULL     COMMENT '项目内部号(PSPHI)',
    OBJNR          VARCHAR(22)  NULL     COMMENT '对象号(OBJNR)',
    PLFAZ          DATE         NULL     COMMENT '计划开始(PLFAZ)',
    PLFEZ          DATE         NULL     COMMENT '计划结束(PLFEZ)',
    ISTAZ          DATE         NULL     COMMENT '实际开始(ISTAZ)',
    ISTEZ          DATE         NULL     COMMENT '实际结束(ISTEZ)',
    PLKOW          DECIMAL(15,2) NULL    COMMENT '计划成本(PLKOW)',
    PLIOW          DECIMAL(15,2) NULL    COMMENT '计划收入(PLIOW)',
    WKGOW          DECIMAL(15,2) NULL    COMMENT '实际成本(WKGOW)',
    WIOOW          DECIMAL(15,2) NULL    COMMENT '实际收入(WIOOW)',
    FKSTK          VARCHAR(1)   NULL     COMMENT '释放标识(FKSTK)',
    PHAI0          VARCHAR(1)   NULL     COMMENT 'TECO标识(PHAI0)',
    BELNR          VARCHAR(10)  NULL     COMMENT '结算凭证号(BELNR)',
    KOKRS          VARCHAR(4)   NULL     COMMENT '控制范围(KOKRS)',
    PRCTR          VARCHAR(10)  NULL     COMMENT '利润中心(PRCTR)',
    PRIMARY KEY (MANDT, PSPNR)
) COMMENT='PRPS-WBS元素';

-- ============================================================
-- 11. 仓库管理域（WM - Warehouse Management）
-- ============================================================

-- LTAK: 转储单抬头
CREATE TABLE IF NOT EXISTS LTAK (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    LGNUM          VARCHAR(3)   NOT NULL COMMENT '仓库号(LGNUM)',
    TANUM          VARCHAR(10)  NOT NULL COMMENT '转储单号(TANUM)',
    TBTYP          VARCHAR(1)   NOT NULL COMMENT '转储类型(TBTYP)',
    BWLVS          VARCHAR(3)   NULL     COMMENT '移动类型(BWLVS)',
    QDATU          DATE         NULL     COMMENT '转储日期(QDATU)',
    QZEIT          VARCHAR(6)   NULL     COMMENT '转储时间(QZEIT)',
    QNAMV          VARCHAR(12)  NULL     COMMENT '创建人(QNAMV)',
    WEMPF          VARCHAR(12)  NULL     COMMENT '目标库位(WEMPF)',
    VLTYP          VARCHAR(3)   NULL     COMMENT '源存储类型(VLTYP)',
    VLPLA          VARCHAR(10)  NULL     COMMENT '源存储仓位(VLPLA)',
    NLTYP          VARCHAR(3)   NULL     COMMENT '目标存储类型(NLTYP)',
    NLPLA          VARCHAR(10)  NULL     COMMENT '目标存储仓位(NLPLA)',
    PERNR          INT          NULL     COMMENT '处理人(PERNR)',
    PRIMARY KEY (MANDT, LGNUM, TANUM)
) COMMENT='LTAK-转储单抬头';

-- LTAP: 转储单行项目
CREATE TABLE IF NOT EXISTS LTAP (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    LGNUM          VARCHAR(3)   NOT NULL COMMENT '仓库号(LGNUM)',
    TANUM          VARCHAR(10)  NOT NULL COMMENT '转储单号(TANUM)',
    TAPOS          INT          NOT NULL COMMENT '行项目号(TAPOS)',
    MATNR          VARCHAR(18)  NULL     COMMENT '物料编号(MATNR)',
    WERKS          VARCHAR(4)   NULL     COMMENT '工厂(WERKS)',
    CHARG          VARCHAR(10)  NULL     COMMENT '批次(CHARG)',
    BESTQ          VARCHAR(1)   NULL     COMMENT '库存类型(BESTQ):空=非限制,S=冻结,X=质检',
    VLTYP          VARCHAR(3)   NULL     COMMENT '源存储类型(VLTYP)',
    VLPLA          VARCHAR(10)  NULL     COMMENT '源仓位(VLPLA)',
    NLTYP          VARCHAR(3)   NULL     COMMENT '目标存储类型(NLTYP)',
    NLPLA          VARCHAR(10)  NULL     COMMENT '目标仓位(NLPLA)',
    VSOLA          DECIMAL(13,3) NULL    COMMENT '源数量(VSOLA)',
    NSOLA          DECIMAL(13,3) NULL    COMMENT '目标数量(NSOLA)',
    ALTME          VARCHAR(3)   NULL     COMMENT '单位(ALTME)',
    QDATU          DATE         NULL     COMMENT '确认日期(QDATU)',
    QNAMV          VARCHAR(12)  NULL     COMMENT '确认人(QNAMV)',
    PERNR          INT          NULL     COMMENT '处理人(PERNR)',
    PRIMARY KEY (MANDT, LGNUM, TANUM, TAPOS)
) COMMENT='LTAP-转储单行项目';

-- LQUA: 仓库量化
CREATE TABLE IF NOT EXISTS LQUA (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    LGNUM          VARCHAR(3)   NOT NULL COMMENT '仓库号(LGNUM)',
    LGTYP          VARCHAR(3)   NOT NULL COMMENT '存储类型(LGTYP)',
    LGPLA          VARCHAR(10)  NOT NULL COMMENT '存储仓位(LGPLA)',
    MATNR          VARCHAR(18)  NOT NULL COMMENT '物料编号(MATNR)',
    WERKS          VARCHAR(4)   NULL     COMMENT '工厂(WERKS)',
    CHARG          VARCHAR(10)  NULL     COMMENT '批次(CHARG)',
    BESTQ          VARCHAR(1)   NULL     COMMENT '库存类型(BESTQ)',
    GESME          DECIMAL(13,3) NULL    COMMENT '可用数量(GESME)',
    VERME          DECIMAL(13,3) NULL    COMMENT '拣配数量(VERME)',
    MEINS          VARCHAR(3)   NULL     COMMENT '单位(MEINS)',
    PRIMARY KEY (MANDT, LGNUM, LGTYP, LGPLA, MATNR)
) COMMENT='LQUA-仓库量化(库存余额)';

-- ============================================================
-- 12. 预算控制域（FM - Funds Management）
-- ============================================================

-- FMBH: 预算凭证抬头
CREATE TABLE IF NOT EXISTS FMBH (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    DOCNR          VARCHAR(10)  NOT NULL COMMENT '预算凭证号(DOCNR)',
    RLDNR          VARCHAR(2)   NOT NULL COMMENT '分类账(RLDNR)',
    FIKRS          VARCHAR(4)   NOT NULL COMMENT '资金管理区(FIKRS)',
    BUKRS          VARCHAR(4)   NULL     COMMENT '公司代码(BUKRS)',
    GJAHR          INT          NOT NULL COMMENT '年度(GJAHR)',
    BUDCAT         VARCHAR(2)   NOT NULL COMMENT '预算类别(BUDCAT):9F=原始,9G=补充,9H=返还',
    BUDTYPE        VARCHAR(2)   NULL     COMMENT '预算类型(BUDTYPE)',
    BUDPROCESS     VARCHAR(2)   NULL     COMMENT '预算过程(BUDPROCESS)',
    BUDAT          DATE         NULL     COMMENT '预算日期(BUDAT)',
    DOCDATE        DATE         NULL     COMMENT '凭证日期(DOCDATE)',
    ERNAM          VARCHAR(12)  NULL     COMMENT '创建人(ERNAM)',
    ERDAT          DATE         NULL     COMMENT '创建日期(ERDAT)',
    PRIMARY KEY (MANDT, DOCNR, RLDNR, FIKRS, GJAHR, BUDCAT)
) COMMENT='FMBH-预算凭证抬头';

-- FMIOI: 预算消耗行项目
CREATE TABLE IF NOT EXISTS FMIOI (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    RLDNR          VARCHAR(2)   NOT NULL COMMENT '分类账(RLDNR)',
    FIKRS          VARCHAR(4)   NOT NULL COMMENT '资金管理区(FIKRS)',
    FAREA          VARCHAR(4)   NOT NULL COMMENT '资金中心(FAREA)',
    GJAHR          INT          NOT NULL COMMENT '年度(GJAHR)',
    BUDCAT         VARCHAR(2)   NOT NULL COMMENT '预算类别(BUDCAT)',
    OBJNR          VARCHAR(22)  NULL     COMMENT '对象号(OBJNR)',
    BUDVAL         DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '预算值(BUDVAL)',
    BUDAVL         DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '可用预算(BUDAVL)',
    BUDREL         DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '已消耗预算(BUDREL)',
    WAERS          VARCHAR(5)   NULL     COMMENT '币种(WAERS)',
    PRIMARY KEY (MANDT, RLDNR, FIKRS, FAREA, GJAHR, BUDCAT)
) COMMENT='FMIOI-预算消耗(预算可用余额)';

-- ============================================================
-- 13. FI/CO 补充（汇率/CO凭证/控制范围）
-- ============================================================

-- TCURR: 汇率表（多币种场景必需！）
CREATE TABLE IF NOT EXISTS TCURR (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    KURST          VARCHAR(4)   NOT NULL COMMENT '汇率类型(KURST):M=平均,0001=即期',
    FCURR          VARCHAR(5)   NOT NULL COMMENT '源币种(FCURR)',
    TCURR_ISO      VARCHAR(5)   NOT NULL COMMENT '目标币种(TCURR_ISO)',
    GDATU          DATE         NOT NULL COMMENT '有效期起(GDATU)',
    UKURS          DECIMAL(9,5) NOT NULL DEFAULT 0 COMMENT '汇率(UKURS):直接报价=1外币=?本位币',
    TFACT          INT          NULL     COMMENT '转换因子(TFACT)',
    PRIMARY KEY (MANDT, KURST, FCURR, TCURR_ISO, GDATU)
) COMMENT='TCURR-汇率表(多币种场景核心)';

-- TKA01: 控制范围
CREATE TABLE IF NOT EXISTS TKA01 (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    KOKRS          VARCHAR(4)   NOT NULL COMMENT '控制范围(KOKRS)',
    BEZEI          VARCHAR(20)  NULL     COMMENT '描述(BEZEI)',
    KTOPL          VARCHAR(4)   NULL     COMMENT '科目表(KTOPL)',
    WAERS          VARCHAR(5)   NULL     COMMENT '控制范围币种(WAERS)',
    ERSDA          DATE         NULL     COMMENT '创建日期(ERSDA)',
    PRIMARY KEY (MANDT, KOKRS)
) COMMENT='TKA01-控制范围';

-- COBK: CO凭证抬头
CREATE TABLE IF NOT EXISTS COBK (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    KOKRS          VARCHAR(4)   NOT NULL COMMENT '控制范围(KOKRS)',
    BELNR          VARCHAR(10)  NOT NULL COMMENT 'CO凭证号(BELNR)',
    GJAHR          INT          NOT NULL COMMENT '年度(GJAHR)',
    PERIO          INT          NOT NULL COMMENT '期间(PERIO)',
    KOKRS_BUKRS    VARCHAR(4)   NULL     COMMENT '公司代码(KOKRS_BUKRS)',
    AWTYP          VARCHAR(3)   NULL     COMMENT '参考交易类型(AWTYP)',
    AWKEY          VARCHAR(20)  NULL     COMMENT '参考凭证号(AWKEY)',
    BUDAT          DATE         NULL     COMMENT '过账日期(BUDAT)',
    BLDAT          DATE         NULL     COMMENT '凭证日期(BLDAT)',
    CPUDT          DATE         NULL     COMMENT '录入日期(CPUDT)',
    USNAM          VARCHAR(12)  NULL     COMMENT '录入人(USNAM)',
    VBUND          VARCHAR(2)   NULL     COMMENT '业务范围(VBUND)',
    PRIMARY KEY (MANDT, KOKRS, BELNR, GJAHR, PERIO)
) COMMENT='COBK-CO凭证抬头(S/4中为CDS视图)';

-- COEP: CO凭证行项目
CREATE TABLE IF NOT EXISTS COEP (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    KOKRS          VARCHAR(4)   NOT NULL COMMENT '控制范围(KOKRS)',
    BELNR          VARCHAR(10)  NOT NULL COMMENT 'CO凭证号(BELNR)',
    GJAHR          INT          NOT NULL COMMENT '年度(GJAHR)',
    PERIO          INT          NOT NULL COMMENT '期间(PERIO)',
    KSTAR          VARCHAR(10)  NOT NULL COMMENT '成本要素(KSTAR)',
    WKGOWR         DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '对象币金额(WKGOWR)',
    WOGBTR         DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '本位币金额(WOGBTR)',
    OWAEER         VARCHAR(5)   NULL     COMMENT '对象币(OWAEER)',
    PWOGBTR        DECIMAL(15,2) NULL    COMMENT '集团币金额(PWOGBTR)',
    OBJNR          VARCHAR(22)  NULL     COMMENT '发送方对象号(OBJNR)',
    OBJN1          VARCHAR(22)  NULL     COMMENT '接收方对象号(OBJN1)',
    KOKRS_REC      VARCHAR(4)   NULL     COMMENT '接收方控制范围(KOKRS_REC)',
    VERSN          VARCHAR(3)   NULL     COMMENT '版本(VERS):0=实际,1=计划',
    BEKNZ          VARCHAR(1)   NULL     COMMENT '记录类型(BEKNZ):空=实际,I=计划',
    PRIMARY KEY (MANDT, KOKRS, BELNR, GJAHR, PERIO, KSTAR)
) COMMENT='COEP-CO凭证行项目(S/4中为CDS视图)';

-- FAGLFLEXT: 新总账汇总表（ECC遗留，S/4仍可查）
CREATE TABLE IF NOT EXISTS FAGLFLEXT (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    RLDNR          VARCHAR(2)   NOT NULL COMMENT '分类账(RLDNR)',
    RACCT          VARCHAR(10)  NOT NULL COMMENT '总账科目(RACCT)',
    RBUKRS         VARCHAR(4)   NOT NULL COMMENT '公司代码(RBUKRS)',
    GJAHR          INT          NOT NULL COMMENT '年度(GJAHR)',
    PERIO          INT          NOT NULL COMMENT '期间(PERIO)',
    RCNTR          VARCHAR(10)  NULL     COMMENT '成本中心(RCNTR)',
    RPCNT          VARCHAR(10)  NULL     COMMENT '利润中心(RPCNT)',
    RBUSA          VARCHAR(4)   NULL     COMMENT '业务范围(RBUSA)',
    RFAREA         VARCHAR(4)   NULL     COMMENT '功能范围(RFAAREA)',
    HSLVT          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '本位币余额(HSLVT)',
    TSLVT          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '目标币余额(TSLVT)',
    KSLVT          DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '集团币余额(KSLVT)',
    DRCRK          VARCHAR(1)   NULL     COMMENT '借/贷标识(DRCRK)',
    CURTP          VARCHAR(2)   NULL     COMMENT '货币类型(CURTP)',
    PRIMARY KEY (MANDT, RLDNR, RACCT, RBUKRS, GJAHR, PERIO)
) COMMENT='FAGLFLEXT-新总账汇总表(S/4中为CDS视图)';

-- ============================================================
-- 14. MM 补充（采购信息记录/BOM使用点）
-- ============================================================

-- EINA: 采购信息记录通用数据
CREATE TABLE IF NOT EXISTS EINA (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    INFNR          VARCHAR(10)  NOT NULL COMMENT '信息记录号(INFNR)',
    LIFNR          VARCHAR(10)  NOT NULL COMMENT '供应商(LIFNR)',
    MATNR          VARCHAR(18)  NOT NULL COMMENT '物料编号(MATNR)',
    EKORG          VARCHAR(4)   NULL     COMMENT '采购组织(EKORG)',
    WAERS          VARCHAR(5)   NULL     COMMENT '币种(WAERS)',
    MEINS          VARCHAR(3)   NULL     COMMENT '单位(MEINS)',
    ERDAT          DATE         NULL     COMMENT '创建日期(ERDAT)',
    ERNAM          VARCHAR(12)  NULL     COMMENT '创建人(ERNAM)',
    LOEKZ          VARCHAR(1)   NULL     COMMENT '删除标识(LOEKZ)',
    PRIMARY KEY (MANDT, INFNR)
) COMMENT='EINA-采购信息记录通用数据';

-- EINE: 采购信息记录组织数据
CREATE TABLE IF NOT EXISTS EINE (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    INFNR          VARCHAR(10)  NOT NULL COMMENT '信息记录号(INFNR)',
    EKORG          VARCHAR(4)   NOT NULL COMMENT '采购组织(EKORG)',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '工厂(WERKS)',
    NETPR          DECIMAL(11,2) NULL    COMMENT '净价(NETPR)',
    PEINH          INT          NULL     COMMENT '价格单位(PEINH)',
    WAERS          VARCHAR(5)   NULL     COMMENT '币种(WAERS)',
    APOTX          DECIMAL(5,2) NULL    COMMENT '有效价格起(APOTX)',
    NORBM          DECIMAL(13,3) NULL   COMMENT '最小订购量(NORBM)',
    EKGRP          VARCHAR(3)   NULL     COMMENT '采购组(EKGRP)',
    PLIFZ          INT          NULL     COMMENT '计划交货天数(PLIFZ)',
    WEBRE          VARCHAR(1)   NULL     COMMENT '基于收货的IV标识(WEBRE)',
    LOEKZ          VARCHAR(1)   NULL     COMMENT '删除标识(LOEKZ)',
    PRIMARY KEY (MANDT, INFNR, EKORG, WERKS)
) COMMENT='EINE-采购信息记录组织数据(含采购价)';

-- MAST: BOM使用点链接（物料-BOM关联）
CREATE TABLE IF NOT EXISTS MAST (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    MATNR          VARCHAR(18)  NOT NULL COMMENT '物料编号(MATNR)',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '工厂(WERKS)',
    STLAL          VARCHAR(2)   NOT NULL COMMENT 'BOM用途(STLAL):01=生产,03=成本核算',
    STLNR          VARCHAR(8)   NOT NULL COMMENT 'BOM号(STLNR)',
    STLTY          VARCHAR(1)   NULL     COMMENT 'BOM类别(STLTY):M=物料',
    PRIMARY KEY (MANDT, MATNR, WERKS, STLAL)
) COMMENT='MAST-BOM使用点链接(物料-BOM关联)';

-- MLGN: 物料主数据-采购组织级
CREATE TABLE IF NOT EXISTS MLGN (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    MATNR          VARCHAR(18)  NOT NULL COMMENT '物料编号(MATNR)',
    EKORG          VARCHAR(4)   NOT NULL COMMENT '采购组织(EKORG)',
    DISPO          VARCHAR(3)   NULL     COMMENT 'MRP控制者(DISPO)',
    DISMM          VARCHAR(2)   NULL     COMMENT 'MRP类型(DISMM):PD=MRP,NB=无MRP',
    DISLS          VARCHAR(2)   NULL     COMMENT '批量大小(DISLS):EX=精确批量,FX=固定批量',
    MINBE          DECIMAL(13,3) NULL    COMMENT '再订货点(MINBE)',
    EISBE          DECIMAL(13,3) NULL    COMMENT '安全库存(EISBE)',
    PLIFZ          INT          NULL     COMMENT '计划交货天数(PLIFZ)',
    WEBAZ          INT          NULL     COMMENT '收货处理时间(WEBAZ)',
    KZBWS          VARCHAR(1)   NULL     COMMENT '特殊采购类型(KZBWS)',
    PRIMARY KEY (MANDT, MATNR, EKORG)
) COMMENT='MLGN-物料主数据(采购组织级)';

-- ============================================================
-- 15. SD 补充（业务数据/抬头状态）
-- ============================================================

-- VBKD: 销售凭证业务数据（付款条款/Incoterm）
CREATE TABLE IF NOT EXISTS VBKD (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    VBELV          VARCHAR(10)  NOT NULL COMMENT '前导凭证号(VBELV)',
    POSNV          INT          NOT NULL COMMENT '前导行号(POSNV)',
    VBELN          VARCHAR(10)  NOT NULL COMMENT '后续凭证号(VBELN)',
    POSNN          INT          NOT NULL COMMENT '后续行号(POSNN)',
    KURRF          DECIMAL(9,5) NULL    COMMENT '汇率(KURRF)',
    PRSDT          DATE         NULL     COMMENT '定价日期(PRSDT)',
    ZTERM          VARCHAR(4)   NULL     COMMENT '付款条款(ZTERM):Z001=30天,Z002=60天',
    INCO1          VARCHAR(3)   NULL     COMMENT 'Incoterm1(INCO1):FOB/CIF/EXW/DDP',
    INCO2          VARCHAR(28)  NULL     COMMENT 'Incoterm2(地点)(INCO2)',
    FKDAT          DATE         NULL     COMMENT '开票日期(FKDAT)',
    FAKSK          VARCHAR(2)   NULL     COMMENT '开票冻结(FAKSK)',
    KTGRD          VARCHAR(2)   NULL     COMMENT '客户科目分配组(KTGRD)',
    KTGRM          VARCHAR(2)   NULL     COMMENT '物料科目分配组(KTGRM)',
    PERFK          VARCHAR(1)   NULL     COMMENT '开票日期类型(PERFK)',
    PRIMARY KEY (MANDT, VBELV, POSNV, VBELN, POSNN)
) COMMENT='VBKD-销售凭证业务数据(付款条款/Incoterm)';

-- VBUK: 销售凭证抬头状态
CREATE TABLE IF NOT EXISTS VBUK (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    VBELN          VARCHAR(10)  NOT NULL COMMENT '销售凭证号(VBELN)',
    WBSTK          VARCHAR(1)   NULL     COMMENT '总体交货状态(WBSTK):A=部分,C=完全',
    FKSTK          VARCHAR(1)   NULL     COMMENT '开票状态(FKSTK):A=部分,C=完全',
    RFSTK          VARCHAR(1)   NULL     COMMENT '参考状态(RFSTK)',
    GBSTK          VARCHAR(1)   NULL     COMMENT '总体处理状态(GBSTK):A=处理中,C=完成',
    CMGST          VARCHAR(2)   NULL     COMMENT '总体确认状态(CMGST)',
    LVSTK          VARCHAR(1)   NULL     COMMENT '交货状态(LVSTK)',
    RFGST          VARCHAR(1)   NULL     COMMENT '参考开票状态(RFGST)',
    BESTK          VARCHAR(1)   NULL     COMMENT '总体PO状态(BESTK)',
    UVALS          VARCHAR(1)   NULL     COMMENT '欠交状态(UVALS)',
    KOSTK          VARCHAR(1)   NULL     COMMENT '拣配状态(KOSTK)',
    LFGSK          VARCHAR(1)   NULL     COMMENT '交货冻结状态(LFGSK)',
    FKSAK          VARCHAR(1)   NULL     COMMENT '开票冻结状态(FKSAK)',
    PRIMARY KEY (MANDT, VBELN)
) COMMENT='VBUK-销售凭证抬头状态(交货/开票/处理)';

-- ============================================================
-- 16. PP 补充（物料-工艺分配/工作中心-成本中心）
-- ============================================================

-- MAPL: 物料-任务清单分配（物料→工艺路线）
CREATE TABLE IF NOT EXISTS MAPL (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    MATNR          VARCHAR(18)  NOT NULL COMMENT '物料编号(MATNR)',
    WERKS          VARCHAR(4)   NOT NULL COMMENT '工厂(WERKS)',
    PLNTY          VARCHAR(1)   NOT NULL COMMENT '任务清单类型(PLNTY):N=工艺路线',
    PLNNR          VARCHAR(8)   NOT NULL COMMENT '任务清单组号(PLNNR)',
    PLNAL          VARCHAR(2)   NOT NULL COMMENT '组计数器(PLNAL)',
    ZAEHL          INT          NOT NULL COMMENT '计数器(ZAEHL)',
    LOEKZ          VARCHAR(1)   NULL     COMMENT '删除标识(LOEKZ)',
    PRIMARY KEY (MANDT, MATNR, WERKS, PLNTY, PLNNR, PLNAL, ZAEHL)
) COMMENT='MAPL-物料-任务清单分配(物料→工艺路线)';

-- CRCO: 工作中心-成本中心分配
CREATE TABLE IF NOT EXISTS CRCO (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    OBJTY          VARCHAR(2)   NOT NULL COMMENT '对象类型(OBJTY):A=工作中心',
    OBJID          INT          NOT NULL COMMENT '对象号(OBJID)',
    KOKRS          VARCHAR(4)   NOT NULL COMMENT '控制范围(KOKRS)',
    ENDDA          DATE         NOT NULL COMMENT '有效期止(ENDDA)',
    BEGDA          DATE         NOT NULL COMMENT '有效期起(BEGDA)',
    KOSTL          VARCHAR(10)  NULL     COMMENT '成本中心(KOSTL)',
    LSTAR          VARCHAR(6)   NULL     COMMENT '活动类型(LSTAR)',
    KAPID          INT          NULL     COMMENT '能力ID(KAPID)',
    PRIMARY KEY (MANDT, OBJTY, OBJID, KOKRS, ENDDA, BEGDA)
) COMMENT='CRCO-工作中心-成本中心分配';

-- ============================================================
-- 17. 获利分析域（CO-PA）
-- ============================================================

-- CE4XXXX: 获利分析段（表名后缀按经营关注范围不同，此处用通用名）
CREATE TABLE IF NOT EXISTS CE4_ACCT (
    MANDT          VARCHAR(3)   NOT NULL COMMENT '集团(MANDT)',
    KOKRS          VARCHAR(4)   NOT NULL COMMENT '控制范围(KOKRS)',
    PAOBJNR        INT          NOT NULL COMMENT '获利段号(PAOBJNR)',
    PASUBNR        INT          NOT NULL COMMENT '获利子号(PASUBNR)',
    BUKRS          VARCHAR(4)   NULL     COMMENT '公司代码(BUKRS)',
    KNDNR          VARCHAR(10)  NULL     COMMENT '客户(KNDNR)',
    ARTNR          VARCHAR(18)  NULL     COMMENT '产品(ARTNR)',
    VKORG          VARCHAR(4)   NULL     COMMENT '销售组织(VKORG)',
    VTWEG          VARCHAR(2)   NULL     COMMENT '分销渠道(VTWEG)',
    SPART          VARCHAR(2)   NULL     COMMENT '产品组(SPART)',
    WERKS          VARCHAR(4)   NULL     COMMENT '工厂(WERKS)',
    KMBTR          DECIMAL(15,2) NULL    COMMENT '收入(KMBTR)',
    KKMNG          DECIMAL(15,2) NULL    COMMENT '销量(KKMNG)',
    KABTR          DECIMAL(15,2) NULL    COMMENT '成本(KABTR)',
    GJAHR          INT          NULL     COMMENT '年度(GJAHR)',
    PERIO          INT          NULL     COMMENT '期间(PERIO)',
    BUDAT          DATE         NULL     COMMENT '过账日期(BUDAT)',
    PRIMARY KEY (MANDT, KOKRS, PAOBJNR, PASUBNR)
) COMMENT='CE4_ACCT-获利分析段(收入/成本/利润)';

-- ============================================================
-- 18. 示例数据
-- ============================================================

INSERT IGNORE INTO T001 (MANDT, BUKRS, BUTXT, ORT01, LAND1, WAERS, PERIV, KTOPL) VALUES
('100', '1000', '华创制造集团', '上海', 'CN', 'CNY', 'K4', 'INT'),
('100', '2000', '华创精密部件', '苏州', 'CN', 'CNY', 'K4', 'INT');

INSERT IGNORE INTO T001W (MANDT, WERKS, NAME1, BUKRS, ORT01, LAND1, REGIO, FABKL) VALUES
('100', '1001', '上海总装厂', '1000', '上海', 'CN', 'SH', 'Z1'),
('100', '1002', '苏州零部件厂', '2000', '苏州', 'CN', 'JS', 'Z1'),
('100', '1003', '上海涂装厂', '1000', '上海', 'CN', 'SH', 'Z1');

INSERT IGNORE INTO T001L (MANDT, WERKS, LGORT, LGOBE, LGTYP) VALUES
('100', '1001', '0001', '原材料仓', '001'),
('100', '1001', '0002', '成品仓', '001'),
('100', '1002', '0001', '零部件仓', '001'),
('100', '1003', '0001', '涂装材料仓', '001');

INSERT IGNORE INTO TVKO (MANDT, VKORG, VTEXT, BUKRS, VKBUR) VALUES
('100', '1000', '国内销售组织', '1000', '1000');

INSERT IGNORE INTO T024E (MANDT, EKORG, EKOTX, BUKRS) VALUES
('100', '1000', '国内采购组织', '1000');

INSERT IGNORE INTO T009 (MANDT, PERIV, PERAZ) VALUES
('100', 'K4', '中国会计年度变式');

INSERT IGNORE INTO T009C (MANDT, PERIV, GJAHR, POPER, BUMON, RELJR) VALUES
('100', 'K4', 2026, 1, 1, '1'), ('100', 'K4', 2026, 2, 2, '1'),
('100', 'K4', 2026, 3, 3, '1'), ('100', 'K4', 2026, 4, 4, '1'),
('100', 'K4', 2026, 5, 5, '1'), ('100', 'K4', 2026, 6, 6, '1'),
('100', 'K4', 2026, 7, 7, '1'), ('100', 'K4', 2026, 8, 8, '1'),
('100', 'K4', 2026, 9, 9, '1'), ('100', 'K4', 2026, 10, 10, '1'),
('100', 'K4', 2026, 11, 11, '1'), ('100', 'K4', 2026, 12, 12, '1');

-- 物料主数据
INSERT IGNORE INTO MARA (MANDT, MATNR, ERSDA, MTART, MATKL, MEINS, SPART) VALUES
('100', 'FG-001', '2024-01-15', 'FERT', '01001', 'EA', '00'),
('100', 'FG-002', '2024-02-01', 'FERT', '01002', 'EA', '00'),
('100', 'SF-001', '2024-01-10', 'HALB', '02001', 'EA', '00'),
('100', 'RM-001', '2023-06-01', 'ROH',  '03001', 'KG', '00'),
('100', 'RM-002', '2023-06-01', 'ROH',  '03002', 'KG', '00'),
('100', 'SP-001', '2023-03-01', 'IBAU', '04001', 'EA', '00');

INSERT IGNORE INTO MARC (MANDT, MATNR, WERKS, DISPO, DISMM, DISLS, BESKZ, EISBE, PLIFZ) VALUES
('100', 'FG-001', '1001', '001', 'PD', 'EX', 'E', 100, 0),
('100', 'FG-002', '1001', '001', 'PD', 'EX', 'E', 50, 0),
('100', 'SF-001', '1002', '002', 'PD', 'EX', 'E', 200, 0),
('100', 'RM-001', '1002', '002', 'NB', 'EX', 'F', 500, 7),
('100', 'RM-002', '1002', '002', 'NB', 'EX', 'F', 300, 10),
('100', 'SP-001', '1001', '003', 'NB', 'EX', 'F', 20, 14);

INSERT IGNORE INTO MARD (MANDT, MATNR, WERKS, LGORT, LABST) VALUES
('100', 'FG-001', '1001', '0002', 1500),
('100', 'FG-002', '1001', '0002', 800),
('100', 'SF-001', '1002', '0001', 3000),
('100', 'RM-001', '1002', '0001', 8000),
('100', 'RM-002', '1002', '0001', 5000),
('100', 'SP-001', '1001', '0001', 50);

INSERT IGNORE INTO MBEW (MANDT, MATNR, BWKEY, BWTAR, LBKUM, SALK3, VPRSV, VERPR, STPRS, PEINH, BKLAS) VALUES
('100', 'FG-001', '1001', '0000', 1500, 450000.00, 'S', 300.00, 300.00, 1, '3000'),
('100', 'FG-002', '1001', '0000', 800,  160000.00, 'S', 200.00, 200.00, 1, '3000'),
('100', 'SF-001', '1002', '0000', 3000, 300000.00, 'V', 100.00, 95.00,  1, '3000'),
('100', 'RM-001', '1002', '0000', 8000, 400000.00, 'V', 50.00,  48.00,  1, '3000'),
('100', 'RM-002', '1002', '0000', 5000, 150000.00, 'V', 30.00,  28.00,  1, '3000');

-- 客户/供应商
INSERT IGNORE INTO KNA1 (MANDT, KUNNR, NAME1, ORT01, LAND1, KTOKD) VALUES
('100', 'C00001', '华东汽车集团', '上海', 'CN', 'Z001'),
('100', 'C00002', '华南机电股份', '广州', 'CN', 'Z001'),
('100', 'C00003', '华北重工集团', '北京', 'CN', 'Z001');

INSERT IGNORE INTO LFA1 (MANDT, LIFNR, NAME1, ORT01, LAND1, KTOKK) VALUES
('100', 'V00001', '宝钢股份', '上海', 'CN', 'Z001'),
('100', 'V00002', '沙钢集团', '张家港', 'CN', 'Z001'),
('100', 'V00003', '博世汽车部件', '苏州', 'CN', 'Z002');

-- 总账科目
INSERT IGNORE INTO SKA1 (MANDT, KTOPL, SAKNR, TXT20, KTOKS, XBILV, GVTYP) VALUES
('100', 'INT', '60010101', '主营业务收入', 'ERG', ' ', '1'),
('100', 'INT', '60010102', '其他业务收入', 'ERG', ' ', '1'),
('100', 'INT', '64010101', '主营业务成本', 'ERG', ' ', '1'),
('100', 'INT', '66010101', '管理费用', 'ERG', ' ', '1'),
('100', 'INT', '66020101', '销售费用', 'ERG', ' ', '1'),
('100', 'INT', '1122',     '应收账款',   'FSA', 'X', ' '),
('100', 'INT', '2202',     '应付账款',   'FSA', 'X', ' ');

-- 成本中心/利润中心
INSERT IGNORE INTO CSKS (MANDT, KOKRS, KOSTL, DATBI, DATAB, KTEXT, KOSAR, BUKRS, WAERS) VALUES
('100', '1000', 'CC1001', '9999-12-31', '2024-01-01', '总装车间', 'P', '1000', 'CNY'),
('100', '1000', 'CC1002', '9999-12-31', '2024-01-01', '零部件车间', 'P', '2000', 'CNY'),
('100', '1000', 'CC2001', '9999-12-31', '2024-01-01', '行政管理', 'L', '1000', 'CNY');

INSERT IGNORE INTO CEPC (MANDT, KOKRS, PRCTR, DATBI, DATAB, KTEXT, BUKRS) VALUES
('100', '1000', 'PC1001', '9999-12-31', '2024-01-01', '制造利润中心', '1000'),
('100', '1000', 'PC1002', '9999-12-31', '2024-01-01', '销售利润中心', '1000');

-- ACDOCA 示例（统一日记账）
INSERT IGNORE INTO ACDOCA (MANDT, RLDNR, RBUKRS, GJAHR, POPER, AWTYP, AWKEY, BELNR, BUZEI, RACCT, RCNTR, RPCNT, DOCTYPE, BUDAT, BLDAT, HSL, RWCUR, DRCRK, SGTXT) VALUES
('100', '0L', '1000', 2026, 7, 'BKPF', '51000000012026', '5100000001', 1, '60010101', 'CC1001', 'PC1001', 'SA', '2026-07-15', '2026-07-15',  500000.00, 'CNY', 'H', '7月营收-华东汽车'),
('100', '0L', '1000', 2026, 7, 'BKPF', '51000000012026', '5100000001', 2, '1122',     NULL,    'PC1001', 'SA', '2026-07-15', '2026-07-15',  500000.00, 'CNY', 'S', '应收-华东汽车'),
('100', '0L', '1000', 2026, 7, 'BKPF', '51000000022026', '5100000002', 1, '60010101', 'CC1001', 'PC1001', 'SA', '2026-07-20', '2026-07-20',  350000.00, 'CNY', 'H', '7月营收-华南机电'),
('100', '0L', '1000', 2026, 7, 'BKPF', '51000000022026', '5100000002', 2, '1122',     NULL,    'PC1001', 'SA', '2026-07-20', '2026-07-20',  350000.00, 'CNY', 'S', '应收-华南机电'),
('100', '0L', '1000', 2026, 7, 'BKPF', '51000000032026', '5100000003', 1, '64010101', 'CC1001', 'PC1001', 'SA', '2026-07-25', '2026-07-25', -320000.00, 'CNY', 'S', '7月销售成本'),
('100', '0L', '1000', 2026, 8, 'BKPF', '51000000042026', '5100000004', 1, '60010101', 'CC1001', 'PC1001', 'SA', '2026-08-10', '2026-08-10',  600000.00, 'CNY', 'H', '8月营收-华东汽车'),
('100', '0L', '1000', 2026, 8, 'BKPF', '51000000042026', '5100000004', 2, '1122',     NULL,    'PC1001', 'SA', '2026-08-10', '2026-08-10',  600000.00, 'CNY', 'S', '应收-华东汽车'),
('100', '0L', '1000', 2026, 8, 'BKPF', '51000000052026', '5100000005', 1, '64010101', 'CC1001', 'PC1001', 'SA', '2026-08-15', '2026-08-15', -380000.00, 'CNY', 'S', '8月销售成本');

-- 销售订单
INSERT IGNORE INTO VBAK (MANDT, VBELN, AUART, VKORG, VTWEG, SPART, KUNNR, WAERK, ERDAT, AUDAT, NETWR) VALUES
('100', '0000000001', 'OR', '1000', '10', '00', 'C00001', 'CNY', '2026-07-10', '2026-07-10', 500000.00),
('100', '0000000002', 'OR', '1000', '10', '00', 'C00002', 'CNY', '2026-07-15', '2026-07-15', 350000.00),
('100', '0000000003', 'OR', '1000', '10', '00', 'C00001', 'CNY', '2026-08-05', '2026-08-05', 600000.00);

INSERT IGNORE INTO VBAP (MANDT, VBELN, POSNR, MATNR, WERKS, KWMENG, MEINS, NETPR, NETWR, WAERK, EDATU) VALUES
('100', '0000000001', 10, 'FG-001', '1001', 1000, 'EA', 500.00, 500000.00, 'CNY', '2026-07-25'),
('100', '0000000002', 10, 'FG-002', '1001', 1000, 'EA', 350.00, 350000.00, 'CNY', '2026-07-30'),
('100', '0000000003', 10, 'FG-001', '1001', 1200, 'EA', 500.00, 600000.00, 'CNY', '2026-08-20');

-- 交货
INSERT IGNORE INTO LIKP (MANDT, VBELN, LFART, KUNWE, WERKS, WADAT, WADAT_IST, ERDAT, WBSTK) VALUES
('100', '0080000001', 'LF', 'C00001', '1001', '2026-07-22', '2026-07-22', '2026-07-20', 'C'),
('100', '0080000002', 'LF', 'C00002', '1001', '2026-07-28', '2026-07-28', '2026-07-26', 'C'),
('100', '0080000003', 'LF', 'C00001', '1001', '2026-08-18', '2026-08-18', '2026-08-16', 'C');

INSERT IGNORE INTO LIPS (MANDT, VBELN, POSNR, MATNR, WERKS, LGORT, LFIMG, VRKME, VGBEL, VGPOS) VALUES
('100', '0080000001', 10, 'FG-001', '1001', '0002', 1000, 'EA', '0000000001', 10),
('100', '0080000002', 10, 'FG-002', '1001', '0002', 1000, 'EA', '0000000002', 10),
('100', '0080000003', 10, 'FG-001', '1001', '0002', 1200, 'EA', '0000000003', 10);

-- 开票
INSERT IGNORE INTO VBRK (MANDT, VBELN, FKART, FKDAT, KUNRG, KUNNR, BUKRS, WAERK, NETWR, MWSBK, VKORG, VTWEG, SPART, GJAHR, POPER) VALUES
('100', '0090000001', 'F2', '2026-07-25', 'C00001', 'C00001', '1000', 'CNY', 500000.00, 65000.00, '1000', '10', '00', 2026, 7),
('100', '0090000002', 'F2', '2026-07-30', 'C00002', 'C00002', '1000', 'CNY', 350000.00, 45500.00, '1000', '10', '00', 2026, 7),
('100', '0090000003', 'F2', '2026-08-20', 'C00001', 'C00001', '1000', 'CNY', 600000.00, 78000.00, '1000', '10', '00', 2026, 8);

INSERT IGNORE INTO VBRP (MANDT, VBELN, POSNR, FKIMG, VRKME, NETPR, NETWR, MWSBP, WAERK, MATNR, WERKS, KUNNR, AUBEL, AUPOS) VALUES
('100', '0090000001', 10, 1000, 'EA', 500.00, 500000.00, 65000.00, 'CNY', 'FG-001', '1001', 'C00001', '0000000001', 10),
('100', '0090000002', 10, 1000, 'EA', 350.00, 350000.00, 45500.00, 'CNY', 'FG-002', '1001', 'C00002', '0000000002', 10),
('100', '0090000003', 10, 1200, 'EA', 500.00, 600000.00, 78000.00, 'CNY', 'FG-001', '1001', 'C00001', '0000000003', 10);

-- 采购订单
INSERT IGNORE INTO EKKO (MANDT, EBELN, BSART, BUKRS, EKORG, EKGRP, LIFNR, WAERS, BSTYP, ERDAT, BEDAT) VALUES
('100', '4500000001', 'NB', '1000', '1000', '001', 'V00001', 'CNY', 'B', '2026-07-01', '2026-07-01'),
('100', '4500000002', 'NB', '1000', '1000', '001', 'V00002', 'CNY', 'B', '2026-07-05', '2026-07-05');

INSERT IGNORE INTO EKPO (MANDT, EBELN, EBELP, MATNR, MENGE, MEINS, NETPR, PEINH, NETWR, WERKS, LGORT, BANFN, BNPOS, EINDT) VALUES
('100', '4500000001', 10, 'RM-001', 5000, 'KG', 50.00, 1, 250000.00, '1002', '0001', '0010000001', 10, '2026-07-08'),
('100', '4500000002', 10, 'RM-002', 3000, 'KG', 30.00, 1, 90000.00,  '1002', '0001', '0010000002', 10, '2026-07-12');

-- 收货（MSEG + MKPF）
INSERT IGNORE INTO MKPF (MANDT, MBLNR, MJAHR, BUDAT, CPUDT, VGART, XBLNR) VALUES
('100', '5000000001', 2026, '2026-07-08', '2026-07-08', 'WE', '4500000001'),
('100', '5000000002', 2026, '2026-07-12', '2026-07-12', 'WE', '4500000002');

INSERT IGNORE INTO MSEG (MANDT, MBLNR, MJAHR, ZEILE, BWART, MATNR, WERKS, LGORT, MENGE, MEINS, DMBTR, SHKZG, EBELN, EBELP) VALUES
('100', '5000000001', 2026, 1, '101', 'RM-001', '1002', '0001', 5000, 'KG', 250000.00, 'S', '4500000001', 10),
('100', '5000000002', 2026, 1, '101', 'RM-002', '1002', '0001', 3000, 'KG', 90000.00,  'S', '4500000002', 10);

-- 生产订单
INSERT IGNORE INTO AUFK (MANDT, AUFNR, AUTYP, AUART, ERDAT, KOKRS, WERKS, ARBPL, PHAS1, GSTRP, GLTRP) VALUES
('100', '000001000001', '10', 'PP01', '2026-07-05', '1000', '1001', 'LINE01', '1', '2026-07-06', '2026-07-20'),
('100', '000001000002', '10', 'PP01', '2026-07-10', '1000', '1001', 'LINE01', '1', '2026-07-11', '2026-07-25');

INSERT IGNORE INTO AFKO (MANDT, AUFNR, PLNBEZ, GAMNG, GMEIN, IGMNG, WEMNG, AUSCH) VALUES
('100', '000001000001', 'FG-001', 1000, 'EA', 980, 980, 2.0),
('100', '000001000002', 'FG-002', 1000, 'EA', 950, 950, 5.0);

-- HCM 示例
INSERT IGNORE INTO HRP1000 (MANDT, PLVAR, OTYPE, OBJID, BEGDA, ENDDA, SHORT, STEXT) VALUES
('100', '01', 'O', 100001, '2024-01-01', '9999-12-31', '总装部', '总装部'),
('100', '01', 'O', 100002, '2024-01-01', '9999-12-31', '零部件部', '零部件部'),
('100', '01', 'O', 100003, '2024-01-01', '9999-12-31', '行政部', '行政管理部');

INSERT IGNORE INTO PA0001 (MANDT, PERNR, ENDDA, BEGDA, BUKRS, WERKS, PERSG, PERSK, ORGEH, ABKRS) VALUES
('100', 10001, '9999-12-31', '2024-03-01', '1000', '1001', '1', '01', 100001, 'A1'),
('100', 10002, '9999-12-31', '2024-05-01', '1000', '1001', '1', '01', 100001, 'A1'),
('100', 10003, '9999-12-31', '2024-06-01', '2000', '1002', '1', '02', 100002, 'A1');

INSERT IGNORE INTO PA0008 (MANDT, PERNR, ENDDA, BEGDA, TRFAR, TRFGB, TRFGR, BET01, WAERS) VALUES
('100', 10001, '9999-12-31', '2024-03-01', '01', '01', 'P01', 25000.00, 'CNY'),
('100', 10002, '9999-12-31', '2024-05-01', '01', '01', 'P01', 22000.00, 'CNY'),
('100', 10003, '9999-12-31', '2024-06-01', '01', '01', 'P02', 18000.00, 'CNY');

-- PM 示例
INSERT IGNORE INTO IFLOT (MANDT, TPLNR, FLTVD, BEGDT, ENDDT, PLTXT, IWERK) VALUES
('100', 'FP-ASSEMBLY-01', '1', '2024-01-01', '9999-12-31', '总装线A', '1001'),
('100', 'FP-PAINT-01',    '1', '2024-01-01', '9999-12-31', '涂装线B', '1003');

INSERT IGNORE INTO EQUI (MANDT, EQUNR, TPLNR, EQKTX, BEGDT, ENDDT, HERST, TYPBZ, IWERK, SWERK) VALUES
('100', 'EQ-10001', 'FP-ASSEMBLY-01', '六轴焊接机器人#1', '2024-01-01', '9999-12-31', 'FANUC', 'R-2000iC', '1001', '1001'),
('100', 'EQ-10002', 'FP-ASSEMBLY-01', '六轴焊接机器人#2', '2024-01-01', '9999-12-31', 'FANUC', 'R-2000iC', '1001', '1001'),
('100', 'EQ-10003', 'FP-PAINT-01',    '喷涂机械臂#1',     '2024-01-01', '9999-12-31', 'ABB',   'IRB 5500',  '1003', '1003');

-- PM 维修工单
INSERT IGNORE INTO AUFK (MANDT, AUFNR, AUTYP, AUART, ERDAT, KOKRS, WERKS, ARBPL, GSTRP, GLTRP) VALUES
('100', '000003000001', '30', 'PM01', '2026-07-20', '1000', '1001', 'MAINT01', '2026-07-21', '2026-07-22'),
('100', '000003000002', '40', 'PM02', '2026-08-01', '1000', '1003', 'MAINT02', '2026-08-02', '2026-08-03');

-- QM 来料检验批
INSERT IGNORE INTO QALS (MANDT, QPLOS, MATNR, WERKS, CHARG, LIFNR, EBELN, EBELP, ENSTEHDAT, QPLVL, MENGENBR, MEINH, LMENGEZUB) VALUES
('100', '000000010001', 'RM-STEEL-01', '1002', 'B20260701', 'V00001', '4500000001', 10, '2026-07-01', '01', 5000.000, 'KG', 5000.000),
('100', '000000010002', 'RM-ALLOY-01', '1002', 'B20260702', 'V00001', '4500000001', 20, '2026-07-01', '01', 2000.000, 'KG', 2000.000);

-- QM 检验特性
INSERT IGNORE INTO QAMV (MANDT, QPLOS, ZAEHLKAT, MERKNR, KURZTEXT, MSTHB, SOLLWERT, TOLERANZOB, TOLERANZUN, SWERTEINH, VORGABENR) VALUES
('100', '000000010001', 1, '00000001', '抗拉强度', 'X', 450.000, 480.000, 420.000, 'MPa', 5),
('100', '000000010001', 2, '00000002', '延伸率',   'X', 22.000,  25.000,  18.000,  '%',   5),
('100', '000000010002', 1, '00000003', '硬度HV',   'X', 180.000, 200.000, 160.000, 'HV',  5);

-- QM 检验结果
INSERT IGNORE INTO QAMR (MANDT, QPLOS, ZAEHLKAT, SATZNR, MERKNR, KURZTEXT, MITTELWERT, MBEWERTG) VALUES
('100', '000000010001', 1, 1, '00000001', '抗拉强度', 462.000, 'A'),
('100', '000000010001', 2, 1, '00000002', '延伸率',   21.500,  'A'),
('100', '000000010002', 1, 1, '00000003', '硬度HV',   175.000, 'A');

-- AM 资产主记录
INSERT IGNORE INTO ANLA (MANDT, BUKRS, ANLN1, ANLN2, ANLKL, TXT50, AKTIV, AFASL, URWRT, ANBTR, KANSW, WAERS, KOSTL, PRCTR, ERDAT) VALUES
('100', '1000', '000010000001', '0000', '1000', '六轴焊接机器人#1', '2024-01-01', 'LIN', 1200000.00, 900000.00, 300000.00, 'CNY', 'CC-PROD-01', 'PC-SH', '2024-01-01'),
('100', '1000', '000010000002', '0000', '1000', '六轴焊接机器人#2', '2024-01-01', 'LIN', 1200000.00, 900000.00, 300000.00, 'CNY', 'CC-PROD-01', 'PC-SH', '2024-01-01'),
('100', '1000', '000010000003', '0000', '2000', '喷涂机械臂#1',     '2024-06-01', 'LIN', 800000.00,  600000.00, 200000.00, 'CNY', 'CC-PROD-01', 'PC-SH', '2024-06-01'),
('100', '2000', '000010000004', '0000', '3000', 'CNC加工中心',       '2023-03-01', 'LIN', 2500000.00, 1500000.00, 1000000.00, 'CNY', 'CC-PROD-02', 'PC-JS', '2023-03-01');

-- AM 资产期间值
INSERT IGNORE INTO ANLZ (MANDT, BUKRS, ANLN1, ANLN2, GJAHR, AFABE, PERAF, KANSW, KNAFA, NAFAP, ANSWL) VALUES
('100', '1000', '000010000001', '0000', 2026, '01', 7, 1200000.00, 300000.00, 50000.00, 900000.00),
('100', '1000', '000010000002', '0000', 2026, '01', 7, 1200000.00, 300000.00, 50000.00, 900000.00),
('100', '1000', '000010000003', '0000', 2026, '01', 7, 800000.00,  200000.00, 33333.33, 600000.00),
('100', '2000', '000010000004', '0000', 2026, '01', 7, 2500000.00, 1000000.00, 83333.33, 1500000.00);

-- PS 项目定义
INSERT IGNORE INTO PROJ (MANDT, PSPNR, PSPID, POST1, PLFAZ, PLFEZ, KOKRS, BUKRS, PRCTR, FKSTK) VALUES
('100', 100001, 'P-2026-001', '新产品线建设', '2026-01-01', '2026-12-31', '1000', '1000', 'PC-SH', 'X'),
('100', 100002, 'P-2026-002', '产线搬迁苏州', '2026-03-01', '2026-09-30', '1000', '2000', 'PC-JS', 'X');

-- PS WBS元素
INSERT IGNORE INTO PRPS (MANDT, PSPNR, POSID, POST1, PSPHI, PLFAZ, PLFEZ, PLKOW, PLIOW, WKGOW, WIOOW, FKSTK, KOKRS, PRCTR) VALUES
('100', 200001, 'P-2026-001.1', '设备采购', 100001, '2026-01-01', '2026-06-30', 5000000.00, 0, 3200000.00, 0, 'X', '1000', 'PC-SH'),
('100', 200002, 'P-2026-001.2', '安装调试', 100001, '2026-04-01', '2026-09-30', 2000000.00, 0,  800000.00, 0, 'X', '1000', 'PC-SH'),
('100', 200003, 'P-2026-001.3', '试生产',   100001, '2026-07-01', '2026-12-31', 1500000.00, 500000.00, 600000.00, 200000.00, 'X', '1000', 'PC-SH');

-- WM 转储单
INSERT IGNORE INTO LTAK (MANDT, LGNUM, TANUM, TBTYP, BWLVS, QDATU, QNAMV) VALUES
('100', 'W01', '0000000001', '1', '101', '2026-07-15', 'WMUSER01'),
('100', 'W01', '0000000002', '2', '311', '2026-07-16', 'WMUSER01');

INSERT IGNORE INTO LTAP (MANDT, LGNUM, TANUM, TAPOS, MATNR, WERKS, BESTQ, VLTYP, VLPLA, NLTYP, NLPLA, VSOLA, NSOLA, ALTME) VALUES
('100', 'W01', '0000000001', 1, 'RM-STEEL-01', '1002', '', '001', 'A-01-01', '001', 'A-02-01', 1000.000, 1000.000, 'KG'),
('100', 'W01', '0000000002', 1, 'FG-MOTOR-01', '1001', '', '001', 'B-01-01', '002', 'C-01-01', 100.000, 100.000, 'EA');

-- WM 仓库量化
INSERT IGNORE INTO LQUA (MANDT, LGNUM, LGTYP, LGPLA, MATNR, WERKS, BESTQ, GESME, VERME, MEINS) VALUES
('100', 'W01', '001', 'A-01-01', 'RM-STEEL-01', '1002', '', 4000.000, 0, 'KG'),
('100', 'W01', '001', 'A-02-01', 'RM-STEEL-01', '1002', '', 1000.000, 0, 'KG'),
('100', 'W01', '002', 'C-01-01', 'FG-MOTOR-01', '1001', '', 80.000, 0, 'EA');

-- FM 预算
INSERT IGNORE INTO FMBH (MANDT, DOCNR, RLDNR, FIKRS, BUKRS, GJAHR, BUDCAT, BUDAT, DOCDATE, ERNAM, ERDAT) VALUES
('100', '9000000001', '0L', '1000', '1000', 2026, '9F', '2025-12-15', '2025-12-15', 'FMBUD01', '2025-12-15'),
('100', '9000000002', '0L', '1000', '1000', 2026, '9G', '2026-06-01', '2026-06-01', 'FMBUD01', '2026-06-01');

INSERT IGNORE INTO FMIOI (MANDT, RLDNR, FIKRS, FAREA, GJAHR, BUDCAT, BUDVAL, BUDAVL, BUDREL, WAERS) VALUES
('100', '0L', '1000', '1000', 2026, '9F', 10000000.00, 6500000.00, 3500000.00, 'CNY'),
('100', '0L', '1000', '2000', 2026, '9F',  5000000.00, 3200000.00, 1800000.00, 'CNY');

-- TCURR 汇率
INSERT IGNORE INTO TCURR (MANDT, KURST, FCURR, TCURR_ISO, GDATU, UKURS) VALUES
('100', 'M',    'USD', 'CNY', '2026-01-01', 7.25000),
('100', 'M',    'EUR', 'CNY', '2026-01-01', 7.90000),
('100', 'M',    'JPY', 'CNY', '2026-01-01', 0.04800),
('100', '0001', 'USD', 'CNY', '2026-01-01', 7.23000),
('100', '0001', 'EUR', 'CNY', '2026-01-01', 7.88000);

-- TKA01 控制范围
INSERT IGNORE INTO TKA01 (MANDT, KOKRS, BEZEI, KTOPL, WAERS, ERSDA) VALUES
('100', '1000', '华创控制范围', 'INT', 'CNY', '2024-01-01');

-- COBK/COEP CO凭证
INSERT IGNORE INTO COBK (MANDT, KOKRS, BELNR, GJAHR, PERIO, AWTYP, AWKEY, BUDAT, CPUDT, USNAM) VALUES
('100', '1000', '0000000501', 2026, 7, 'BKPF', '01000000012026', '2026-07-01', '2026-07-01', 'FIUSER'),
('100', '1000', '0000000502', 2026, 7, 'AUFK', '00000100002026', '2026-07-15', '2026-07-15', 'PPUSER');

INSERT IGNORE INTO COEP (MANDT, KOKRS, BELNR, GJAHR, PERIO, KSTAR, WKGOWR, WOGBTR, OWAEER, OBJNR, VERSN, BEKNZ) VALUES
('100', '1000', '0000000501', 2026, 7, '60010101', 500000.00, 500000.00, 'CNY', 'KS1000CC-PROD-01', '0', ''),
('100', '1000', '0000000502', 2026, 7, '50010101', 200000.00, 200000.00, 'CNY', 'OR0000010000',      '0', '');

-- FAGLFLEXT 汇总
INSERT IGNORE INTO FAGLFLEXT (MANDT, RLDNR, RACCT, RBUKRS, GJAHR, PERIO, RCNTR, RPCNT, HSLVT, DRCRK, CURTP) VALUES
('100', '0L', '60010101', '1000', 2026, 7, 'CC-PROD-01', 'PC-SH', 500000.00, 'H', '10'),
('100', '0L', '50010101', '1000', 2026, 7, 'CC-PROD-01', 'PC-SH', 200000.00, 'S', '10');

-- EINA/EINE 采购信息记录
INSERT IGNORE INTO EINA (MANDT, INFNR, LIFNR, MATNR, EKORG, WAERS, MEINS, ERDAT) VALUES
('100', '5300000001', 'V00001', 'RM-STEEL-01', '1000', 'CNY', 'KG', '2025-01-01'),
('100', '5300000002', 'V00001', 'RM-ALLOY-01', '1000', 'CNY', 'KG', '2025-01-01'),
('100', '5300000003', 'V00002', 'PM-BEARING-01', '1000', 'CNY', 'EA', '2025-03-01');

INSERT IGNORE INTO EINE (MANDT, INFNR, EKORG, WERKS, NETPR, PEINH, WAERS, EKGRP, PLIFZ) VALUES
('100', '5300000001', '1000', '1002', 8.50,  1, 'CNY', '001', 7),
('100', '5300000002', '1000', '1002', 32.00, 1, 'CNY', '001', 10),
('100', '5300000003', '1000', '1001', 45.00, 1, 'CNY', '002', 5);

-- MAST BOM使用点
INSERT IGNORE INTO MAST (MANDT, MATNR, WERKS, STLAL, STLNR, STLTY) VALUES
('100', 'FG-MOTOR-01', '1001', '01', '00000001', 'M'),
('100', 'FG-GEARBOX-01', '1001', '01', '00000002', 'M');

-- MLGN 物料采购组织级
INSERT IGNORE INTO MLGN (MANDT, MATNR, EKORG, DISPO, DISMM, DISLS, MINBE, EISBE, PLIFZ) VALUES
('100', 'RM-STEEL-01',  '1000', '001', 'PD', 'EX', 2000.000, 500.000, 7),
('100', 'RM-ALLOY-01',  '1000', '001', 'PD', 'EX', 1000.000, 200.000, 10),
('100', 'PM-BEARING-01', '1000', '002', 'PD', 'FX', 500.000, 100.000, 5);

-- VBKD 业务数据
INSERT IGNORE INTO VBKD (MANDT, VBELV, POSNV, VBELN, POSNN, ZTERM, INCO1, INCO2, PRSDT) VALUES
('100', '0000000001', 0, '0000000001', 0, 'Z001', 'FOB', 'SHANGHAI', '2026-07-01'),
('100', '0000000002', 0, '0000000002', 0, 'Z002', 'CIF', 'SUZHOU',   '2026-07-05');

-- VBUK 抬头状态
INSERT IGNORE INTO VBUK (MANDT, VBELN, WBSTK, FKSTK, GBSTK) VALUES
('100', '0000000001', 'C', 'C', 'C'),
('100', '0000000002', 'A', 'A', 'A');

-- MAPL 物料-工艺路线
INSERT IGNORE INTO MAPL (MANDT, MATNR, WERKS, PLNTY, PLNNR, PLNAL, ZAEHL) VALUES
('100', 'FG-MOTOR-01',  '1001', 'N', '00000001', '01', 1),
('100', 'FG-GEARBOX-01', '1001', 'N', '00000002', '01', 1);

-- CRCO 工作中心-成本中心
INSERT IGNORE INTO CRCO (MANDT, OBJTY, OBJID, KOKRS, ENDDA, BEGDA, KOSTL, LSTAR) VALUES
('100', 'A', 1000001, '1000', '9999-12-31', '2024-01-01', 'CC-PROD-01', 'L001'),
('100', 'A', 1000002, '1000', '9999-12-31', '2024-01-01', 'CC-PROD-01', 'L002'),
('100', 'A', 1000003, '1000', '9999-12-31', '2024-01-01', 'CC-PROD-02', 'L003');

-- CE4_ACCT 获利分析段
INSERT IGNORE INTO CE4_ACCT (MANDT, KOKRS, PAOBJNR, PASUBNR, BUKRS, KNDNR, ARTNR, VKORG, VTWEG, SPART, KMBTR, KKMNG, KABTR, GJAHR, PERIO, BUDAT) VALUES
('100', '1000', 1, 1, '1000', 'C00001', 'FG-MOTOR-01',  '1000', '10', '00', 500000.00, 100.00, 320000.00, 2026, 7, '2026-07-10'),
('100', '1000', 2, 1, '1000', 'C00002', 'FG-GEARBOX-01', '1000', '10', '00', 350000.00, 50.00,  210000.00, 2026, 7, '2026-07-12'),
('100', '1000', 3, 1, '1000', 'C00001', 'FG-MOTOR-01',  '1000', '10', '00', 480000.00, 96.00,  307200.00, 2026, 8, '2026-08-05');

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 19. 验证
-- ============================================================

SELECT '--- SAP S/4HANA 表结构验证 ---' AS '';

SELECT 'T001' AS tbl, COUNT(*) AS cnt FROM T001
UNION ALL SELECT 'T001W', COUNT(*) FROM T001W
UNION ALL SELECT 'T001L', COUNT(*) FROM T001L
UNION ALL SELECT 'TVKO', COUNT(*) FROM TVKO
UNION ALL SELECT 'T024E', COUNT(*) FROM T024E
UNION ALL SELECT 'MARA', COUNT(*) FROM MARA
UNION ALL SELECT 'MARC', COUNT(*) FROM MARC
UNION ALL SELECT 'MARD', COUNT(*) FROM MARD
UNION ALL SELECT 'MBEW', COUNT(*) FROM MBEW
UNION ALL SELECT 'KNA1', COUNT(*) FROM KNA1
UNION ALL SELECT 'KNVV', COUNT(*) FROM KNVV
UNION ALL SELECT 'LFA1', COUNT(*) FROM LFA1
UNION ALL SELECT 'SKA1', COUNT(*) FROM SKA1
UNION ALL SELECT 'SKB1', COUNT(*) FROM SKB1
UNION ALL SELECT 'CSKS', COUNT(*) FROM CSKS
UNION ALL SELECT 'CEPC', COUNT(*) FROM CEPC
UNION ALL SELECT 'ACDOCA', COUNT(*) FROM ACDOCA
UNION ALL SELECT 'BKPF', COUNT(*) FROM BKPF
UNION ALL SELECT 'BSEG', COUNT(*) FROM BSEG
UNION ALL SELECT 'BSID', COUNT(*) FROM BSID
UNION ALL SELECT 'BSIK', COUNT(*) FROM BSIK
UNION ALL SELECT 'EBAN', COUNT(*) FROM EBAN
UNION ALL SELECT 'EKKO', COUNT(*) FROM EKKO
UNION ALL SELECT 'EKPO', COUNT(*) FROM EKPO
UNION ALL SELECT 'MKPF', COUNT(*) FROM MKPF
UNION ALL SELECT 'MSEG', COUNT(*) FROM MSEG
UNION ALL SELECT 'VBAK', COUNT(*) FROM VBAK
UNION ALL SELECT 'VBAP', COUNT(*) FROM VBAP
UNION ALL SELECT 'VBUP', COUNT(*) FROM VBUP
UNION ALL SELECT 'LIKP', COUNT(*) FROM LIKP
UNION ALL SELECT 'LIPS', COUNT(*) FROM LIPS
UNION ALL SELECT 'VBRK', COUNT(*) FROM VBRK
UNION ALL SELECT 'VBRP', COUNT(*) FROM VBRP
UNION ALL SELECT 'PRCD_ELEMENTS', COUNT(*) FROM PRCD_ELEMENTS
UNION ALL SELECT 'STKO', COUNT(*) FROM STKO
UNION ALL SELECT 'STPO', COUNT(*) FROM STPO
UNION ALL SELECT 'CRHD', COUNT(*) FROM CRHD
UNION ALL SELECT 'PLKO', COUNT(*) FROM PLKO
UNION ALL SELECT 'PLPO', COUNT(*) FROM PLPO
UNION ALL SELECT 'AUFK', COUNT(*) FROM AUFK
UNION ALL SELECT 'AFKO', COUNT(*) FROM AFKO
UNION ALL SELECT 'AFPO', COUNT(*) FROM AFPO
UNION ALL SELECT 'MDKP', COUNT(*) FROM MDKP
UNION ALL SELECT 'MDPS', COUNT(*) FROM MDPS
UNION ALL SELECT 'HRP1000', COUNT(*) FROM HRP1000
UNION ALL SELECT 'HRP1001', COUNT(*) FROM HRP1001
UNION ALL SELECT 'PA0001', COUNT(*) FROM PA0001
UNION ALL SELECT 'PA0002', COUNT(*) FROM PA0002
UNION ALL SELECT 'PA0008', COUNT(*) FROM PA0008
UNION ALL SELECT 'IFLOT', COUNT(*) FROM IFLOT
UNION ALL SELECT 'EQUI', COUNT(*) FROM EQUI
UNION ALL SELECT 'MHIO', COUNT(*) FROM MHIO
UNION ALL SELECT 'PMCO', COUNT(*) FROM PMCO
UNION ALL SELECT 'QALS', COUNT(*) FROM QALS
UNION ALL SELECT 'QAMV', COUNT(*) FROM QAMV
UNION ALL SELECT 'QAMR', COUNT(*) FROM QAMR
UNION ALL SELECT 'QPLO', COUNT(*) FROM QPLO
UNION ALL SELECT 'ANLA', COUNT(*) FROM ANLA
UNION ALL SELECT 'ANLZ', COUNT(*) FROM ANLZ
UNION ALL SELECT 'ANEP', COUNT(*) FROM ANEP
UNION ALL SELECT 'PROJ', COUNT(*) FROM PROJ
UNION ALL SELECT 'PRPS', COUNT(*) FROM PRPS
UNION ALL SELECT 'LTAK', COUNT(*) FROM LTAK
UNION ALL SELECT 'LTAP', COUNT(*) FROM LTAP
UNION ALL SELECT 'LQUA', COUNT(*) FROM LQUA
UNION ALL SELECT 'FMBH', COUNT(*) FROM FMBH
UNION ALL SELECT 'FMIOI', COUNT(*) FROM FMIOI
UNION ALL SELECT 'TCURR', COUNT(*) FROM TCURR
UNION ALL SELECT 'TKA01', COUNT(*) FROM TKA01
UNION ALL SELECT 'COBK', COUNT(*) FROM COBK
UNION ALL SELECT 'COEP', COUNT(*) FROM COEP
UNION ALL SELECT 'FAGLFLEXT', COUNT(*) FROM FAGLFLEXT
UNION ALL SELECT 'EINA', COUNT(*) FROM EINA
UNION ALL SELECT 'EINE', COUNT(*) FROM EINE
UNION ALL SELECT 'MAST', COUNT(*) FROM MAST
UNION ALL SELECT 'MLGN', COUNT(*) FROM MLGN
UNION ALL SELECT 'VBKD', COUNT(*) FROM VBKD
UNION ALL SELECT 'VBUK', COUNT(*) FROM VBUK
UNION ALL SELECT 'MAPL', COUNT(*) FROM MAPL
UNION ALL SELECT 'CRCO', COUNT(*) FROM CRCO
UNION ALL SELECT 'CE4_ACCT', COUNT(*) FROM CE4_ACCT
UNION ALL SELECT 'T009', COUNT(*) FROM T009
UNION ALL SELECT 'T009C', COUNT(*) FROM T009C;

SELECT CONCAT('总表数: ', COUNT(*)) AS summary FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE';