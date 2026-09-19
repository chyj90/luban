import { useState, useEffect, useCallback, useRef } from 'react';
import { FlaskConical, Loader2, Play } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import { useToastStore } from '@/stores/toastStore';
import {
  listRegressionPackages,
  runRegression,
  getAsyncTask,
  type RegressionPackageInfo,
} from '@/api/concept';
import './og-page.css';
import './OntologyRegressionPage.css';

interface CaseCheck {
  check: string;
  expected: string;
  actual: string;
  pass: boolean;
}

interface RegressionCaseResult {
  id: string;
  question: string;
  pass: boolean;
  checks: CaseCheck[];
  answerExcerpt: string;
  sql: string;
}

interface RegressionReport {
  package: string;
  packageDisplayName: string;
  total: number;
  passed: number;
  failed: number;
  results: RegressionCaseResult[];
}

export default function OntologyRegressionPage() {
  const [packages, setPackages] = useState<RegressionPackageInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningTask, setRunningTask] = useState<{ name: string; taskId: number } | null>(null);
  const [progress, setProgress] = useState('');
  const [report, setReport] = useState<RegressionReport | null>(null);
  const toast = useToastStore((s) => s.show);
  const runningRef = useRef(runningTask);
  runningRef.current = runningTask;

  const fetchPackages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listRegressionPackages();
      setPackages(res.data || []);
    } catch {
      toast('加载问题集失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchPackages(); }, [fetchPackages]);

  useEffect(() => {
    const timer = setInterval(async () => {
      const cur = runningRef.current;
      if (!cur) return;
      try {
        const res = await getAsyncTask(cur.taskId);
        const t = res.data;
        if (t.status === 'COMPLETED') {
          setProgress('');
          try {
            setReport(JSON.parse(t.result || '{}') as RegressionReport);
          } catch {
            toast('报告解析失败', 'error');
          }
          setRunningTask(null);
        } else if (t.status === 'FAILED') {
          setProgress('');
          toast('回归执行失败: ' + (t.errorMsg || '未知错误'), 'error');
          setRunningTask(null);
        } else {
          setProgress(t.currentStep || '运行中...');
        }
      } catch { /* 单次轮询失败忽略 */ }
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  const startRun = async (name: string) => {
    if (runningTask) return;
    try {
      const res = await runRegression(name);
      setRunningTask({ name, taskId: res.data.taskId });
      setReport(null);
      setProgress('启动中...');
    } catch (e) {
      toast(e instanceof Error ? e.message : '启动失败', 'error');
    }
  };

  return (
    <div className="og-page">
      <PageTopbar
        icon={<FlaskConical size={22} />}
        title="语义包回归"
        subtitle="典型问题集跑真实问数链路，度量内置本体质量——概念命中、SQL 落表、回答可用性"
      />
      <div className="og-page__content">
        {loading ? (
          <div className="og-page__loading"><Loader2 size={22} className="og-page__spin" /></div>
        ) : (
          <table className="bp-table">
            <thead>
              <tr>
                <th>语义包</th>
                <th>说明</th>
                <th>用例数</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {packages.map((p) => (
                <tr key={p.name}>
                  <td className="bp-ds-name">{p.displayName}<span className="bp-ds-id">{p.name}</span></td>
                  <td style={{ maxWidth: 420 }}>{p.description}</td>
                  <td>{p.caseCount}</td>
                  <td>
                    <button
                      className="bp-btn bp-btn--primary"
                      disabled={!!runningTask}
                      onClick={() => startRun(p.name)}
                    >
                      {runningTask?.name === p.name ? <Loader2 size={13} className="bp-spin" /> : <Play size={13} />}
                      运行回归
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {runningTask && (
          <div className="bp-autobind-progress" style={{ marginTop: 14 }}>
            <Loader2 size={14} className="bp-spin" />
            <span>正在运行「{runningTask.name}」回归：{progress}（每用例约 5~30 秒，会话记录自动清理）</span>
          </div>
        )}

        {report && (
          <div className="bp-detail" style={{ marginTop: 18 }}>
            <div className={`bp-autobind-result ${report.failed === 0 ? 'bp-autobind-result--done' : 'bp-autobind-result--error'}`} style={{ fontSize: 14 }}>
              <b>{report.packageDisplayName}</b>：通过 {report.passed}/{report.total}
              {report.failed > 0 ? `，失败 ${report.failed} 个（见下方 ✗ 检查项）` : ''}
            </div>
            <table className="bp-table">
              <thead>
                <tr>
                  <th style={{ width: 30 }}></th>
                  <th>问题</th>
                  <th>检查明细</th>
                </tr>
              </thead>
              <tbody>
                {report.results.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontSize: 15 }}>{c.pass ? '✅' : '❌'}</td>
                    <td className="bp-ds-name" style={{ fontWeight: 400 }}>{c.question}</td>
                    <td>
                      {c.checks.map((ck, i) => (
                        <div key={i} style={{ fontSize: 12, marginBottom: 4 }}>
                          <span style={{ color: ck.pass ? '#52c41a' : '#ff4d4f' }}>{ck.pass ? '✓' : '✗'}</span>
                          {' '}{ck.check}：<span style={{ color: '#8c8c8c' }}>{ck.actual}</span>
                        </div>
                      ))}
                      {c.sql && <div style={{ fontSize: 11, color: '#1677ff' }}><code>{c.sql}</code></div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
