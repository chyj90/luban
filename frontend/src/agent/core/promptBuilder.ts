import { buildInteliSystemPrompt } from '../prompts/systemPrompt';
import { formatUnfinishedPlansForPrompt } from './planContext';
import { getPlanPromptFragment } from '../registry/skills/promptFragments';
import type { IStoreReader } from './ports';

export interface PromptBuildContext {
  applicationId: string;
  currentPageId: number;
  currentPageName: string;
  allPages: Array<{ id: number; name: string }>;
  storeReader: IStoreReader;
  isMainAgent: boolean;
  overrideSystemPrompt?: string;
}

export function buildAnalysisPrompt(ctx: PromptBuildContext): string {
  const systemPrompt =
    ctx.overrideSystemPrompt ||
    buildInteliSystemPrompt(Number(ctx.applicationId), ctx.currentPageId, ctx.currentPageName, ctx.allPages, 'analysis');
  const planContext = ctx.isMainAgent ? formatUnfinishedPlansForPrompt(ctx.storeReader) : '';
  const skillPrompts = ctx.isMainAgent ? getPlanPromptFragment() : '';
  return [systemPrompt, skillPrompts, planContext].filter(Boolean).join('\n\n');
}

export function buildExecutionPrompt(
  ctx: PromptBuildContext,
  analysisReport?: string,
): string {
  const executionSystemPrompt = buildInteliSystemPrompt(
    Number(ctx.applicationId),
    ctx.currentPageId,
    ctx.currentPageName,
    ctx.allPages,
    'execution',
  );
  const planContext = formatUnfinishedPlansForPrompt(ctx.storeReader);
  const skillPrompt = getPlanPromptFragment();
  const analysisSection = analysisReport
    ? `\n\n## 需求分析报告（执行上下文）\n\n以下是完整的需求分析报告，执行每个步骤时请参考此报告中的模块、布局、交互联动等细节：\n\n${analysisReport}`
    : '';
  return [executionSystemPrompt, skillPrompt, planContext].filter(Boolean).join('\n\n') + analysisSection;
}