import type { ToolDefinition, ToolContext, ToolExecuteResult } from '@/types/agent';
import { createPageTools } from './pageTools';
import { createCodePageTools } from './codePageTools';
import { createObservationTools } from './observationTools';
import { createFindQueryTool } from './findQueryTool';
import { createFindWorkflowTool } from './findWorkflowTool';
import { planSkill } from '../skills';
import type { ChatRouter } from '../core/chatRouter';

export type { ToolDefinition, ToolContext, ToolExecuteResult };

export function createInteliTools(context: ToolContext, chatRouter?: ChatRouter): ToolDefinition[] {
  return [
    ...createPageTools(context),
    ...createCodePageTools(context),
    ...createObservationTools(context),
    ...planSkill.getTools(),
    ...(chatRouter ? [
      createFindQueryTool(context, chatRouter),
      createFindWorkflowTool(context, chatRouter),
    ] : []),
  ];
}