/**
 * Concept Skills（概念语义层技能）
 *
 * 让开发智能体复用平台的概念图谱：概念是"一个平台一套"的语义事实源，
 * 应用查询与智能问数共用同一套概念→表/列映射，避免两套口径各自漂移。
 */

import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { listConcepts, getConcept, getConceptTree, listConceptMappings, listConceptJoinMappings, generateNl2Sql, proposeOntologyChanges } from '@/api/concept';

export const conceptSkills: Record<string, SkillFactory> = {
  'concept:search': () => ({
    id: 'concept:search',
    category: SkillCategory.CONCEPT,
    name: 'search_concepts',
    description: `按关键词搜索平台概念图谱中的概念（返回概念 ID/名称/所属概念域）。写 SELECT 查询前先用它确认业务对象是否已有概念建模——有概念就必须走概念口径生成 SQL，与智能问数共用同一套语义，禁止绕过概念直接裸写口径。`,
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '概念名称关键词，如"客户""请假""订单"' },
        groupId: { type: 'number', description: '限定概念域 ID（可选）' },
      },
    },
    async execute(args) {
      const res = await listConcepts(args.groupId as number | undefined, args.keyword as string | undefined);
      const data = res.data.map((c) => ({
        conceptId: c.id,
        conceptName: c.name,
        groupId: c.groupId,
        description: c.description || '',
      }));
      return { success: true, message: `匹配到 ${data.length} 个概念`, data };
    },
  }),

  'concept:detail': () => ({
    id: 'concept:detail',
    category: SkillCategory.CONCEPT,
    name: 'get_concept_detail',
    description: `获取概念详情：属性、到物理表/列的映射（tableName/columnName）、概念间关系与 JOIN 映射。用于确认概念的物理落表和可用字段，再决定 SQL 怎么写。`,
    parameters: {
      type: 'object',
      properties: {
        conceptId: { type: 'number', description: '概念 ID' },
      },
      required: ['conceptId'],
    },
    async execute(args) {
      const conceptId = args.conceptId as number;
      const [detail, mappings, joins] = await Promise.all([
        getConcept(conceptId),
        listConceptMappings(conceptId).catch(() => ({ data: [] })),
        listConceptJoinMappings(conceptId).catch(() => ({ data: [] })),
      ]);
      const data = {
        concept: detail.data,
        mappings: mappings.data,
        joinMappings: joins.data,
      };
      return {
        success: true,
        message: `概念「${detail.data.name}」共 ${mappings.data.length} 条字段映射、${joins.data.length} 条 JOIN 映射`,
        data,
      };
    },
  }),

  'concept:tree': () => ({
    id: 'concept:tree',
    category: SkillCategory.CONCEPT,
    name: 'get_concept_tree',
    description: `获取指定概念域的概念树（层级结构）。用于了解某业务域（如人事域、销售域）里有哪些概念、父子层级如何组织。`,
    parameters: {
      type: 'object',
      properties: {
        groupId: { type: 'number', description: '概念域 ID' },
      },
      required: ['groupId'],
    },
    async execute(args) {
      const res = await getConceptTree(args.groupId as number);
      return { success: true, message: `概念树共 ${res.data.length} 个根节点`, data: res.data };
    },
  }),

  'concept:nl2sql': () => ({
    id: 'concept:nl2sql',
    category: SkillCategory.CONCEPT,
    name: 'nl2sql_generate',
    description: `按概念映射直拼基准 SQL：传入概念 ID 列表，平台把概念→表/列映射与概念间 JOIN 拼成 SELECT（与智能问数共用同一套概念映射）。**注意：模板只覆盖简单场景**（单表/预定义 JOIN/等值过滤），复杂聚合与计算口径请改用 get_concept_detail 拿映射后自写 SQL；最终统计口径以智能问数为准。生成后可把 SQL 作为查询 body，再按需补充 {{ this.params.xxx }} 参数绑定与动态标签。仅适用于 SELECT，写查询仍按表结构手写。`,
    parameters: {
      type: 'object',
      properties: {
        conceptIds: { type: 'array', items: { type: 'number' }, description: '概念 ID 列表（1 个即含该概念全部映射字段；多个概念时平台自动补概念间 JOIN）' },
        filters: { type: 'object', description: '可选过滤条件 { "属性名": "值" }' },
      },
      required: ['conceptIds'],
    },
    async execute(args) {
      const res = await generateNl2Sql({
        conceptIds: args.conceptIds as number[],
        filters: args.filters as Record<string, unknown> | undefined,
      });
      const d = res.data;
      const status = d.valid
        ? `生成成功（主表 ${d.mainTable}，${d.mappings.length} 个字段映射，${d.joins.length} 个 JOIN）`
        : `校验未通过：${(d.errors || []).join('；')}`;
      return {
        success: d.valid,
        message: `${status}\nSQL：\n${d.sql}\n字段映射：${d.mappings.map((m) => `${m.attributeName}→${m.tableName}.${m.columnName}`).join('、')}`,
        data: d,
      };
    },
  }),

  'concept:propose_change': () => ({
    id: 'concept:propose_change',
    category: SkillCategory.CONCEPT,
    name: 'propose_ontology_change',
    description: `把建模过程中发现的语义缺口（新建业务表缺概念/缺映射/缺关系）作为本体变更草稿提交到平台审批队列，与智能问数的本体变更走同一链路。草稿不会立即生效，需管理员在「建模中心 → 变更审核」中批准后由平台执行（执行时平台会校验表/列/概念是否真实存在，失败会标记 FAILED）。建完表/写入数据后，若该表对应的业务对象还没有概念或映射，用它提交草稿，并在汇报中告知用户需要管理员批准。`,
    parameters: {
      type: 'object',
      properties: {
        reasoning: { type: 'string', description: '为什么需要这批变更（如：新 建 t_after_service 表承接售后工单，缺概念与映射）' },
        changes: {
          type: 'array',
          description: '变更草稿数组。ADD_CONCEPT: { "operation": "ADD_CONCEPT", "concept": { "name": "AfterServiceOrder", "description": "售后工单", "groupName": "服务域", "conceptType": "ENTITY" } }；ADD_MAPPING: { "operation": "ADD_MAPPING", "mapping": { "conceptName": "AfterServiceOrder", "tableName": "t_after_service", "columnName": "order_no", "mappingType": "direct", "dataSourceId": 12 } }；ADD_RELATION: { "operation": "ADD_RELATION", "relation": { "sourceConceptName": "AfterServiceOrder", "targetConceptName": "Customer", "relationType": "CORRELATED", "description": "售后工单关联客户" } }',
          items: { type: 'object' },
        },
      },
      required: ['reasoning', 'changes'],
    },
    async execute(args) {
      const res = await proposeOntologyChanges({
        reasoning: args.reasoning as string,
        changes: args.changes as Array<Record<string, unknown>>,
      });
      const recorded = res.data.recorded as Array<{ changeId: string; operation: string; status: string }>;
      return {
        success: true,
        message: `已提交 ${recorded.length} 条本体变更草稿（${recorded.map((r) => r.operation).join('、')}），等待管理员在「变更审核」中批准后生效`,
        data: res.data,
      };
    },
  }),
};
