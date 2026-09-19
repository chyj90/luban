import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { Link2, Plus, Trash2, RefreshCw, Loader2, Save, X, Zap } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import { useToastStore } from '@/stores/toastStore';
import {
  listBindingProfiles,
  getBindingProfile,
  updateBindingProfile,
  refreshEnumColumn,
  autoBindProfile,
  getAsyncTask,
  applyAutoMatchMappings,
  listFederationBridges,
  createFederationBridge,
  deleteFederationBridge,
  type BindingProfileInfo,
  type SynonymDictEntry,
  type EnumDictEntry,
  type FederationBridgeInfo,
} from '@/api/concept';
import './BindingProfilePage.css';

interface AutoBindState {
  taskId: number;
  status: string;
  currentStep?: string;
  conceptCount: number;
  summary?: { total: number; matched: number; ruleCovered: number; llmFallback: number; unmatched: number };
  applied?: { created: number; skipped: number; createdJoins: number; skippedJoins: number };
  error?: string;
}

export default function BindingProfilePage() {
  const [profiles, setProfiles] = useState<BindingProfileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDs, setExpandedDs] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ id: number; name: string; description: string; synonymDict: SynonymDictEntry[]; enumDict: EnumDictEntry[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enumTable, setEnumTable] = useState('');
  const [enumColumn, setEnumColumn] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [autoBind, setAutoBind] = useState<Record<number, AutoBindState>>({});
  const [applying, setApplying] = useState(false);
  const [bridges, setBridges] = useState<FederationBridgeInfo[]>([]);
  const [showBridgeForm, setShowBridgeForm] = useState(false);
  const [bridgeForm, setBridgeForm] = useState({ name: '', leftDatasourceId: '', leftTable: '', leftColumn: '', rightDatasourceId: '', rightTable: '', rightColumn: '', joinType: 'INNER' });
  const [bridgeSaving, setBridgeSaving] = useState(false);
  const toast = useToastStore((s) => s.show);
  const autoBindRef = useRef(autoBind);

  useEffect(() => { autoBindRef.current = autoBind; }, [autoBind]);

  // 轮询进行中的一键绑定任务
  useEffect(() => {
    const timer = setInterval(async () => {
      const active = Object.entries(autoBindRef.current)
        .filter(([, v]) => v.status === 'RUNNING' || v.status === 'PENDING');
      for (const [dsIdStr, v] of active) {
        try {
          const res = await getAsyncTask(v.taskId);
          const t = res.data;
          if (t.status === 'COMPLETED') {
            let summary: AutoBindState['summary'];
            try {
              const r = JSON.parse(t.result || '{}');
              const crs: Array<Record<string, unknown>> = r.conceptResults || [];
              summary = {
                total: crs.length,
                matched: crs.filter((cr) => Array.isArray(cr.candidates) && (cr.candidates as unknown[]).length > 0).length,
                ruleCovered: Number(r.ruleCoveredConcepts || 0),
                llmFallback: Number(r.llmFallbackConcepts || 0),
                unmatched: typeof r.unmatchedConcepts === 'number'
                  ? r.unmatchedConcepts
                  : Array.isArray(r.unmatchedConcepts) ? r.unmatchedConcepts.length : 0,
              };
            } catch { /* result parse fallback */ }
            setAutoBind((prev) => ({ ...prev, [Number(dsIdStr)]: { ...v, status: 'COMPLETED', summary } }));
          } else if (t.status === 'FAILED') {
            setAutoBind((prev) => ({ ...prev, [Number(dsIdStr)]: { ...v, status: 'FAILED', error: t.errorMsg || '自动匹配失败' } }));
          } else {
            setAutoBind((prev) => ({ ...prev, [Number(dsIdStr)]: { ...v, status: t.status, currentStep: t.currentStep } }));
          }
        } catch { /* 单次轮询失败忽略，下个周期重试 */ }
      }
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  const startAutoBind = async (datasourceId: number) => {
    try {
      const res = await autoBindProfile(datasourceId);
      setAutoBind((prev) => ({
        ...prev,
        [datasourceId]: { taskId: res.data.taskId, status: 'RUNNING', conceptCount: res.data.conceptCount },
      }));
      toast(`自动匹配任务 #${res.data.taskId} 已启动（${res.data.conceptCount} 个概念）`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : '启动自动匹配失败', 'error');
    }
  };

  const applyAutoBind = async (datasourceId: number) => {
    const st = autoBind[datasourceId];
    if (!st?.taskId) return;
    setApplying(true);
    try {
      const res = await applyAutoMatchMappings(st.taskId);
      const d = res.data;
      setAutoBind((prev) => ({
        ...prev,
        [datasourceId]: { ...st, applied: { created: d.created, skipped: d.skipped, createdJoins: d.createdJoins, skippedJoins: d.skippedJoins } },
      }));
      toast(`已应用：新建 ${d.created} 条映射、${d.createdJoins} 条 JOIN，跳过 ${d.skipped} 条`, 'success');
      fetchProfiles();
    } catch (e) {
      toast(e instanceof Error ? e.message : '应用失败', 'error');
    } finally {
      setApplying(false);
    }
  };

  const fetchBridges = useCallback(async () => {
    try {
      const res = await listFederationBridges();
      setBridges(res.data || []);
    } catch { /* 可选区块 */ }
  }, []);

  useEffect(() => { fetchBridges(); }, [fetchBridges]);

  const handleBridgeCreate = async () => {
    if (!bridgeForm.leftDatasourceId || !bridgeForm.rightDatasourceId
        || !bridgeForm.leftTable || !bridgeForm.rightTable
        || !bridgeForm.leftColumn || !bridgeForm.rightColumn) {
      toast('请填写两侧数据源与表/列', 'warning');
      return;
    }
    setBridgeSaving(true);
    try {
      await createFederationBridge({
        name: bridgeForm.name || undefined,
        leftDatasourceId: Number(bridgeForm.leftDatasourceId),
        leftTable: bridgeForm.leftTable.trim(),
        leftColumn: bridgeForm.leftColumn.trim(),
        rightDatasourceId: Number(bridgeForm.rightDatasourceId),
        rightTable: bridgeForm.rightTable.trim(),
        rightColumn: bridgeForm.rightColumn.trim(),
        joinType: bridgeForm.joinType,
      });
      toast('桥接已创建', 'success');
      setShowBridgeForm(false);
      setBridgeForm({ name: '', leftDatasourceId: '', leftTable: '', leftColumn: '', rightDatasourceId: '', rightTable: '', rightColumn: '', joinType: 'INNER' });
      fetchBridges();
    } catch (e) {
      toast(e instanceof Error ? e.message : '创建失败', 'error');
    } finally {
      setBridgeSaving(false);
    }
  };

  const handleBridgeDelete = async (id: number) => {
    try {
      await deleteFederationBridge(id);
      setBridges((prev) => prev.filter((b) => b.id !== id));
    } catch {
      toast('删除失败', 'error');
    }
  };

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listBindingProfiles();
      setProfiles(res.data || []);
    } catch {
      toast('加载绑定集失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchProfiles(); }, [fetchProfiles]);

  const openDetail = async (datasourceId: number) => {
    if (expandedDs === datasourceId) {
      setExpandedDs(null);
      setDetail(null);
      return;
    }
    setExpandedDs(datasourceId);
    setDetailLoading(true);
    try {
      const res = await getBindingProfile(datasourceId);
      let synonyms: SynonymDictEntry[] = [];
      let enums: EnumDictEntry[] = [];
      try { synonyms = res.data.synonymDict ? JSON.parse(res.data.synonymDict) : []; } catch { /* ignore */ }
      try { enums = res.data.enumDict ? JSON.parse(res.data.enumDict) : []; } catch { /* ignore */ }
      setDetail({
        id: res.data.id,
        name: res.data.name,
        description: res.data.description || '',
        synonymDict: synonyms,
        enumDict: enums,
      });
    } catch {
      toast('加载绑定集详情失败', 'error');
    } finally {
      setDetailLoading(false);
    }
  };

  const saveProfile = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      await updateBindingProfile(detail.id, {
        name: detail.name,
        description: detail.description,
        synonymDict: detail.synonymDict,
      });
      toast('绑定集已保存', 'success');
      fetchProfiles();
    } catch {
      toast('保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRefreshEnum = async () => {
    if (!expandedDs || !enumTable.trim() || !enumColumn.trim()) {
      toast('请填写表名和列名', 'warning');
      return;
    }
    setRefreshing(true);
    try {
      const res = await refreshEnumColumn(expandedDs, enumTable.trim(), enumColumn.trim());
      toast(`已缓存 ${res.data.values.length} 个枚举值`, 'success');
      setDetail((prev) => prev ? {
        ...prev,
        enumDict: [
          ...prev.enumDict.filter((e) => !(e.table === res.data.table && e.column === res.data.column)),
          { table: res.data.table, column: res.data.column, values: res.data.values, syncedAt: new Date().toISOString() },
        ],
      } : prev);
      setEnumTable('');
      setEnumColumn('');
    } catch (e) {
      toast(e instanceof Error ? e.message : '枚举值刷新失败', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const updateSynonym = (idx: number, field: keyof SynonymDictEntry, value: string) => {
    setDetail((prev) => {
      if (!prev) return prev;
      const list = [...prev.synonymDict];
      if (field === 'synonyms') {
        list[idx] = { ...list[idx], synonyms: value ? value.split(/[，,]/).map((s) => s.trim()).filter(Boolean) : [] };
      } else {
        list[idx] = { ...list[idx], [field]: value };
      }
      return { ...prev, synonymDict: list };
    });
  };

  return (
    <div className="bp-page">
      <PageTopbar
        icon={<Link2 size={22} />}
        title="绑定管理"
        subtitle="每个数据源一套绑定集：概念映射覆盖 + 术语词典 + 枚举字典，问数按绑定集路由"
      />

      <div className="bp-content">
        {/* 跨源桥接（全局） */}
        <div className="bp-section" style={{ marginBottom: 20 }}>
          <div className="bp-section-title">
            跨源桥接
            <span className="bp-section-hint">声明两个数据源之间的等值联接键；问数遇到跨源问题时按 nl2sql_federated 生成两条分源 SQL，平台内存合并</span>
            <button className="bp-btn" style={{ marginLeft: 10 }} onClick={() => setShowBridgeForm(!showBridgeForm)}>
              {showBridgeForm ? '收起' : '新建桥接'}
            </button>
          </div>
          {showBridgeForm && (
            <div className="bp-enum-refresh" style={{ flexWrap: 'wrap', marginBottom: 10, gap: 6 }}>
              <input placeholder="名称(可选)" value={bridgeForm.name} onChange={(e) => setBridgeForm({ ...bridgeForm, name: e.target.value })} style={{ width: 110 }} />
              <select value={bridgeForm.leftDatasourceId} onChange={(e) => setBridgeForm({ ...bridgeForm, leftDatasourceId: e.target.value })} style={{ padding: '5px 8px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 12 }}>
                <option value="">左侧数据源</option>
                {profiles.map((p) => <option key={p.datasourceId} value={p.datasourceId}>{p.datasourceName} #{p.datasourceId}</option>)}
              </select>
              <input placeholder="左表" value={bridgeForm.leftTable} onChange={(e) => setBridgeForm({ ...bridgeForm, leftTable: e.target.value })} style={{ width: 120 }} />
              <input placeholder="左列" value={bridgeForm.leftColumn} onChange={(e) => setBridgeForm({ ...bridgeForm, leftColumn: e.target.value })} style={{ width: 100 }} />
              <span>↔</span>
              <select value={bridgeForm.rightDatasourceId} onChange={(e) => setBridgeForm({ ...bridgeForm, rightDatasourceId: e.target.value })} style={{ padding: '5px 8px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 12 }}>
                <option value="">右侧数据源</option>
                {profiles.map((p) => <option key={p.datasourceId} value={p.datasourceId}>{p.datasourceName} #{p.datasourceId}</option>)}
              </select>
              <input placeholder="右表" value={bridgeForm.rightTable} onChange={(e) => setBridgeForm({ ...bridgeForm, rightTable: e.target.value })} style={{ width: 120 }} />
              <input placeholder="右列" value={bridgeForm.rightColumn} onChange={(e) => setBridgeForm({ ...bridgeForm, rightColumn: e.target.value })} style={{ width: 100 }} />
              <select value={bridgeForm.joinType} onChange={(e) => setBridgeForm({ ...bridgeForm, joinType: e.target.value })} style={{ padding: '5px 8px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 12 }}>
                <option value="INNER">INNER</option>
                <option value="LEFT">LEFT</option>
              </select>
              <button className="bp-btn bp-btn--primary" onClick={handleBridgeCreate} disabled={bridgeSaving}>
                {bridgeSaving ? <Loader2 size={13} className="bp-spin" /> : null} 保存
              </button>
            </div>
          )}
          {bridges.length > 0 && (
            <table className="bp-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>左侧</th>
                  <th>右侧</th>
                  <th>联接</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {bridges.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td style={{ fontSize: 12 }}>#{b.leftDatasourceId} {b.leftDatasourceName} · {b.leftTable}.{b.leftColumn}</td>
                    <td style={{ fontSize: 12 }}>#{b.rightDatasourceId} {b.rightDatasourceName} · {b.rightTable}.{b.rightColumn}</td>
                    <td>{b.joinType}</td>
                    <td>
                      <button className="bp-btn" title="删除" onClick={() => handleBridgeDelete(b.id)}><Trash2 size={12} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {loading ? (
          <div className="bp-loading"><Loader2 size={22} className="bp-spin" /></div>
        ) : profiles.length === 0 ? (
          <div className="bp-empty">
            暂无绑定集。数据源接入并完成概念映射后，会自动生成对应绑定集。
          </div>
        ) : (
          <table className="bp-table">
            <thead>
              <tr>
                <th>数据源</th>
                <th>状态</th>
                <th>映射覆盖</th>
                <th>术语词条</th>
                <th>枚举列</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <Fragment key={p.id}>
                  <tr className={expandedDs === p.datasourceId ? 'bp-row-active' : ''}>
                    <td className="bp-ds-name">
                      {p.datasourceName}
                      <span className="bp-ds-id">#{p.datasourceId}</span>
                    </td>
                    <td>
                      <span className={`bp-status bp-status--${p.status.toLowerCase()}`}>
                        {p.status === 'ACTIVE' ? '已绑定' : '未绑定'}
                      </span>
                    </td>
                    <td>{p.mappedConcepts} / {p.totalConcepts} 个概念</td>
                    <td>{p.synonymCount}</td>
                    <td>{p.enumColumnCount}</td>
                    <td>
                      <button className="bp-btn" onClick={() => openDetail(p.datasourceId)}>
                        {expandedDs === p.datasourceId ? '收起' : '管理'}
                      </button>
                    </td>
                  </tr>
                  {expandedDs === p.datasourceId && (
                    <tr>
                      <td colSpan={6} className="bp-detail-cell">
                        {detailLoading || !detail ? (
                          <div className="bp-loading"><Loader2 size={18} className="bp-spin" /></div>
                        ) : (
                          <div className="bp-detail">
                            <div className="bp-section">
                              <div className="bp-section-title">
                                一键接入绑定
                                <span className="bp-section-hint">全量概念自动匹配（规则优先 + LLM 兜底）→ 确认后生成绑定</span>
                              </div>
                              {!autoBind[expandedDs] && (
                                <button className="bp-btn bp-btn--primary" onClick={() => startAutoBind(expandedDs)}>
                                  <Zap size={13} /> 启动自动匹配
                                </button>
                              )}
                              {autoBind[expandedDs] && (autoBind[expandedDs].status === 'RUNNING' || autoBind[expandedDs].status === 'PENDING') && (
                                <div className="bp-autobind-progress">
                                  <Loader2 size={14} className="bp-spin" />
                                  <span>{autoBind[expandedDs].currentStep || '正在匹配...'}</span>
                                </div>
                              )}
                              {autoBind[expandedDs].status === 'FAILED' && (
                                <div className="bp-autobind-result bp-autobind-result--error">
                                  自动匹配失败：{autoBind[expandedDs].error}
                                  <button className="bp-btn" onClick={() => startAutoBind(expandedDs)} style={{ marginLeft: 10 }}>重试</button>
                                </div>
                              )}
                              {autoBind[expandedDs].status === 'COMPLETED' && !autoBind[expandedDs].applied && (() => {
                                const s = autoBind[expandedDs].summary;
                                return (
                                  <div className="bp-autobind-result">
                                    <span>
                                      匹配完成：<b>{s?.matched ?? '-'}</b>/{s?.total ?? '-'} 个概念有候选映射
                                      （规则覆盖 {s?.ruleCovered ?? 0}，LLM 兜底 {s?.llmFallback ?? 0}，未匹配 {s?.unmatched ?? 0}）
                                    </span>
                                    <button className="bp-btn bp-btn--primary" onClick={() => applyAutoBind(expandedDs!)} disabled={applying} style={{ marginLeft: 10 }}>
                                      {applying ? <Loader2 size={13} className="bp-spin" /> : null} 确认应用
                                    </button>
                                  </div>
                                );
                              })()}
                              {autoBind[expandedDs].applied && (
                                <div className="bp-autobind-result bp-autobind-result--done">
                                  已生效：新建 {autoBind[expandedDs].applied!.created} 条映射、{autoBind[expandedDs].applied!.createdJoins} 条 JOIN，
                                  跳过 {autoBind[expandedDs].applied!.skipped} 条
                                  <button className="bp-btn" onClick={() => startAutoBind(expandedDs!)} style={{ marginLeft: 10 }}>重新匹配</button>
                                </div>
                              )}
                            </div>

                            <div className="bp-section">
                              <div className="bp-section-title">基本信息</div>
                              <div className="bp-form-row">
                                <label>名称</label>
                                <input value={detail.name} onChange={(e) => setDetail({ ...detail, name: e.target.value })} />
                              </div>
                              <div className="bp-form-row">
                                <label>描述</label>
                                <input value={detail.description} onChange={(e) => setDetail({ ...detail, description: e.target.value })} />
                              </div>
                            </div>

                            <div className="bp-section">
                              <div className="bp-section-title">
                                术语词典
                                <span className="bp-section-hint">分公司方言 → 集团概念口径，问数时注入 prompt</span>
                              </div>
                              {detail.synonymDict.length > 0 && (
                                <div className="bp-synonym-list">
                                  <div className="bp-synonym-head">
                                    <span>方言术语</span><span>对齐概念</span><span>同义词</span><span>备注</span><span></span>
                                  </div>
                                  {detail.synonymDict.map((s, i) => (
                                    <div key={i} className="bp-synonym-row">
                                      <input value={s.term || ''} onChange={(e) => updateSynonym(i, 'term', e.target.value)} placeholder="如：立账组织" />
                                      <input value={s.conceptName || ''} onChange={(e) => updateSynonym(i, 'conceptName', e.target.value)} placeholder="如：公司" />
                                      <input value={(s.synonyms || []).join('，')} onChange={(e) => updateSynonym(i, 'synonyms', e.target.value)} placeholder="逗号分隔" />
                                      <input value={s.note || ''} onChange={(e) => updateSynonym(i, 'note', e.target.value)} placeholder="如：用友叫法" />
                                      <button className="bp-icon-btn" title="删除" onClick={() => setDetail({ ...detail, synonymDict: detail.synonymDict.filter((_, j) => j !== i) })}>
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <button className="bp-btn" onClick={() => setDetail({ ...detail, synonymDict: [...detail.synonymDict, { term: '', synonyms: [] }] })}>
                                <Plus size={13} /> 添加词条
                              </button>
                            </div>

                            <div className="bp-section">
                              <div className="bp-section-title">
                                枚举字典
                                <span className="bp-section-hint">缓存列枚举值，问数溯源校验免实连数据源</span>
                              </div>
                              {detail.enumDict.length > 0 && (
                                <div className="bp-enum-list">
                                  {detail.enumDict.map((e, i) => (
                                    <div key={i} className="bp-enum-item">
                                      <code>{e.table}.{e.column}</code>
                                      <span>{(e.values || []).length} 个值</span>
                                      <button className="bp-icon-btn" title="移除" onClick={() => setDetail({ ...detail, enumDict: detail.enumDict.filter((_, j) => j !== i) })}>
                                        <X size={12} />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="bp-enum-refresh">
                                <input placeholder="表名，如 t_order" value={enumTable} onChange={(e) => setEnumTable(e.target.value)} />
                                <input placeholder="列名，如 status" value={enumColumn} onChange={(e) => setEnumColumn(e.target.value)} />
                                <button className="bp-btn" onClick={handleRefreshEnum} disabled={refreshing}>
                                  {refreshing ? <Loader2 size={13} className="bp-spin" /> : <RefreshCw size={13} />} 拉取枚举值
                                </button>
                              </div>
                            </div>

                            <button className="bp-btn bp-btn--primary" onClick={saveProfile} disabled={saving}>
                              {saving ? <Loader2 size={13} className="bp-spin" /> : <Save size={13} />} 保存绑定集
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
