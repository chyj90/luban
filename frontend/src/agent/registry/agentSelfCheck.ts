/**
 * Agent 自检（需求 R1：提示词-工具一致性校验）
 *
 * 背景：2026-09-08 事故中，委派提示词要求调用 update_workflow，但该工具未注册进
 * workflow-assistant 的 allowedSkills，模型运行时撞"工具不存在"。提示词（人写的文本）
 * 与工具注册表（代码里的 allowedSkills）是两套独立维护的体系，本模块在 dev 启动 /
 * CI 阶段对二者做一致性校验，让漂移在构建期暴露而不是运行期。
 *
 * 校验规则：
 * 1. 提示词中出现的工具名（全量工具名全集按词边界匹配），必须在该智能体实际可用的
 *    工具列表中；不在则为违规（例外：显式声明的"作为参数值/跨智能体引用"排除项）；
 * 2. planSkills 自动推导的步骤 toolName 必须是主智能体可用工具；
 * 3. delegate:query 的 DBA_DELEGATE_SKILL_IDS 与 agentRegistry 中 data-assistant
 *    的 allowedSkills 必须一致（两份列表漂移同样是事故源）；
 * 4. 所有被引用的技能 ID 必须已注册。
 */
import { AGENTS, resolveAgentTools } from './agentRegistry';
import type { AgentDefinition } from './agentRegistry';
import { resolveSkills, getAllSkillIds } from './skillRegistry';
import type { ToolContext } from '@/types/agent';
import { buildInteliSystemPrompt } from '../prompts/systemPrompt';
import { buildDataAssistantPrompt } from '../prompts/dbaPrompt';
import { WORKFLOW_AGENT_PROMPT } from '../prompts/workflowAgent';
import { getPlanPromptFragment } from './skills/promptFragments';
import {
  buildWorkflowDelegateSystemPrompt,
  DBA_DELEGATE_SKILL_IDS,
  type WorkflowDelegateMode,
} from './skills/delegateSkills';

export interface ConsistencyTarget {
  agentId: string;
  promptSources: Array<{ source: string; text: string }>;
  toolNames: string[];
  /** 工具名 → 排除原因（提示词中仅作为参数值/跨智能体引用出现，并非本智能体可调用） */
  excludedMentions?: Record<string, string>;
}

export interface ConsistencyViolation {
  agentId: string;
  source: string;
  toolName: string;
  reason: string;
}

/** 主智能体提示词中把子智能体工具名当作 task_type 参数值/示例引用，属合法排除项 */
const MAIN_AGENT_EXCLUSIONS: Record<string, string> = {
  design_form: '作为 delegate_workflow 的 task_type 参数值/示例引用，主智能体不直接调用',
  design_workflow: '作为 delegate_workflow 的 task_type 参数值/示例引用，主智能体不直接调用',
  bind_workflow: '示例中的跨智能体引用，主智能体不直接调用',
};

const STUB_CTX: ToolContext = {
  applicationId: 1,
  pageId: 1,
} as ToolContext;

function agentToolNames(agentDef: AgentDefinition): string[] {
  return resolveAgentTools(agentDef, STUB_CTX).map((t) => t.name);
}

/** 全局工具名全集（所有已注册技能的工具名，导出供 eval 使用） */
export function toolNameUniverse(): string[] {
  const all = resolveSkills(getAllSkillIds(), STUB_CTX);
  return Array.from(new Set(all.map((t) => t.name)));
}

/** 在文本中按词边界查找工具名（中文与工具名相邻也算边界） */
export function findToolMentions(text: string, universe: string[]): string[] {
  return universe.filter((name) => new RegExp(`\\b${name}\\b`).test(text));
}

/** 对单个校验目标执行"提示词提到但工具不可用"检查 */
export function checkTarget(target: ConsistencyTarget, universe: string[]): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];
  const available = new Set(target.toolNames);
  for (const { source, text } of target.promptSources) {
    for (const mentioned of findToolMentions(text, universe)) {
      if (available.has(mentioned)) continue;
      const exclusion = target.excludedMentions?.[mentioned];
      if (exclusion) continue;
      violations.push({
        agentId: target.agentId,
        source,
        toolName: mentioned,
        reason: `提示词提到了工具 "${mentioned}"，但该智能体的可用工具中没有它。要么在 allowedSkills/委派工具列表中补注册，要么修正提示词`,
      });
    }
  }
  return violations;
}

/** 构建三个智能体的校验目标（提示词与实际运行使用同一 builder/常量） */
export function buildConsistencyTargets(): ConsistencyTarget[] {
  const mainDef = AGENTS.find((a) => a.id === 'main-agent')!;
  const dataDef = AGENTS.find((a) => a.id === 'data-assistant')!;
  const workflowDef = AGENTS.find((a) => a.id === 'workflow-assistant')!;

  const dbaPrompt = buildDataAssistantPrompt({ applicationId: 1, targetPage: 'P', queryName: '', requirement: 'r' });
  const delegateModes: WorkflowDelegateMode[] = ['design_form', 'design_workflow', 'full'];

  return [
    {
      agentId: 'main-agent',
      promptSources: [
        {
          source: 'buildInteliSystemPrompt',
          text: buildInteliSystemPrompt(1, 1, 'Page1', [{ id: 1, name: 'Page1' }]),
        },
        { source: 'getPlanPromptFragment', text: getPlanPromptFragment() },
      ],
      toolNames: agentToolNames(mainDef),
      excludedMentions: MAIN_AGENT_EXCLUSIONS,
    },
    {
      agentId: 'data-assistant',
      promptSources: [{ source: 'buildDataAssistantPrompt', text: dbaPrompt }],
      toolNames: agentToolNames(dataDef),
    },
    {
      agentId: 'workflow-assistant',
      promptSources: [
        { source: 'WORKFLOW_AGENT_PROMPT', text: WORKFLOW_AGENT_PROMPT },
        ...delegateModes.map((mode) => ({
          source: `delegate:${mode}`,
          text: buildWorkflowDelegateSystemPrompt(mode, { applicationId: 1 }),
        })),
      ],
      toolNames: agentToolNames(workflowDef),
    },
  ];
}

/** 执行全部一致性校验，返回违规列表（空数组=通过） */
export function runConsistencyCheck(): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];
  const universe = toolNameUniverse();
  const registeredIds = new Set(getAllSkillIds());

  // 规则 1：提示词提到的工具必须可用
  for (const target of buildConsistencyTargets()) {
    violations.push(...checkTarget(target, universe));
  }

  // 规则 2：计划自动推导的 toolName 必须是主智能体可用工具
  const mainTarget = buildConsistencyTargets()[0];
  const mainTools = new Set(mainTarget.toolNames);
  const derivedToolNames = ['delegate_query', 'delegate_workflow', 'create_code_page', 'update_code_page'];
  for (const toolName of derivedToolNames) {
    if (!mainTools.has(toolName)) {
      violations.push({
        agentId: 'main-agent',
        source: 'derivePlanFromAnalysis',
        toolName,
        reason: `计划自动推导会生成步骤 toolName="${toolName}"，但主智能体工具列表中没有它，执行时必然报"工具不存在"`,
      });
    }
  }

  // 规则 3：delegate 的 DBA 工具列表与 agentRegistry 的 data-assistant.allowedSkills 必须一致
  const dataDef = AGENTS.find((a) => a.id === 'data-assistant')!;
  const registryIds = new Set(dataDef.allowedSkills);
  for (const id of DBA_DELEGATE_SKILL_IDS) {
    if (!registryIds.has(id)) {
      violations.push({
        agentId: 'data-assistant',
        source: 'DBA_DELEGATE_SKILL_IDS',
        toolName: id,
        reason: `delegate:query 委派了技能 "${id}"，但 agentRegistry 的 data-assistant.allowedSkills 未包含它（两份列表漂移）`,
      });
    }
  }

  // 规则 4：被引用的技能 ID 必须已注册
  for (const id of [...DBA_DELEGATE_SKILL_IDS, ...dataDef.allowedSkills]) {
    if (!registeredIds.has(id)) {
      violations.push({
        agentId: 'data-assistant',
        source: 'skillIds',
        toolName: id,
        reason: `引用了未注册的技能 ID "${id}"，resolveSkills 会静默跳过`,
      });
    }
  }
  for (const agent of AGENTS) {
    for (const id of agent.allowedSkills) {
      if (!registeredIds.has(id)) {
        violations.push({
          agentId: agent.id,
          source: 'allowedSkills',
          toolName: id,
          reason: `allowedSkills 引用了未注册的技能 ID "${id}"，resolveSkills 会静默跳过`,
        });
      }
    }
  }

  return violations;
}

/** dev 启动时运行：有违规则醒目报错（不抛异常，避免阻塞启动） */
export function runDevSelfCheck(): void {
  const violations = runConsistencyCheck();
  if (violations.length === 0) {
    console.log('[AgentSelfCheck] ✅ 提示词-工具一致性校验通过');
    return;
  }
  console.error(`[AgentSelfCheck] ❌ 发现 ${violations.length} 处提示词-工具不一致：`);
  for (const v of violations) {
    console.error(`  - [${v.agentId}] ${v.source}: 工具 "${v.toolName}" | ${v.reason}`);
  }
}
