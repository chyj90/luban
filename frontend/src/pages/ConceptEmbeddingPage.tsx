import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { Check, Loader2, RefreshCw, ChevronLeft, ChevronRight, ListTodo } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import DataTable from '@/components/DataTable';
import type { Column } from '@/components/DataTable';
import { useToastStore } from '@/stores/toastStore';
import {
  getPendingAsyncTasks,
  getProcessedAsyncTasks,
  executeImportFromTask,
  applyAutoMatchMappings,
  addIndustryRelationsBatch,
  autoMatchConceptMappings,
  markTaskProcessed,
} from '@/api/concept';
import type { AsyncTaskInfo } from '@/api/concept';
import { confirm } from '@/stores/confirmStore';
import './ConceptEmbeddingPage.css';

const TASK_TYPE_LABELS: Record<string, string> = {
  IMPORT_CONCEPTS: '导入概念',
  AUTO_MATCH_MAPPINGS: '自动映射',
  AUTO_MATCH_MAPPINGS_V2: '自动映射(规则优先)',
};

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  PENDING: { label: '等待中', color: '#999' },
  RUNNING: { label: '运行中', color: '#1677ff' },
  COMPLETED: { label: '已完成', color: '#52c41a' },
  FAILED: { label: '失败', color: '#ff4d4f' },
};

export default function ConceptEmbeddingPage() {
  const [tab, setTab] = useState<'pending' | 'processed'>('pending');
  const [pendingTasks, setPendingTasks] = useState<AsyncTaskInfo[]>([]);
  const [processedPage, setProcessedPage] = useState<AsyncTaskInfo[]>([]);
  const [processedTotalPages, setProcessedTotalPages] = useState(0);
  const [processedTotalElements, setProcessedTotalElements] = useState(0);
  const [processedCurPage, setProcessedCurPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const toast = useToastStore((s) => s.show);

  const fetchPendingTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getPendingAsyncTasks();
      setPendingTasks(res.data || []);
    } catch {
      toast('加载待处理任务失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchProcessedTasks = useCallback(async (page: number) => {
    setLoading(true);
    try {
      const res = await getProcessedAsyncTasks(page, 20);
      setProcessedPage(res.data.content || []);
      setProcessedTotalPages(res.data.totalPages);
      setProcessedTotalElements(res.data.totalElements);
      setProcessedCurPage(res.data.page);
    } catch {
      toast('加载已处理任务失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (tab === 'pending') {
      fetchPendingTasks();
    }
  }, [tab, fetchPendingTasks]);

  useEffect(() => {
    if (tab === 'processed') {
      fetchProcessedTasks(0);
    }
  }, [tab, fetchProcessedTasks]);

  useEffect(() => {
    if (tab !== 'pending') return;
    const interval = setInterval(() => {
      const hasRunning = pendingTasks.some((t) => t.status === 'RUNNING' || t.status === 'PENDING');
      if (hasRunning) {
        fetchPendingTasks();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [tab, pendingTasks, fetchPendingTasks]);

  const tasks = tab === 'pending' ? pendingTasks : processedPage;

  const expandedTask = tasks.find((t) => t.id === expandedId);
  const previewData = useMemo(() => {
    if (!expandedTask || expandedTask.taskType !== 'IMPORT_CONCEPTS' || expandedTask.status !== 'COMPLETED' || !expandedTask.result) {
      return null;
    }
    try {
      return JSON.parse(expandedTask.result) as {
        concepts: Array<Record<string, unknown>>;
        total: number;
        sourceType: string;
        _industryId?: number;
        autoDomain?: boolean;
        suggestedDomains?: Array<{ name: string; conceptCount: number; isNew: boolean }>;
      };
    } catch {
      return null;
    }
  }, [expandedTask]);

  const autoMatchData = useMemo(() => {
    if (!expandedTask || !(expandedTask.taskType === 'AUTO_MATCH_MAPPINGS' || expandedTask.taskType === 'AUTO_MATCH_MAPPINGS_V2') || expandedTask.status !== 'COMPLETED' || !expandedTask.result) {
      return null;
    }
    try {
      return JSON.parse(expandedTask.result) as {
        groupId?: number;
        datasourceIds?: number[];
        conceptResults: Array<{
          conceptId: number;
          conceptName: string;
          conceptDescription: string;
          candidates: Array<Record<string, unknown>>;
          joinCandidates?: Array<Record<string, unknown>>;
          total: number;
          source?: string;
        }>;
        failedConcepts: Array<{
          conceptId: number;
          conceptName: string;
          reason: string;
        }>;
        totalConcepts: number;
        matchedConcepts: number;
        unmatchedConcepts: number;
        ruleCoveredConcepts?: number;
        llmFallbackConcepts?: number;
      };
    } catch {
      return null;
    }
  }, [expandedTask]);

  const [autoMatchApplying, setAutoMatchApplying] = useState(false);
  const [retryingAllFailed, setRetryingAllFailed] = useState(false);

  const handleRetryAllFailed = async () => {
    if (!autoMatchData || !expandedTask) return;
    const failedIds = autoMatchData.failedConcepts.map(fc => fc.conceptId);
    if (failedIds.length === 0) return;
    setRetryingAllFailed(true);
    try {
      await autoMatchConceptMappings(failedIds, autoMatchData.datasourceIds || []);
      toast('重试任务已提交，请等待执行完成', 'success');
      await markTaskProcessed(expandedTask.id);
      setExpandedId(null);
      setTab('processed');
      fetchProcessedTasks(0);
    } catch {
      toast('提交重试任务失败', 'error');
    } finally {
      setRetryingAllFailed(false);
    }
  };

  const handleApplyAutoMatch = async () => {
    if (!autoMatchData || !expandedTask) return;
    const mappingCount = autoMatchData.conceptResults.reduce((sum: number, cr: { candidates?: unknown[] }) => sum + (cr.candidates?.length || 0), 0);
    const joinCount = autoMatchData.conceptResults.reduce((sum: number, cr: { joinCandidates?: unknown[] }) => sum + (cr.joinCandidates?.length || 0), 0);
    if (mappingCount === 0 && joinCount === 0) {
      toast('没有可应用的映射', 'warning');
      return;
    }
    const ok = await confirm({
      title: '确认应用映射',
      message: `将先清除 ${autoMatchData.matchedConcepts} 个概念的已有映射，再写入 ${mappingCount} 条字段映射、${joinCount} 条 JOIN 映射，共 ${mappingCount + joinCount} 条，是否继续？`,
    });
    if (!ok) return;
    setAutoMatchApplying(true);
    try {
      const res = await applyAutoMatchMappings(expandedTask.id);
      toast(res.data.message, res.data.skipped > 0 || res.data.skippedJoins > 0 ? 'warning' : 'success');

      const hasDetails = (res.data.savedDetails?.length || 0) + (res.data.skippedDetails?.length || 0) > 0;
      if (hasDetails) {
        type MappingRow = {
          conceptId: number;
          target: string;
          mappingType: string;
          status: '成功' | '跳过';
          reason: string;
        };
        const rows: MappingRow[] = [
          ...(res.data.savedDetails || []).map(d => ({
            conceptId: d.conceptId,
            target: d.joinTable ? `${d.joinTable}(JOIN)` : `${d.tableName || ''}.${d.columnName || ''}`,
            mappingType: d.mappingType || 'direct',
            status: '成功' as const,
            reason: '',
          })),
          ...(res.data.skippedDetails || []).map(d => ({
            conceptId: d.conceptId,
            target: d.joinTable ? `${d.joinTable}(JOIN)` : `${d.tableName || ''}.${d.columnName || ''}`,
            mappingType: d.reason?.includes('JOIN') ? 'join' : 'direct',
            status: '跳过' as const,
            reason: d.reason || '',
          })),
        ];
        const detailColumns: Column<MappingRow>[] = [
          { key: 'conceptId', title: '概念ID', render: (r) => r.conceptId },
          { key: 'target', title: '目标对象', render: (r) => r.target },
          { key: 'mappingType', title: '类型', render: (r) => r.mappingType === 'join' ? 'JOIN' : '字段' },
          {
            key: 'status',
            title: '状态',
            render: (r) => (
              <span style={{ color: r.status === '成功' ? '#52c41a' : '#ff4d4f', fontWeight: 500 }}>
                {r.status}
              </span>
            ),
          },
          { key: 'reason', title: '原因', render: (r) => r.reason || '-' },
        ];
        const skippedCount = res.data.skippedDetails?.length || 0;
        await confirm({
          title: `映射应用结果（${res.data.savedDetails?.length || 0} 成功 / ${skippedCount} 跳过）`,
          content: (
            <DataTable<MappingRow>
              columns={detailColumns}
              data={rows}
              rowKey={(_, i) => i}
              className="confirm-detail-table"
            />
          ),
          width: 680,
          confirmText: '知道了',
          cancelText: undefined as unknown as string,
        });
      }

      const failedConceptIds = autoMatchData.failedConcepts.map((fc: { conceptId: number }) => fc.conceptId);
      if (failedConceptIds.length > 0) {
        const retryOk = await confirm({
          title: '存在失败概念',
          message: `有 ${failedConceptIds.length} 个概念映射失败，是否重新提交异步任务重试？`,
          confirmText: '重试',
          cancelText: '不用了',
        });
        if (retryOk) {
          try {
            const retryDatasourceIds = autoMatchData.datasourceIds || [];
            await autoMatchConceptMappings(failedConceptIds, retryDatasourceIds);
            toast('重试任务已提交，请等待执行完成', 'success');
          } catch {
            toast('提交重试任务失败', 'error');
          }
        }
      }

      await markTaskProcessed(expandedTask.id);
      setExpandedId(null);
      setTab('processed');
      fetchProcessedTasks(0);
    } catch {
      toast('应用映射失败', 'error');
    } finally {
      setAutoMatchApplying(false);
    }
  };

  const allSelected = previewData && selectedItems.size === previewData.concepts.length;
  const toggleSelectAll = () => {
    if (!previewData) return;
    if (allSelected) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(previewData.concepts.map((c) => String(c.name ?? ''))));
    }
  };

  const toggleItem = (name: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleImportExecute = async () => {
    if (!previewData || !expandedTask) return;
    const items = previewData.concepts.filter((c) => selectedItems.has(String(c.name ?? '')));
    if (items.length === 0) {
      toast('请至少选择一个概念', 'warning');
      return;
    }
    setImporting(true);
    try {
      const res = await executeImportFromTask(expandedTask.id, items);
      toast(`导入完成: 创建 ${res.data.created} 个, 跳过 ${res.data.skipped} 个`, 'success');
      setSelectedItems(new Set());
      fetchPendingTasks();

      const newTypes = res.data.newRelationTypes;
      const industryId = previewData._industryId;
      if (newTypes && newTypes.length > 0 && industryId) {
        const typesStr = newTypes.join('、');
        const ok = await confirm({
          title: '发现新关系类型',
          message: `导入的概念中使用了以下新的关系类型：${typesStr}。是否将其添加到当前行业的关系类型中？`,
          confirmText: '添加',
          variant: 'default',
        });
        if (ok) {
          try {
            await addIndustryRelationsBatch(industryId, newTypes);
            toast(`已添加 ${newTypes.length} 个关系类型`, 'success');
          } catch {
            toast('添加关系类型失败', 'error');
          }
        }
      }
    } catch {
      toast('导入失败', 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleMarkProcessed = async (taskId: number) => {
    try {
      await markTaskProcessed(taskId);
      setExpandedId(taskId);
    } catch {
      toast('标记失败', 'error');
    }
  };

  const handleCollapse = () => {
    setExpandedId(null);
    if (tab === 'pending') fetchPendingTasks();
  };

  const handleProcessedView = (taskId: number) => {
    setExpandedId(expandedId === taskId ? null : taskId);
  };

  const isProcessed = tab === 'processed';

  const renderTaskDetail = (task: AsyncTaskInfo) => {
    const isPreview = task.taskType === 'IMPORT_CONCEPTS' && task.status === 'COMPLETED';
    const isAutoMatch = (task.taskType === 'AUTO_MATCH_MAPPINGS' || task.taskType === 'AUTO_MATCH_MAPPINGS_V2') && task.status === 'COMPLETED';
    const isPreviewData = isPreview && previewData;
    const isAutoMatchData = isAutoMatch && autoMatchData;

    return (
      <tr className="detailRow" key={`detail-${task.id}`}>
        <td colSpan={8} style={{ padding: 0, borderBottom: '2px solid #e5e7eb' }}>
          <div className="detailPanelInline">
            <div className="detailGrid">
              <div className="detailItem">
                <span className="detailLabel">类型</span>
                <span>{TASK_TYPE_LABELS[task.taskType] || task.taskType}</span>
              </div>
              <div className="detailItem">
                <span className="detailLabel">状态</span>
                <span style={{ color: STATUS_MAP[task.status]?.color }}>
                  {STATUS_MAP[task.status]?.label || task.status}
                </span>
              </div>
              <div className="detailItem">
                <span className="detailLabel">进度</span>
                <span>{task.totalSteps > 0 ? `${task.progress}/${task.totalSteps}` : '-'}</span>
              </div>
              <div className="detailItem">
                <span className="detailLabel">当前步骤</span>
                <span>{task.currentStep || '-'}</span>
              </div>
              <div className="detailItem">
                <span className="detailLabel">用户ID</span>
                <span>{task.userId || '-'}</span>
              </div>
              <div className="detailItem">
                <span className="detailLabel">创建时间</span>
                <span>{new Date(task.createdAt).toLocaleString('zh-CN')}</span>
              </div>
              <div className="detailItem">
                <span className="detailLabel">完成时间</span>
                <span>{task.finishedAt ? new Date(task.finishedAt).toLocaleString('zh-CN') : '-'}</span>
              </div>
            </div>

            {isPreviewData && (
              <div className="detailSection">
                <div className="importPreviewHeader">
                  <h5>解析结果（{previewData!.total} 个概念）</h5>
                  {!isProcessed && (
                    <div className="importPreviewActions">
                      <label className="importSelectAll">
                        <input type="checkbox" checked={allSelected || false} onChange={toggleSelectAll} />
                        全选
                      </label>
                      <button
                        className="btnPrimary"
                        disabled={importing || selectedItems.size === 0}
                        onClick={handleImportExecute}
                      >
                        {importing ? <><Loader2 size={14} className="spin" />导入中...</> : <><Check size={14} />确认导入 ({selectedItems.size})</>}
                      </button>
                    </div>
                  )}
                </div>
                {previewData!.suggestedDomains && previewData!.suggestedDomains.length > 0 && (
                  <div className="importSuggestedDomains">
                    识别到 {previewData!.suggestedDomains.length} 个概念域：{previewData!.suggestedDomains.map((d) => `${d.name}(${d.conceptCount})`).join('、')}
                  </div>
                )}
                <div className="importConceptList">
                  {previewData!.concepts.map((item) => {
                    const name = String(item.name ?? '');
                    const displayName = String(item.displayName ?? name);
                    const selected = selectedItems.has(name);
                    return (
                      <label key={name} className={`importConceptItem ${selected ? 'selected' : ''} ${isProcessed ? 'importConceptItemDisabled' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={isProcessed}
                          onChange={() => toggleItem(name)}
                        />
                        <div className="importConceptInfo">
                          <span className="importConceptName">{displayName}</span>
                          <span className="importConceptSlug">{name}</span>
                          {Boolean(item.description) && <span className="importConceptDesc">{String(item.description)}</span>}
                          {Boolean(item.conflict) && <span className="importConceptConflict">⚠ {String(item.conflictMessage ?? '')}</span>}
                          {Boolean(item.relations) && Array.isArray(item.relations) && (item.relations as string[]).length > 0 && (
                            <span className="importConceptRels">关系: {(item.relations as string[]).join(', ')}</span>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {isAutoMatchData && (
              <div className="detailSection">
                <div className="importPreviewHeader">
                  <h5>匹配结果</h5>
                  {!isProcessed && (
                    <div className="importPreviewActions">
                      {autoMatchData!.matchedConcepts === 0 && autoMatchData!.failedConcepts.length > 0 ? (
                        <button
                          className="btnPrimary"
                          disabled={retryingAllFailed}
                          onClick={handleRetryAllFailed}
                        >
                          {retryingAllFailed ? <><Loader2 size={14} className="spin" />重试中...</> : <><RefreshCw size={14} />重试失败概念</>}
                        </button>
                      ) : (
                        <button
                          className="btnPrimary"
                          disabled={autoMatchApplying || autoMatchData!.matchedConcepts === 0}
                          onClick={handleApplyAutoMatch}
                        >
                          {autoMatchApplying ? <><Loader2 size={14} className="spin" />应用中...</> : <><Check size={14} />全部确认映射</>}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="autoMatchSummary">
                  <span className="autoMatchSummaryItem matched">✓ 匹配成功: {autoMatchData!.matchedConcepts} 个概念</span>
                  {autoMatchData!.unmatchedConcepts > 0 && (
                    <span className="autoMatchSummaryItem unmatched">— 未匹配到字段: {autoMatchData!.unmatchedConcepts} 个概念</span>
                  )}
                  {autoMatchData!.failedConcepts.length > 0 && (
                    <span className="autoMatchSummaryItem failed">✗ 失败: {autoMatchData!.failedConcepts.length} 个概念</span>
                  )}
                  {autoMatchData!.ruleCoveredConcepts != null && (
                    <span className="autoMatchSummaryItem" style={{ color: '#722ed1' }}>⚙ 规则覆盖: {autoMatchData!.ruleCoveredConcepts} 个</span>
                  )}
                  {autoMatchData!.llmFallbackConcepts != null && autoMatchData!.llmFallbackConcepts > 0 && (
                    <span className="autoMatchSummaryItem" style={{ color: '#fa8c16' }}>🤖 LLM兜底: {autoMatchData!.llmFallbackConcepts} 个</span>
                  )}
                  <span className="autoMatchSummaryItem total">共 {autoMatchData!.totalConcepts} 个概念</span>
                </div>

                {autoMatchData!.failedConcepts.length > 0 && (
                  <div className="autoMatchFailedSection">
                    <div className="autoMatchFailedHeader">
                      <span className="autoMatchFailedTitle">失败的概念</span>
                    </div>
                    {autoMatchData!.failedConcepts.map((fc) => (
                      <div key={fc.conceptId} className="autoMatchFailedItem">
                        <div className="autoMatchFailedItemLeft">
                          <span className="autoMatchFailedName">{fc.conceptName}</span>
                          <span className="autoMatchFailedReason">{fc.reason}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {autoMatchData!.conceptResults.map((cr) => (
                  <div key={cr.conceptId} className="autoMatchConceptGroup">
                    <div className="autoMatchConceptHeader">
                      <span className="autoMatchConceptName">{cr.conceptName}</span>
                      <span className="autoMatchConceptCount">
                        {cr.total} 条字段映射{cr.joinCandidates ? ` + ${cr.joinCandidates.length} JOIN` : ''}
                        {cr.source != null && (
                          <span style={{ marginLeft: 8, fontSize: 11, color: cr.source === 'rule' ? '#722ed1' : '#fa8c16' }}>
                            [{cr.source === 'rule' ? '规则' : '规则+LLM'}]
                          </span>
                        )}
                      </span>
                    </div>
                    {cr.candidates.length === 0 ? (
                      <div className="autoMatchEmpty">未匹配到字段</div>
                    ) : (
                      <div className="importConceptList">
                        {cr.candidates.map((item, idx) => {
                          const dsId = String(item.datasourceId ?? '');
                          const table = String(item.tableName ?? '');
                          const col = String(item.columnName ?? '');
                          const attr = String(item.attributeName ?? '');
                          const type = String(item.mappingType ?? 'direct');
                          const conf = Number(item.confidence ?? 0);
                          const rule = String(item.rule ?? '');
                          return (
                            <div key={idx} className="importConceptItem" style={{ cursor: 'default' }}>
                              <div className="importConceptInfo">
                                <span className="importConceptName">
                                  {attr} ← {table}.{col}
                                  <span style={{ marginLeft: 8, fontSize: 11, color: '#999' }}>{item.datasourceName || `数据源${dsId}`}</span>
                                  {rule && <span style={{ marginLeft: 4, fontSize: 10, color: '#722ed1', background: '#f9f0ff', padding: '0 4px', borderRadius: 3 }}>{rule}</span>}
                                </span>
                                <span className="importConceptSlug">
                                  <span className={`importMappingTypeTag type-${type}`}>{type}</span>
                                  <span className={`importConfidenceTag ${conf >= 0.9 ? 'conf-high' : conf >= 0.7 ? 'conf-mid' : 'conf-low'}`}>
                                    {Math.round(conf * 100)}%
                                  </span>
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {cr.joinCandidates && cr.joinCandidates.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 11, color: '#13c2c2', fontWeight: 600, marginBottom: 4 }}>JOIN 映射:</div>
                        <div className="importConceptList">
                          {cr.joinCandidates.map((jc, jdx) => {
                            const jdsId = String(jc.datasourceId ?? '');
                            const jTable = String(jc.joinTable ?? '');
                            const jType = String(jc.joinType ?? 'LEFT');
                            return (
                              <div key={jdx} className="importConceptItem" style={{ cursor: 'default', borderLeft: '3px solid #13c2c2' }}>
                                <div className="importConceptInfo">
                                  <span className="importConceptName">
                                    {jType} JOIN {jTable}
                                    {jc.targetConcept ? ` → ${String(jc.targetConcept)}` : null}
                                    <span style={{ marginLeft: 8, fontSize: 11, color: '#999' }}>{jc.datasourceName || `数据源${jdsId}`}</span>
                                  </span>
                                  <span className="importConceptSlug">
                                    <span className="importMappingTypeTag" style={{ background: '#e6fffb', color: '#13c2c2', borderColor: '#b5f5ec' }}>{jType}</span>
                                  </span>
                                </div>
                                {jc.joinCondition ? (
                                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                                    ON {String(jc.joinCondition)}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!isPreviewData && !isAutoMatchData && task.result && (
              <div className="detailSection">
                <h5>执行结果</h5>
                <pre className="detailPre">{task.result}</pre>
              </div>
            )}
            {task.errorMsg && (
              <div className="detailSection">
                <h5 className="errorTitle">错误信息</h5>
                <pre className="detailPre detailPreError">{task.errorMsg}</pre>
              </div>
            )}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="embedding-page">
      <PageTopbar
        icon={<ListTodo size={22} />}
        title="异步任务"
        subtitle="管理概念导入、自动映射、索引重建与向量生成的异步任务"
      />

      <div className="embedding-content">
        <div className="taskSection">
          <div className="taskSectionHeader">
            <h3>异步任务</h3>
            <div className="taskTabs">
              <button
                className={`taskTab ${tab === 'pending' ? 'taskTabActive' : ''}`}
                onClick={() => { setTab('pending'); setExpandedId(null); }}
              >
                待处理
                {pendingTasks.length > 0 && <span className="taskBadge">{pendingTasks.length}</span>}
              </button>
              <button
                className={`taskTab ${tab === 'processed' ? 'taskTabActive' : ''}`}
                onClick={() => { setTab('processed'); setExpandedId(null); }}
              >
                已处理
              </button>
            </div>
          </div>

          {loading ? (
            <div className="loading">加载中...</div>
          ) : tasks.length === 0 ? (
            <div className="emptyState">{tab === 'pending' ? '暂无待处理任务' : '暂无已处理记录'}</div>
          ) : (
            <>
              <div className="tableWrapper">
                <table className="dataTable">
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}>任务ID</th>
                      <th style={{ width: 120 }}>类型</th>
                      <th style={{ width: 80 }}>状态</th>
                      <th style={{ width: 100 }}>进度</th>
                      <th>当前步骤</th>
                      <th style={{ width: 150 }}>创建时间</th>
                      <th style={{ width: 150 }}>完成时间</th>
                      <th style={{ width: 60 }}>{isProcessed ? '查看' : '处理'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t) => (
                      <Fragment key={t.id}>
                        <tr>
                          <td>{t.id}</td>
                          <td>
                            <span className="taskTag" style={{ background: (STATUS_MAP[t.status]?.color || '#999') + '18', color: STATUS_MAP[t.status]?.color || '#333' }}>
                              {TASK_TYPE_LABELS[t.taskType] || t.taskType}
                            </span>
                          </td>
                          <td>
                            <span className="statusTag" style={{ color: STATUS_MAP[t.status]?.color || '#333' }}>
                              {t.status === 'RUNNING' && <span className="statusDot" />}
                              {STATUS_MAP[t.status]?.label || t.status}
                            </span>
                          </td>
                          <td>
                            {t.totalSteps > 0 ? (
                              <div className="progressWrap">
                                <div className="progressBar">
                                  <div
                                    className="progressFill"
                                    style={{ width: `${Math.round((t.progress / t.totalSteps) * 100)}%` }}
                                  />
                                </div>
                                <span className="progressText">{t.progress}/{t.totalSteps}</span>
                              </div>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="stepCell">{t.currentStep || '-'}</td>
                          <td>{new Date(t.createdAt).toLocaleString('zh-CN')}</td>
                          <td>{t.finishedAt ? new Date(t.finishedAt).toLocaleString('zh-CN') : '-'}</td>
                          <td>
                            {isProcessed ? (
                              <button
                                className="expandBtn"
                                onClick={() => handleProcessedView(t.id)}
                              >
                                {expandedId === t.id ? '收起' : '查看'}
                              </button>
                            ) : expandedId === t.id ? (
                              <button className="expandBtn" onClick={handleCollapse}>
                                收起
                              </button>
                            ) : (
                              <button
                                className="expandBtn processBtn"
                                disabled={t.status === 'RUNNING' || t.status === 'PENDING'}
                                onClick={() => handleMarkProcessed(t.id)}
                              >
                                处理
                              </button>
                            )}
                          </td>
                        </tr>
                        {expandedId === t.id && renderTaskDetail(t)}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              {isProcessed && processedTotalPages > 1 && (
                <div className="pagination">
                  <span className="paginationInfo">共 {processedTotalElements} 条，第 {processedCurPage + 1}/{processedTotalPages} 页</span>
                  <div className="paginationBtns">
                    <button
                      className="paginationBtn"
                      disabled={processedCurPage <= 0}
                      onClick={() => { fetchProcessedTasks(processedCurPage - 1); setExpandedId(null); }}
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      className="paginationBtn"
                      disabled={processedCurPage >= processedTotalPages - 1}
                      onClick={() => { fetchProcessedTasks(processedCurPage + 1); setExpandedId(null); }}
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}