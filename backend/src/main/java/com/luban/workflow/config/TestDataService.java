package com.luban.workflow.config;

import com.luban.entity.User;
import com.luban.repository.UserRepository;
import com.luban.workflow.entity.Department;
import com.luban.workflow.entity.Member;
import com.luban.workflow.entity.Role;
import com.luban.workflow.repository.DepartmentRepository;
import com.luban.workflow.repository.MemberRepository;
import com.luban.workflow.repository.RoleRepository;
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
    private final UserRepository userRepository;

    @Transactional
    public void ensureGlobalOrgData() {
        List<Member> existing = memberRepository.findAll();
        if (!existing.isEmpty()) {
            boolean allExist = List.of("周九", "张三", "李四", "赵六", "王五", "孙七", "钱八").stream()
                    .allMatch(name -> existing.stream().anyMatch(m -> name.equals(m.getName())));
            if (allExist) {
                return;
            }
            log.info("检测到成员数据不完整，补齐缺失成员...");
        }

        log.info("初始化全局测试组织数据（部门、成员）...");

        Department deptExecutive = getOrCreateDepartment("总经办");
        Department deptTech = getOrCreateDepartment("技术部");
        Department deptFinance = getOrCreateDepartment("财务部");
        Department deptHr = getOrCreateDepartment("人事部");

        Member zhou = getOrCreateMember("周九", "zhou@luban.local", "13800007777", deptExecutive.getId(), "CEO", "E001", null);
        Member zhang = getOrCreateMember("张三", "zhang@luban.local", "13800001111", deptTech.getId(), "技术总监", "T001", zhou.getId());
        Member li = getOrCreateMember("李四", "li@luban.local", "13800002222", deptFinance.getId(), "财务经理", "F001", zhou.getId());
        Member zhao = getOrCreateMember("赵六", "zhao@luban.local", "13800004444", deptHr.getId(), "HR 总监", "H001", zhou.getId());
        getOrCreateMember("王五", "wang@luban.local", "13800003333", deptTech.getId(), "高级工程师", "T002", zhang.getId());
        getOrCreateMember("孙七", "sun@luban.local", "13800005555", deptFinance.getId(), "会计", "F002", li.getId());
        getOrCreateMember("钱八", "qian@luban.local", "13800006666", deptHr.getId(), "HR 专员", "H002", zhao.getId());

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

        ensureGlobalOrgData();
        List<Member> members = memberRepository.findAll();

        Member li = findMember(members, "李四");
        Member sun = findMember(members, "孙七");
        Member zhao = findMember(members, "赵六");
        Member qian = findMember(members, "钱八");
        Member zhou = findMember(members, "周九");
        Member zhang = findMember(members, "张三");

        createRole("财务审批组", "role_finance", applicationId);
        createRole("HR 审批组", "role_hr", applicationId);
        createRole("高管审批组", "role_executive", applicationId);
        createRole("部门负责人", "role_dept_manager", applicationId);

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

    private Department getOrCreateDepartment(String name) {
        return departmentRepository.findAll().stream()
                .filter(d -> name.equals(d.getName()))
                .findFirst()
                .orElseGet(() -> createDepartment(name, null, null));
    }

    private Member getOrCreateMember(String name, String email, String mobile,
                                      Long departmentId, String position, String employeeNo, Long leaderId) {
        return memberRepository.findAll().stream()
                .filter(m -> name.equals(m.getName()))
                .findFirst()
                .orElseGet(() -> createMember(name, email, mobile, departmentId, position, employeeNo, leaderId));
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

    private Role createRole(String name, String slug, Long applicationId) {
        Role role = new Role();
        role.setName(name);
        role.setSlug(slug + "_" + applicationId);
        role.setApplicationId(applicationId);
        role.setScope("APPLICATION");
        userRepository.findFirstByOrderByIdAsc().ifPresent(u -> role.setCreatedBy(u.getId()));
        return roleRepository.save(role);
    }
}