package com.luban.security.appaccess.resolvers;

import com.luban.entity.Application;
import com.luban.entity.Datasource;
import com.luban.entity.Page;
import com.luban.entity.Query;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.DatasourceRepository;
import com.luban.repository.PageRepository;
import com.luban.repository.QueryRepository;
import com.luban.security.appaccess.AppAction;
import com.luban.security.appaccess.AppResourceResolver;
import com.luban.workflow.repository.WorkflowDefinitionRepository;
import com.luban.workflow.repository.WorkflowInstanceRepository;
import org.springframework.stereotype.Component;

/**
 * 内置资源解析器：把 endpoint 操作的资源 id 映射到应用（或资源 owner）。
 * 新增资源类型时在同类中追加一个静态嵌套 @Component 即可，授权框架零改动。
 */
public final class StandardAppResolvers {

    private StandardAppResolvers() {}

    @Component
    public static class QueryResolver implements AppResourceResolver {
        private final QueryRepository repository;
        public QueryResolver(QueryRepository repository) { this.repository = repository; }
        @Override public String resourceType() { return "query"; }
        @Override public Long applicationIdOf(Long id) {
            return repository.findById(id).map(Query::getApplicationId).orElse(null);
        }
        @Override public boolean resourceExists(Long id) { return repository.existsById(id); }
    }

    @Component
    public static class PageResolver implements AppResourceResolver {
        private final PageRepository repository;
        public PageResolver(PageRepository repository) { this.repository = repository; }
        @Override public String resourceType() { return "page"; }
        @Override public Long applicationIdOf(Long id) {
            return repository.findById(id).map(Page::getApplicationId).orElse(null);
        }
        @Override public boolean resourceExists(Long id) { return repository.existsById(id); }
    }

    @Component
    public static class ApplicationResolver implements AppResourceResolver {
        private final ApplicationRepository repository;
        public ApplicationResolver(ApplicationRepository repository) { this.repository = repository; }
        @Override public String resourceType() { return "application"; }
        @Override public Long applicationIdOf(Long id) { return id; }
    }

    @Component
    public static class ProcessResolver implements AppResourceResolver {
        private final WorkflowDefinitionRepository repository;
        public ProcessResolver(WorkflowDefinitionRepository repository) { this.repository = repository; }
        @Override public String resourceType() { return "process"; }
        @Override public Long applicationIdOf(Long id) {
            return repository.findById(id).map(d -> d.getApplicationId()).orElse(null);
        }
        @Override public boolean resourceExists(Long id) { return repository.existsById(id); }
        /** 应用级流程走应用访问控制；平台级流程：发起由 canSubmitWorkflow 兜底，其余动作需应用开发平台权限 */
        @Override public String platformPermission(AppAction action) {
            return action == AppAction.RUN ? null : com.luban.constant.Permissions.APPS_READ;
        }
    }

    @Component
    public static class InstanceResolver implements AppResourceResolver {
        private final WorkflowInstanceRepository repository;
        public InstanceResolver(WorkflowInstanceRepository repository) { this.repository = repository; }
        @Override public String resourceType() { return "instance"; }
        @Override public Long applicationIdOf(Long id) {
            return repository.findById(id).map(i -> i.getApplicationId()).orElse(null);
        }
        @Override public boolean resourceExists(Long id) { return repository.existsById(id); }
        @Override public String platformPermission(AppAction action) {
            return com.luban.constant.Permissions.APPS_READ;
        }
    }

    /**
     * 数据源领域模型：slug/scope 承担 scope 语义——APPLICATION 时 ownerId 存的是应用 id
     * （按应用访问控制）；PLATFORM 时 ownerId 为平台组 id（非应用），维护操作走平台权限
     * connect:systems，避免平台级资源被统一 404 挡死。
     */
    @Component
    public static class DatasourceResolver implements AppResourceResolver {
        private final DatasourceRepository repository;
        public DatasourceResolver(DatasourceRepository repository) { this.repository = repository; }
        @Override public String resourceType() { return "datasource"; }
        @Override public Long applicationIdOf(Long id) {
            return repository.findById(id)
                    .filter(ds -> "APPLICATION".equals(ds.getEffectiveScope()))
                    .map(Datasource::getOwnerId)
                    .orElse(null);
        }
        @Override public String platformPermission(AppAction action) {
            return com.luban.constant.Permissions.CONNECT_SYSTEMS;
        }
        @Override public boolean resourceExists(Long id) {
            return repository.existsById(id);
        }
    }
}