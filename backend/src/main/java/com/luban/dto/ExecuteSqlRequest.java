package com.luban.dto;

import lombok.Data;

@Data
public class ExecuteSqlRequest {
    private Long datasourceId;
    private String sql;
    private Boolean multi;
    private Boolean allowDdl;
    /**
     * 测试回滚模式：语句在事务中执行后回滚而非提交——验证写 SQL 效果（如触发器回写、
     * 状态守卫）而不污染数据。rollback=true 时强制走事务批量路径（单条也如此）。
     */
    private Boolean rollback;
}