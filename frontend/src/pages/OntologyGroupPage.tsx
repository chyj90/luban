import { useState, useEffect, useCallback, useRef, createElement } from 'react';
import { useNavigate } from 'react-router-dom';
import PageTopbar from '@/components/PageTopbar';
import {
  Box, Plus, Pencil, Trash2, X, Check, Loader2, Upload, FileText as FileTextIcon,
  Building2, Users, Briefcase, ShoppingCart, Database,
  Globe, Heart, Star, Shield, Book, Lightbulb, GraduationCap,
  Plane, Truck, Home, Phone, Mail, Clock, Calendar, Tag, Hash,
  Layers, Network, Brain, Cpu, Cloud, Anchor, Bell, Camera,
  Wrench, Zap, Award, Banknote, BarChart3, Bookmark, Calculator,
  Cog, Eye, Flag, Gift, Key, MapPin, Music, Package, Palette,
  Rocket, Search, ThumbsUp, TrendingUp, Umbrella, UserCheck, AlertTriangle,
} from 'lucide-react';
import { listOntologyGroups, createOntologyGroup, updateOntologyGroup, deleteOntologyGroup, executeConceptImport, uploadConceptImportAsync, listIndustries, createIndustry, updateIndustry, deleteIndustry, getIndustryRelations, addIndustryRelation, deleteIndustryRelation, rebuildConceptIndex, regenerateAllEmbeddings } from '@/api/concept';
import { useToastStore } from '@/stores/toastStore';
import { confirm } from '@/stores/confirmStore';
import Select from '@/components/Select';
import type { OntologyGroup, Industry, IndustryRelation } from '@/types/concept';
import './OntologyGroupPage.css';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  Box, Building2, Users, Briefcase, ShoppingCart, FileTextIcon, Database,
  Globe, Heart, Star, Shield, Book, Lightbulb, GraduationCap,
  Plane, Truck, Home, Phone, Mail, Clock, Calendar, Tag, Hash,
  Layers, Network, Brain, Cpu, Cloud, Anchor, Bell, Camera,
  Wrench, Zap, Award, Banknote, BarChart3, Bookmark, Calculator,
  Cog, Eye, Flag, Gift, Key, MapPin, Music, Package, Palette,
  Rocket, Search, ThumbsUp, TrendingUp, Umbrella, UserCheck,
};

const ICON_KEYS = Object.keys(ICON_MAP);

function renderIcon(iconName: string, size: number) {
  const Icon = ICON_MAP[iconName];
  if (Icon) return createElement(Icon, { size });
  return createElement(Box, { size });
}

export default function OntologyGroupPage() {
  const [groups, setGroups] = useState<OntologyGroup[]>([]);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [selectedIndustryId, setSelectedIndustryId] = useState<number | null>(null);
  const [industryPanelOpen, setIndustryPanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showIndustryForm, setShowIndustryForm] = useState(false);
  const [editingIndustry, setEditingIndustry] = useState<Industry | null>(null);
  const [industryForm, setIndustryForm] = useState({ name: '', displayName: '', description: '' });
  const [industrySaving, setIndustrySaving] = useState(false);
  const [expandedIndustryId, setExpandedIndustryId] = useState<number | null>(null);
  const [industryRelations, setIndustryRelations] = useState<Record<number, IndustryRelation[]>>({});
  const [showRelationForm, setShowRelationForm] = useState(false);
  const [editingRelation, setEditingRelation] = useState<IndustryRelation | null>(null);
  const [relationForm, setRelationForm] = useState({ relationType: '', description: '', isTransitive: false, isSymmetric: false, sortOrder: 0 });
  const [relationSaving, setRelationSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<OntologyGroup | null>(null);
  const [form, setForm] = useState({ name: '', displayName: '', description: '', iconUrl: '', sortOrder: 0, industryId: null as number | null });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const toast = useToastStore((s) => s.show);
  const navigate = useNavigate();

  const [showImport, setShowImport] = useState(false);
  const [importStep, setImportStep] = useState<'input' | 'preview' | 'importing'>('input');
  const [importSourceType, setImportSourceType] = useState('SWAGGER');
  const [importUrl, setImportUrl] = useState('');
  const [importContent, setImportContent] = useState('');
  const [importTargetGroupId, setImportTargetGroupId] = useState<number | null>(null);
  const [importPreview, setImportPreview] = useState<Array<Record<string, unknown>>>([]);
  const [importPreviewTotal, setImportPreviewTotal] = useState(0);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number } | null>(null);
  const [importMode, setImportMode] = useState<'url' | 'file' | 'paste'>('url');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSuggestedDomains, setImportSuggestedDomains] = useState<Array<{ name: string; conceptCount: number; isNew: boolean }>>([]);
  const [importProgress, setImportProgress] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await listOntologyGroups();
      setGroups(res.data);
    } catch {
      toast('加载概念域失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchIndustries = useCallback(async () => {
    try {
      const res = await listIndustries();
      const list = res.data;
      setIndustries(list);
      const relationsMap: Record<number, IndustryRelation[]> = {};
      await Promise.all(list.map(async (ind) => {
        try {
          const relRes = await getIndustryRelations(ind.id);
          relationsMap[ind.id] = relRes.data;
        } catch {
          relationsMap[ind.id] = [];
        }
      }));
      setIndustryRelations(relationsMap);
    } catch {
      // industries are optional, don't show error
    }
  }, []);

  useEffect(() => {
    fetchGroups();
    fetchIndustries();
  }, [fetchGroups, fetchIndustries]);

  const handleIndustrySubmit = async () => {
    if (!industryForm.name || !industryForm.displayName) {
      toast('名称和显示名称为必填项', 'error');
      return;
    }
    setIndustrySaving(true);
    try {
      if (editingIndustry) {
        await updateIndustry(editingIndustry.id, industryForm);
        toast('行业更新成功', 'success');
      } else {
        await createIndustry(industryForm);
        toast('行业创建成功', 'success');
      }
      setShowIndustryForm(false);
      setEditingIndustry(null);
      fetchIndustries();
    } catch {
      toast('操作失败', 'error');
    } finally {
      setIndustrySaving(false);
    }
  };

  const handleDeleteIndustry = async (industry: Industry) => {
    const confirmed = await confirm({
      title: '确认删除',
      message: `确定要删除行业「${industry.displayName}」吗？该行业下的关系类型也将被删除。`,
      confirmText: '删除',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteIndustry(industry.id);
      toast('删除成功', 'success');
      setExpandedIndustryId(null);
      fetchIndustries();
    } catch {
      toast('删除失败', 'error');
    }
  };

  const openIndustryCreate = () => {
    setEditingIndustry(null);
    setIndustryForm({ name: '', displayName: '', description: '' });
    setShowIndustryForm(true);
  };

  const openIndustryEdit = (industry: Industry) => {
    setEditingIndustry(industry);
    setIndustryForm({ name: industry.name, displayName: industry.displayName, description: industry.description || '' });
    setShowIndustryForm(true);
  };

  const toggleIndustryExpand = async (industryId: number) => {
    if (expandedIndustryId === industryId) {
      setExpandedIndustryId(null);
      return;
    }
    setExpandedIndustryId(industryId);
    if (!industryRelations[industryId]) {
      try {
        const res = await getIndustryRelations(industryId);
        setIndustryRelations((prev) => ({ ...prev, [industryId]: res.data }));
      } catch {
        toast('加载关系类型失败', 'error');
      }
    }
  };

  const openRelationCreate = (industryId: number) => {
    setEditingRelation(null);
    setRelationForm({ relationType: '', description: '', isTransitive: false, isSymmetric: false, sortOrder: 0 });
    setShowRelationForm(true);
  };

  const handleRelationSubmit = async () => {
    if (!relationForm.relationType) {
      toast('关系类型为必填项', 'error');
      return;
    }
    if (!expandedIndustryId) return;
    setRelationSaving(true);
    try {
      await addIndustryRelation(expandedIndustryId, relationForm);
      toast('关系类型添加成功', 'success');
      setShowRelationForm(false);
      const res = await getIndustryRelations(expandedIndustryId);
      setIndustryRelations((prev) => ({ ...prev, [expandedIndustryId]: res.data }));
    } catch {
      toast('操作失败', 'error');
    } finally {
      setRelationSaving(false);
    }
  };

  const handleDeleteRelation = async (relationId: number) => {
    if (!expandedIndustryId) return;
    const confirmed = await confirm({
      title: '确认删除',
      message: '确定要删除该关系类型吗？',
      confirmText: '删除',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteIndustryRelation(expandedIndustryId, relationId);
      toast('删除成功', 'success');
      const res = await getIndustryRelations(expandedIndustryId);
      setIndustryRelations((prev) => ({ ...prev, [expandedIndustryId]: res.data }));
    } catch {
      toast('删除失败', 'error');
    }
  };

  const handleSubmit = async () => {
    if (!form.name || !form.displayName) {
      toast('名称和显示名称为必填项', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateOntologyGroup(editing.id, form);
        toast('更新成功', 'success');
      } else {
        await createOntologyGroup(form);
        toast('创建成功', 'success');
      }
      setShowForm(false);
      setEditing(null);
      fetchGroups();
    } catch {
      toast('操作失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (group: OntologyGroup) => {
    if (group.isSystem) {
      toast('系统内置概念域不可删除', 'warning');
      return;
    }
    const confirmed = await confirm({
      title: '确认删除',
      message: `确定要删除概念域「${group.displayName}」吗？删除后该域下的所有概念将变为未分组。`,
      confirmText: '删除',
      variant: 'danger',
    });
    if (!confirmed) return;
    setDeletingId(group.id);
    try {
      await deleteOntologyGroup(group.id);
      toast(`概念域「${group.displayName}」已删除`, 'success');
      fetchGroups();
    } catch {
      toast('删除失败', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', displayName: '', description: '', iconUrl: '', sortOrder: groups.length, industryId: null });
    setShowForm(true);
  };

  const openEdit = (group: OntologyGroup) => {
    setEditing(group);
    setForm({
      name: group.name,
      displayName: group.displayName,
      description: group.description || '',
      iconUrl: group.iconUrl || '',
      sortOrder: group.sortOrder,
      industryId: group.industryId || null,
    });
    setShowForm(true);
  };

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      const res = await rebuildConceptIndex();
      toast(res.data?.message || '索引重建任务已提交', 'success');
    } catch {
      toast('索引重建失败', 'error');
    } finally {
      setRebuilding(false);
    }
  };

  const handleRegenerateAll = async () => {
    setRegenerating(true);
    try {
      const res = await regenerateAllEmbeddings();
      toast(res.data?.message || '全量重新生成任务已提交', 'success');
    } catch {
      toast('重新生成失败', 'error');
    } finally {
      setRegenerating(false);
    }
  };

  const handleImportPreview = async () => {
    if (importMode === 'url' && !importUrl.trim()) {
      toast('请输入 URL', 'error');
      return;
    }
    if (importMode === 'file' && !importFile) {
      toast('请选择文件', 'error');
      return;
    }
    if (importMode === 'paste' && !importContent.trim()) {
      toast('请粘贴内容', 'error');
      return;
    }
    setImportLoading(true);
    setImportProgress('正在提交任务...');

    try {
      const isFile = importMode === 'file' && importFile;

      const result = await uploadConceptImportAsync(
        isFile ? importFile : null,
        importSourceType,
        selectedIndustryId,
        importTargetGroupId,
        isFile ? undefined : {
          content: importMode === 'paste' ? importContent : undefined,
          url: importMode === 'url' ? importUrl : undefined,
        },
      );

      toast(`任务 #${result.taskId} 已提交，请在异步任务页面查看结果`, 'success');
      closeImport();
    } catch (err) {
      toast('提交任务失败: ' + (err instanceof Error ? err.message : '未知错误'), 'error');
    } finally {
      setImportLoading(false);
      setImportProgress('');
    }
  };

  const handleImportExecute = async () => {
    setImportLoading(true);
    setImportStep('importing');
    try {
      const res = await executeConceptImport({
        sourceType: importSourceType,
        content: importMode === 'paste' || importMode === 'file' ? importContent : undefined,
        url: importMode === 'url' ? importUrl : undefined,
        industryId: selectedIndustryId || undefined,
        groupId: importTargetGroupId || undefined,
        selectedItems: importPreview,
      });
      setImportResult({ created: res.data.created, skipped: res.data.skipped });
      toast(`成功导入 ${res.data.created} 个概念`, 'success');
      fetchGroups();
    } catch {
      toast('导入失败', 'error');
    } finally {
      setImportLoading(false);
    }
  };

  const toggleSelectItem = (index: number) => {
    setImportPreview((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, skip: !item.skip } : item,
      ),
    );
  };

  const closeImport = () => {
    setShowImport(false);
    setImportStep('input');
    setImportPreview([]);
    setImportResult(null);
    setImportUrl('');
    setImportContent('');
    setImportFile(null);
    setImportMode('url');
    setImportProgress('');
  };

  if (loading) {
    return (
      <div className="og-page__loading">
        <Loader2 size={24} className="og-page__spin" />
      </div>
    );
  }

  return (
    <div className="og-page">
      <PageTopbar
        icon={<Layers size={22} />}
        title="概念域管理"
        subtitle="管理行业与概念域，定义关系类型与概念体系"
        actions={
          <div className="og-page__topbar-right">
            <button className="og-page__btn-primary" onClick={openCreate}>
              <Plus size={15} />
              新建概念域
            </button>
            <button className="og-page__btn-outline" onClick={() => {
              setImportTargetGroupId(groups[0]?.id || null);
              setShowImport(true);
            }}>
              <Upload size={15} />
              导入概念
            </button>
            <button className="og-page__btn-outline" onClick={handleRegenerateAll} disabled={regenerating}>
              {regenerating ? '生成中...' : '全量生成 Embedding'}
            </button>
            <button className="og-page__btn-outline" onClick={handleRebuild} disabled={rebuilding}>
              {rebuilding ? '重建中...' : '重建 FAISS 索引'}
            </button>
          </div>
        }
      />

      <div className="og-page__content">
        {/* 行业管理面板（可折叠） */}
        <div className={`og-page__industry-panel ${industryPanelOpen ? 'open' : ''}`}>
          <button
            className="og-page__industry-toggle"
            onClick={() => setIndustryPanelOpen(!industryPanelOpen)}
          >
            <span className="og-page__industry-toggle-icon">
              <Briefcase size={16} />
            </span>
            <span className="og-page__industry-toggle-text">行业管理</span>
            <span className="og-page__industry-toggle-count">{industries.length} 个行业</span>
            <span className="og-page__industry-toggle-arrow">
              <svg width="14" height="14" viewBox="0 0 14 14">
                <path d="M5 3L9 7L5 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          </button>
          {industryPanelOpen && (
            <div className="og-page__industry-body">
              <div className="og-page__industry-body-header">
                <span className="og-page__industry-body-desc">行业是概念域的上级分类，每个概念域归属一个行业，使用该行业下的关系类型</span>
                <button className="og-page__btn-primary-sm" onClick={openIndustryCreate}>
                  <Plus size={13} />
                  新增行业
                </button>
              </div>
              {industries.length === 0 ? (
                <div className="og-page__industry-body-empty">暂无行业，点击"新增行业"创建</div>
              ) : (
                <div className="og-page__industry-list">
                  {industries.map((ind) => (
                    <div key={ind.id} className={`og-page__industry-item ${expandedIndustryId === ind.id ? 'expanded' : ''}`}>
                      <div className="og-page__industry-row" onClick={() => toggleIndustryExpand(ind.id)}>
                        <button className={`og-page__industry-expand ${expandedIndustryId === ind.id ? 'open' : ''}`}>
                          <svg width="14" height="14" viewBox="0 0 14 14">
                            <path d="M5 3L9 7L5 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        <div className="og-page__industry-info">
                          <span className="og-page__industry-name">{ind.displayName}</span>
                          <span className="og-page__industry-slug">{ind.name}</span>
                          {ind.description && <span className="og-page__industry-desc">{ind.description}</span>}
                        </div>
                        <span className="og-page__industry-count">
                          {(industryRelations[ind.id] || []).length} 个关系类型
                        </span>
                        <div className="og-page__industry-actions" onClick={(e) => e.stopPropagation()}>
                          <button className="og-page__action-btn" onClick={() => openIndustryEdit(ind)} title="编辑行业">
                            <Pencil size={14} />
                          </button>
                          <button
                            className="og-page__action-btn og-page__action-btn--danger"
                            onClick={() => handleDeleteIndustry(ind)}
                            title="删除行业"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      {expandedIndustryId === ind.id && (
                        <div className="og-page__industry-relations">
                          <div className="og-page__relations-header">
                            <span className="og-page__relations-title">关系类型清单</span>
                            <button className="og-page__btn-outline-sm" onClick={() => openRelationCreate(ind.id)}>
                              <Plus size={13} />
                              新增关系
                            </button>
                          </div>
                          {(!industryRelations[ind.id] || industryRelations[ind.id].length === 0) ? (
                            <div className="og-page__relations-empty">暂无关系类型，点击"新增关系"添加</div>
                          ) : (
                            <table className="og-page__relations-table">
                              <thead>
                                <tr>
                                  <th>关系类型</th>
                                  <th>描述</th>
                                  <th>传递性</th>
                                  <th>对称性</th>
                                  <th>排序</th>
                                  <th>操作</th>
                                </tr>
                              </thead>
                              <tbody>
                                {industryRelations[ind.id]?.map((rel) => (
                                  <tr key={rel.id}>
                                    <td className="og-page__rel-type">{rel.relationType}</td>
                                    <td className="og-page__rel-desc">{rel.description || '-'}</td>
                                    <td>{rel.isTransitive ? <span className="og-page__rel-tag yes">是</span> : <span className="og-page__rel-tag">否</span>}</td>
                                    <td>{rel.isSymmetric ? <span className="og-page__rel-tag yes">是</span> : <span className="og-page__rel-tag">否</span>}</td>
                                    <td>{rel.sortOrder}</td>
                                    <td>
                                      <button
                                        className="og-page__action-btn og-page__action-btn--danger"
                                        onClick={() => handleDeleteRelation(rel.id)}
                                        title="删除关系类型"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 概念域按行业聚合 */}
        <div className="og-page__domain-section">
          {groups.length === 0 ? (
            <div className="og-page__empty-state">
              <div className="og-page__empty-icon"><Layers size={48} /></div>
              <h3>暂无概念域</h3>
              <p>创建概念域来组织你的概念体系，每个概念域归属一个行业</p>
              <button className="og-page__btn-primary" onClick={openCreate}>
                <Plus size={15} />新建概念域
              </button>
            </div>
          ) : (
            (() => {
              const grouped = new Map<number | null, OntologyGroup[]>();
              groups.forEach((g) => {
                const key = g.industryId ?? null;
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key)!.push(g);
              });
              const sortedEntries = [...grouped.entries()].sort(([a], [b]) => {
                if (a === null) return 1;
                if (b === null) return -1;
                return a - b;
              });

              return (
                <div className="og-page__domain-groups">
                  {sortedEntries.map(([industryId, domainList]) => {
                    const industry = industryId ? industries.find(i => i.id === industryId) : null;
                    return (
                      <div key={industryId ?? 'uncategorized'} className="og-page__domain-group">
                        <div className="og-page__domain-group-header">
                          <div className="og-page__domain-group-title">
                            {industry ? (
                              <>
                                <Briefcase size={14} />
                                <span>{industry.displayName}</span>
                              </>
                            ) : (
                              <>
                                <Layers size={14} />
                                <span>未归属行业</span>
                              </>
                            )}
                            <span className="og-page__domain-group-count">{domainList.length} 个域</span>
                          </div>
                        </div>
                        <div className="og-page__grid">
                          {domainList.map((g) => (
                            <div key={g.id} className={`og-page__card${deletingId === g.id ? ' og-page__card--deleting' : ''}`} onClick={() => navigate(`/concept/concepts?domainId=${g.id}`)}>
                              {deletingId === g.id && (
                                <div className="og-page__card-deleting-overlay">
                                  <Loader2 size={24} className="og-page__card-deleting-spinner" />
                                  <span>正在删除...</span>
                                </div>
                              )}
                              <div className="og-page__card-top">
                                <div className="og-page__card-icon" style={{ background: g.isSystem ? '#f6ffed' : '#f0f5ff', color: g.isSystem ? '#52c41a' : '#1677ff' }}>
                                  {renderIcon(g.iconUrl, 22)}
                                </div>
                                <div className="og-page__card-meta">
                                  <h4 className="og-page__card-name">
                                    {g.displayName}
                                    {g.isSystem && <span className="og-page__badge">系统</span>}
                                  </h4>
                                  <span className="og-page__card-slug">{g.name}</span>
                                </div>
                                <div className="og-page__card-actions">
                                  <button className="og-page__action-btn" onClick={(e) => { e.stopPropagation(); openEdit(g); }} title="编辑">
                                    <Pencil size={14} />
                                  </button>
                                  <button
                                    className="og-page__action-btn og-page__action-btn--danger"
                                    onClick={(e) => { e.stopPropagation(); handleDelete(g); }}
                                    disabled={g.isSystem}
                                    title={g.isSystem ? '系统内置域不可删除' : '删除'}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                              {g.description && <p className="og-page__card-desc">{g.description}</p>}
                              <div className="og-page__card-footer">
                                <span className="og-page__card-sort">排序 {g.sortOrder}</span>
                                {industries.length > 0 && (
                                  <div className="og-page__card-industry-wrap" onClick={(e) => e.stopPropagation()}>
                                    <Select
                                      className="og-page__card-industry-select"
                                      value={g.industryId ? String(g.industryId) : 'none'}
                                      options={[
                                        { value: 'none', label: '无行业' },
                                        ...industries.map((ind) => ({
                                          value: String(ind.id),
                                          label: ind.displayName,
                                        })),
                                      ]}
                                      onChange={async (v) => {
                                        const newId = v === 'none' ? null : Number(v);
                                        try {
                                          await updateOntologyGroup(g.id, { industryId: newId } as OntologyGroup);
                                          toast('行业已更新', 'success');
                                          fetchGroups();
                                        } catch {
                                          toast('更新失败', 'error');
                                        }
                                      }}
                                      placeholder="选择行业"
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()
          )}
        </div>
      </div>

      {showForm && (
        <div className="og-page__modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="og-page__modal" onClick={(e) => e.stopPropagation()}>
            <div className="og-page__modal-header">
              <h3>{editing ? '编辑概念域' : '新建概念域'}</h3>
              <button className="og-page__modal-close" onClick={() => setShowForm(false)}>
                <X size={18} />
              </button>
            </div>
            <hr className="og-page__modal-divider" />
            <div className="og-page__modal-body">
              <div className="og-page__form-group">
                <label>概念域标识 <span className="og-page__required">*</span></label>
                <input
                  type="text"
                  placeholder="如：hr"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  disabled={!!editing}
                />
              </div>
              <div className="og-page__form-group">
                <label>显示名称 <span className="og-page__required">*</span></label>
                <input
                  type="text"
                  placeholder="如：人力资源"
                  value={form.displayName}
                  onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))}
                />
              </div>
              <div className="og-page__form-group">
                <label>描述</label>
                <textarea
                  placeholder="概念域描述"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>
              {industries.length > 0 && (
                <div className="og-page__form-group">
                  <label>所属行业</label>
                  <div className="og-page__select-wrap">
                    <Select
                      value={form.industryId ? String(form.industryId) : 'none'}
                      options={[
                        { value: 'none', label: '不选择行业' },
                        ...industries.map((ind) => ({
                          value: String(ind.id),
                          label: `${ind.displayName} (${ind.name})`,
                        })),
                      ]}
                      onChange={(v) => {
                        setForm((prev) => ({ ...prev, industryId: v === 'none' ? null : Number(v) }));
                      }}
                      placeholder="选择行业"
                    />
                  </div>
                </div>
              )}
              <div className="og-page__form-group">
                <label>图标</label>
                <div className="og-page__icon-picker">
                  <div className="og-page__icon-picker-selected">
                    {renderIcon(form.iconUrl || 'Box', 20)}
                    <span>{form.iconUrl || 'Box'}</span>
                  </div>
                  <div className="og-page__icon-picker-grid">
                    {ICON_KEYS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        className={`og-page__icon-picker-item ${form.iconUrl === key ? 'selected' : ''}`}
                        title={key}
                        onClick={() => setForm((prev) => ({ ...prev, iconUrl: key }))}
                      >
                        {renderIcon(key, 32)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="og-page__form-group">
                <label>排序</label>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm((prev) => ({ ...prev, sortOrder: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div className="og-page__modal-footer">
              <button className="og-page__modal-cancel" onClick={() => setShowForm(false)}>
                取消
              </button>
              <button className="og-page__modal-save" onClick={handleSubmit} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 size={14} className="og-page__spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    保存
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showIndustryForm && (
        <div className="og-page__modal-backdrop" onClick={() => setShowIndustryForm(false)}>
          <div className="og-page__modal" onClick={(e) => e.stopPropagation()}>
            <div className="og-page__modal-header">
              <h3>{editingIndustry ? '编辑行业' : '新增行业'}</h3>
              <button className="og-page__modal-close" onClick={() => setShowIndustryForm(false)}>
                <X size={18} />
              </button>
            </div>
            <hr className="og-page__modal-divider" />
            <div className="og-page__modal-body">
              <div className="og-page__form-group">
                <label>行业标识 <span className="og-page__required">*</span></label>
                <input
                  type="text"
                  placeholder="如：manufacturing"
                  value={industryForm.name}
                  onChange={(e) => setIndustryForm((prev) => ({ ...prev, name: e.target.value }))}
                  disabled={!!editingIndustry}
                />
              </div>
              <div className="og-page__form-group">
                <label>显示名称 <span className="og-page__required">*</span></label>
                <input
                  type="text"
                  placeholder="如：制造业"
                  value={industryForm.displayName}
                  onChange={(e) => setIndustryForm((prev) => ({ ...prev, displayName: e.target.value }))}
                />
              </div>
              <div className="og-page__form-group">
                <label>描述</label>
                <textarea
                  placeholder="行业描述"
                  rows={3}
                  value={industryForm.description}
                  onChange={(e) => setIndustryForm((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>
            </div>
            <div className="og-page__modal-footer">
              <button className="og-page__modal-cancel" onClick={() => setShowIndustryForm(false)}>
                取消
              </button>
              <button className="og-page__modal-save" onClick={handleIndustrySubmit} disabled={industrySaving}>
                {industrySaving ? (
                  <><Loader2 size={14} className="og-page__spin" />保存中...</>
                ) : (
                  <><Check size={14} />保存</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRelationForm && (
        <div className="og-page__modal-backdrop" onClick={() => setShowRelationForm(false)}>
          <div className="og-page__modal" onClick={(e) => e.stopPropagation()}>
            <div className="og-page__modal-header">
              <h3>新增关系类型</h3>
              <button className="og-page__modal-close" onClick={() => setShowRelationForm(false)}>
                <X size={18} />
              </button>
            </div>
            <hr className="og-page__modal-divider" />
            <div className="og-page__modal-body">
              <div className="og-page__form-group">
                <label>关系类型 <span className="og-page__required">*</span></label>
                <input
                  type="text"
                  placeholder="如：PART_OF"
                  value={relationForm.relationType}
                  onChange={(e) => setRelationForm((prev) => ({ ...prev, relationType: e.target.value }))}
                />
              </div>
              <div className="og-page__form-group">
                <label>描述</label>
                <textarea
                  placeholder="关系类型描述"
                  rows={2}
                  value={relationForm.description}
                  onChange={(e) => setRelationForm((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>
              <div className="og-page__form-group">
                <div className="og-page__switch-label">
                  <span className="og-page__switch-text">
                    传递性
                    <span className="og-page__switch-hint">若 A→B 且 B→C，则 A→C</span>
                  </span>
                  <label className="og-page__switch">
                    <input
                      type="checkbox"
                      checked={relationForm.isTransitive}
                      onChange={(e) => setRelationForm((prev) => ({ ...prev, isTransitive: e.target.checked }))}
                    />
                    <span className="og-page__switch-slider" />
                  </label>
                </div>
              </div>
              <div className="og-page__form-group">
                <div className="og-page__switch-label">
                  <span className="og-page__switch-text">
                    对称性
                    <span className="og-page__switch-hint">若 A→B，则 B→A</span>
                  </span>
                  <label className="og-page__switch">
                    <input
                      type="checkbox"
                      checked={relationForm.isSymmetric}
                      onChange={(e) => setRelationForm((prev) => ({ ...prev, isSymmetric: e.target.checked }))}
                    />
                    <span className="og-page__switch-slider" />
                  </label>
                </div>
              </div>
              <div className="og-page__form-group">
                <label>排序</label>
                <input
                  type="number"
                  value={relationForm.sortOrder}
                  onChange={(e) => setRelationForm((prev) => ({ ...prev, sortOrder: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div className="og-page__modal-footer">
              <button className="og-page__modal-cancel" onClick={() => setShowRelationForm(false)}>
                取消
              </button>
              <button className="og-page__modal-save" onClick={handleRelationSubmit} disabled={relationSaving}>
                {relationSaving ? (
                  <><Loader2 size={14} className="og-page__spin" />保存中...</>
                ) : (
                  <><Check size={14} />保存</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="og-page__modal-backdrop" onClick={closeImport}>
          <div className="og-page__modal og-page__import-modal" onClick={(e) => e.stopPropagation()}>
            <div className="og-page__modal-header">
              <h3>导入概念</h3>
              <button className="og-page__modal-close" onClick={closeImport}>
                <X size={18} />
              </button>
            </div>
            <hr className="og-page__modal-divider" />
            <div className="og-page__modal-body">
              {importStep === 'input' && (
                <>
                  {industries.length > 0 && (
                    <div className="og-page__form-group">
                      <label>行业</label>
                      <div className="og-page__select-wrap">
                        <Select
                          value={selectedIndustryId ? String(selectedIndustryId) : 'none'}
                          options={[
                            { value: 'none', label: '不选择行业（使用默认关系）' },
                            ...industries.map((ind) => ({
                              value: String(ind.id),
                              label: `${ind.displayName} (${ind.name})`,
                            })),
                          ]}
                          onChange={(v) => {
                            if (v === 'none') {
                              setSelectedIndustryId(null);
                            } else {
                              setSelectedIndustryId(v ? Number(v) : null);
                            }
                          }}
                          placeholder="选择行业"
                        />
                      </div>
                    </div>
                  )}
                  <div className="og-page__form-group">
                    <label>目标概念域 {!importTargetGroupId && <span className="og-page__required">*</span>}</label>
                    <div className="og-page__select-wrap">
                      <Select
                        value={importTargetGroupId ? String(importTargetGroupId) : 'auto'}
                        options={[
                          { value: 'auto', label: '🔍 自动匹配（若无匹配则创建新域）' },
                          ...groups
                            .filter((g) => !selectedIndustryId || g.industryId === selectedIndustryId)
                            .map((g) => ({
                              value: String(g.id),
                              label: `${g.displayName} (${g.name})`,
                            })),
                        ]}
                        onChange={(v) => {
                          if (v === 'auto') {
                            setImportTargetGroupId(null);
                          } else {
                            setImportTargetGroupId(v ? Number(v) : null);
                          }
                        }}
                        placeholder="请选择概念域"
                      />
                    </div>
                  </div>
                  <div className="og-page__form-group">
                    <label>格式 <span className="og-page__required">*</span></label>
                    <div className="og-page__select-wrap">
                      <Select
                        value={importSourceType}
                        options={[
                          { value: 'SWAGGER', label: 'Swagger / OpenAPI' },
                          { value: 'OWL', label: 'OWL / RDF' },
                          { value: 'JSON', label: 'JSON' },
                          { value: 'EXCEL', label: 'Excel (.xlsx)' },
                        ]}
                        onChange={(v) => setImportSourceType(v)}
                        placeholder="选择格式"
                      />
                    </div>
                  </div>
                  <div className="og-page__form-group">
                    <label>导入方式</label>
                    <div className="og-page__import-tabs">
                      <button
                        className={`og-page__import-tab ${importMode === 'url' ? 'active' : ''}`}
                        onClick={() => setImportMode('url')}
                      >
                        <Globe size={14} /> URL 链接
                      </button>
                      <button
                        className={`og-page__import-tab ${importMode === 'file' ? 'active' : ''}`}
                        onClick={() => setImportMode('file')}
                      >
                        <Upload size={14} /> 上传文件
                      </button>
                      <button
                        className={`og-page__import-tab ${importMode === 'paste' ? 'active' : ''}`}
                        onClick={() => setImportMode('paste')}
                      >
                        <FileTextIcon size={14} /> 粘贴内容
                      </button>
                    </div>
                  </div>
                  {importMode === 'url' && (
                    <div className="og-page__form-group">
                      <label>URL 地址</label>
                      <input
                        type="text"
                        placeholder="https://example.com/swagger.json"
                        value={importUrl}
                        onChange={(e) => setImportUrl(e.target.value)}
                      />
                    </div>
                  )}
                  {importMode === 'file' && (
                    <div className="og-page__form-group">
                      <div
                        className={`og-page__import-drop ${importFile ? 'has-file' : ''}`}
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
                        onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.remove('drag-over');
                          const file = e.dataTransfer.files[0];
                          if (file) setImportFile(file);
                        }}
                      >
                        {importFile ? (
                          <div className="og-page__import-file-info">
                            <FileTextIcon size={20} />
                            <span className="og-page__import-file-name">{importFile.name}</span>
                            <span className="og-page__import-file-size">
                              {(importFile.size / 1024).toFixed(1)} KB
                            </span>
                            <button
                              className="og-page__import-file-remove"
                              onClick={(e) => { e.stopPropagation(); setImportFile(null); }}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <div className="og-page__import-drop-hint">
                            <Upload size={24} />
                            <span>点击选择文件，或拖拽文件到此处</span>
                            <span className="og-page__import-drop-sub">支持 .json, .owl, .rdf, .yaml, .yml, .xlsx</span>
                          </div>
                        )}
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,.owl,.rdf,.yaml,.yml,.xml,.txt,.xlsx,.xls"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) setImportFile(file);
                        }}
                      />
                    </div>
                  )}
                  {importMode === 'paste' && (
                    <div className="og-page__form-group">
                      <label>粘贴内容</label>
                      <textarea
                        placeholder="粘贴 OWL / JSON / Swagger 内容..."
                        rows={8}
                        value={importContent}
                        onChange={(e) => setImportContent(e.target.value)}
                      />
                    </div>
                  )}
                </>
              )}

              {/* SSE 进度提示 */}
              {importProgress && (
                <div className="og-page__import-progress">
                  <Loader2 size={18} className="og-page__spin" />
                  <span>{importProgress}</span>
                </div>
              )}

              {importStep === 'preview' && (
                <>
                  <div className="og-page__import-summary">
                    解析到 {importPreviewTotal} 个概念，勾选取消不需要导入的项
                  </div>
                  {importSuggestedDomains.length > 0 && (
                    <div className="og-page__import-domains">
                      <div className="og-page__import-domains-title">自动识别的概念域：</div>
                      {importSuggestedDomains.map((d, i) => (
                        <span key={i} className={`og-page__import-domain-tag ${d.isNew ? 'new' : ''}`}>
                          {d.name} ({d.conceptCount}个)
                          {d.isNew && <span className="og-page__import-domain-new-badge">新建</span>}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="og-page__import-list">
                    {importPreview.map((item, i) => (
                      <label key={i} className={`og-page__import-item ${item.skip ? 'skip' : ''} ${item.conflict ? 'conflict' : ''}`}>
                        <input
                          type="checkbox"
                          checked={!item.skip}
                          onChange={() => toggleSelectItem(i)}
                        />
                        <div className="og-page__import-item-info">
                          <span className="og-page__import-item-name">
                            {Boolean(item.conflict) && <AlertTriangle size={14} className="og-page__import-warn" />}
                            {String(item.displayName ?? item.name ?? '')}
                          </span>
                          <span className="og-page__import-item-slug">{String(item.name ?? '')}</span>
                          {Boolean(item.description) && <span className="og-page__import-item-desc">{String(item.description)}</span>}
                          {Boolean(item.conflict) && <span className="og-page__import-item-conflict">{String(item.conflictMessage ?? '')}</span>}
                          {Boolean(item.relations) && Array.isArray(item.relations) && (item.relations as string[]).length > 0 && (
                            <span className="og-page__import-item-rels">
                              {(item.relations as string[]).join(', ')}
                            </span>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {importStep === 'importing' && !importResult && (
                <div className="og-page__import-progress">
                  <Loader2 size={24} className="og-page__spin" />
                  <span>正在导入概念，请稍候...</span>
                </div>
              )}
              {importStep === 'importing' && importResult && (
                <div className="og-page__import-result">
                  <Check size={32} className="og-page__import-result-icon" />
                  <p>导入完成</p>
                  <p>成功 {importResult.created} 个，跳过 {importResult.skipped} 个</p>
                </div>
              )}
            </div>
            <div className="og-page__modal-footer">
              {importStep === 'input' && (
                <>
                  <button className="og-page__modal-cancel" onClick={closeImport}>取消</button>
                  <button className="og-page__modal-save" onClick={handleImportPreview} disabled={importLoading}>
                    {importLoading ? <><Loader2 size={14} className="og-page__spin" />解析中...</> : '下一步：预览'}
                  </button>
                </>
              )}
              {importStep === 'preview' && (
                <>
                  <button className="og-page__modal-cancel" onClick={() => setImportStep('input')}>上一步</button>
                  <button className="og-page__modal-save" onClick={handleImportExecute} disabled={importLoading}>
                    {importLoading ? <><Loader2 size={14} className="og-page__spin" />导入中...</> : '确认导入'}
                  </button>
                </>
              )}
              {importStep === 'importing' && !importResult && (
                <button className="og-page__modal-cancel" disabled>取消</button>
              )}
              {importStep === 'importing' && importResult && (
                <button className="og-page__modal-save" onClick={closeImport}>完成</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}