-- ============================================================
-- 清理本体相关历史数据
-- 保留：行业(industry)、领域(ontology_group)、数据源(datasources)、
--       工具(tool_definition/tool_group)、用户(users)等基础配置
-- 清理：所有概念、关系、映射、快照、反馈、日志及行业关系类型
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- 1. 概念嵌入任务
DELETE FROM concept_embedding_task;
ALTER TABLE concept_embedding_task AUTO_INCREMENT = 1;

-- 2. 概念反馈
DELETE FROM concept_feedback;
ALTER TABLE concept_feedback AUTO_INCREMENT = 1;

-- 3. 概念快照
DELETE FROM concept_snapshot;
ALTER TABLE concept_snapshot AUTO_INCREMENT = 1;

-- 4. 概念工具绑定
DELETE FROM concept_tool_binding;
ALTER TABLE concept_tool_binding AUTO_INCREMENT = 1;

-- 5. 概念导入日志
DELETE FROM concept_import_log;
ALTER TABLE concept_import_log AUTO_INCREMENT = 1;

-- 6. 本体变更日志
DELETE FROM ontology_change_log;
ALTER TABLE ontology_change_log AUTO_INCREMENT = 1;

-- 7. 工具概念关联
DELETE FROM tool_concept;
ALTER TABLE tool_concept AUTO_INCREMENT = 1;

-- 8. 概念表连接映射
DELETE FROM concept_join_mapping;
ALTER TABLE concept_join_mapping AUTO_INCREMENT = 1;

-- 9. 概念映射
DELETE FROM concept_mapping;
ALTER TABLE concept_mapping AUTO_INCREMENT = 1;

-- 10. 概念间关系
DELETE FROM concept_relation;
ALTER TABLE concept_relation AUTO_INCREMENT = 1;

-- 11. 概念
DELETE FROM concept;
ALTER TABLE concept AUTO_INCREMENT = 1;

-- 12. 行业关系类型（配置的关系）
DELETE FROM industry_relation;
ALTER TABLE industry_relation AUTO_INCREMENT = 1;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 验证：以下查询应全部返回 0
-- ============================================================
SELECT 'concept_embedding_task' AS tbl, COUNT(*) AS cnt FROM concept_embedding_task
UNION ALL
SELECT 'concept_feedback', COUNT(*) FROM concept_feedback
UNION ALL
SELECT 'concept_snapshot', COUNT(*) FROM concept_snapshot
UNION ALL
SELECT 'concept_tool_binding', COUNT(*) FROM concept_tool_binding
UNION ALL
SELECT 'concept_import_log', COUNT(*) FROM concept_import_log
UNION ALL
SELECT 'ontology_change_log', COUNT(*) FROM ontology_change_log
UNION ALL
SELECT 'tool_concept', COUNT(*) FROM tool_concept
UNION ALL
SELECT 'concept_join_mapping', COUNT(*) FROM concept_join_mapping
UNION ALL
SELECT 'concept_mapping', COUNT(*) FROM concept_mapping
UNION ALL
SELECT 'concept_relation', COUNT(*) FROM concept_relation
UNION ALL
SELECT 'concept', COUNT(*) FROM concept
UNION ALL
SELECT 'industry_relation', COUNT(*) FROM industry_relation;