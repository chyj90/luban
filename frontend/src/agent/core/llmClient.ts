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
  type: 'content' | 'tool_call' | 'done';
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
  timeout: number;
  signal?: AbortSignal;
}

export async function callLLMAPI(options: LLMCallOptions): Promise<LLMResponse> {
  const { model, messages, tools, temperature, timeout, signal } = options;

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

  const timeoutId = setTimeout(() => {
    if (!resolved) {
      streamError = new Error(`LLM 调用超时（${timeout / 1000}秒）`);
      resolved = true;
    }
  }, timeout);

  if (signal) {
    signal.addEventListener('abort', () => {
      if (!resolved) {
        streamError = new Error('Cancelled');
        resolved = true;
      }
    });
  }

  await collect();
  clearTimeout(timeoutId);

  if (streamError) {
    if (streamError.message.includes('Cancelled')) {
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

export function parseToolArguments(rawArgs: string): Record<string, unknown> {
  try {
    return JSON.parse(rawArgs);
  } catch {
    const repaired = tryRepairJson(rawArgs) || tryTrimJson(rawArgs);
    if (repaired) {
      try {
        return JSON.parse(repaired);
      } catch {
        // ignore
      }
    }
    console.warn('[parseToolArguments] JSON 解析失败，返回空对象。原始参数:', rawArgs.slice(0, 300));
    return {};
  }
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
            if (tc.function?.name) existing.name += tc.function.name;
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

  xhr.timeout = timeout;

  if (signal) {
    signal.addEventListener('abort', () => {
      streamError = new Error('Cancelled');
      finished = true;
      xhr.abort();
      wake();
    });
  }

  let currentEvent = '';
  let currentData = '';

  xhr.onprogress = () => {
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
    wake();
  };

  xhr.ontimeout = () => {
    streamError = new Error(`LLM 调用超时（${timeout / 1000}秒）`);
    finished = true;
    wake();
  };

  xhr.send(requestBody);

  while (true) {
    while (pending.length > 0) {
      yield pending.shift()!;
    }
    if (finished) break;
    await new Promise<void>((resolve) => { waiter = resolve; });
  }

  if (streamError) {
    if (streamError.message.includes('Cancelled') || streamError.message.includes('abort')) {
      throw new Error('Cancelled');
    }
    throw streamError;
  }
}