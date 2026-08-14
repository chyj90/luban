package com.luban.workflow.config;

import com.luban.workflow.entity.Department;
import com.luban.workflow.entity.Member;
import com.luban.workflow.entity.Role;
import com.luban.workflow.repository.DepartmentRepository;
import com.luban.workflow.repository.MemberRepository;
import com.luban.workflow.repository.RoleRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;
import java.util.List;

@Slf4j
@Component
@RequiredArgsConstructor
public class DataInitializer implements CommandLineRunner {

    private final MemberRepository memberRepository;
    private final DepartmentRepository departmentRepository;
    private final RoleRepository roleRepository;

    @Override
    public void run(String... args) {
        if (memberRepository.count() > 0) {
            log.info("工作流组织数据已存在，跳过初始化");
            return;
        }

        log.info("初始化工作流测试组织数据...");

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

        createRole("财务审批组", "role_finance", List.of(li.getId(), sun.getId()));
        createRole("HR 审批组", "role_hr", List.of(zhao.getId(), qian.getId()));
        createRole("高管审批组", "role_executive", List.of(zhou.getId()));
        createRole("部门负责人", "role_dept_manager", List.of(zhang.getId(), li.getId(), zhao.getId(), zhou.getId()));

        log.info("工作流测试组织数据初始化完成: {} 部门, {} 成员, {} 角色",
                departmentRepository.count(), memberRepository.count(), roleRepository.count());
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

    private Role createRole(String name, String slug, List<Long> memberIds) {
        Role role = new Role();
        role.setName(name);
        role.setSlug(slug);
        role.setWorkspaceId(1L);
        try {
            role.setMemberIds(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(memberIds));
        } catch (Exception e) {
            role.setMemberIds("[]");
        }
        return roleRepository.save(role);
    }
}