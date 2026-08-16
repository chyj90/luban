import type { ToolDefinition, ToolContext, ToolExecuteResult } from '@/types/agent';
import { createPageTools } from './pageTools';
import { createCodePageTools } from './codePageTools';
import { createObservationTools } from './observationTools';
import { createDelegateQueryTool } from './findQueryTool';
import { createFindWorkflowTool } from './findWorkflowTool';
import { createFindAnalysisTool } from './findAnalysisTool';
import { getRequirementTools } from './requirementTools';
import type { ChatRouter } from '../core/chatRouter';

export type { ToolDefinition, ToolContext, ToolExecuteResult };

export function createInteliTools(context: ToolContext, chatRouter?: ChatRouter): ToolDefinition[] {
  return [
    ...createPageTools(context),
    ...createCodePageTools(context),
    ...createObservationTools(context),
    ...getRequirementTools(),
    ...(chatRouter ? [
      createFindAnalysisTool(context, chatRouter),
      createDelegateQueryTool(context, chatRouter),
      createFindWorkflowTool(context, chatRouter),
    ] : []),
  ];
}