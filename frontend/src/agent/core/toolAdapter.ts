import { tool, jsonSchema } from 'ai';
import type { ToolDefinition, ToolContext } from '@/types/agent';

/**
 * 将 luban 的 ToolDefinition[] 转换为 AI SDK 的 ToolSet。
 * 使用 jsonSchema() 直接将 JSON Schema 参数转成 AI SDK 可接受的格式。
 */
export function buildToolSet(tools: ToolDefinition[], context: ToolContext) {
  const toolSet: Record<string, ReturnType<typeof tool>> = {};

  for (const t of tools) {
    const schema = jsonSchema(t.parameters as Record<string, unknown>);
    toolSet[t.name] = tool({
      description: t.description,
      parameters: schema,
      execute: async (args) => {
        const result = await t.execute(args as Record<string, unknown>, context);
        return result;
      },
    });
  }

  return toolSet;
}