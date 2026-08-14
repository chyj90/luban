import type { Message, Plan, Step, ToolDefinition, ToolExecuteResult } from '@/types/agent';
import { callLLMAPI, buildToolDefinitions, parseToolArguments, type LLMMessage, type ToolDef } from './llmClient';

export interface AgentLoopOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  maxIterations: number;
  temperature: number;
  timeout: number;
  signal?: AbortSignal;
  conversationMessages: Message[];
  onStatusChange: (status: string) => void;
  onStreamingContent: (content: string) => void;
  onClearStreaming: () => void;
  onAddMessage: (msg: Message) => void;
  onPlanCreate: (plan: Plan) => void;
  onPlanConfirm: (planId: string, action: 'confirm' | 'abandon') => boolean;
  onStepUpdate: (planId: string, stepId: string, status: string, result?: string) => void;
  onToolCall: (name: string, input: Record<string, unknown>, messageId: string) => void;
  onToolResult: (name: string, result: ToolExecuteResult, messageId: string) => void;
  onError: (error: string) => void;
  onTokenUsage: (input: number, output: number) => void;
}

export interface AgentLoopResult {
  response: string | null;
  conversationMessages: Message[];
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const {
    baseUrl, apiKey, model, systemPrompt, tools, maxIterations,
    temperature, timeout, signal,
    conversationMessages: initialMessages,
    onStatusChange, onStreamingContent, onClearStreaming,
    onAddMessage, onPlanCreate, onPlanConfirm, onStepUpdate,
    onToolCall, onToolResult, onError, onTokenUsage,
  } = options;

  const conversationMessages = [...initialMessages];
  const toolDefs = buildToolDefinitions(tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  })));

  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  console.log(`[AgentLoop] 开始 开始 | 模型: ${model} | 最多 ${maxIterations} 轮 | 工具: [${tools.map((t) => t.name).join(', ')}]`);

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (signal?.aborted) throw new Error('Cancelled');

    console.log(`[AgentLoop] 轮 第 ${iteration + 1}/${maxIterations} 轮`);

    onStatusChange('executing');
    onStreamingContent('思考中...');
    console.log(`[AgentLoop] onStreamingContent('思考中...') 已调用`);

    const apiMessages = buildAPIMessages(conversationMessages);
    console.log(`[AgentLoop] API messages 数量: ${apiMessages.length} | roles: [${apiMessages.map((m) => m.role).join(', ')}]`);

    try {
      const response = await callLLMAPI({
        baseUrl, apiKey, model,
        messages: apiMessages,
        tools: toolDefs,
        temperature,
        timeout,
        signal,
      });

      onClearStreaming();
      console.log(`[AgentLoop] onClearStreaming 已调用`);

      const { content, toolCalls } = response;

      if (toolCalls.length > 0) {
        console.log(`[AgentLoop] LLM 返回 ${toolCalls.length} 个 tool call: [${toolCalls.map((tc) => tc.function.name).join(', ')}]`);

        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: content?.trim() || '',
          timestamp: Date.now(),
          toolCalls: toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: parseToolArguments(tc.function.arguments),
            status: 'pending' as const,
          })),
        };
        conversationMessages.push(assistantMsg);
        onAddMessage(assistantMsg);

        const allToolResults: Array<{
          toolCallId: string;
          toolName: string;
          result: ToolExecuteResult;
        }> = [];

        for (const toolCall of toolCalls) {
          const toolName = toolCall.function.name;
          const toolInput = parseToolArguments(toolCall.function.arguments);

          const tool = tools.find((t) => t.name === toolName);
          if (!tool) {
            const errResult: ToolExecuteResult = {
              success: false,
              message: `工具 "${toolName}" 不存在`,
            };
            allToolResults.push({ toolCallId: toolCall.id, toolName, result: errResult });
            onToolResult(toolName, errResult, assistantMsg.id);
            continue;
          }

          onToolCall(toolName, toolInput, assistantMsg.id);

          let toolResult: ToolExecuteResult;
          try {
            const toolStart = Date.now();
            toolResult = await tool.execute(toolInput, {} as any);
            const toolElapsed = Date.now() - toolStart;
            console.log(`[AgentLoop] ${toolName} ${toolElapsed}ms | ${toolResult.success ? 'OK' : 'ERR'} ${toolResult.message.slice(0, 200)}${toolResult._pause ? ' | pause' : ''}`);
          } catch (err: any) {
            console.error(`[AgentLoop] ${toolName} ERR 异常: ${err.message}`);
            toolResult = { success: false, message: err.message };
          }

          onToolResult(toolName, toolResult, assistantMsg.id);

          if (toolResult._pause) {
            for (const { toolCallId: tcid, result: r } of allToolResults) {
              conversationMessages.push({
                id: crypto.randomUUID(),
                role: 'tool',
                content: JSON.stringify(r),
                toolCallId: tcid,
                timestamp: Date.now(),
              });
            }
            conversationMessages.push({
              id: crypto.randomUUID(),
              role: 'tool',
              content: JSON.stringify(toolResult),
              toolCallId: toolCall.id,
              timestamp: Date.now(),
            });

            const currentIndex = toolCalls.indexOf(toolCall);
            for (let i = currentIndex + 1; i < toolCalls.length; i++) {
              const tc = toolCalls[i];
              conversationMessages.push({
                id: crypto.randomUUID(),
                role: 'tool',
                content: JSON.stringify({ success: false, message: '已暂停，等待用户确认后继续' }),
                toolCallId: tc.id,
                timestamp: Date.now(),
              });
            }

            onStatusChange('idle');
            return {
              response: content || toolResult.message || '操作完成，等待用户确认',
              conversationMessages,
            };
          }

          allToolResults.push({ toolCallId: toolCall.id, toolName, result: toolResult });

          conversationMessages.push({
            id: crypto.randomUUID(),
            role: 'tool',
            content: JSON.stringify(toolResult),
            toolCallId: toolCall.id,
            timestamp: Date.now(),
          });
        }

        const failedResults = allToolResults.filter((r) => !r.result.success);
        if (failedResults.length > 0) {
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            onError(`连续 ${consecutiveFailures} 次工具调用失败，已停止执行`);
            return { response: null, conversationMessages };
          }
        } else {
          consecutiveFailures = 0;
        }
      } else {
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: content || '执行完毕。',
          timestamp: Date.now(),
        };
        conversationMessages.push(assistantMsg);
        onAddMessage(assistantMsg);
        onStatusChange('completed');
        return { response: content, conversationMessages };
      }
    } catch (err: any) {
      if (err.message === 'Cancelled' || err.name === 'AbortError') throw err;
      console.error(`[AgentLoop] ERR 第 ${iteration + 1} 轮错误: ${err.message}`);
      onError(err.message);
      onStatusChange('error');
      return { response: null, conversationMessages };
    }
  }

  console.log(`[AgentLoop] WARN 达到最大迭代次数 ${maxIterations}`);
  onStatusChange('completed');
  return { response: null, conversationMessages };
}

function buildAPIMessages(messages: Message[]): LLMMessage[] {
  return messages.map((m) => {
    if (m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant' as const,
        content: m.content,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      };
    }
    if (m.toolCallId) {
      return {
        role: 'tool' as const,
        content: m.content,
        tool_call_id: m.toolCallId,
      };
    }
    return {
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    };
  });
}