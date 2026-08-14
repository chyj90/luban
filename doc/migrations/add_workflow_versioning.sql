-- ============================================================
-- 迁移：流程定义版本化 + 实例标记
-- 依赖：drop_workspace_migration.sql 必须先执行
-- ============================================================

-- 1. workflow_definitions 加已发布版本关联
ALTER TABLE workflow_definitions ADD COLUMN published_version_id BIGINT NULL;

-- 2. workflow_instances 加测试标记和定义版本
ALTER TABLE workflow_instances ADD COLUMN is_test BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE workflow_instances ADD COLUMN definition_version INT NOT NULL DEFAULT 1;

-- 3. 已有数据迁移：已存在流程定义标记为 PUBLISHED v1
UPDATE workflow_definitions SET status = 'PUBLISHED', version = 1 WHERE status IS NULL;