import type { ToolExecuteResult } from '@/types/agent';

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

export interface LLMCallOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: LLMMessage[];
  tools: ToolDef[];
  temperature: number;
  timeout: number;
  signal?: AbortSignal;
}

export async function callLLMAPI(options: LLMCallOptions): Promise<LLMResponse> {
  const { baseUrl, apiKey, model, messages, tools, temperature, timeout, signal } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
  }

  const startTime = Date.now();
  const msgSummary = messages.map((m) => `${m.role}${m.tool_calls ? `(${m.tool_calls.length} tool_calls)` : ''}${m.tool_call_id ? `(tool_call_id)` : ''}`).join(' → ');
  const toolNames = tools.map((t) => t.function.name).join(', ');
  console.log(`[LLM] 调用 ${model} | 消息: ${msgSummary} | 工具: [${toolNames}] | temperature: ${temperature}`);

  try {
    const apiUrl = `${baseUrl}/chat/completions`;
    const requestBody = JSON.stringify({
      model,
      messages,
      tools,
      tool_choice: 'auto',
      temperature,
      stream: false,
    });

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: requestBody,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorBody = await res.text();
      const err: any = new Error(`LLM API 调用失败 (${res.status}): ${errorBody}`);
      err.status = res.status;
      console.error(`[LLM] API 失败 (${res.status}): ${errorBody.slice(0, 500)}`);
      throw err;
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const message = choice?.message;

    const content = message?.content || '';
    const toolCalls = message?.tool_calls || [];
    const elapsed = Date.now() - startTime;
    const usage = data.usage;

    if (toolCalls.length > 0) {
      console.log(`[LLM] ${elapsed}ms | ${toolCalls.length} tool_calls: [${toolCalls.map((tc: any) => tc.function.name).join(', ')}] | content: "${content.slice(0, 100)}"${usage ? ` | tokens: ${usage.prompt_tokens}→${usage.completion_tokens}` : ''}`);
      console.log(`[LLM] ${elapsed}ms | 纯文本回复 | content: "${content.slice(0, 200)}${content.length > 200 ? '...' : ''}"${usage ? ` | tokens: ${usage.prompt_tokens}→${usage.completion_tokens}` : ''}`);
    }

    return { content, toolCalls };
  } catch (e: any) {
    clearTimeout(timeoutId);
    const elapsed = Date.now() - startTime;
    if (e.name === 'AbortError') {
      if (signal?.aborted) {
        console.log(`[LLM] ${elapsed}ms | 用户手动取消`);
        throw new Error('Cancelled');
      }
      console.error(`[LLM] ${elapsed}ms | 超时（${timeout / 1000}秒）`);
      throw new Error(`LLM 调用超时（${timeout / 1000}秒）`);
    }
    console.error(`[LLM] ${elapsed}ms | 异常: ${e.message}`);
    throw e;
  }
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
    return {};
  }
}