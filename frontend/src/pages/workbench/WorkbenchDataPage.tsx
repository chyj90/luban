import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listInsightSavedQueries, runQuery } from '@/api';
import { listAccessibleApplications } from '@/api/application';
import { useToastStore } from '@/stores/toastStore';
import type { Query, RunQueryResponse } from '@/types/query';
import styles from './WorkbenchDataPage.module.css';

/**
 * 工作中心 · 数据看板：展示洞察沉淀的查询（source=INSIGHT）。
 * "洞察发现 → 开发固化 → 工作中心消费"链路的消费端：
 * 业务用户在这里直接运行沉淀下来的分析，或跳转开发中心把它组装进应用页面。
 */
export default function WorkbenchDataPage() {
  const toast = useToastStore((s) => s.show);
  const navigate = useNavigate();
  const [queries, setQueries] = useState<Query[]>([]);
  const [appNameMap, setAppNameMap] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [result, setResult] = useState<{ query: Query; data: RunQueryResponse } | null>(null);

  useEffect(() => {
    Promise.all([
      listInsightSavedQueries().then((res) => res.data).catch(() => []),
      listAccessibleApplications().then((res) => res.data || []).catch(() => []),
    ]).then(([saved, apps]) => {
      setQueries(saved);
      setAppNameMap(new Map(apps.map((a) => [a.id, a.name])));
    }).finally(() => setLoading(false));
  }, []);

  const handleRun = async (q: Query) => {
    setRunningId(q.id);
    try {
      const res = await runQuery(q.id, { params: {} });
      setResult({ query: q, data: res.data });
    } catch {
      toast('查询执行失败，请联系应用开发者检查 SQL', 'error');
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.title}>数据看板</h2>
        <p className={styles.subtitle}>
          来自「智能问数」沉淀的分析查询——在问数里问出有价值的结论后，可以一键沉淀到这里反复查看；
          也可以到开发中心把查询组装进应用页面。
        </p>
      </div>

      {loading ? (
        <div className={styles.empty}>加载中...</div>
      ) : queries.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>还没有沉淀的数据查询</p>
          <p className={styles.emptyHint}>
            到「智能问数」用自然语言问数，回答支持「沉淀」操作，即可把分析 SQL 固化到这里。
          </p>
          <button className={styles.primaryBtn} onClick={() => navigate('/agent-chat')}>
            去智能问数
          </button>
        </div>
      ) : (
        <div className={styles.list}>
          {queries.map((q) => (
            <div key={q.id} className={styles.card}>
              <div className={styles.cardMain}>
                <div className={styles.cardTitle}>{q.name}</div>
                <div className={styles.cardMeta}>
                  <span className={styles.appTag}>{appNameMap.get(q.applicationId) || `应用 #${q.applicationId}`}</span>
                  {q.description && <span className={styles.desc}>{q.description}</span>}
                </div>
              </div>
              <div className={styles.cardActions}>
                <button className={styles.primaryBtn} onClick={() => handleRun(q)} disabled={runningId === q.id}>
                  {runningId === q.id ? '运行中...' : '运行'}
                </button>
                <button className={styles.ghostBtn} onClick={() => navigate(`/apps/${q.applicationId}`)}>
                  在开发中心打开
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {result && (
        <div className={styles.result}>
          <div className={styles.resultHeader}>
            <span className={styles.resultTitle}>{result.query.name} · {result.data.totalCount} 条 · {result.data.executionTime}ms</span>
            <button className={styles.ghostBtn} onClick={() => setResult(null)}>收起</button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {result.data.columns.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.data.rows.slice(0, 100).map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell == null ? '—' : String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
