import { get } from '@/api/client';
import type { DriverInfo, InstallProgress } from '@/types/datasource';
import { useAuthStore } from '@/stores/authStore';

export async function listDrivers() {
  const res = await get<DriverInfo[]>('/drivers');
  if (res.data) {
    res.data = res.data.map((d: DriverInfo) => ({
      ...d,
      extraFields: typeof d.extraFields === 'string' ? JSON.parse(d.extraFields) : d.extraFields,
    }));
  }
  return res;
}

const BASE_URL = '/api/v1';

export function installDriver(
  name: string,
  onProgress: (progress: InstallProgress) => void,
  onComplete: () => void,
  onError: (err: string) => void,
) {
  const url = `${BASE_URL}/drivers/${name}/install`;
  const token = useAuthStore.getState().token;
  const controller = new AbortController();

  fetch(url, {
    headers: {
      Authorization: token ? `Bearer ${token}` : '',
    },
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      onError(text || `HTTP ${response.status}`);
      return;
    }
    const reader = response.body?.getReader();
    if (!reader) { onError('浏览器不支持流式读取'); return; }
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';
    let completed = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) { eventType = ''; continue; }
        if (trimmed.startsWith('event:')) {
          eventType = trimmed.slice(6).trim();
          continue;
        }
        if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim();
          if (eventType === 'complete') { completed = true; onComplete(); return; }
          if (eventType === 'error') { completed = true; onError(data); return; }
          try { onProgress(JSON.parse(data)); }
          catch { onProgress({ phase: 'DOWNLOADING', fileName: data, current: 0, total: 0, percent: 0 }); }
        }
      }
    }
    if (!completed) onComplete();
  }).catch((err) => {
    if (err.name !== 'AbortError') onError(err.message || '安装失败');
  });

  return { close: () => controller.abort() };
}