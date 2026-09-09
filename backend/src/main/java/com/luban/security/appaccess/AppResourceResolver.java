package com.luban.security.appaccess;

/**
 * 资源 → 应用 的解析器。新增一种可按应用归属鉴权的资源时，实现本接口并注册为
 * Spring Bean 即可，授权框架无需改动——这是本方案的可扩展点。
 */
public interface AppResourceResolver {

/** 资源类型标识，与 {@link AppAccess#resource()} 对应，如 "query"、"page" */
String resourceType();

/**
 * 解析资源所属的应用 ID。
 * - 应用级资源：返回资源所属应用 ID（拦截器按 AppAction 校验）；
 * - 平台级共享资源（如 PLATFORM 数据源）：返回 null，并实现 {@link #platformPermission()}
 *   声明所需平台权限，拦截器据此放行平台权限持有者；
 * - 资源不存在：返回 null 且 {@link #platformPermission()} 也为 null → 拦截器统一 404。
 */
Long applicationIdOf(Long resourceId);

/**
 * 资源是否存在。默认等于 applicationIdOf != null；用户级/平台级资源（applicationIdOf 恒 null）
 * 必须覆写（如数据源用 existsById），否则"不存在"会被误判为平台级资源。
 */
default boolean resourceExists(Long resourceId) { return applicationIdOf(resourceId) != null; }

/**
 * 平台级资源的访问所需平台权限（如 "connect:systems"）；非平台级资源返回 null。
 *
 * 三态语义（拦截器按此处理）：
 * - 应用级资源 → applicationIdOf 非空，走应用访问控制；
 * - 平台级资源且本动作需要平台权限 → 返回权限键，拦截器 assertPlatformPermission；
 * - 平台级资源且本动作由服务层自行兜底（如流程发起的 canSubmitWorkflow）→ 返回 null，拦截器放行。
 */
default String platformPermission(AppAction action) { return null; }
}
