import { get } from '@/api/client';

let cachedDeployMode: string | null = null;

export async function getDeployMode(): Promise<string> {
  if (cachedDeployMode !== null) return cachedDeployMode;
  try {
    const res = await get<{ deployMode: string }>('/config');
    cachedDeployMode = res.data.deployMode || 'standard';
  } catch {
    cachedDeployMode = 'standard';
  }
  return cachedDeployMode;
}