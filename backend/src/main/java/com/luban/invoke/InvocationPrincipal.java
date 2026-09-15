package com.luban.invoke;

import lombok.Value;

/**
 * 调用者身份。内部触发（编排节点/流程触发器）携带"代表谁"的用户身份（on-behalf-of），
 * 供目标服务做数据级过滤，但运行时授权依据是发布固化的目标清单而非该用户的动态权限。
 */
@Value
public class InvocationPrincipal {

    public enum Kind { USER, API_KEY, SYSTEM }

    Kind kind;
    /** USER：用户 id；SYSTEM：被代表的用户 id（可为 null） */
    Long userId;
    /** API_KEY：key id */
    Long apiKeyId;

    public static InvocationPrincipal ofUser(Long userId) {
        return new InvocationPrincipal(Kind.USER, userId, null);
    }

    public static InvocationPrincipal ofApiKey(Long apiKeyId) {
        return new InvocationPrincipal(Kind.API_KEY, null, apiKeyId);
    }

    /** 系统身份，代表指定用户执行（可传 null 表示纯系统） */
    public static InvocationPrincipal onBehalfOf(Long userId) {
        return new InvocationPrincipal(Kind.SYSTEM, userId, null);
    }
}
