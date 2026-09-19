import { getAsyncTask, type AsyncTaskInfo } from '@/api/concept';

/**
 * 轮询异步任务直到终态（COMPLETED / FAILED）。
 * 超时抛 Error('timeout')，调用方按"任务仍在后台执行"提示并引导去异步任务列表查看。
 */
export async function pollTaskUntilDone(taskId: number, timeoutMs = 120000, intervalMs = 2000): Promise<AsyncTaskInfo> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await getAsyncTask(taskId);
    if (res.data.status === 'COMPLETED' || res.data.status === 'FAILED') return res.data;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('timeout');
}
