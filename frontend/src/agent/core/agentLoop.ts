import type { Message, Plan, Step, ToolDefinition, ToolExecuteResult } from '@/types/agent';
import { buildToolDefinitions, parseToolArguments, callLLMAPIStream, type LLMMessage, type ToolDef } from './llmClient';

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
  onStreamingContent: (content: string, reasoning?: boolean) => void;
  onClearStreaming: () => void;
  onAddMessage: (msg: Message) => void;
  onPlanCreate: (plan: Plan) => void;
  onPlanConfirm: (planId: string, action: 'confirm' | 'abandon') => boolean;
  onStepUpdate: (planId: string, stepId: string, status: string, result?: string) => void;
  onToolCall: (name: string, input: Record<string, unknown>, messageId: string, toolCallId: string) => void;
  onToolResult: (name: string, result: ToolExecuteResult, messageId: string, toolCallId: string) => void;
  onError: (error: string) => void;
  onTokenUsage: (input: number, output: number) => void;
  throwOnStuck?: boolean;
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
    onToolCall, onToolResult, onError, onTokenUsage, throwOnStuck,
  } = options;

  const conversationMessages = [...initialMessages];
  const toolDefs = buildToolDefinitions(tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  })));

  let sameProblemCount = 0;
  const MAX_SAME_PROBLEM = 2;
  let lastRoundTools: Set<string> = new Set();
  let _stopRequested = false;
  let _stuckForcedStop = false;

  console.log(`[AgentLoop] 开始 开始 | 模型: ${model} | 最多 ${maxIterations} 轮 | 工具: [${tools.map((t) => t.name).join(', ')}]`);

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (signal?.aborted) throw new Error('Cancelled');

    console.log(`[AgentLoop] 轮 第 ${iteration + 1}/${maxIterations} 轮`);

    onStatusChange('executing');
    const apiMessages = buildAPIMessages(conversationMessages);
    console.log(`[AgentLoop] API messages 数量: ${apiMessages.length} | roles: [${apiMessages.map((m) => m.role).join(', ')}]`);

    try {
      let content = '';
      const toolCallsAccumulated: Array<{
        id: string;
        function: { name: string; arguments: string };
      }> = [];

      const streamGen = callLLMAPIStream({
        baseUrl, apiKey, model,
        messages: apiMessages,
        tools: toolDefs,
        temperature,
        timeout,
        signal,
      });

      for await (const chunk of streamGen) {
        if (chunk.type === 'content' && chunk.content) {
          onStreamingContent(chunk.content, chunk.reasoning);
          content += chunk.content;
        } else if (chunk.type === 'tool_call' && chunk.toolCall) {
          toolCallsAccumulated.push(chunk.toolCall);
        }
      }

      onClearStreaming();

      const toolCalls = toolCallsAccumulated;

      if (toolCalls.length > 0) {
        if (_stuckForcedStop) {
          console.log('[AgentLoop] 强制停止：系统已提醒卡住，但 LLM 仍尝试调用工具，直接退出');
          const finalMsg: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: '我在同一个问题上尝试了多次但没有进展，需要您的帮助。请告诉我下一步该如何处理？',
            timestamp: Date.now(),
          };
          conversationMessages.push(finalMsg);
          onAddMessage(finalMsg);
          onStatusChange('completed');
          return { response: finalMsg.content, conversationMessages };
        }

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
            onToolResult(toolName, errResult, assistantMsg.id, toolCall.id);
            continue;
          }

          onToolCall(toolName, toolInput, assistantMsg.id, toolCall.id);

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

          onToolResult(toolName, toolResult, assistantMsg.id, toolCall.id);

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

        const thisRoundTools = new Set(allToolResults.map((r) => r.toolName));
        const hasOverlap = lastRoundTools.size > 0 && [...thisRoundTools].some((t) => lastRoundTools.has(t));

        if (hasOverlap) {
          sameProblemCount++;
          console.log(`[AgentLoop] 相同问题计数: ${sameProblemCount}/${MAX_SAME_PROBLEM} | 工具重叠: [${[...thisRoundTools].join(', ')}]`);
          if (sameProblemCount >= MAX_SAME_PROBLEM && !_stopRequested) {
            _stopRequested = true;
            const reminderMsg = {
              role: 'system' as const,
              content: '你似乎卡在同一个问题上（连续3轮使用相同工具），请回顾之前的尝试。如果没有进展，请停止并向用户说明情况，等待用户指导。',
            };
            conversationMessages.push({
              id: crypto.randomUUID(),
              role: 'system',
              content: reminderMsg.content,
              timestamp: Date.now(),
            });
            console.log('[AgentLoop] 注入系统提醒：疑似卡在同一问题');
            if (throwOnStuck) {
              throw new Error('__STUCK__: 同一问题尝试多次无进展');
            }
            _stuckForcedStop = true;
            sameProblemCount = 0;
          }
        } else {
          sameProblemCount = 0;
        }
        lastRoundTools = thisRoundTools;

        const hasNoRetryFailure = allToolResults.some((r) => !r.result.success && r.result._noRetry);
        if (hasNoRetryFailure && !_stopRequested) {
          _stopRequested = true;
          _stuckForcedStop = true;
          const noRetryMsg = {
            role: 'system' as const,
            content: '子智能体已尝试多次失败，不要再重试，直接将子智能体的反馈告知用户，等待用户指导。',
          };
          conversationMessages.push({
            id: crypto.randomUUID(),
            role: 'system',
            content: noRetryMsg.content,
            timestamp: Date.now(),
          });
          console.log('[AgentLoop] 注入系统提醒：子智能体失败，不可重试');
        }
      } else {
        sameProblemCount = 0;
        lastRoundTools = new Set();
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: content || '执行完毕。',
          timestamp: Date.now(),
        };
        conversationMessages.push(assistantMsg);
        onAddMessage(assistantMsg);
        onStatusChange('completed');
        return { response: content || '执行完毕。', conversationMessages };
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