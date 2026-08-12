export interface SSEChunk {
  content: string;
  reasoningContent: string;
  toolCalls: Array<{ index: number; id: string; name: string; arguments: string }>;
  isDone: boolean;
}

export function parseSSELine(line: string): SSEChunk | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('data: ')) return null;

  const data = trimmed.slice(6);
  if (data === '[DONE]') return { content: '', reasoningContent: '', toolCalls: [], isDone: true };

  try {
    const parsed = JSON.parse(data);
    const delta = parsed.choices?.[0]?.delta;

    return {
      content: delta?.content || '',
      reasoningContent: delta?.reasoning_content || '',
      toolCalls: (delta?.tool_calls || []).map((tc: Record<string, unknown>) => ({
        index: (tc.index as number) ?? 0,
        id: (tc.id as string) || '',
        name: tc.function ? (tc.function as Record<string, string>).name || '' : '',
        arguments: tc.function ? (tc.function as Record<string, string>).arguments || '' : '',
      })),
      isDone: false,
    };
  } catch {
    return null;
  }
}

export function parseSSEStream(
  text: string,
  onChunk: (chunk: SSEChunk) => void,
): void {
  const lines = text.split('\n');
  for (const line of lines) {
    const chunk = parseSSELine(line);
    if (chunk) onChunk(chunk);
  }
}