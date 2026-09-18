import { useAuthStore } from '@/stores/authStore';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMResponse {
  content: string;
  toolCalls: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;
}

export interface LLMStreamChunk {
  /** tool_call_pending = 模型开始生成工具调用参数（仅函数名就绪，参数未完），供 UI 提前提示 */
  type: 'content' | 'tool_call' | 'tool_call_pending' | 'done';
  content?: string;
  reasoning?: boolean;
  toolCall?: {
    id: string;
    function: { name: string; arguments: string };
  };
}

export interface LLMCallOptions {
  model: string;
  messages: LLMMessage[];
  tools: ToolDef[];
  temperature: number;
  /** 空闲超时（毫秒）：流式请求连续该时长收不到任何数据才中断。不是整请求墙钟——
   *  大参数工具调用（整页代码/超大 JSON）可持续数分钟，只要流上还有数据就继续等 */
  timeout: number;
  signal?: AbortSignal;
}

export async function callLLMAPI(options: LLMCallOptions): Promise<LLMResponse> {
  const { model, tools, temperature, signal } = options;

  const startTime = Date.now();
  const toolNames = tools.map((t) => t.function.name).join(', ');
  console.log(`[LLM] 调用 ${model} | 工具: [${toolNames}] | temperature: ${temperature}`);

  let contentText = '';
  let resolved = false;
  let streamError: Error | null = null;

  const streamGen = callLLMAPIStream(options);

  const collect = async () => {
    try {
      for await (const chunk of streamGen) {
        if (chunk.type === 'content') {
          contentText += chunk.content;
        }
      }
    } catch (e) {
      streamError = e instanceof Error ? e : new Error(String(e));
    }
    resolved = true;
  };

  // 不另设整请求超时：底层流已带空闲超时（见 LLMCallOptions.timeout），这里再加
  // 绝对上限会把持续输出但耗时很长的生成误杀

  if (signal) {
    signal.addEventListener('abort', () => {
      if (!resolved) {
        streamError = new Error('Cancelled');
        resolved = true;
      }
    });
  }

  await collect();

  if (streamError) {
    if ((streamError as Error).message.includes('Cancelled')) {
      throw new Error('Cancelled', { cause: streamError });
    }
    throw streamError;
  }

  const elapsed = Date.now() - startTime;
  console.log(`[LLM] ${elapsed}ms | content: "${contentText.slice(0, 200)}${contentText.length > 200 ? '...' : ''}"`);
  return { content: contentText, toolCalls: [] };
}

export function buildToolDefinitions(tools: Array<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}>): ToolDef[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export function tryRepairJson(jsonStr: string): string | null {
  const result: string[] = [];
  let i = 0;
  let inString = false;

  while (i < jsonStr.length) {
    const ch = jsonStr[i];

    if (inString) {
      if (ch === '\\') {
        result.push(ch);
        i++;
        if (i < jsonStr.length) {
          result.push(jsonStr[i]);
          i++;
        }
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        while (j < jsonStr.length && (jsonStr[j] === ' ' || jsonStr[j] === '\t' || jsonStr[j] === '\n' || jsonStr[j] === '\r')) {
          j++;
        }
        const next = j < jsonStr.length ? jsonStr[j] : '';
        if (next === ':' || next === ',' || next === '}' || next === ']' || next === '') {
          inString = false;
          result.push(ch);
          i++;
          continue;
        }
        result.push('\\');
        result.push(ch);
        i++;
        continue;
      }
      if (ch === '\n') { result.push('\\n'); i++; continue; }
      if (ch === '\r') { result.push('\\r'); i++; continue; }
      if (ch === '\t') { result.push('\\t'); i++; continue; }
      result.push(ch);
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      result.push(ch);
      i++;
      continue;
    }

    result.push(ch);
    i++;
  }

  const repaired = result.join('');
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}

export function tryTrimJson(jsonStr: string): string | null {
  let depth = 0;
  let lastValidEnd = -1;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];

    if (escapeNext) { escapeNext = false; continue; }
    if (inString) {
      if (ch === '\\') { escapeNext = true; continue; }
      if (ch === '"') { inString = false; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') { depth++; }
    if (ch === '}' || ch === ']') { depth--; }
    if (depth === 0 && (ch === '}' || ch === ']')) {
      lastValidEnd = i + 1;
    }
  }

  if (lastValidEnd > 0) {
    const trimmed = jsonStr.slice(0, lastValidEnd);
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 解析工具调用参数并给出失败原因。空参数（无参工具）返回 {}；解析失败返回 args: null，
 * 由调用方作为工具错误反馈给模型，禁止静默降级为 {}（会导致工具带着空参数"成功"执行）。
 * reason 携带 JSON.parse 的原始错误（含出错位置），让模型能自修正而不是盲试。
 */
export function parseToolArgumentsWithReason(rawArgs: string): { args: Record<string, unknown> | null; reason?: string } {
  const trimmed = (rawArgs || '').trim();
  if (!trimmed) return { args: {} };
  try {
    return { args: JSON.parse(trimmed) as Record<string, unknown> };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const repaired = tryRepairJson(trimmed) || tryTrimJson(trimmed);
    if (repaired) {
      try {
        return { args: JSON.parse(repaired) as Record<string, unknown> };
      } catch {
        // fallthrough
      }
    }
    console.warn('[parseToolArguments] JSON 解析失败。原始参数:', trimmed.slice(0, 300));
    return { args: null, reason };
  }
}

export function parseToolArguments(rawArgs: string): Record<string, unknown> | null {
  return parseToolArgumentsWithReason(rawArgs).args;
}

/** 兜底剥离模型内联输出的 <think> 思考块（正常情况思考走 reasoning 通道，不经过这里） */
export function stripThinkBlocks(text: string): string {
  if (!text || !text.includes('<think')) return text;
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .replace(/<\/?think>/gi, '')
    .trim();
}

export async function* callLLMAPIStream(options: LLMCallOptions): AsyncGenerator<LLMStreamChunk> {
  const { model, messages, tools, temperature, timeout, signal } = options;

  const startTime = Date.now();
  const toolNames = tools.map((t) => t.function.name).join(', ');
  console.log(`[LLM] 流式调用 ${model} | 工具: [${toolNames}] | temperature: ${temperature}`);

  const proxyUrl = '/api/v1/agent/dev/chat/stream';
  const requestBody = JSON.stringify({
    messages,
    tools,
    temperature,
    stream: true,
  });

  let lastProcessedIndex = 0;
  let lineBuffer = '';
  let contentText = '';
  const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();

  const pending: LLMStreamChunk[] = [];
  let waiter: (() => void) | null = null;
  let finished = false;
  let streamError: Error | null = null;

  const wake = () => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w();
    }
  };

  const processSSELine = (event: string, data: string) => {
    if (event === 'delta') {
      try {
        const delta = JSON.parse(data);
        let content = delta.content || '';
        if (content) {
          content = content.replace(/<\/think_never_used_[a-f0-9]+>/gi, '');
          if (content) {
            contentText += content;
            pending.push({
              type: 'content',
              content,
              ...(delta.reasoning ? { reasoning: true } : {}),
            });
          }
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = toolCallsMap.get(idx) || { id: '', name: '', arguments: '' };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) {
              // 函数名首个片段一到就上抛：参数可能还要生成数十秒（如 submit_analysis 的
              // 大 JSON），UI 需要在这段静默期显示"正在生成提交数据"
              if (!existing.name) {
                pending.push({
                  type: 'tool_call_pending',
                  toolCall: { id: existing.id, function: { name: tc.function.name, arguments: '' } },
                });
              }
              existing.name += tc.function.name;
            }
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            toolCallsMap.set(idx, existing);
          }
        }
      } catch (e) {
        console.warn('[llmClient] SSE delta 解析失败:', e, 'data:', data.substring(0, 200));
      }
    } else if (event === 'done') {
      for (const tc of toolCallsMap.values()) {
        pending.push({
          type: 'tool_call',
          toolCall: { id: tc.id, function: { name: tc.name, arguments: tc.arguments } },
        });
      }
      pending.push({ type: 'done' });
      finished = true;
    } else if (event === 'error') {
      streamError = new Error(data);
      finished = true;
    }
  };

  const xhr = new XMLHttpRequest();
  xhr.open('POST', proxyUrl, true);
  xhr.setRequestHeader('Content-Type', 'application/json');

  const token = useAuthStore.getState().token;
  if (token) {
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
  }

  // 空闲超时（非整请求墙钟）：XHR 自带的 xhr.timeout 是从 send 起算的绝对上限，
  // onprogress 收到数据不会重置它，会误杀持续输出的大参数生成（整页代码/超大 JSON）。
  // 改为每次收到数据就重置计时器，只有连续 timeout 时长收不到任何字节才判超时
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const armIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (finished) return;
      streamError = new Error(`LLM 调用超时（${Math.round(timeout / 1000)}秒无响应）`);
      finished = true;
      try { xhr.abort(); } catch { /* already aborted */ }
      wake();
    }, timeout);
  };
  const disarmIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  if (signal) {
    signal.addEventListener('abort', () => {
      streamError = new Error('Cancelled');
      finished = true;
      disarmIdleTimer();
      xhr.abort();
      wake();
    });
  }

  let currentEvent = '';
  let currentData = '';

  xhr.onprogress = () => {
    armIdleTimer();
    const fullText = xhr.responseText;
    const newText = fullText.slice(lastProcessedIndex);
    lastProcessedIndex = fullText.length;

    lineBuffer += newText;
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '');
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        currentData = line.slice(6);
      } else if (line.trim() === '') {
        if (currentEvent) {
          processSSELine(currentEvent, currentData);
        }
        currentEvent = '';
        currentData = '';
      }
    }
    wake();
  };

  xhr.onloadend = () => {
    disarmIdleTimer();
    if (lineBuffer.trim()) {
      const trimmed = lineBuffer.replace(/\r$/, '');
      if (trimmed.startsWith('event: ')) {
        currentEvent = trimmed.slice(7).trim();
      } else if (trimmed.startsWith('data: ')) {
        currentData = trimmed.slice(6);
        if (currentEvent) {
          processSSELine(currentEvent, currentData);
        }
      }
    }

    if (!finished) {
      for (const tc of toolCallsMap.values()) {
        pending.push({
          type: 'tool_call',
          toolCall: { id: tc.id, function: { name: tc.name, arguments: tc.arguments } },
        });
      }
      pending.push({ type: 'done' });
      finished = true;
    }

    if (xhr.status !== 0 && xhr.status >= 400) {
      streamError = new Error(`LLM 代理调用失败 (${xhr.status}): ${xhr.responseText?.slice(0, 500) || ''}`);
      console.error(`[LLM] 代理失败 (${xhr.status}): ${xhr.responseText?.slice(0, 500)}`);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[LLM] 流式 ${elapsed}ms | content: "${contentText.slice(0, 200)}${contentText.length > 200 ? '...' : ''}" | tool_calls: ${toolCallsMap.size}`);

    wake();
  };

  xhr.onerror = () => {
    streamError = new Error('网络请求失败');
    finished = true;
    disarmIdleTimer();
    wake();
  };

  xhr.send(requestBody);
  armIdleTimer();

  while (true) {
    while (pending.length > 0) {
      yield pending.shift()!;
    }
    if (finished) break;
    await new Promise<void>((resolve) => { waiter = resolve; });
  }

  if (streamError) {
    if ((streamError as Error).message.includes('Cancelled') || (streamError as Error).message.includes('abort')) {
      throw new Error('Cancelled');
    }
    throw streamError;
  }
}