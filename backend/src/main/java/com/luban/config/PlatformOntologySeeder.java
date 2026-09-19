package com.luban.config;

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
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 平台自身语义包（内置本体三来源之一）：组织 / 人员 / 部门。
 *
 * 平台是自己的第一个数据源——users / user_dept / departments 是身份单一事实源
 * （业务表只存 user_id，姓名/部门运行时解析），这套概念任何接入的企业都用得上：
 * - 数据底座：幂等注册 PLATFORM 数据源「平台系统库」，指向平台自身库；
 * - 概念与绑定：平台用户 / 平台部门 / 用户部门关系 + 全部字段映射 + 预定义 JOIN；
 * - 术语词典：用户/部门/领导/我的 的方言对照挂在绑定集上，问数 prompt 注入；
 * - 运行时身份由 ContextBuilder 注入当前登录用户（this.auth 的语义侧），种子不携带任何具体用户。
 */
@Slf4j
@Component
@Order(100)
@RequiredArgsConstructor
public class PlatformOntologySeeder implements CommandLineRunner {

    private static final String GROUP_NAME = "platform_semantics";
    private static final String GROUP_DISPLAY = "平台语义";

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
    @Transactional
    public void run(String... args) {
        try {
            Datasource ds = datasourceService.ensurePlatformSystemDatasource();
            Long dsId = ds.getId();

            OntologyGroup group = ensureGroup();

            List<Long> newConceptIds = new ArrayList<>();
            Concept platformUser = ensureConcept(group.getId(), "PlatformUser",
                    "平台用户（登录账号）。业务表只存 user_id，姓名/账号/部门等身份字段运行时经本概念解析，业务表禁止冗余姓名等身份列。"
                            + "字段：账号 account、姓名 name、邮箱 email、工号 employee_no、手机号 mobile、职位 position、状态 status。",
                    "ENTITY", null, newConceptIds);
            Concept platformDept = ensureConcept(group.getId(), "PlatformDepartment",
                    "平台部门（组织单元）。departments 表 parent_id 自引用构成部门树；departments.manager_id 为部门主管用户ID。"
                            + "用户与部门的多对多归属在 UserDeptRelation。",
                    "DIMENSION", null, newConceptIds);
            Concept userDept = ensureConcept(group.getId(), "UserDeptRelation",
                    "用户与部门的归属关系（多对多）。user_dept.user_id 关联平台用户、department_id 关联部门、is_primary 标记主部门、"
                            + "leader_id 为直属领导用户ID（审批链从该字段与 departments.manager_id 解析，业务表禁止自建 leader_id）。",
                    "ENTITY", null, newConceptIds);

            ensureRelation(platformUser.getId(), userDept.getId(), "CORRELATED", "用户与其部门归属记录，双向对称");
            ensureRelation(userDept.getId(), platformDept.getId(), "CORRELATED", "部门归属记录与部门，双向对称");

            ensureMapping(platformUser, dsId, "users", "account", "账号");
            ensureMapping(platformUser, dsId, "users", "name", "姓名");
            ensureMapping(platformUser, dsId, "users", "email", "邮箱");
            ensureMapping(platformUser, dsId, "users", "employee_no", "工号");
            ensureMapping(platformUser, dsId, "users", "mobile", "手机号");
            ensureMapping(platformUser, dsId, "users", "position", "职位");
            ensureMapping(platformUser, dsId, "users", "status", "状态");
            ensureMapping(platformDept, dsId, "departments", "name", "部门名称");
            ensureMapping(platformDept, dsId, "departments", "parent_id", "上级部门ID");
            ensureMapping(platformDept, dsId, "departments", "manager_id", "部门主管用户ID");
            ensureMapping(platformDept, dsId, "departments", "external_id", "外部系统部门ID");
            ensureMapping(userDept, dsId, "user_dept", "user_id", "用户ID");
            ensureMapping(userDept, dsId, "user_dept", "department_id", "部门ID");
            ensureMapping(userDept, dsId, "user_dept", "department_name", "部门名称");
            ensureMapping(userDept, dsId, "user_dept", "is_primary", "是否主部门");
            ensureMapping(userDept, dsId, "user_dept", "leader_id", "直属领导用户ID");

            ensureJoin(platformUser, dsId, "UserDeptRelation", "user_dept",
                    "users.id = user_dept.user_id", "用户与其部门归属");
            ensureJoin(userDept, dsId, "PlatformDepartment", "departments",
                    "user_dept.department_id = departments.id", "部门归属与部门");

            ensureSynonymDict(dsId);

            if (!newConceptIds.isEmpty()) {
                conceptEmbeddingService.scheduleEmbeddingAfterCommit(newConceptIds, false);
            }
            log.info("平台语义包就绪：数据源「{}」({})，概念 {} 个", DatasourceService.PLATFORM_DS_NAME, dsId,
                    conceptRepository.findAll().stream().filter(c -> c.getGroupId() != null && c.getGroupId().equals(group.getId())).count());
        } catch (Exception e) {
            log.error("平台语义包初始化失败（不阻断启动）: {}", e.getMessage(), e);
        }
    }

    private OntologyGroup ensureGroup() {
        return groupRepository.findByName(GROUP_NAME).orElseGet(() -> {
            OntologyGroup g = new OntologyGroup();
            g.setName(GROUP_NAME);
            g.setDisplayName(GROUP_DISPLAY);
            g.setDescription("平台自身语义：组织 / 人员 / 部门，身份单一事实源（业务表只存 user_id）");
            g.setIsSystem(true);
            g.setSortOrder(-100);
            return groupRepository.save(g);
        });
    }

    private Concept ensureConcept(Long groupId, String name, String description, String conceptType,
            String unit, List<Long> newConceptIds) {
        Optional<Concept> existing = conceptRepository.findByName(name).stream().findFirst();
        if (existing.isPresent()) return existing.get();
        Concept c = new Concept();
        c.setName(name);
        c.setGroupId(groupId);
        c.setDescription(description);
        c.setConceptType(conceptType);
        if (unit != null) c.setUnit(unit);
        Concept saved = conceptRepository.save(c);
        newConceptIds.add(saved.getId());
        return saved;
    }

    private void ensureRelation(Long sourceId, Long targetId, String relationType, String description) {
        boolean exists = conceptRelationRepository
                .findBySourceConceptIdAndTargetConceptIdAndRelationType(sourceId, targetId, relationType)
                .isEmpty() == false;
        if (exists) return;
        ConceptRelation r = new ConceptRelation();
        r.setSourceConceptId(sourceId);
        r.setTargetConceptId(targetId);
        r.setRelationType(relationType);
        r.setDescription(description);
        conceptRelationRepository.save(r);
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
        j.setConfidence(java.math.BigDecimal.ONE);
        conceptJoinMappingRepository.save(j);
    }

    private void ensureSynonymDict(Long dsId) {
        var profile = bindingProfileService.ensureProfile(dsId);
        if (profile.getSynonymDict() != null && !profile.getSynonymDict().isBlank()) return;
        try {
            List<Map<String, Object>> dict = List.of(
                    Map.of("term", "用户", "conceptName", "PlatformUser",
                            "synonyms", List.of("人员", "员工", "账号", "成员", "同事"),
                            "note", "业务表只存 user_id，姓名/账号经平台用户表解析"),
                    Map.of("term", "部门", "conceptName", "PlatformDepartment",
                            "synonyms", List.of("组织", "组织单元", "团队", "科室"),
                            "note", "departments.parent_id 自引用构成部门树"),
                    Map.of("term", "直属领导", "conceptName", "UserDeptRelation",
                            "synonyms", List.of("上级", "领导", "主管"),
                            "note", "user_dept.leader_id 为直属领导；departments.manager_id 为部门主管"),
                    Map.of("term", "我的", "note", "运行时已注入当前用户身份，业务表用 user_id 过滤，无需查询用户表反查"));
            profile.setSynonymDict(objectMapper.writeValueAsString(dict));
            bindingProfileService.update(profile.getId(), profile);
        } catch (Exception e) {
            log.warn("平台语义术语词典写入失败: {}", e.getMessage());
        }
    }
}
