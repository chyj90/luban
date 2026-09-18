/**
 * 应用链路自检技能：agent 交付应用前的运行时验证（L2 业务链路层）。
 * 一键按钮与 agent 技能共用同一后端端点与契约提取器。
 *
 * 契约即文档：TestSpec 的字段级契约只存在于后端 DTO（com.luban.selftest.dto），
 * 模型读不到 Java 代码——工具描述就是唯一的契约载体（2026-09-17 请假案例：模型按周边
 * 工具惯例写 queryName/processId/数组 expect，3 轮全被 400 拒绝）。因此本文件维护：
 *  ① 工具 description 写全 per-type 字段 + 金样例；
 *  ② 执行前做别名归一（queryName→queryId、processId→definitionId）与结构前置校验，
 *     契约错误在本地拦截并给出可操作修复建议，不烧后端重试预算。
 */
import { SkillCategory, type SkillFactory } from '../skillRegistry';
import { selfTestApi } from '@/api/selfTest';
import { listQueries } from '@/api';
import { extractContractAndBuildSpec } from './selfTestContract';
import type { ToolExecuteResult } from '@/types/agent';
import type { SelfTestReport, SelfTestRun, SelfTestSpec } from '@/types/selfTest';

/** 技能内轮询：引擎总预算 60s + 清理时间，90s 内每 2.5s 回读一次运行状态 */
const POLL_INTERVAL_MS = 2500;
const POLL_BUDGET_MS = 90_000;

/** TestSpec 字段契约速查（失败时随错误返回，模型下一轮可直接照抄修正） */
const TESTSPEC_CONTRACT = `【TestSpec 字段契约】
- 顶层: {testName, datasourceId(数字,断言/捕获用数据源), actors: {"别名": 平台用户ID}(平铺，不要嵌套 platformUserId), steps: [...]}
- 步骤公共字段: id(唯一)、actor(actors 别名)、type
- query_run: queryId(数字!不是 queryName) + params{}
- workflow_start: definitionId(数字!不是 processId/workflowId) + formData{}
- task_complete: instanceRef(如 "\${start.instanceId}") + action("APPROVE"|"REJECT") + comment
- wait_outbox: instanceRef + timeoutSeconds(默认20,上限55)
- assert_sql: sql(仅单条 SELECT) + expect 对象: {"operator":"cell_eq|rows_count_eq|cell_contains|is_empty","value":"期望值"}（不是数组! cell_eq 比较首行首列）
- capture_sql: sql(仅单条 SELECT) + captureVar，首行首列存入变量
- 占位符: "\${步骤id.insertId}"、"\${步骤id.instanceId}"、"\${captureVar}"`;

/** 金样例：字段名与结构逐字照此构造（queryId/definitionId 换成真实 ID） */
const GOLDEN_SPEC = `{"testName":"主链路-通过","datasourceId":12,"actors":{"employee":6,"leader":3},"steps":[
  {"id":"insert","actor":"employee","type":"query_run","queryId":175,"params":{"leave_type":"年假","days":1}},
  {"id":"start","actor":"employee","type":"workflow_start","definitionId":261,"formData":{"id":"\${insert.insertId}","leave_type":"年假","days":1}},
  {"id":"wait1","actor":"leader","type":"wait_outbox","instanceRef":"\${start.instanceId}"},
  {"id":"approve","actor":"leader","type":"task_complete","instanceRef":"\${start.instanceId}","action":"APPROVE","comment":"同意"},
  {"id":"wait2","actor":"leader","type":"wait_outbox","instanceRef":"\${start.instanceId}"},
  {"id":"assert1","actor":"employee","type":"assert_sql","sql":"SELECT status FROM leave_records WHERE id = \${insert.insertId}","expect":{"operator":"cell_eq","value":"已通过"}}]}`;

function contractError(title: string, problems: string[]): ToolExecuteResult {
  return {
    success: false,
    message: `${title}\n${problems.map(p => `- ${p}`).join('\n')}\n\n${TESTSPEC_CONTRACT}\n\n【金样例（逐字段照此构造）】\n${GOLDEN_SPEC}`,
  };
}

type RawStep = Record<string, unknown>;

/**
 * 别名归一：把模型按周边生态惯例写出的字段名归一到后端 DTO 契约。
 * - processId / workflowId → definitionId
 * - queryName → queryId（按本应用查询名解析；同名多个查询时拒绝并列出候选，避免静默选中遗留资源）
 * - expect 数组（单键单元素）→ {operator:"cell_eq", value}
 */
function normalizeTestSpec(
  raw: SelfTestSpec,
  queries: Array<{ id: number; name: string }> | null,
): { spec: SelfTestSpec; fixes: string[] } {
  const fixes: string[] = [];
  const spec = JSON.parse(JSON.stringify(raw)) as SelfTestSpec & { steps: RawStep[] };
  const byName = new Map<string, number[]>();
  for (const q of queries || []) {
    const ids = byName.get(q.name) || [];
    ids.push(Number(q.id));
    byName.set(q.name, ids);
  }
  for (const step of spec.steps) {
    const sid = String(step.id ?? '?');
    if (step.definitionId == null && step.processId != null) {
      step.definitionId = Number(step.processId);
      delete step.processId;
      fixes.push(`步骤 ${sid}: processId → definitionId=${step.definitionId}`);
    }
    if (step.definitionId == null && step.workflowId != null) {
      step.definitionId = Number(step.workflowId);
      delete step.workflowId;
      fixes.push(`步骤 ${sid}: workflowId → definitionId=${step.definitionId}`);
    }
    if (step.queryId == null && typeof step.queryName === 'string') {
      const name = String(step.queryName);
      const ids = byName.get(name);
      if (!ids || ids.length === 0) {
        throw new Error(`步骤 ${sid}: queryName「${name}」在本应用中不存在。请改用数字 queryId（以 delegate_query / 查询列表返回的真实 ID 为准，区分大小写）`);
      }
      if (ids.length > 1) {
        throw new Error(`步骤 ${sid}: queryName「${name}」匹配到多个同名查询 (ID: ${ids.join(', ')})——存在遗留重复资源，请直接指定 queryId，并建议清理同名旧查询`);
      }
      step.queryId = ids[0];
      delete step.queryName;
      fixes.push(`步骤 ${sid}: queryName「${name}」→ queryId=${ids[0]}`);
    }
    if (Array.isArray(step.expect)) {
      const arr = step.expect as Array<Record<string, unknown>>;
      if (arr.length === 1 && arr[0] && typeof arr[0] === 'object' && Object.keys(arr[0]).length === 1) {
        const key = Object.keys(arr[0])[0];
        step.expect = { operator: 'cell_eq', value: String(arr[0][key]) };
        fixes.push(`步骤 ${sid}: expect 数组 → {"operator":"cell_eq","value":"${String(arr[0][key])}"}（cell_eq 比较首行首列，请确认 sql 只取需要断言的列）`);
      } else {
        throw new Error(`步骤 ${sid}: expect 必须是对象 {"operator":"cell_eq|rows_count_eq|cell_contains|is_empty","value":"..."}，不是数组`);
      }
    }
  }
  return { spec, fixes };
}

/** 结构前置校验：per-type 必填字段在本地拦截，不烧后端重试预算 */
function preValidateTestSpec(spec: SelfTestSpec): string[] {
  const problems: string[] = [];
  if (spec.actors == null || typeof spec.actors !== 'object' || Array.isArray(spec.actors)) {
    problems.push('actors 必须是平的对象 {"别名": 平台用户ID}（不要嵌套 platformUserId）');
  } else {
    for (const [alias, uid] of Object.entries(spec.actors)) {
      if (typeof uid === 'object' || !Number.isFinite(Number(uid))) {
        problems.push(`actors.${alias} 必须是数字平台用户 ID（嵌套对象写法 {platformUserId:N} 不支持）`);
      }
    }
  }
  if (!Array.isArray(spec.steps) || spec.steps.length === 0) {
    problems.push('steps 不能为空');
    return problems;
  }
  const seenIds = new Set<string>();
  const EXPECT_OPS = ['cell_eq', 'rows_count_eq', 'cell_contains', 'is_empty'];
  for (const step of spec.steps as unknown as RawStep[]) {
    const sid = String(step.id ?? '(缺 id)');
    if (!step.id) problems.push('每个步骤必须有唯一 id');
    else if (seenIds.has(String(step.id))) problems.push(`步骤 id「${step.id}」重复（引擎要求唯一，变量引用随之冲突）`);
    if (step.id) seenIds.add(String(step.id));
    switch (String(step.type ?? '')) {
      case 'query_run':
        if (step.queryId == null || !Number.isFinite(Number(step.queryId))) problems.push(`步骤 ${sid}: query_run 缺少数字 queryId（不是 queryName）`);
        break;
      case 'workflow_start':
        if (step.definitionId == null || !Number.isFinite(Number(step.definitionId))) problems.push(`步骤 ${sid}: workflow_start 缺少数字 definitionId（不是 processId/workflowId）`);
        break;
      case 'task_complete':
      case 'wait_outbox':
        if (!step.instanceRef) problems.push(`步骤 ${sid}: ${step.type} 缺少 instanceRef（如 "\${start.instanceId}"）`);
        break;
      case 'assert_sql': {
        if (!step.sql) problems.push(`步骤 ${sid}: assert_sql 缺少 sql（仅允许单条 SELECT）`);
        const expect = step.expect as { operator?: string } | undefined;
        if (!expect || typeof expect !== 'object' || Array.isArray(expect)) {
          problems.push(`步骤 ${sid}: assert_sql 的 expect 必须是对象 {"operator":"...","value":"..."}，不是数组`);
        } else if (!EXPECT_OPS.includes(String(expect.operator))) {
          problems.push(`步骤 ${sid}: expect.operator 必须是 ${EXPECT_OPS.join('|')}`);
        }
        break;
      }
      case 'capture_sql':
        if (!step.sql) problems.push(`步骤 ${sid}: capture_sql 缺少 sql（仅允许单条 SELECT）`);
        if (!step.captureVar) problems.push(`步骤 ${sid}: capture_sql 缺少 captureVar`);
        break;
      default:
        problems.push(`步骤 ${sid}: 未知 type "${step.type}"（允许: query_run|workflow_start|task_complete|wait_outbox|assert_sql|capture_sql）`);
    }
  }
  return problems;
}

function renderReportMarkdown(report: SelfTestReport, gaps: string[], notes: string[]): string {
  const lines: string[] = [];
  lines.push(`## 链路自检报告（${report.passed ? '✅ 通过' : '❌ 未通过'}）`);
  lines.push(`runId: ${report.runId}`);
  lines.push(`\n**${report.summary}**\n`);
  lines.push('| 步骤 | 类型 | 结果 | 耗时 | 说明 |');
  lines.push('|---|---|---|---|---|');
  for (const s of report.steps) {
    const ev = s.evidence || {};
    const detail = s.error
      || (ev.triggers ? `触发器: ${(ev.triggers as Array<{ triggerId: string; status: string }>).map(t => `${t.triggerId}=${t.status}`).join(', ')}` : '')
      || (ev.captured ? String(ev.captured) : '')
      || (ev.insertId != null ? `insertId=${ev.insertId}` : '')
      || (ev.instanceId != null ? `instanceId=${ev.instanceId}` : '');
    lines.push(`| ${s.id} | ${s.type} | ${s.passed ? '✅' : '❌'} | ${s.durationMs}ms | ${detail} |`);
  }
  if (report.cleanupLog.length > 0) {
    lines.push(`\n**自动清理**：${report.cleanupLog.join('；')}`);
  }
  if (report.residuals.length > 0) {
    lines.push(`\n⚠️ **测试残留（需人工处理）**：\n${report.residuals.map(r => `- ${r}`).join('\n')}`);
  }
  if (report.warnings.length > 0) {
    lines.push(`\n⚠️ 警告：\n${report.warnings.map(w => `- ${w}`).join('\n')}`);
  }
  if (gaps.length > 0) {
    lines.push(`\n**可测性缺口**（契约无法自动推导，需补充）：\n${gaps.map(g => `- ${g}`).join('\n')}`);
  }
  if (notes.length > 0) {
    lines.push(`\n提取说明：${notes.join('；')}`);
  }
  return lines.join('\n');
}

export const selfTestSkills: Record<string, SkillFactory> = {
  /**
   * 执行链路自检。testSpec 缺省时先跑契约提取器生成默认主链路用例
   * （对手工应用与 agent 应用同等适用），agent 通常应传入自己构造的
   * TestSpec（含语义断言与驳回分支）以获得更强验证。
   */
  'test:app-selfcheck': (ctx) => ({
    id: 'test:app-selfcheck',
    category: SkillCategory.TEST,
    name: 'app_selfcheck',
    description: `执行应用链路自检（运行时验证）：以真实平台用户身份走"写库→发起流程→审批→触发器派发→数据断言"，引擎按写入记账自动清理测试数据。
执行为异步运行记录：调用后自动轮询至终态并返回完整报告；报告持久化在应用编辑器「链路自检」抽屉，可随时凭 runId 回看。应用已有自检在运行时不并发，自动转而等待那次运行。
使用约定：应用交付前（页面+流程类需求）必须执行一次并把报告摘要写进完成汇报；testSpec 缺省时自动生成主链路用例（仅链路级验证）；语义断言（余额/状态变化）必须自己构造 TestSpec（capture_sql 捕获初值、assert_sql 里对比期望，主分支+驳回分支各一份）。

## TestSpec 契约（字段名必须逐字一致，别名 queryName/processId 会被自动归一但语义断言需自查）
- 顶层: {testName, datasourceId(数字), actors: {"别名": 平台用户ID}(平铺), steps: [...]}；步骤 ≤50、actors ≤5
- 步骤公共: id(唯一)、actor(actors 别名)、type
- query_run: queryId=数字查询ID + params{}
- workflow_start: definitionId=数字流程定义ID + formData{}（formData 必须满足绑定表单契约：必填字段齐全、字段 key 与表单逐字一致；触发器回写场景必须携带业务记录 id，如 {"id":"\${insert.insertId}"}）
- task_complete: instanceRef + action("APPROVE"|"REJECT") + comment
- wait_outbox: instanceRef + timeoutSeconds(默认20上限55)
- assert_sql: sql(仅单条 SELECT) + expect 对象 {"operator":"cell_eq|rows_count_eq|cell_contains|is_empty","value":"期望值"}（不是数组; cell_eq 比较首行首列）
- capture_sql: sql(仅单条 SELECT) + captureVar
- 占位符: "\${步骤id.insertId}"、"\${步骤id.instanceId}"、"\${captureVar}"；actors 必须是真实平台用户 ID；断言只允许 SELECT；无清理手段时拒绝执行

## 金样例（queryId/definitionId/SQL 换成被测应用的真实值）
${GOLDEN_SPEC}

参数必须使用纯 JSON 格式，禁止使用 XML 标签`,
    parameters: {
      type: 'object',
      properties: {
        testSpec: {
          type: 'string',
          description: 'TestSpec JSON 字符串（可选）。缺省时自动提取应用契约生成主链路用例；需要语义断言/驳回分支时自己构造。字段契约：{testName, datasourceId:数字, actors:{"别名":平台用户ID}, steps:[{id, actor, type, ...}]}；query_run 用数字 queryId、workflow_start 用数字 definitionId（不是 queryName/processId）、assert_sql 的 expect 是对象 {"operator":"cell_eq|rows_count_eq|cell_contains|is_empty","value":"..."} 而不是数组；占位符 "${步骤id.insertId}"/"${步骤id.instanceId}"',
        },
        runId: {
          type: 'string',
          description: '可选。传入已发起运行的 runId 时只回读该运行的状态/报告，不重新执行——用于轮询超时后的重查。仍在运行时返回进度，稍后再次调用即可',
        },
      },
    },
    async execute(args): Promise<ToolExecuteResult> {
      const appId = ctx.applicationId;

      // runId 回读模式：不重跑，只查询某次运行（轮询超时/撞锁跟随后的重查入口）
      const runIdArg = (args as { runId?: string }).runId;
      if (runIdArg && runIdArg.trim()) {
        try {
          const resp = await selfTestApi.getRun(appId, runIdArg.trim());
          const run = resp.data;
          if (run.status === 'RUNNING') {
            return {
              success: false,
              message: `自检仍在后台运行（runId=${run.runId}，当前步骤 ${run.currentStepId ?? '准备中'}）。稍后再次调用本工具并传 {"runId":"${run.runId}"} 查询；报告持久化，也可在应用编辑器「链路自检」抽屉查看。`,
            };
          }
          if (!run.report) {
            return {
              success: false,
              message: `运行 ${run.runId} 终态为 ${run.status}${run.summary ? `：${run.summary}` : ''}（无报告）。请重新发起自检。`,
            };
          }
          const md = renderReportMarkdown(run.report, [], [`来源 ${run.source}，结束于 ${run.finishedAt ?? '-'}`]);
          return { success: run.report.passed, message: md, data: { report: run.report } };
        } catch (e) {
          return { success: false, message: `查询运行记录失败: ${(e as Error).message}` };
        }
      }

      const raw = (args as { testSpec?: string }).testSpec;
      let gaps: string[] = [];
      let notes: string[] = [];
      let spec: SelfTestSpec;
      if (raw && raw.trim()) {
        try {
          spec = JSON.parse(raw) as SelfTestSpec;
        } catch (e) {
          return contractError(`testSpec 不是合法 JSON: ${(e as Error).message}`, []);
        }
        // ① 别名归一：queryName/processId/workflowId/数组 expect → 后端 DTO 契约字段
        try {
          const needsQueries = JSON.stringify(spec).includes('queryName');
          const queries = needsQueries
            ? await listQueries(ctx.applicationId).then(r => (r.data || []) as Array<{ id: number; name: string }>).catch(() => null)
            : null;
          const normalized = normalizeTestSpec(spec, queries);
          spec = normalized.spec;
          if (normalized.fixes.length > 0) {
            notes = [...notes, `契约归一: ${normalized.fixes.join('；')}`];
          }
        } catch (e) {
          return contractError((e as Error).message, []);
        }
        // ② 结构前置校验：per-type 必填字段本地拦截，附契约速查与金样例
        const problems = preValidateTestSpec(spec);
        if (problems.length > 0) {
          return contractError('TestSpec 结构校验未通过（未发起执行，修复后重试）：', problems);
        }
      } else {
        const extraction = await extractContractAndBuildSpec(ctx.applicationId);
        spec = extraction.spec;
        gaps = extraction.gaps;
        notes = extraction.notes;
        if (spec.steps.length === 0) {
          return {
            success: false,
            message: `契约提取未能生成用例：\n${gaps.map(g => `- ${g}`).join('\n')}`,
          };
        }
      }
      // ③ 启动异步运行（立即返回 RUNNING 记录），随后内部轮询至终态——对外契约仍是"调用 → 报告"
      let run: SelfTestRun;
      try {
        const resp = await selfTestApi.start(ctx.applicationId, spec, 'AGENT');
        run = resp.data;
      } catch (e) {
        return contractError(`自检启动失败: ${(e as Error).message}`, []);
      }
      if (run.followedExisting) {
        notes = [...notes, `该应用已有自检在运行，本次未重复发起，转而等待该运行完成（runId=${run.runId}）`];
      }
      const deadline = Date.now() + POLL_BUDGET_MS;
      while (run.status === 'RUNNING' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        try {
          const resp = await selfTestApi.getRun(ctx.applicationId, run.runId);
          run = resp.data;
        } catch { /* 单次轮询失败忽略，下一轮重试 */ }
      }
      if (run.status === 'RUNNING') {
        return {
          success: false,
          message: `自检仍在后台执行（runId=${run.runId}，当前步骤 ${run.currentStepId ?? '…'}）。稍后再次调用本工具并传 {"runId":"${run.runId}"} 查询结果；报告持久化，也可在应用编辑器「链路自检」抽屉回看。`,
        };
      }
      if (!run.report) {
        return {
          success: false,
          message: `运行 ${run.runId} 终态为 ${run.status}${run.summary ? `：${run.summary}` : ''}（无报告）。请修复后重新发起自检。`,
        };
      }
      const md = renderReportMarkdown(run.report, gaps, notes);
      if (!run.report.passed) {
        return {
          success: false,
          message: `链路自检未通过，必须修复后重跑（同一用例最多 2 轮，仍失败要如实上报）：\n\n${md}`,
          data: { report: run.report },
        };
      }
      return { success: true, message: md, data: { report: run.report } };
    },
  }),
};
