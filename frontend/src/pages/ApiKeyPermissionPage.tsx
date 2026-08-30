import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { listToolGroups, listToolDefinitions, listKeyTools, requestToolPermissions, listKeyDatasources, listAvailableDatasources, requestDatasourcePermission, fetchToolTypes } from '@/api/tool';
import { listApiKeys } from '@/api/tool';
import { useToastStore } from '@/stores/toastStore';
import { useConfirmStore } from '@/stores/confirmStore';
import type { ToolGroup, ToolDefinition, ToolTypeInfo } from '@/types/tool';
import './ApiKeyPermissionPage.css';

interface ApiKeyItem {
  id: number;
  name: string;
}

interface ToolWithStatus extends ToolDefinition {
  permissionStatus: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
}

interface DatasourceItem {
  id: number;
  name: string;
  type: string;
  status: string;
  description?: string;
}

interface DatasourceWithStatus extends DatasourceItem {
  permissionStatus: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
}

const STATUS_LABEL: Record<string, string> = {
  NONE: '未申请',
  PENDING: '待审批',
  APPROVED: '已通过',
  REJECTED: '已驳回',
};

export default function ApiKeyPermissionPage() {
  const { keyId } = useParams<{ keyId: string }>();
  const navigate = useNavigate();
  const toast = useToastStore((s) => s.show);
  const confirm = useConfirmStore((s) => s.confirm);

  const [keyInfo, setKeyInfo] = useState<ApiKeyItem | null>(null);
  const [toolTypes, setToolTypes] = useState<ToolTypeInfo[]>([]);
  const [groups, setGroups] = useState<ToolGroup[]>([]);
  const [tools, setTools] = useState<ToolWithStatus[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [_toolLoading, setToolLoading] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [systemSearch, setSystemSearch] = useState('');
  const [page, setPage] = useState(1);
  const [keyToolStatuses, setKeyToolStatuses] = useState<Map<number, string>>(new Map());
  const PAGE_SIZE = 20;

  const [activeTab, setActiveTab] = useState<'tools' | 'datasources'>('tools');
  const [datasources, setDatasources] = useState<DatasourceWithStatus[]>([]);
  const [selectedDsIds, setSelectedDsIds] = useState<Set<number>>(new Set());
  const [dsSearch, setDsSearch] = useState('');
  const [dsPage, setDsPage] = useState(1);
  const [dsLoading, setDsLoading] = useState(false);
  const [keyDsStatuses, setKeyDsStatuses] = useState<Map<number, string>>(new Map());
  const [activeDsGroupId, setActiveDsGroupId] = useState<number | null>(null);

  const fetchInit = useCallback(async () => {
    if (!keyId) return;
    setLoading(true);
    try {
      const [keysRes, groupsRes, keyToolsRes] = await Promise.all([
        listApiKeys(),
        listToolGroups(),
        listKeyTools(Number(keyId)),
      ]);

      fetchToolTypes().then((res) => setToolTypes(res.data)).catch(() => {});

      const keys = (keysRes.data as ApiKeyItem[]) || [];
      const currentKey = keys.find((k) => k.id === Number(keyId));
      setKeyInfo(currentKey || null);

      const allGroups = (groupsRes.data as ToolGroup[]) || [];
      setGroups(allGroups.filter((g) => g.status === 'ENABLED'));

      const kt = (keyToolsRes.data as { toolId: number; status: string }[]) || [];
      const sm = new Map<number, string>();
      kt.forEach((item) => sm.set(item.toolId, item.status));
      setKeyToolStatuses(sm);
    } catch {
      toast('加载数据失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [keyId, toast]);

  const fetchTools = useCallback(async (groupId: number, statuses?: Map<number, string>) => {
    const sm = statuses || keyToolStatuses;
    setToolLoading(true);
    try {
      const res = await listToolDefinitions({ groupId: String(groupId) });
      const raw = (res.data as ToolDefinition[]) || [];
      const withStatus: ToolWithStatus[] = raw
        .filter((t) => t.status === 'ENABLED')
        .map((t) => ({
          ...t,
          permissionStatus: (sm.get(t.id) || 'NONE') as ToolWithStatus['permissionStatus'],
        }));
      setTools(withStatus);
    } catch {
      toast('加载工具失败', 'error');
    } finally {
      setToolLoading(false);
    }
  }, [keyToolStatuses, toast]);

  useEffect(() => {
    fetchInit();
  }, [fetchInit]);

  useEffect(() => {
    if (activeGroupId !== null) fetchTools(activeGroupId);
  }, [activeGroupId, fetchTools]);

  useEffect(() => {
    if (activeGroupId === null && groups.length > 0) {
      setActiveGroupId(groups[0].id);
    }
  }, [groups, activeGroupId]);

  useEffect(() => {
    setPage(1);
  }, [activeGroupId, search]);

  const fetchDatasources = useCallback(async (groupId: number, statuses?: Map<number, string>) => {
    const sm = statuses || keyDsStatuses;
    setDsLoading(true);
    try {
      const [allRes, keyRes] = await Promise.all([
        listAvailableDatasources(groupId),
        listKeyDatasources(Number(keyId)),
      ]);
      const all = (allRes.data as DatasourceItem[]) || [];
      const keyList = (keyRes.data as { datasourceId: number; status: string }[]) || [];
      const ksm = new Map<number, string>();
      keyList.forEach((item) => ksm.set(item.datasourceId, item.status));
      setKeyDsStatuses(ksm);

      const withStatus: DatasourceWithStatus[] = all.map((ds) => ({
        ...ds,
        permissionStatus: ((sm.get(ds.id) || ksm.get(ds.id) || 'NONE') as DatasourceWithStatus['permissionStatus']),
      }));
      setDatasources(withStatus);
    } catch {
      toast('加载数据源失败', 'error');
    } finally {
      setDsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyId, toast]);

  useEffect(() => {
    if (activeTab === 'datasources' && activeDsGroupId !== null) fetchDatasources(activeDsGroupId);
  }, [activeTab, activeDsGroupId, fetchDatasources]);

  useEffect(() => {
    if (activeTab === 'datasources' && activeDsGroupId === null && groups.length > 0) {
      setActiveDsGroupId(groups[0].id);
    }
  }, [activeTab, activeDsGroupId, groups]);

  useEffect(() => {
    setDsPage(1);
  }, [activeDsGroupId, dsSearch]);

  const filteredTools = useMemo(() => {
    let list = tools;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) =>
        (t.displayName || t.name).toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [tools, search]);

  const totalPages = Math.max(1, Math.ceil(filteredTools.length / PAGE_SIZE));
  const pagedTools = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredTools.slice(start, start + PAGE_SIZE);
  }, [filteredTools, page]);

  const filteredGroups = useMemo(() => {
    if (!systemSearch.trim()) return groups;
    const q = systemSearch.trim().toLowerCase();
    return groups.filter((g) =>
      g.name.toLowerCase().includes(q) || g.code.toLowerCase().includes(q)
    );
  }, [groups, systemSearch]);

  const selectableTools = useMemo(() =>
    filteredTools.filter((t) => t.permissionStatus === 'NONE' || t.permissionStatus === 'REJECTED'),
    [filteredTools]);

  const filteredDatasources = useMemo(() => {
    let list = datasources;
    if (dsSearch.trim()) {
      const q = dsSearch.trim().toLowerCase();
      list = list.filter((ds) =>
        (ds.name || '').toLowerCase().includes(q) ||
        (ds.description || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [datasources, dsSearch]);

  const dsTotalPages = Math.max(1, Math.ceil(filteredDatasources.length / PAGE_SIZE));
  const pagedDatasources = useMemo(() => {
    const start = (dsPage - 1) * PAGE_SIZE;
    return filteredDatasources.slice(start, start + PAGE_SIZE);
  }, [filteredDatasources, dsPage]);

  const selectableDatasources = useMemo(() =>
    filteredDatasources.filter((ds) => ds.permissionStatus === 'NONE' || ds.permissionStatus === 'REJECTED'),
    [filteredDatasources]);

  const allDsSelectedInView = selectableDatasources.length > 0 && selectableDatasources.every((ds) => selectedDsIds.has(ds.id));

  const allSelectedInView = selectableTools.length > 0 && selectableTools.every((t) => selectedIds.has(t.id));

  const toggleSelect = (toolId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  };

  const toggleSelectAllInView = () => {
    if (allSelectedInView) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        selectableTools.forEach((t) => next.delete(t.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        selectableTools.forEach((t) => next.add(t.id));
        return next;
      });
    }
  };

  const handleBatchRequest = async () => {
    if (selectedIds.size === 0) return;
    const result = await confirm({
      title: '确认申请',
      message: `确定要为 ${selectedIds.size} 个工具申请权限吗？`,
    });
    if (!result) return;
    try {
      await requestToolPermissions(Number(keyId), Array.from(selectedIds));
      toast('权限申请已提交', 'success');
      setSelectedIds(new Set());
      const ktRes = await listKeyTools(Number(keyId));
      const kt = (ktRes.data as { toolId: number; status: string }[]) || [];
      const sm = new Map<number, string>();
      kt.forEach((item) => sm.set(item.toolId, item.status));
      setKeyToolStatuses(sm);
      if (activeGroupId !== null) fetchTools(activeGroupId, sm);
    } catch {
      toast('申请失败', 'error');
    }
  };

  const toggleDsSelect = (dsId: number) => {
    setSelectedDsIds((prev) => {
      const next = new Set(prev);
      if (next.has(dsId)) next.delete(dsId);
      else next.add(dsId);
      return next;
    });
  };

  const toggleSelectAllDs = () => {
    if (allDsSelectedInView) {
      setSelectedDsIds((prev) => {
        const next = new Set(prev);
        selectableDatasources.forEach((ds) => next.delete(ds.id));
        return next;
      });
    } else {
      setSelectedDsIds((prev) => {
        const next = new Set(prev);
        selectableDatasources.forEach((ds) => next.add(ds.id));
        return next;
      });
    }
  };

  const handleDsBatchRequest = async () => {
    if (selectedDsIds.size === 0) return;
    const result = await confirm({
      title: '确认申请',
      message: `确定要为 ${selectedDsIds.size} 个数据源申请权限吗？`,
    });
    if (!result) return;
    try {
      for (const dsId of selectedDsIds) {
        await requestDatasourcePermission(Number(keyId), dsId);
      }
      toast('数据源权限申请已提交', 'success');
      setSelectedDsIds(new Set());
      fetchDatasources(activeDsGroupId!);
    } catch {
      toast('申请失败', 'error');
    }
  };

  if (loading) {
    return <div className="perm-page-loading">加载中...</div>;
  }

  const _totalSelectable = tools.filter((t) => t.permissionStatus === 'NONE' || t.permissionStatus === 'REJECTED').length;

  return (
    <div className="perm-page">
      <div className="perm-page-header">
        <div className="perm-page-header-left">
          <button className="perm-page-back" onClick={() => navigate('/connect/keys')}>
            <ArrowLeft size={18} />
          </button>
          <h2>权限申请</h2>
          {keyInfo && <span className="perm-page-key-name">{keyInfo.name}</span>}
        </div>
        <div className="perm-page-tabs">
          <button
            className={`perm-page-tab ${activeTab === 'tools' ? 'active' : ''}`}
            onClick={() => setActiveTab('tools')}
          >
            工具
          </button>
          <button
            className={`perm-page-tab ${activeTab === 'datasources' ? 'active' : ''}`}
            onClick={() => setActiveTab('datasources')}
          >
            数据源
          </button>
        </div>
        {activeTab === 'tools' && selectedIds.size > 0 && (
          <button className="perm-page-submit" onClick={handleBatchRequest}>
            <Check size={16} />
            申请选中 ({selectedIds.size})
          </button>
        )}
        {activeTab === 'datasources' && selectedDsIds.size > 0 && (
          <button className="perm-page-submit" onClick={handleDsBatchRequest}>
            <Check size={16} />
            申请选中 ({selectedDsIds.size})
          </button>
        )}
      </div>

      {activeTab === 'tools' ? (
        <div className="perm-layout">
          <div className="perm-sidebar">
            <div className="perm-sidebar-search">
              <Search size={14} />
              <input
                type="text"
                placeholder="搜索系统..."
                value={systemSearch}
                onChange={(e) => setSystemSearch(e.target.value)}
              />
            </div>
            <div className="perm-sidebar-label">
              <span>全部系统</span>
              <span className="perm-sidebar-label-count">{groups.length}</span>
            </div>
            {filteredGroups.map((group) => (
              <div
                key={group.id}
                className={`perm-sidebar-item ${activeGroupId === group.id ? 'active' : ''}`}
                onClick={() => setActiveGroupId(group.id)}
              >
                <span className="perm-sidebar-name">{group.name}</span>
              </div>
            ))}
          </div>

          <div className="perm-content">
            <div className="perm-toolbar">
              <div className="perm-toolbar-left">
                <div className="perm-search">
                  <Search size={16} />
                  <input
                    type="text"
                    placeholder="搜索工具名称或描述..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                {activeGroupId !== null && (
                  <span className="perm-tool-count">
                    {groups.find((g) => g.id === activeGroupId)?.name} · {tools.length} 个工具
                  </span>
                )}
              </div>
              {selectableTools.length > 0 && (
                <label className="perm-select-all">
                  <input
                    type="checkbox"
                    checked={allSelectedInView}
                    onChange={toggleSelectAllInView}
                  />
                  全选 ({selectableTools.length})
                </label>
              )}
            </div>

            <div className="perm-tool-list">
              {pagedTools.length === 0 ? (
                <div className="perm-tool-empty">暂无工具</div>
              ) : (
                pagedTools.map((tool) => {
                  const isSelected = selectedIds.has(tool.id);
                  const canRequest = tool.permissionStatus === 'NONE' || tool.permissionStatus === 'REJECTED';

                  return (
                    <div
                      key={tool.id}
                      className={`perm-tool-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => { if (canRequest) toggleSelect(tool.id); }}
                    >
                      {canRequest && (
                        <input
                          type="checkbox"
                          className="perm-tool-checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(tool.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                      <div className="perm-tool-info">
                        <div className="perm-tool-name-row">
                          <span className="perm-tool-name">{tool.displayName || tool.name}</span>
                          <span className={`perm-tool-type type-${tool.toolType}`}>
                            {toolTypes.find(t => t.value === tool.toolType)?.label || tool.toolType}
                          </span>
                          <span className={`perm-tool-status status-${tool.permissionStatus.toLowerCase()}`}>
                            {STATUS_LABEL[tool.permissionStatus]}
                          </span>
                        </div>
                        {tool.description && (
                          <span className="perm-tool-desc">{tool.description}</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {totalPages > 1 && (
              <div className="perm-pagination">
                <span className="perm-pagination-info">
                  共 {filteredTools.length} 个工具，第 {page}/{totalPages} 页
                </span>
                <div className="perm-pagination-btns">
                  <button
                    className="perm-pagination-btn"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    className="perm-pagination-btn"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="perm-layout">
          <div className="perm-sidebar">
            <div className="perm-sidebar-search">
              <Search size={14} />
              <input
                type="text"
                placeholder="搜索系统..."
                value={systemSearch}
                onChange={(e) => setSystemSearch(e.target.value)}
              />
            </div>
            <div className="perm-sidebar-label">
              <span>全部系统</span>
              <span className="perm-sidebar-label-count">{groups.length}</span>
            </div>
            {filteredGroups.map((group) => (
              <div
                key={group.id}
                className={`perm-sidebar-item ${activeDsGroupId === group.id ? 'active' : ''}`}
                onClick={() => setActiveDsGroupId(group.id)}
              >
                <span className="perm-sidebar-name">{group.name}</span>
              </div>
            ))}
          </div>

          <div className="perm-content">
            <div className="perm-toolbar">
              <div className="perm-toolbar-left">
                <div className="perm-search">
                  <Search size={16} />
                  <input
                    type="text"
                    placeholder="搜索数据源名称或描述..."
                    value={dsSearch}
                    onChange={(e) => setDsSearch(e.target.value)}
                  />
                </div>
                <span className="perm-tool-count">
                  {activeDsGroupId !== null
                    ? `${groups.find((g) => g.id === activeDsGroupId)?.name} · ${datasources.length} 个数据源`
                    : `数据源 · ${datasources.length} 个`}
                </span>
              </div>
              {selectableDatasources.length > 0 && (
                <label className="perm-select-all">
                  <input
                    type="checkbox"
                    checked={allDsSelectedInView}
                    onChange={toggleSelectAllDs}
                  />
                  全选 ({selectableDatasources.length})
                </label>
              )}
            </div>

            {dsLoading ? (
              <div className="perm-tool-empty">加载中...</div>
            ) : (
              <div className="perm-tool-list">
                {pagedDatasources.length === 0 ? (
                  <div className="perm-tool-empty">暂无数据源</div>
                ) : (
                  pagedDatasources.map((ds) => {
                    const isSelected = selectedDsIds.has(ds.id);
                    const canRequest = ds.permissionStatus === 'NONE' || ds.permissionStatus === 'REJECTED';

                    return (
                      <div
                        key={ds.id}
                        className={`perm-tool-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => { if (canRequest) toggleDsSelect(ds.id); }}
                      >
                        {canRequest && (
                          <input
                            type="checkbox"
                            className="perm-tool-checkbox"
                            checked={isSelected}
                            onChange={() => toggleDsSelect(ds.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                        <div className="perm-tool-info">
                          <div className="perm-tool-name-row">
                            <span className="perm-tool-name">{ds.name}</span>
                            <span className="perm-tool-type type-HTTP">
                              {ds.type || 'DB'}
                            </span>
                            <span className={`perm-tool-status status-${ds.permissionStatus.toLowerCase()}`}>
                              {STATUS_LABEL[ds.permissionStatus]}
                            </span>
                          </div>
                          {ds.description && (
                            <span className="perm-tool-desc">{ds.description}</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {dsTotalPages > 1 && (
              <div className="perm-pagination">
                <span className="perm-pagination-info">
                  共 {filteredDatasources.length} 个数据源，第 {dsPage}/{dsTotalPages} 页
                </span>
                <div className="perm-pagination-btns">
                  <button
                    className="perm-pagination-btn"
                    disabled={dsPage <= 1}
                    onClick={() => setDsPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    className="perm-pagination-btn"
                    disabled={dsPage >= dsTotalPages}
                    onClick={() => setDsPage((p) => Math.min(dsTotalPages, p + 1))}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}