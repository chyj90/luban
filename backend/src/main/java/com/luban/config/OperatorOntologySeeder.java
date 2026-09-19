package com.luban.config;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.Concept;
import com.luban.entity.ConceptJoinMapping;
import com.luban.entity.ConceptMapping;
import com.luban.entity.ConceptRelation;
import com.luban.entity.Datasource;
import com.luban.entity.OntologyGroup;
import com.luban.repository.ConceptJoinMappingRepository;
import com.luban.repository.ConceptMappingRepository;
import com.luban.repository.ConceptRelationRepository;
import com.luban.repository.ConceptRepository;
import com.luban.repository.OntologyGroupRepository;
import com.luban.service.BindingProfileService;
import com.luban.service.ConceptEmbeddingService;
import com.luban.service.DatasourceService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Random;

/**
 * 运营商行业语义包（内置本体三来源之二）：开箱即用的运营商演示语义。
 *
 * 语义包分两层，与具体业务库彻底解耦：
 * - 标准层（跨省一致，随平台版本交付）：概念/关系/术语词典/回归题集。概念描述只写业务语义
 *   （字段、枚举、口径），不出现任何表名列名——表结构是省侧现实，不属于语义标准；
 * - 本地层（每省现场生成）：概念→表列映射。演示库的映射随包预置（演示 schema 是包的一部分），
 *   真实省份接入时连接生产库后用「绑定管理 → 自动绑定」把同一套概念映射到真实表列，
 *   概念/关系/题集无需重建。
 *
 * 数据底座与平台系统库物理解耦：演示业务表建在独立演示库 luban_demo_operator 中，
 * 注册内置数据源「运营商演示库」指向它——平台库只存平台元数据，删演示库不影响平台，
 * 且演示接入形态与真实外部库接入完全同构。
 * 配套回归题集：resources/ontology-questionsets/operator-semantics.json，
 * 在「建模中心 → 语义包回归」一键验证。
 * 通过 luban.operator-package.enabled=false 可整体关闭（未来其他行业部署互不影响）。
 */
@Slf4j
@Component
@Order(120)
@ConditionalOnProperty(name = "luban.operator-package.enabled", havingValue = "true", matchIfMissing = true)
@RequiredArgsConstructor
public class OperatorOntologySeeder implements CommandLineRunner {

    private static final String GROUP_NAME = "operator_semantics";
    private static final String GROUP_DISPLAY = "运营商语义";
    public static final String DEMO_DS_SLUG = "OPERATOR_DEMO";
    public static final String DEMO_DS_NAME = "运营商演示库";
    public static final String DEMO_DB_NAME = "luban_demo_operator";

    private final DatasourceService datasourceService;
    private final OntologyGroupRepository groupRepository;
    private final ConceptRepository conceptRepository;
    private final ConceptMappingRepository conceptMappingRepository;
    private final ConceptJoinMappingRepository conceptJoinMappingRepository;
    private final ConceptRelationRepository conceptRelationRepository;
    private final BindingProfileService bindingProfileService;
    private final ConceptEmbeddingService conceptEmbeddingService;
    private final ObjectMapper objectMapper;

    @Override
    public void run(String... args) {
        try {
            Datasource ds = datasourceService.ensureBuiltinDemoDatasource(DEMO_DS_SLUG, DEMO_DS_NAME, DEMO_DB_NAME);
            Long dsId = ds.getId();

            JdbcTemplate demoJdbc = buildDemoJdbcTemplate(ds);
            ensureDemoTablesAndData(demoJdbc);

            OntologyGroup group = ensureGroup();

            List<Long> newConceptIds = new ArrayList<>();
            Concept opUser = ensureConcept(group.getId(), "OpUser",
                    "运营商用户（手机/宽带客户），一行一个用户。属性：手机号、客户名称、地市、区县、用户类型（5G/4G/宽带）、"
                            + "在网状态（在网/离网，离网即流失或携出）、当前套餐、入网时间、离网时间。可按地市/区县/用户类型过滤或分组。",
                    "ENTITY", null, null, newConceptIds);
            Concept opPackage = ensureConcept(group.getId(), "OpPackage",
                    "套餐（资费档位），一行一个套餐。属性：套餐名称、套餐类型（融合/宽带/移动）、月费（元）、包含流量（GB）。"
                            + "用户与套餐是「当前订购」关系：一个用户同一时间只有一个当前套餐。",
                    "DIMENSION", null, null, newConceptIds);
            Concept opBill = ensureConcept(group.getId(), "OpBill",
                    "用户月账单，一行一个用户一个账期。属性：账期（yyyy-MM）、出账费用（元，含语音/流量/宽带全部费用）、语音费、"
                            + "流量费、宽带费、缴费状态（已缴/未缴）。收入类指标以账期为时间锚。",
                    "ENTITY", null, "bill_month", newConceptIds);
            Concept opComplaint = ensureConcept(group.getId(), "OpComplaint",
                    "投诉工单，一行一个投诉。属性：投诉类型（网络质量/资费争议/装维服务/业务办理）、投诉渠道（10010热线/掌上营业厅/营业厅）、"
                            + "工单状态（已完成/处理中）、受理时间、处理时长（小时）。每个投诉归属一个用户。",
                    "ENTITY", null, "created_date", newConceptIds);

            Concept revenue = ensureConcept(group.getId(), "出账收入",
                    "统计周期内用户月账单出账费用合计，含语音/流量/宽带全部费用，按账期归属。问「收入/营收/出账/计费收入」默认指本口径。",
                    "METRIC", "元", "bill_month", newConceptIds);
            revenue.setDefaultAggregation("SUM");
            conceptRepository.save(revenue);
            Concept complaintCount = ensureConcept(group.getId(), "投诉量",
                    "统计周期内投诉工单件数，按受理时间计数。问「投诉/客诉/申诉」默认指本口径。",
                    "METRIC", "件", "created_date", newConceptIds);
            complaintCount.setDefaultAggregation("COUNT");
            conceptRepository.save(complaintCount);
            Concept newUsers = ensureConcept(group.getId(), "新增用户数",
                    "统计周期内新入网用户数（入网时间落在统计周期内的用户计数）。问「新增/新入网/发展用户/拉新」默认指本口径。",
                    "METRIC", "户", "in_net_date", newConceptIds);
            newUsers.setDefaultAggregation("COUNT");
            conceptRepository.save(newUsers);
            Concept broadbandUsers = ensureConcept(group.getId(), "宽带用户数",
                    "当前在网且用户类型为宽带的用户数。问「宽带用户/宽带在网用户」默认指本口径。",
                    "METRIC", "户", null, newConceptIds);
            broadbandUsers.setDefaultAggregation("COUNT");
            conceptRepository.save(broadbandUsers);

            ensureRelation(revenue.getId(), opUser.getId(), "DRILLS_INTO", "出账收入可按用户/地市/区县维度下钻");
            ensureRelation(revenue.getId(), opPackage.getId(), "DRILLS_INTO", "出账收入可按套餐维度下钻");
            ensureRelation(complaintCount.getId(), opUser.getId(), "DRILLS_INTO", "投诉量可按用户/地市/区县维度下钻");
            ensureRelation(newUsers.getId(), opUser.getId(), "DRILLS_INTO", "新增用户数可按地市/区县维度下钻");
            ensureRelation(opUser.getId(), opPackage.getId(), "CORRELATED", "用户与其当前套餐，双向对称");
            ensureRelation(opUser.getId(), opBill.getId(), "CORRELATED", "用户与其月账单，双向对称");
            ensureRelation(opUser.getId(), opComplaint.getId(), "CORRELATED", "用户与其投诉工单，双向对称");

            ensureMapping(opUser, dsId, "op_user", "id", "用户ID");
            ensureMapping(opUser, dsId, "op_user", "msisdn", "手机号");
            ensureMapping(opUser, dsId, "op_user", "user_name", "客户名称");
            ensureMapping(opUser, dsId, "op_user", "city", "地市");
            ensureMapping(opUser, dsId, "op_user", "county", "区县");
            ensureMapping(opUser, dsId, "op_user", "user_type", "用户类型");
            ensureMapping(opUser, dsId, "op_user", "status", "在网状态");
            ensureMapping(opUser, dsId, "op_user", "package_id", "当前套餐ID");
            ensureMapping(opUser, dsId, "op_user", "in_net_date", "入网时间");
            ensureMapping(opUser, dsId, "op_user", "out_net_date", "离网时间");
            ensureMapping(opPackage, dsId, "op_package", "package_name", "套餐名称");
            ensureMapping(opPackage, dsId, "op_package", "package_type", "套餐类型");
            ensureMapping(opPackage, dsId, "op_package", "monthly_fee", "月费");
            ensureMapping(opPackage, dsId, "op_package", "data_gb", "包含流量");
            ensureMapping(opBill, dsId, "op_bill", "bill_month", "账期");
            ensureMapping(opBill, dsId, "op_bill", "total_fee", "出账费用");
            ensureMapping(opBill, dsId, "op_bill", "voice_fee", "语音费");
            ensureMapping(opBill, dsId, "op_bill", "data_fee", "流量费");
            ensureMapping(opBill, dsId, "op_bill", "broadband_fee", "宽带费");
            ensureMapping(opBill, dsId, "op_bill", "pay_status", "缴费状态");
            ensureMapping(opComplaint, dsId, "op_complaint", "complaint_type", "投诉类型");
            ensureMapping(opComplaint, dsId, "op_complaint", "channel", "投诉渠道");
            ensureMapping(opComplaint, dsId, "op_complaint", "status", "工单状态");
            ensureMapping(opComplaint, dsId, "op_complaint", "created_date", "受理时间");
            ensureMapping(opComplaint, dsId, "op_complaint", "handle_hours", "处理时长");
            ensureMapping(revenue, dsId, "op_bill", "total_fee", "出账费用");
            ensureMapping(complaintCount, dsId, "op_complaint", "id", "投诉工单ID");
            ensureMapping(newUsers, dsId, "op_user", "id", "用户ID");
            ensureMapping(broadbandUsers, dsId, "op_user", "id", "用户ID");

            ensureJoin(opUser, dsId, "OpPackage", "op_package", "op_user.package_id = op_package.id", "用户当前套餐");
            ensureJoin(opBill, dsId, "OpUser", "op_user", "op_bill.user_id = op_user.id", "账单归属用户");
            ensureJoin(opComplaint, dsId, "OpUser", "op_user", "op_complaint.user_id = op_user.id", "投诉归属用户");

            ensureSynonymDict(dsId);

            if (!newConceptIds.isEmpty()) {
                conceptEmbeddingService.scheduleEmbeddingAfterCommit(newConceptIds, false);
            }
            long count = conceptRepository.findAll().stream()
                    .filter(c -> c.getGroupId() != null && c.getGroupId().equals(group.getId())).count();
            log.info("运营商语义包就绪：数据源「{}」({}) → 独立演示库 {}，概念 {} 个",
                    DEMO_DS_NAME, dsId, DEMO_DB_NAME, count);
        } catch (Exception e) {
            log.error("运营商语义包初始化失败（不阻断启动）: {}", e.getMessage(), e);
        }
    }

    /** 用数据源配置构造指向演示库的 JdbcTemplate（启动期一次性建表灌数用） */
    private JdbcTemplate buildDemoJdbcTemplate(Datasource ds) {
        try {
            Map<String, Object> config = objectMapper.readValue(ds.getConfig(),
                    new TypeReference<Map<String, Object>>() {});
            String jdbcUrl = datasourceService.buildJdbcUrl(ds.getType(), config);
            String username = String.valueOf(config.getOrDefault("username", ""));
            String password = datasourceService.decryptPassword(config);
            DriverManagerDataSource dataSource = new DriverManagerDataSource(jdbcUrl, username, password);
            dataSource.setDriverClassName("com.mysql.cj.jdbc.Driver");
            return new JdbcTemplate(dataSource);
        } catch (Exception e) {
            throw new RuntimeException("解析演示数据源配置失败: " + e.getMessage(), e);
        }
    }

    /** 幂等创建演示表并灌入近 6 个月演示数据（op_user 有数据则跳过） */
    private void ensureDemoTablesAndData(JdbcTemplate jdbc) {
        jdbc.execute("CREATE TABLE IF NOT EXISTS op_package ("
                + "id BIGINT AUTO_INCREMENT PRIMARY KEY,"
                + "package_name VARCHAR(64) NOT NULL COMMENT '套餐名称',"
                + "package_type VARCHAR(16) NOT NULL COMMENT '套餐类型：融合/宽带/移动',"
                + "monthly_fee DECIMAL(10,2) NOT NULL COMMENT '月费(元)',"
                + "data_gb INT NOT NULL DEFAULT 0 COMMENT '包含流量(GB)'"
                + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        jdbc.execute("CREATE TABLE IF NOT EXISTS op_user ("
                + "id BIGINT AUTO_INCREMENT PRIMARY KEY,"
                + "msisdn VARCHAR(16) NOT NULL COMMENT '手机号',"
                + "user_name VARCHAR(32) NOT NULL COMMENT '客户名称',"
                + "city VARCHAR(32) NOT NULL COMMENT '地市',"
                + "county VARCHAR(32) NOT NULL COMMENT '区县',"
                + "user_type VARCHAR(8) NOT NULL COMMENT '用户类型：5G/4G/宽带',"
                + "status VARCHAR(8) NOT NULL COMMENT '在网状态：在网/离网',"
                + "package_id BIGINT NOT NULL COMMENT '当前套餐ID',"
                + "in_net_date DATE NOT NULL COMMENT '入网时间',"
                + "out_net_date DATE NULL COMMENT '离网时间'"
                + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        jdbc.execute("CREATE TABLE IF NOT EXISTS op_bill ("
                + "id BIGINT AUTO_INCREMENT PRIMARY KEY,"
                + "user_id BIGINT NOT NULL COMMENT '用户ID',"
                + "bill_month VARCHAR(7) NOT NULL COMMENT '账期 yyyy-MM',"
                + "total_fee DECIMAL(10,2) NOT NULL COMMENT '出账费用(元)',"
                + "voice_fee DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '语音费',"
                + "data_fee DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '流量费',"
                + "broadband_fee DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '宽带费',"
                + "pay_status VARCHAR(8) NOT NULL DEFAULT '已缴' COMMENT '缴费状态：已缴/未缴'"
                + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        jdbc.execute("CREATE TABLE IF NOT EXISTS op_complaint ("
                + "id BIGINT AUTO_INCREMENT PRIMARY KEY,"
                + "user_id BIGINT NOT NULL COMMENT '用户ID',"
                + "complaint_type VARCHAR(16) NOT NULL COMMENT '投诉类型：网络质量/资费争议/装维服务/业务办理',"
                + "channel VARCHAR(16) NOT NULL COMMENT '投诉渠道：10010热线/掌上营业厅/营业厅',"
                + "status VARCHAR(8) NOT NULL COMMENT '工单状态：已完成/处理中',"
                + "created_date DATE NOT NULL COMMENT '受理时间',"
                + "handle_hours INT NOT NULL DEFAULT 0 COMMENT '处理时长(小时)',"
                + "city VARCHAR(32) NOT NULL COMMENT '地市',"
                + "county VARCHAR(32) NOT NULL COMMENT '区县'"
                + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

        Integer userCount = jdbc.queryForObject("SELECT COUNT(*) FROM op_user", Integer.class);
        if (userCount != null && userCount > 0) return;

        seedDemoData(jdbc);
        log.info("运营商演示数据灌入完成（{}）：op_package/op_user/op_bill/op_complaint", DEMO_DB_NAME);
    }

    private void seedDemoData(JdbcTemplate jdbc) {
        Random r = new Random(42);
        LocalDate today = LocalDate.now();
        DateTimeFormatter monthFmt = DateTimeFormatter.ofPattern("yyyy-MM");

        String[][] packages = {
                {"5G畅越冰激凌129", "融合", "129", "60"},
                {"5G畅越冰激凌159", "融合", "159", "80"},
                {"全家享融合199", "融合", "199", "100"},
                {"全家享融合129", "融合", "129", "60"},
                {"100M精品单宽", "宽带", "60", "0"},
                {"300M千兆单宽", "宽带", "90", "0"},
                {"8元保号套餐", "移动", "8", "1"},
                {"校园青春卡39", "移动", "39", "30"},
        };
        List<Object[]> pkgRows = new ArrayList<>();
        for (String[] p : packages) {
            pkgRows.add(new Object[]{p[0], p[1], new BigDecimal(p[2]), Integer.parseInt(p[3])});
        }
        jdbc.batchUpdate("INSERT INTO op_package (package_name, package_type, monthly_fee, data_gb) VALUES (?,?,?,?)",
                pkgRows);

        String[] mobilePkgIdx = {"1", "2", "3", "4", "7", "8"};
        String[] broadbandPkgIdx = {"1", "2", "3", "4", "5", "6"};
        String[] surnames = {"张", "王", "李", "赵", "刘", "陈", "杨", "黄", "周", "吴", "徐", "孙", "马", "朱", "胡", "郭", "何", "高", "林"};
        String[] givens = {"伟", "芳", "娜", "敏", "静", "丽", "强", "磊", "军", "洋", "勇", "艳", "杰", "娟", "涛", "明", "超", "霞", "平", "刚", "华", "梅", "鑫", "畅"};
        String[][] regions = {
                {"石家庄市", "长安区"}, {"石家庄市", "桥西区"}, {"石家庄市", "裕华区"}, {"石家庄市", "新华区"},
                {"唐山市", "路北区"}, {"唐山市", "路南区"}, {"唐山市", "丰润区"}, {"唐山市", "开平区"},
                {"保定市", "竞秀区"}, {"保定市", "莲池区"}, {"保定市", "满城区"}, {"保定市", "清苑区"},
        };
        String[] phonePrefixes = {"138", "139", "186", "187", "155", "156", "176", "130"};

        List<Object[]> users = new ArrayList<>();
        for (int i = 0; i < 120; i++) {
            String[] region = regions[r.nextInt(regions.length)];
            String userType = r.nextDouble() < 0.35 ? "5G" : (r.nextDouble() < 0.55 ? "4G" : "宽带");
            String status = r.nextDouble() < 0.85 ? "在网" : "离网";
            String pkgId = "宽带".equals(userType)
                    ? broadbandPkgIdx[r.nextInt(broadbandPkgIdx.length)]
                    : mobilePkgIdx[r.nextInt(mobilePkgIdx.length)];
            LocalDate inNet = today.minusDays(30 + r.nextInt(700));
            LocalDate outNet = "离网".equals(status) ? today.minusDays(1 + r.nextInt(180)) : null;
            String name = surnames[r.nextInt(surnames.length)] + givens[r.nextInt(givens.length)]
                    + (r.nextDouble() < 0.3 ? givens[r.nextInt(givens.length)] : "");
            String msisdn = phonePrefixes[r.nextInt(phonePrefixes.length)]
                    + String.format("%08d", r.nextInt(100000000));
            users.add(new Object[]{msisdn, name, region[0], region[1], userType, status, pkgId,
                    java.sql.Date.valueOf(inNet), outNet == null ? null : java.sql.Date.valueOf(outNet)});
        }
        jdbc.batchUpdate("INSERT INTO op_user (msisdn, user_name, city, county, user_type, status, package_id, in_net_date, out_net_date) "
                + "VALUES (?,?,?,?,?,?,?,?,?)", users);

        List<Object[]> bills = new ArrayList<>();
        for (int m = 5; m >= 0; m--) {
            LocalDate monthStart = today.minusMonths(m).withDayOfMonth(1);
            LocalDate monthEnd = monthStart.plusMonths(1).minusDays(1);
            String billMonth = monthStart.format(monthFmt);
            for (Object[] u : users) {
                LocalDate inNet = ((java.sql.Date) u[7]).toLocalDate();
                LocalDate outNet = u[8] == null ? null : ((java.sql.Date) u[8]).toLocalDate();
                if (inNet.isAfter(monthEnd) || (outNet != null && outNet.isBefore(monthStart))) continue;
                int pkgIdx = Integer.parseInt((String) u[6]) - 1;
                String pkgType = packages[pkgIdx][1];
                BigDecimal pkgFee = new BigDecimal(packages[pkgIdx][2]);
                BigDecimal broadbandFee = "宽带".equals(pkgType) || "融合".equals(pkgType)
                        ? pkgFee.multiply(new BigDecimal("0.6")).setScale(2, RoundingMode.HALF_UP)
                        : BigDecimal.ZERO;
                BigDecimal voiceFee = ("移动".equals(pkgType) || "融合".equals(pkgType)
                        ? BigDecimal.TEN.add(BigDecimal.valueOf(r.nextInt(250) / 10.0))
                        : BigDecimal.valueOf(r.nextInt(20) / 10.0)).setScale(2, RoundingMode.HALF_UP);
                BigDecimal dataFee = BigDecimal.valueOf(50 + r.nextInt(200) / 10.0).setScale(2, RoundingMode.HALF_UP);
                BigDecimal overage = BigDecimal.valueOf(r.nextInt(150) / 10.0).setScale(2, RoundingMode.HALF_UP);
                BigDecimal total = voiceFee.add(dataFee).add(broadbandFee).add(overage);
                String payStatus = r.nextDouble() < 0.93 ? "已缴" : "未缴";
                bills.add(new Object[]{u[0], billMonth, total, voiceFee, dataFee, broadbandFee, payStatus});
            }
        }
        jdbc.batchUpdate("INSERT INTO op_bill (user_id, bill_month, total_fee, voice_fee, data_fee, broadband_fee, pay_status) "
                + "VALUES (?,?,?,?,?,?,?)", bills);

        String[] complaintTypes = {"网络质量", "网络质量", "网络质量", "资费争议", "资费争议", "装维服务", "装维服务", "业务办理"};
        String[] channels = {"10010热线", "10010热线", "10010热线", "掌上营业厅", "掌上营业厅", "营业厅"};
        List<Object[]> complaints = new ArrayList<>();
        for (int i = 0; i < 90; i++) {
            Object[] u = users.get(r.nextInt(users.size()));
            LocalDate created = today.minusDays(1 + r.nextInt(180));
            boolean done = r.nextDouble() < 0.8;
            complaints.add(new Object[]{u[0], complaintTypes[r.nextInt(complaintTypes.length)],
                    channels[r.nextInt(channels.length)], done ? "已完成" : "处理中",
                    java.sql.Date.valueOf(created), done ? 2 + r.nextInt(70) : 0, u[2], u[3]});
        }
        jdbc.batchUpdate("INSERT INTO op_complaint (user_id, complaint_type, channel, status, created_date, handle_hours, city, county) "
                + "VALUES (?,?,?,?,?,?,?,?)", complaints);
    }

    private OntologyGroup ensureGroup() {
        return groupRepository.findByName(GROUP_NAME).orElseGet(() -> {
            OntologyGroup g = new OntologyGroup();
            g.setName(GROUP_NAME);
            g.setDisplayName(GROUP_DISPLAY);
            g.setDescription("运营商行业语义：用户 / 套餐 / 月账单 / 投诉工单 + 核心指标（出账收入、投诉量、新增用户数、宽带用户数）。标准层随平台交付，映射经自动绑定对接各省业务库");
            g.setIsSystem(true);
            g.setSortOrder(-90);
            return groupRepository.save(g);
        });
    }

    private Concept ensureConcept(Long groupId, String name, String description, String conceptType,
            String unit, String timestampColumn, List<Long> newConceptIds) {
        Optional<Concept> existing = conceptRepository.findByName(name).stream().findFirst();
        if (existing.isPresent()) return existing.get();
        Concept c = new Concept();
        c.setName(name);
        c.setGroupId(groupId);
        c.setDescription(description);
        c.setConceptType(conceptType);
        if (unit != null) c.setUnit(unit);
        if (timestampColumn != null) c.setTimestampColumn(timestampColumn);
        Concept saved = conceptRepository.save(c);
        if (newConceptIds != null) newConceptIds.add(saved.getId());
        return saved;
    }

    private void ensureRelation(Long sourceId, Long targetId, String relationType, String description) {
        boolean exists = !conceptRelationRepository
                .findBySourceConceptIdAndTargetConceptIdAndRelationType(sourceId, targetId, relationType)
                .isEmpty();
        if (exists) return;
        ConceptRelation rel = new ConceptRelation();
        rel.setSourceConceptId(sourceId);
        rel.setTargetConceptId(targetId);
        rel.setRelationType(relationType);
        rel.setDescription(description);
        conceptRelationRepository.save(rel);
    }

    private void ensureMapping(Concept concept, Long dsId, String table, String column, String attribute) {
        boolean exists = !conceptMappingRepository
                .findByConceptIdAndColumnNameAndDatasourceId(concept.getId(), column, dsId).isEmpty();
        if (exists) return;
        ConceptMapping m = new ConceptMapping();
        m.setConceptId(concept.getId());
        m.setDatasourceId(dsId);
        m.setTableName(table);
        m.setColumnName(column);
        m.setAttributeName(attribute);
        m.setMappingType("direct");
        m.setIsAuto(false);
        m.setIsRequired(false);
        conceptMappingRepository.save(m);
    }

    private void ensureJoin(Concept concept, Long dsId, String targetConceptName, String joinTable,
            String joinCondition, String description) {
        boolean exists = conceptJoinMappingRepository.findByConceptId(concept.getId()).stream()
                .anyMatch(j -> dsId.equals(j.getDatasourceId())
                        && joinCondition.equals(j.getJoinCondition())
                        && targetConceptName.equals(j.getTargetConcept()));
        if (exists) return;
        ConceptJoinMapping j = new ConceptJoinMapping();
        j.setConceptId(concept.getId());
        j.setDatasourceId(dsId);
        j.setTargetConcept(targetConceptName);
        j.setRelationType("JOIN");
        j.setJoinTable(joinTable);
        j.setJoinCondition(joinCondition);
        j.setJoinType("LEFT");
        j.setConfidence(BigDecimal.ONE);
        conceptJoinMappingRepository.save(j);
    }

    /** 运营商方言词典：问数 prompt 注入，把口语说法对齐到概念口径（只写业务语义，不写表名） */
    private void ensureSynonymDict(Long dsId) {
        var profile = bindingProfileService.ensureProfile(dsId);
        if (profile.getSynonymDict() != null && !profile.getSynonymDict().isBlank()) return;
        try {
            List<Map<String, Object>> dict = List.of(
                    Map.of("term", "用户", "conceptName", "OpUser",
                            "synonyms", List.of("客户", "手机用户", "在网用户", "号码", "机主", "用户数"),
                            "note", "一行一个用户，姓名/手机号是用户属性"),
                    Map.of("term", "套餐", "conceptName", "OpPackage",
                            "synonyms", List.of("资费", "资费套餐", "档位", "资费档位"),
                            "note", "用户当前套餐"),
                    Map.of("term", "投诉", "conceptName", "OpComplaint",
                            "synonyms", List.of("客诉", "申诉", "工单", "抱怨"),
                            "note", "投诉量按受理时间计数"),
                    Map.of("term", "出账收入", "conceptName", "出账收入",
                            "synonyms", List.of("收入", "营收", "出账", "计费收入", "收入完成"),
                            "note", "月账单出账费用合计，按账期归属"),
                    Map.of("term", "新增用户", "conceptName", "新增用户数",
                            "synonyms", List.of("新入网", "新发展用户", "拉新", "入网用户"),
                            "note", "入网时间落在统计周期内的用户计数"),
                    Map.of("term", "离网", "conceptName", "OpUser",
                            "synonyms", List.of("拆机", "销户", "流失", "携出"),
                            "note", "在网状态=离网；携号转出也按离网口径"),
                    Map.of("term", "地市", "conceptName", "OpUser",
                            "synonyms", List.of("城市", "分公司"),
                            "note", "地市/区县是用户属性"),
                    Map.of("term", "携转",
                            "note", "演示库未单独建模携转字段；携入视为新增（入网时间），携出视为离网（在网状态=离网）"));
            profile.setSynonymDict(objectMapper.writeValueAsString(dict));
            bindingProfileService.update(profile.getId(), profile);
        } catch (Exception e) {
            log.warn("运营商语义术语词典写入失败: {}", e.getMessage());
        }
    }
}
