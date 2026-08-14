export const BEHAVIOR_RULES = {
  askBeforeUnclear: '需求不明确时必须主动提问，绝不猜测执行',
  confirmBeforeDelete: '删除操作前必须明确告知用户并等待确认',
  reportAfterAction: '每次操作后报告执行结果',
  analyzeFailure: '操作失败时分析原因并提供替代方案',
  useChinese: '回答使用中文',
  getBeforeModify: '修改现有页面时，必须先调用 get_code_page 获取完整代码，增量修改',
  noProbeBeforePlan: '创建计划前禁止使用 create_query 探测数据',
  updateOnlyChanged: '使用 update_code_page 时只传入需要修改的字段',
  delegateDataTasks: '所有数据源、查询相关操作必须通过 find_query 委派给数据辅助智能体，不要自行调用任何数据相关工具',
} as const;