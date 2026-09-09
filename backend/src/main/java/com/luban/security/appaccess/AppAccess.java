package com.luban.security.appaccess;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 应用级访问控制声明（由 AppAccessInterceptor 统一强制执行）。
 *
 * 使用方式（三选一）：
 * <pre>
 * // 1. 直接从参数取 applicationId（param=查询参数 / path=路径变量 / body=JSON 字段）
 * {@code @AppAccess(action = AppAction.DEVELOP, from = AppAccess.Source.BODY, key = "applicationId")}
 *
 * // 2. 通过资源类型间接解析：resource 对应一个 AppResourceResolver bean，id 从 path/query/body 中按 key 取
 * {@code @AppAccess(action = AppAction.DEVELOP, resource = "query", key = "id")}
 *
 * // 3. resource + key 均为空：拦截器按默认规则解析（applicationId 参数/路径/请求体），写操作默认要求 DEVELOP
 * {@code @AppAccess(action = AppAction.DEVELOP)}
 * </pre>
 * key 未填时默认 "id"（资源方式）或 "applicationId"（直接方式）。
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface AppAccess {

    AppAction action();

    enum Source { AUTO, PARAM, PATH, BODY }

    /** 直接取 applicationId 的来源；AUTO 时按 path → param → body 顺序尝试 key */
    Source from() default Source.AUTO;

    /** 参数/字段名：直接方式默认 applicationId；资源方式默认 id */
    String key() default "";

    /** 资源类型，对应 AppResourceResolver#resourceType()，如 "query"、"page"、"process"、"instance"、"datasource" */
    String resource() default "";

    /** 资源 id 值：true=值为资源 id（经 resolver 解析应用）；false=值就是 applicationId */
    boolean asResource() default true;
}
