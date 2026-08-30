import { useState, useEffect, useCallback, useMemo } from 'react';
import { Camera, GitCompare, RotateCcw, Plus, ChevronRight, Loader2, Check, AlertTriangle, Clock, Hash, User, FileText, ArrowRight, X } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import Select from '@/components/Select';
import { useToastStore } from '@/stores/toastStore';
import { useAuthStore } from '@/stores/authStore';
import { listSnapshots, createSnapshot, diffSnapshots, getSnapshot, rollbackSnapshot } from '@/api/snapshot';
import { listOntologyGroups, listIndustries } from '@/api/concept';
import type { ConceptSnapshot, DiffResult } from '@/api/snapshot';
import type { OntologyGroup, Industry } from '@/types/concept';
import './ConceptSnapshotPage.css';

type ViewMode = 'list' | 'diff' | 'detail';

export default function ConceptSnapshotPage() {
  const [snapshots, setSnapshots] = useState<ConceptSnapshot[]>([]);
  const [groups, setGroups] = useState<OntologyGroup[]>([]);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedIndustryId, setSelectedIndustryId] = useState<number | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [createError, setCreateError] = useState('');
  const [diffFromId, setDiffFromId] = useState<number | null>(null);
  const [diffToId, setDiffToId] = useState<number | null>(null);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [detailSnapshot, setDetailSnapshot] = useState<ConceptSnapshot | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<ConceptSnapshot | null>(null);
  const [rollbackConfirm, setRollbackConfirm] = useState(false);
  const [rollbackLoading, setRollbackLoading] = useState(false);

  const toast = useToastStore((s) => s.show);
  const user = useAuthStore((s) => s.user);

  const fetchSnapshots = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listSnapshots();
      setSnapshots(res.data || []);
    } catch {
      toast('加载快照列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchSnapshots();
    listOntologyGroups()
      .then((d) => setGroups(d.data || []))
      .catch(() => {});
    listIndustries()
      .then((d) => {
        setIndustries(d.data || []);
        if (d.data && d.data.length > 0) setSelectedIndustryId(d.data[0].id);
      })
      .catch(() => {});
  }, [fetchSnapshots]);

  const filteredGroups = useMemo(() => {
    if (!selectedIndustryId) return [];
    return groups.filter((g) => g.industryId === selectedIndustryId);
  }, [groups, selectedIndustryId]);

  const selectedGroup = useMemo(() => {
    return groups.find((g) => g.id === selectedGroupId) || null;
  }, [groups, selectedGroupId]);

  const selectedIndustry = useMemo(() => {
    return industries.find((i) => i.id === selectedIndustryId) || null;
  }, [industries, selectedIndustryId]);

  const autoVersion = useMemo(() => {
    if (!selectedIndustry || !selectedGroup) return '';
    const now = new Date();
    const ts = now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `v${selectedIndustry.id}-${selectedGroup.id}-${ts}-${random}`;
  }, [selectedIndustry, selectedGroup]);

  const handleCreate = async () => {
    setCreateError('');
    if (!selectedIndustryId) {
      setCreateError('请选择行业');
      return;
    }
    if (!selectedGroupId) {
      setCreateError('请选择概念域');
      return;
    }
    try {
      await createSnapshot({ groupId: selectedGroupId, version: autoVersion, comment, createdBy: user?.account || 'admin' });
      toast('快照创建成功', 'success');
      setShowCreate(false);
      setComment('');
      setSelectedGroupId(null);
      setCreateError('');
      fetchSnapshots();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '创建失败';
      toast(msg, 'error');
    }
  };

  const handleDiff = async () => {
    if (!diffFromId || !diffToId) return;
    setDiffLoading(true);
    try {
      const res = await diffSnapshots(diffFromId, diffToId);
      setDiffResult(res.data);
      setViewMode('diff');
    } catch {
      toast('比对失败', 'error');
    } finally {
      setDiffLoading(false);
    }
  };

  const handleViewDetail = async (id: number) => {
    try {
      const res = await getSnapshot(id);
      setDetailSnapshot(res.data);
      setViewMode('detail');
    } catch {
      toast('加载快照详情失败', 'error');
    }
  };

  const handleRollback = async () => {
    if (!rollbackTarget) return;
    setRollbackLoading(true);
    try {
      const res = await rollbackSnapshot(rollbackTarget.id, user?.account || 'admin');
      if (res.data?.success) {
        toast(`已回滚至版本 ${rollbackTarget.version}`, 'success');
        setRollbackTarget(null);
        setRollbackConfirm(false);
        fetchSnapshots();
      } else {
        toast(res.data?.error || '回滚失败', 'error');
      }
    } catch {
      toast('回滚失败', 'error');
    } finally {
      setRollbackLoading(false);
    }
  };

  const formatTime = (iso?: string) => {
    if (!iso) return '-';
    return iso.slice(0, 19).replace('T', ' ');
  };

  const formatSnapshotData = (snapshot: string) => {
    try {
      const data = JSON.parse(snapshot);
      if (Array.isArray(data)) {
        return `${data.length} 个概念`;
      }
      if (data && typeof data === 'object' && 'concepts' in data) {
        const concepts = data.concepts as Array<unknown>;
        const parts = [`${concepts.length} 个概念`];
        if (data.relations?.length > 0) parts.push(`${data.relations.length} 个关系`);
        if (data.mappings?.length > 0) parts.push(`${data.mappings.length} 个映射`);
        if (data.joinMappings?.length > 0) parts.push(`${data.joinMappings.length} 个关联`);
        if (data.toolBindings?.length > 0) parts.push(`${data.toolBindings.length} 个工具绑定`);
        return parts.join('，');
      }
      return String(data).slice(0, 80);
    } catch {
      return snapshot.slice(0, 80);
    }
  };

  const getGroupName = (groupId: number) => {
    return groups.find((g) => g.id === groupId)?.name || `域 #${groupId}`;
  };

  return (
    <div className="snapshot-page">
      <PageTopbar
        icon={<Camera size={22} />}
        title="变更审计中心"
        subtitle="管理概念域版本快照，支持差异对比、变更审计与版本回滚"
        actions={
          <div className="snapshot-header-actions">
            {viewMode !== 'list' && (
              <button className="snapshot-back-btn" onClick={() => { setViewMode('list'); setDiffResult(null); setDetailSnapshot(null); }}>
                <ChevronRight size={16} className="snapshot-back-icon" />
                返回列表
              </button>
            )}
            <button className="snapshot-btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={14} /> 创建快照
            </button>
          </div>
        }
      />

      {showCreate && (
        <div className="snapshot-modal-container">
          <div className="snapshot-modal-overlay" onClick={() => { setShowCreate(false); setCreateError(''); }} />
          <div className="snapshot-modal-dialog">
            <div className="snapshot-modal-title">创建版本快照</div>
            <div className="snapshot-form-group">
              <label>行业 <span className="snapshot-required">*</span></label>
              <Select
                value={selectedIndustryId != null ? String(selectedIndustryId) : ''}
                options={industries.map((ind) => ({
                  value: String(ind.id),
                  label: ind.displayName,
                }))}
                onChange={(v) => {
                  setSelectedIndustryId(v ? Number(v) : null);
                  setSelectedGroupId(null);
                  setCreateError('');
                }}
                placeholder="选择行业"
              />
            </div>
            <div className="snapshot-form-group">
              <label>概念域 <span className="snapshot-required">*</span></label>
              <Select
                value={selectedGroupId != null ? String(selectedGroupId) : ''}
                options={filteredGroups.map((g) => ({
                  value: String(g.id),
                  label: g.displayName || g.name,
                }))}
                onChange={(v) => {
                  setSelectedGroupId(v ? Number(v) : null);
                  setCreateError('');
                }}
                placeholder={selectedIndustryId ? '选择概念域' : '请先选择行业'}
                disabled={!selectedIndustryId}
              />
              {selectedIndustryId && filteredGroups.length === 0 && (
                <span className="snapshot-form-hint">该行业下暂无概念域</span>
              )}
            </div>
            <div className="snapshot-form-group">
              <label>版本号</label>
              <div className="snapshot-version-display">
                {autoVersion || (
                  <span className="snapshot-version-placeholder">
                    {selectedIndustryId && selectedGroupId ? '生成中...' : '选择行业和概念域后自动生成'}
                  </span>
                )}
              </div>
            </div>
            <div className="snapshot-form-group">
              <label>变更说明</label>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="描述本次变更" rows={3} />
            </div>
            {createError && (
              <div className="snapshot-form-error">
                <AlertTriangle size={14} />
                <span>{createError}</span>
              </div>
            )}
            <div className="snapshot-modal-actions">
              <button className="snapshot-btn-cancel" onClick={() => { setShowCreate(false); setCreateError(''); }}>取消</button>
              <button className="snapshot-btn-primary" onClick={handleCreate} disabled={!selectedIndustryId || !selectedGroupId}>创建</button>
            </div>
          </div>
        </div>
      )}

      {rollbackTarget && (
        <div className="snapshot-modal-container">
          <div className="snapshot-modal-overlay" onClick={() => { setRollbackTarget(null); setRollbackConfirm(false); }} />
          <div className="snapshot-modal-dialog">
            {!rollbackConfirm ? (
              <>
                <div className="snapshot-modal-title">
                  <AlertTriangle size={18} style={{ color: '#fa8c16' }} />
                  确认回滚
                </div>
                <p className="snapshot-modal-text">
                  将回滚至版本 <strong>{rollbackTarget.version}</strong>（{formatTime(rollbackTarget.createdAt)}），
                  当前概念将被快照中保存的概念替换，此操作不可逆。
                </p>
                <div className="snapshot-modal-actions">
                  <button className="snapshot-btn-cancel" onClick={() => setRollbackTarget(null)}>取消</button>
                  <button
                    className="snapshot-btn-danger"
                    onClick={() => setRollbackConfirm(true)}
                  >
                    确认回滚
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="snapshot-modal-title">
                  <AlertTriangle size={18} style={{ color: '#ff4d4f' }} />
                  二次确认
                </div>
                <p className="snapshot-modal-text">
                  <strong>此操作将删除当前域中所有概念并恢复为快照版本。</strong>请确认执行。
                </p>
                <div className="snapshot-modal-actions">
                  <button className="snapshot-btn-cancel" onClick={() => { setRollbackTarget(null); setRollbackConfirm(false); }}>
                    取消
                  </button>
                  <button
                    className="snapshot-btn-danger"
                    onClick={handleRollback}
                    disabled={rollbackLoading}
                  >
                    {rollbackLoading ? <Loader2 size={14} className="snapshot-spin" /> : <RotateCcw size={14} />}
                    执行回滚
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="snapshot-content">
        {viewMode === 'list' && (
          <>
            <div className="snapshot-diff-bar">
              <span className="snapshot-diff-label">差异对比</span>
              <Select
                value={diffFromId != null ? String(diffFromId) : ''}
                options={[
                  { value: '', label: '选择原版本' },
                  ...snapshots.map((s) => ({
                    value: String(s.id),
                    label: s.version,
                    desc: formatTime(s.createdAt),
                  })),
                ]}
                onChange={(v) => setDiffFromId(v ? Number(v) : null)}
                placeholder="选择原版本"
                className="snapshot-diff-select"
              />
              <ArrowRight size={14} className="snapshot-diff-arrow" />
              <Select
                value={diffToId != null ? String(diffToId) : ''}
                options={[
                  { value: '', label: '选择目标版本' },
                  ...snapshots
                    .filter((s) => s.id !== diffFromId)
                    .map((s) => ({
                      value: String(s.id),
                      label: s.version,
                      desc: formatTime(s.createdAt),
                    })),
                ]}
                onChange={(v) => setDiffToId(v ? Number(v) : null)}
                placeholder="选择目标版本"
                className="snapshot-diff-select"
              />
              <button
                className="snapshot-btn-primary"
                onClick={handleDiff}
                disabled={!diffFromId || !diffToId || diffLoading}
              >
                {diffLoading ? <Loader2 size={14} className="snapshot-spin" /> : <GitCompare size={14} />}
                对比
              </button>
            </div>

            {loading ? (
              <div className="snapshot-loading">
                <Loader2 size={24} className="snapshot-spin" />
              </div>
            ) : snapshots.length === 0 ? (
              <div className="snapshot-empty">暂无版本快照，请创建第一个快照</div>
            ) : (
              <div className="snapshot-timeline">
                {snapshots.map((s, i) => (
                  <div key={s.id} className="snapshot-timeline-item">
                    <div className="snapshot-timeline-dot" />
                    {i < snapshots.length - 1 && <div className="snapshot-timeline-line" />}
                    <div className="snapshot-timeline-card">
                      <div className="snapshot-timeline-card-header">
                        <div className="snapshot-timeline-card-title">
                          <code className="snapshot-version-tag">{s.version}</code>
                          <span className="snapshot-group-name">{getGroupName(s.groupId)}</span>
                        </div>
                        <span className="snapshot-timeline-time">
                          <Clock size={12} /> {formatTime(s.createdAt)}
                        </span>
                      </div>
                      <div className="snapshot-timeline-card-body">
                        <div className="snapshot-timeline-meta">
                          <span><User size={12} /> {s.createdBy || '系统'}</span>
                          <span><FileText size={12} /> {formatSnapshotData(s.snapshot)}</span>
                          {s.changeLog && <span className="snapshot-change-log">{s.changeLog}</span>}
                        </div>
                      </div>
                      <div className="snapshot-timeline-card-actions">
                        <button className="snapshot-action-btn" onClick={() => handleViewDetail(s.id)}>
                          <FileText size={12} /> 详情
                        </button>
                        <button className="snapshot-action-btn snapshot-action-btn--danger" onClick={() => setRollbackTarget(s)}>
                          <RotateCcw size={12} /> 回滚
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {viewMode === 'diff' && diffResult && (
          <div className="snapshot-diff-view">
            <div className="snapshot-diff-header">
              <div className="snapshot-diff-header-item">
                <span className="snapshot-diff-header-label">原版本</span>
                <code>{diffResult.fromVersion}</code>
              </div>
              <ArrowRight size={18} className="snapshot-diff-arrow-lg" />
              <div className="snapshot-diff-header-item">
                <span className="snapshot-diff-header-label">目标版本</span>
                <code>{diffResult.toVersion}</code>
              </div>
            </div>

            {diffResult.error ? (
              <div className="snapshot-diff-error">{diffResult.error}</div>
            ) : (
              <div className="snapshot-diff-summary">
                {diffResult.summary.addedCount === 0 && diffResult.summary.removedCount === 0 && diffResult.summary.modifiedCount === 0 ? (
                  <div className="snapshot-diff-nochange">
                    <Check size={20} />
                    <span>两个版本完全一致，无变更</span>
                  </div>
                ) : (
                  <>
                    <div className="snapshot-diff-summary-cards">
                      <div className="snapshot-diff-summary-card snapshot-diff-summary-card--added">
                        <span className="snapshot-diff-summary-num">{diffResult.summary.addedCount}</span>
                        <span>新增概念</span>
                      </div>
                      <div className="snapshot-diff-summary-card snapshot-diff-summary-card--removed">
                        <span className="snapshot-diff-summary-num">{diffResult.summary.removedCount}</span>
                        <span>删除概念</span>
                      </div>
                      <div className="snapshot-diff-summary-card snapshot-diff-summary-card--modified">
                        <span className="snapshot-diff-summary-num">{diffResult.summary.modifiedCount}</span>
                        <span>修改概念</span>
                      </div>
                      {(diffResult.summary.relationsAdded ?? 0) > 0 || (diffResult.summary.relationsRemoved ?? 0) > 0 ? (
                        <div className="snapshot-diff-summary-card snapshot-diff-summary-card--relation">
                          <span className="snapshot-diff-summary-num">
                            +{diffResult.summary.relationsAdded ?? 0} / -{diffResult.summary.relationsRemoved ?? 0}
                          </span>
                          <span>关系变更</span>
                        </div>
                      ) : null}
                      {(diffResult.summary.mappingsAdded ?? 0) > 0 || (diffResult.summary.mappingsRemoved ?? 0) > 0 ? (
                        <div className="snapshot-diff-summary-card snapshot-diff-summary-card--mapping">
                          <span className="snapshot-diff-summary-num">
                            +{diffResult.summary.mappingsAdded ?? 0} / -{diffResult.summary.mappingsRemoved ?? 0}
                          </span>
                          <span>映射变更</span>
                        </div>
                      ) : null}
                      {(diffResult.summary.joinMappingsAdded ?? 0) > 0 || (diffResult.summary.joinMappingsRemoved ?? 0) > 0 ? (
                        <div className="snapshot-diff-summary-card snapshot-diff-summary-card--join">
                          <span className="snapshot-diff-summary-num">
                            +{diffResult.summary.joinMappingsAdded ?? 0} / -{diffResult.summary.joinMappingsRemoved ?? 0}
                          </span>
                          <span>关联变更</span>
                        </div>
                      ) : null}
                      {(diffResult.summary.toolBindingsAdded ?? 0) > 0 || (diffResult.summary.toolBindingsRemoved ?? 0) > 0 ? (
                        <div className="snapshot-diff-summary-card snapshot-diff-summary-card--binding">
                          <span className="snapshot-diff-summary-num">
                            +{diffResult.summary.toolBindingsAdded ?? 0} / -{diffResult.summary.toolBindingsRemoved ?? 0}
                          </span>
                          <span>工具绑定变更</span>
                        </div>
                      ) : null}
                    </div>

                    {diffResult.added.length > 0 && (
                      <div className="snapshot-diff-section">
                        <h4 className="snapshot-diff-section-title snapshot-diff-section-title--added">
                          <Plus size={14} /> 新增 ({diffResult.added.length})
                        </h4>
                        <div className="snapshot-diff-list">
                          {diffResult.added.map((c, i) => (
                            <div key={i} className="snapshot-diff-item snapshot-diff-item--added">
                              <span className="snapshot-diff-item-name">{String(c.name)}</span>
                              <span className="snapshot-diff-item-id">ID: {String(c.id)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {diffResult.removed.length > 0 && (
                      <div className="snapshot-diff-section">
                        <h4 className="snapshot-diff-section-title snapshot-diff-section-title--removed">
                          <X size={14} /> 删除 ({diffResult.removed.length})
                        </h4>
                        <div className="snapshot-diff-list">
                          {diffResult.removed.map((c, i) => (
                            <div key={i} className="snapshot-diff-item snapshot-diff-item--removed">
                              <span className="snapshot-diff-item-name">{String(c.name)}</span>
                              <span className="snapshot-diff-item-id">ID: {String(c.id)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {diffResult.modified.length > 0 && (
                      <div className="snapshot-diff-section">
                        <h4 className="snapshot-diff-section-title snapshot-diff-section-title--modified">
                          <Hash size={14} /> 修改 ({diffResult.modified.length})
                        </h4>
                        <div className="snapshot-diff-list">
                          {diffResult.modified.map((m, i) => (
                            <div key={i} className="snapshot-diff-item snapshot-diff-item--modified">
                              <div className="snapshot-diff-item-header">
                                <span className="snapshot-diff-item-name">{m.name}</span>
                                <span className="snapshot-diff-item-id">ID: {m.id}</span>
                              </div>
                              <div className="snapshot-diff-changes">
                                {m.changes.map((ch, j) => (
                                  <div key={j} className="snapshot-diff-change">
                                    <span className="snapshot-diff-change-field">{ch.field}</span>
                                    <div className="snapshot-diff-change-vals">
                                      <span className="snapshot-diff-change-from">{ch.from}</span>
                                      <ArrowRight size={12} />
                                      <span className="snapshot-diff-change-to">{ch.to}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {viewMode === 'detail' && detailSnapshot && (
          <div className="snapshot-detail-view">
            <div className="snapshot-detail-card">
              <div className="snapshot-detail-header">
                <h3 className="snapshot-detail-title">
                  <code className="snapshot-version-tag">{detailSnapshot.version}</code>
                  快照详情
                </h3>
              </div>
              <div className="snapshot-detail-meta">
                <div className="snapshot-detail-meta-item">
                  <label>概念域</label>
                  <span>{getGroupName(detailSnapshot.groupId)}</span>
                </div>
                <div className="snapshot-detail-meta-item">
                  <label>创建人</label>
                  <span>{detailSnapshot.createdBy || '系统'}</span>
                </div>
                <div className="snapshot-detail-meta-item">
                  <label>创建时间</label>
                  <span>{formatTime(detailSnapshot.createdAt)}</span>
                </div>
                <div className="snapshot-detail-meta-item">
                  <label>变更说明</label>
                  <span>{detailSnapshot.changeLog || '（无）'}</span>
                </div>
              </div>
              <div className="snapshot-detail-data">
                <label>快照数据</label>
                <pre className="snapshot-detail-json">
                  {JSON.stringify(JSON.parse(detailSnapshot.snapshot), null, 2)}
                </pre>
              </div>
              <div className="snapshot-detail-actions">
                <button className="snapshot-btn-cancel" onClick={() => { setViewMode('list'); setDetailSnapshot(null); }}>
                  返回列表
                </button>
                <button className="snapshot-btn-danger" onClick={() => { setRollbackTarget(detailSnapshot); setViewMode('list'); }}>
                  <RotateCcw size={14} /> 回滚到此版本
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}