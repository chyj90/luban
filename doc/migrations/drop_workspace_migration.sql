-- ============================================================
-- 迁移：取消 workspace 概念，Application 直接关联用户
-- 执行前请先备份数据库
-- ============================================================

-- 1. applications 表：添加 created_by，迁移数据，删除 workspace_id
ALTER TABLE applications ADD COLUMN created_by BIGINT;
UPDATE applications SET created_by = (
    SELECT w.owner_id FROM workspaces w WHERE w.id = applications.workspace_id
);
ALTER TABLE applications MODIFY COLUMN created_by BIGINT NOT NULL;
ALTER TABLE applications DROP COLUMN workspace_id;

-- 2. workflow_roles 表：workspace_id → application_id
ALTER TABLE workflow_roles ADD COLUMN application_id BIGINT;
UPDATE workflow_roles SET application_id = 1;
ALTER TABLE workflow_roles MODIFY COLUMN application_id BIGINT NOT NULL;
ALTER TABLE workflow_roles DROP COLUMN workspace_id;

-- 3. 删除 workspaces 表
DROP TABLE IF EXISTS workspaces;