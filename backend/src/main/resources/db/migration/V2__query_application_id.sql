-- 将 Query 从页面级改为应用级
-- 参考: doc/需求文档/多智能体群聊设计.md 七-附二

-- 1. 添加 application_id 列（先允许 NULL）
ALTER TABLE queries ADD COLUMN application_id BIGINT;

-- 2. 从 pages 表回填 application_id
UPDATE queries q
JOIN pages p ON q.page_id = p.id
SET q.application_id = p.application_id;

-- 3. 设置 NOT NULL 约束
ALTER TABLE queries MODIFY COLUMN application_id BIGINT NOT NULL;

-- 4. 删除旧的 page_id 列
ALTER TABLE queries DROP COLUMN page_id;