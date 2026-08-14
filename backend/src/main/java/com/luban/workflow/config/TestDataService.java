package com.luban.workflow.config;

import com.luban.workflow.entity.Department;
import com.luban.workflow.entity.Member;
import com.luban.workflow.entity.Role;
import com.luban.workflow.repository.DepartmentRepository;
import com.luban.workflow.repository.MemberRepository;
import com.luban.workflow.repository.RoleRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class TestDataService {

    private final MemberRepository memberRepository;
    private final DepartmentRepository departmentRepository;
    private final RoleRepository roleRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Transactional
    public void ensureGlobalOrgData() {
        if (memberRepository.count() > 0) {
            return;
        }

        log.info("初始化全局测试组织数据（部门、成员）...");

        Department deptExecutive = createDepartment("总经办", null, null);
        Department deptTech = createDepartment("技术部", null, null);
        Department deptFinance = createDepartment("财务部", null, null);
        Department deptHr = createDepartment("人事部", null, null);

        Member zhou = createMember("周九", "zhou@luban.local", "13800007777", deptExecutive.getId(), "CEO", "E001", null);
        Member zhang = createMember("张三", "zhang@luban.local", "13800001111", deptTech.getId(), "技术总监", "T001", zhou.getId());
        Member li = createMember("李四", "li@luban.local", "13800002222", deptFinance.getId(), "财务经理", "F001", zhou.getId());
        Member zhao = createMember("赵六", "zhao@luban.local", "13800004444", deptHr.getId(), "HR 总监", "H001", zhou.getId());
        Member wang = createMember("王五", "wang@luban.local", "13800003333", deptTech.getId(), "高级工程师", "T002", zhang.getId());
        Member sun = createMember("孙七", "sun@luban.local", "13800005555", deptFinance.getId(), "会计", "F002", li.getId());
        Member qian = createMember("钱八", "qian@luban.local", "13800006666", deptHr.getId(), "HR 专员", "H002", zhao.getId());

        deptExecutive.setManagerId(zhou.getId());
        deptTech.setManagerId(zhang.getId());
        deptFinance.setManagerId(li.getId());
        deptHr.setManagerId(zhao.getId());
        departmentRepository.saveAll(List.of(deptExecutive, deptTech, deptFinance, deptHr));

        log.info("全局测试组织数据初始化完成: {} 部门, {} 成员",
                departmentRepository.count(), memberRepository.count());
    }

    @Transactional
    public void initApplicationRoles(Long applicationId) {
        List<Role> existing = roleRepository.findByApplicationId(applicationId);
        if (!existing.isEmpty()) {
            log.info("应用 {} 已有角色数据，跳过初始化", applicationId);
            return;
        }

        log.info("初始化应用 {} 的测试角色数据...", applicationId);

        List<Member> members = memberRepository.findAll();
        if (members.isEmpty()) {
            ensureGlobalOrgData();
            members = memberRepository.findAll();
        }

        Member li = findMember(members, "李四");
        Member sun = findMember(members, "孙七");
        Member zhao = findMember(members, "赵六");
        Member qian = findMember(members, "钱八");
        Member zhou = findMember(members, "周九");
        Member zhang = findMember(members, "张三");

        createRole("财务审批组", "role_finance", List.of(li.getId(), sun.getId()), applicationId);
        createRole("HR 审批组", "role_hr", List.of(zhao.getId(), qian.getId()), applicationId);
        createRole("高管审批组", "role_executive", List.of(zhou.getId()), applicationId);
        createRole("部门负责人", "role_dept_manager", List.of(zhang.getId(), li.getId(), zhao.getId(), zhou.getId()), applicationId);

        log.info("应用 {} 测试角色数据初始化完成: {} 角色", applicationId, roleRepository.count());
    }

    @Transactional
    public void resetApplicationRoles(Long applicationId) {
        List<Role> roles = roleRepository.findByApplicationId(applicationId);
        roleRepository.deleteAll(roles);
        initApplicationRoles(applicationId);
        log.info("应用 {} 测试角色数据已重置", applicationId);
    }

    private Member findMember(List<Member> members, String name) {
        return members.stream()
                .filter(m -> name.equals(m.getName()))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("测试成员不存在: " + name));
    }

    private Department createDepartment(String name, String path, String externalId) {
        Department dept = new Department();
        dept.setName(name);
        dept.setPath("/" + name);
        dept.setExternalId(externalId);
        dept.setProvider("local");
        dept.setOrderNum(0);
        return departmentRepository.save(dept);
    }

    private Member createMember(String name, String email, String mobile,
                                 Long departmentId, String position, String employeeNo, Long leaderId) {
        Member member = new Member();
        member.setName(name);
        member.setEmail(email);
        member.setMobile(mobile);
        member.setDepartmentId(departmentId);
        member.setDepartmentName(departmentRepository.findById(departmentId).map(Department::getName).orElse(""));
        member.setPosition(position);
        member.setEmployeeNo(employeeNo);
        member.setLeaderId(leaderId);
        member.setProvider("local");
        member.setStatus("ACTIVE");
        return memberRepository.save(member);
    }

    private Role createRole(String name, String slug, List<Long> memberIds, Long applicationId) {
        Role role = new Role();
        role.setName(name);
        role.setSlug(slug + "_" + applicationId);
        role.setApplicationId(applicationId);
        try {
            role.setMemberIds(objectMapper.writeValueAsString(memberIds));
        } catch (Exception e) {
            role.setMemberIds("[]");
        }
        return roleRepository.save(role);
    }
}