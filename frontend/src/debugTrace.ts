// debugTrace.ts - 全局调试日志，在代码中调用 bug_trace_log() 记录，F12 调用 copy_bug_trace() 导出
const BUG_TRACE_KEY = '__bug_trace_log__';

(window as unknown).bug_trace_log = (key: string, value: unknown) => {
  const logs: Array<{ time: string; key: string; value: unknown }> = JSON.parse(localStorage.getItem(BUG_TRACE_KEY) || '[]');
  logs.push({ time: new Date().toISOString(), key, value });
  localStorage.setItem(BUG_TRACE_KEY, JSON.stringify(logs));
};

(window as unknown).copy_bug_trace = () => {
  const logs = JSON.parse(localStorage.getItem(BUG_TRACE_KEY) || '[]');
  const text = JSON.stringify({
    url: window.location.href,
    userAgent: navigator.userAgent,
    logs,
  }, null, 2);
  navigator.clipboard.writeText(text).then(() => {
    console.log(`✅ 已复制 ${logs.length} 条日志`);
  });
  return logs;
};

(window as unknown).clear_bug_trace = () => {
  localStorage.removeItem(BUG_TRACE_KEY);
  console.log('✅ 调试记录已清空');
};

console.log(
  '%c🐛 Debug Trace 就绪 %c| %cbug_trace_log(key, value)%c 记录 %c| %ccopy_bug_trace()%c 导出 %c| %cclear_bug_trace()%c 清空',
  'color:#e6a23c;font-weight:bold', '',
  'color:#409eff', '', '', 'color:#409eff', '', '', 'color:#409eff', '',
);