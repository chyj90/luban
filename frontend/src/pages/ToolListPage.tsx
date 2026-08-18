import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listToolGroups, listToolDefinitions, createToolDefinition, updateToolDefinition, deleteToolDefinition, searchTools, testTool, parseSwagger, batchImportSwagger } from '@/api/tool';
import { getConceptTools, getToolConcepts, listConcepts, bindToolConcept, unbindToolConcept } from '@/api/concept';
import { useToastStore } from '@/stores/toastStore';
import { useConfirmStore } from '@/stores/confirmStore';
import type { ToolGroup, ToolDefinition, ToolSearchResult, SwaggerEndpoint } from '@/types/tool';
import type { ToolBindingInfo, ToolConcept, Concept } from '@/types/concept';
import './ToolListPage.css';

const TOOL_TYPE_LABELS: Record<string, string> = {
  HTTP: 'HTTP 接口',
  SQL: 'SQL 查询',
  MCP_PASSTHROUGH: 'MCP 透传',
};

export default function ToolListPage() {
  const [searchParams] = useSearchParams();
  const [groups, setGroups] = useState<ToolGroup[]>([]);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(
    searchParams.get('groupId') ? Number(searchParams.get('groupId')) : null,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ToolSearchResult[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ToolDefinition | null>(null);
  const [form, setForm] = useState({ name: '', displayName: '', toolType: 'HTTP', description: '', inputSchema: '{}', config: '{}', groupId: 0 });
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [showSwagger, setShowSwagger] = useState(false);
  const [swaggerUrl, setSwaggerUrl] = useState('');
  const [swaggerEndpoints, setSwaggerEndpoints] = useState<SwaggerEndpoint[]>([]);
  const [selectedEndpoints, setSelectedEndpoints] = useState<Set<string>>(new Set());
  const [parsingSwagger, setParsingSwagger] = useState(false);
  const [showConceptBind, setShowConceptBind] = useState(false);
  const [bindingTool, setBindingTool] = useState<ToolDefinition | null>(null);
  const [conceptBindings, setConceptBindings] = useState<ToolConcept[]>([]);
  const [allConcepts, setAllConcepts] = useState<Concept[]>([]);
  const [selectedConceptId, setSelectedConceptId] = useState<number | null>(null);
  const [selectedBindRelation, setSelectedBindRelation] = useState('PRODUCES');
  const toast = useToastStore((s) => s.add);
  const confirm = useConfirmStore((s) => s.show);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await listToolGroups();
      setGroups(res.data);
    } catch {
      toast('加载系统列表失败', 'error');
    }
  }, [toast]);

  const fetchTools = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listToolDefinitions(selectedGroupId ?? undefined);
      setTools(res.data);
    } catch {
      toast('加载工具列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedGroupId, toast]);

  useEffect(() => {
    fetchGroups();
    fetchTools();
  }, [fetchGroups, fetchTools]);

  const handleSearch = async () => {
    if (!selectedGroupId || !searchQuery.trim()) return;
    try {
      const res = await searchTools(selectedGroupId, searchQuery);
      setSearchResults(res.data);
    } catch {
      toast('搜索失败', 'error');
    }
  };

  const handleSubmit = async () => {
    if (!form.name || !form.groupId) {
      toast('名称和所属系统为必填项', 'error');
      return;
    }
    try {
      if (editing) {
        await updateToolDefinition(editing.id, form);
        toast('更新成功', 'success');
      } else {
        await createToolDefinition(form);
        toast('创建成功', 'success');
      }
      setShowForm(false);
      setEditing(null);
      fetchTools();
    } catch {
      toast('操作失败', 'error');
    }
  };

  const handleDelete = async (tool: ToolDefinition) => {
    confirm({
      title: '确认删除',
      message: `确定要删除工具「${tool.displayName}」吗？`,
      onConfirm: async () => {
        try {
          await deleteToolDefinition(tool.id);
          toast('删除成功', 'success');
          fetchTools();
        } catch {
          toast('删除失败', 'error');
        }
      },
    });
  };

  const handleTest = async (tool: ToolDefinition) => {
    setTesting(true);
    setTestResult(null);
    try {
      const args: Record<string, unknown> = {};
      if (tool.inputSchema && tool.inputSchema !== '{}') {
        const schema = JSON.parse(tool.inputSchema);
        if (schema.properties) {
          for (const [key, prop] of Object.entries(schema.properties) as [string, { type: string; default?: unknown }][]) {
            if (prop.default !== undefined) {
              args[key] = prop.default;
            }
          }
        }
      }
      const res = await testTool(tool.id, args);
      setTestResult(JSON.stringify(res.data, null, 2));
    } catch {
      setTestResult('测试调用失败');
    } finally {
      setTesting(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', displayName: '', toolType: 'HTTP', description: '', inputSchema: '{}', config: '{}', groupId: selectedGroupId ?? 0 });
    setShowForm(true);
  };

  const openEdit = (tool: ToolDefinition) => {
    setEditing(tool);
    setForm({
      name: tool.name,
      displayName: tool.displayName,
      toolType: tool.toolType,
      description: tool.description || '',
      inputSchema: tool.inputSchema || '{}',
      config: tool.config || '{}',
      groupId: tool.groupId,
    });
    setShowForm(true);
  };

  const handleParseSwagger = async () => {
    if (!swaggerUrl.trim()) {
      toast('请输入 Swagger 地址', 'error');
      return;
    }
    setParsingSwagger(true);
    try {
      const res = await parseSwagger({ url: swaggerUrl });
      setSwaggerEndpoints(res.data.endpoints);
      setSelectedEndpoints(new Set());
      if (res.data.endpoints.length === 0) {
        toast('未解析到接口', 'error');
      }
    } catch {
      toast('解析失败', 'error');
    } finally {
      setParsingSwagger(false);
    }
  };

  const handleBatchImport = async () => {
    if (selectedEndpoints.size === 0) {
      toast('请选择要导入的接口', 'error');
      return;
    }
    if (!selectedGroupId) {
      toast('请先选择所属系统', 'error');
      return;
    }
    const endpoints = swaggerEndpoints.filter((ep) => selectedEndpoints.has(ep.name));
    try {
      const res = await batchImportSwagger(selectedGroupId, endpoints);
      toast(`导入成功，创建 ${res.data.created} 个工具`, 'success');
      setShowSwagger(false);
      setSwaggerEndpoints([]);
      setSelectedEndpoints(new Set());
      fetchTools();
    } catch {
      toast('导入失败', 'error');
    }
  };

  const toggleEndpoint = (name: string) => {
    const next = new Set(selectedEndpoints);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    setSelectedEndpoints(next);
  };

  const toggleAllEndpoints = () => {
    if (selectedEndpoints.size === swaggerEndpoints.length) {
      setSelectedEndpoints(new Set());
    } else {
      setSelectedEndpoints(new Set(swaggerEndpoints.map((ep) => ep.name)));
    }
  };

  const openConceptBind = async (tool: ToolDefinition) => {
    setBindingTool(tool);
    setShowConceptBind(true);
    try {
      const [bindingsRes, conceptsRes] = await Promise.all([
        getToolConcepts(tool.id),
        listConcepts(),
      ]);
      setConceptBindings(bindingsRes.data);
      setAllConcepts(conceptsRes.data);
    } catch {
      toast('加载概念绑定失败', 'error');
    }
  };

  const handleBindConcept = async () => {
    if (!bindingTool || !selectedConceptId) return;
    try {
      await bindToolConcept(bindingTool.id, { conceptId: selectedConceptId, relation: selectedBindRelation });
      toast('绑定成功', 'success');
      const res = await getToolConcepts(bindingTool.id);
      setConceptBindings(res.data);
      setSelectedConceptId(null);
    } catch {
      toast('绑定失败', 'error');
    }
  };

  const handleUnbindConcept = async (bindId: number) => {
    if (!bindingTool) return;
    try {
      await unbindToolConcept(bindingTool.id, bindId);
      toast('已解绑', 'success');
      const res = await getToolConcepts(bindingTool.id);
      setConceptBindings(res.data);
    } catch {
      toast('解绑失败', 'error');
    }
  };

  const displayTools = searchQuery.trim() ? [] : tools;

  return (
    <div className="tool-list">
      <div className="tool-list-header">
        <h2 className="tool-list-title">工具注册表</h2>
        <div className="tool-list-header-actions">
          <button className="tool-list-swagger-btn" onClick={() => setShowSwagger(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Swagger 导入
          </button>
          <button className="tool-list-add-btn" onClick={openCreate}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            新建工具
          </button>
        </div>
      </div>

      <div className="tool-list-filters">
        <select
          className="tool-list-select"
          value={selectedGroupId ?? ''}
          onChange={(e) => setSelectedGroupId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">全部系统</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <div className="tool-list-search">
          <input
            className="tool-list-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="搜索工具..."
          />
          <button className="tool-list-search-btn" onClick={handleSearch}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
        </div>
      </div>

      {searchQuery.trim() && searchResults.length > 0 && (
        <div className="tool-list-search-results">
          <h3 className="tool-list-search-results-title">搜索结果</h3>
          {searchResults.map((r) => (
            <div key={r.id} className="tool-list-search-item">
              <span className="tool-list-search-item-name">{r.displayName}</span>
              <span className="tool-list-search-item-type">{TOOL_TYPE_LABELS[r.toolType] ?? r.toolType}</span>
              <span className="tool-list-search-item-desc">{r.description}</span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="tool-list-loading">加载中...</div>
      ) : (
        <div className="tool-list-table-wrap">
          <table className="tool-list-table">
            <thead>
              <tr>
                <th>工具名称</th>
                <th>类型</th>
                <th>所属系统</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {displayTools.length === 0 ? (
                <tr>
                  <td colSpan={5} className="tool-list-empty">暂无工具</td>
                </tr>
              ) : (
                displayTools.map((tool) => {
                  const group = groups.find((g) => g.id === tool.groupId);
                  return (
                    <tr key={tool.id}>
                      <td>
                        <div className="tool-list-tool-name">{tool.displayName}</div>
                        <div className="tool-list-tool-desc">{tool.description}</div>
                      </td>
                      <td>
                        <span className="tool-list-type-badge">{TOOL_TYPE_LABELS[tool.toolType] ?? tool.toolType}</span>
                      </td>
                      <td>{group?.name ?? '-'}</td>
                      <td>
                        <span className={`tool-list-status ${tool.status === 'ENABLED' ? 'enabled' : 'disabled'}`}>
                          {tool.status === 'ENABLED' ? '启用' : '禁用'}
                        </span>
                      </td>
                      <td>
                        <div className="tool-list-row-actions">
                          <button className="tool-list-row-btn" onClick={() => handleTest(tool)}>测试</button>
                          <button className="tool-list-row-btn" onClick={() => openEdit(tool)}>编辑</button>
                          <button className="tool-list-row-btn" onClick={() => openConceptBind(tool)}>概念</button>
                          <button className="tool-list-row-btn danger" onClick={() => handleDelete(tool)}>删除</button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {testResult !== null && (
        <div className="tool-list-test-result">
          <div className="tool-list-test-result-header">
            <h3>测试结果</h3>
            <button onClick={() => setTestResult(null)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <pre className="tool-list-test-result-content">{testResult}</pre>
        </div>
      )}

      {showForm && (
        <div className="tool-form-overlay" onClick={() => setShowForm(false)}>
          <div className="tool-form" onClick={(e) => e.stopPropagation()}>
            <h3 className="tool-form-title">{editing ? '编辑工具' : '新建工具'}</h3>
            <div className="tool-form-field">
              <label className="tool-form-label">所属系统</label>
              <select className="tool-form-select" value={form.groupId} onChange={(e) => setForm({ ...form, groupId: Number(e.target.value) })}>
                <option value={0}>请选择系统</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div className="tool-form-field">
              <label className="tool-form-label">工具名称（英文标识）</label>
              <input className="tool-form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：get_device_status" />
            </div>
            <div className="tool-form-field">
              <label className="tool-form-label">显示名称</label>
              <input className="tool-form-input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="如：查询设备状态" />
            </div>
            <div className="tool-form-field">
              <label className="tool-form-label">工具类型</label>
              <select className="tool-form-select" value={form.toolType} onChange={(e) => setForm({ ...form, toolType: e.target.value })}>
                <option value="HTTP">HTTP 接口</option>
                <option value="SQL">SQL 查询</option>
                <option value="MCP_PASSTHROUGH">MCP 透传</option>
              </select>
            </div>
            <div className="tool-form-field">
              <label className="tool-form-label">描述</label>
              <textarea className="tool-form-textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="工具功能描述" rows={3} />
            </div>
            <div className="tool-form-field">
              <label className="tool-form-label">输入 Schema (JSON)</label>
              <textarea className="tool-form-textarea code" value={form.inputSchema} onChange={(e) => setForm({ ...form, inputSchema: e.target.value })} rows={5} />
            </div>
            <div className="tool-form-field">
              <label className="tool-form-label">配置 (JSON)</label>
              <textarea className="tool-form-textarea code" value={form.config} onChange={(e) => setForm({ ...form, config: e.target.value })} rows={5} />
            </div>
            <div className="tool-form-actions">
              <button className="tool-form-cancel" onClick={() => setShowForm(false)}>取消</button>
              <button className="tool-form-submit" onClick={handleSubmit}>{editing ? '保存' : '创建'}</button>
            </div>
          </div>
        </div>
      )}

      {showSwagger && (
        <div className="tool-swagger-overlay" onClick={() => setShowSwagger(false)}>
          <div className="tool-swagger" onClick={(e) => e.stopPropagation()}>
            <h3 className="tool-swagger-title">Swagger 批量导入</h3>
            <div className="tool-swagger-input-row">
              <input
                className="tool-swagger-url-input"
                value={swaggerUrl}
                onChange={(e) => setSwaggerUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleParseSwagger()}
                placeholder="输入 Swagger JSON URL，如 http://localhost:8080/v2/api-docs"
              />
              <button className="tool-swagger-parse-btn" onClick={handleParseSwagger} disabled={parsingSwagger}>
                {parsingSwagger ? '解析中...' : '解析'}
              </button>
            </div>
            {swaggerEndpoints.length > 0 && (
              <div className="tool-swagger-endpoints">
                <div className="tool-swagger-endpoints-header">
                  <label className="tool-swagger-checkbox-all">
                    <input type="checkbox" checked={selectedEndpoints.size === swaggerEndpoints.length} onChange={toggleAllEndpoints} />
                    全选 ({selectedEndpoints.size}/{swaggerEndpoints.length})
                  </label>
                </div>
                <div className="tool-swagger-endpoints-list">
                  {swaggerEndpoints.map((ep) => (
                    <label key={ep.name} className="tool-swagger-endpoint-item">
                      <input type="checkbox" checked={selectedEndpoints.has(ep.name)} onChange={() => toggleEndpoint(ep.name)} />
                      <span className="tool-swagger-endpoint-method">{ep.method}</span>
                      <span className="tool-swagger-endpoint-path">{ep.path}</span>
                      <span className="tool-swagger-endpoint-summary">{ep.summary}</span>
                    </label>
                  ))}
                </div>
                <div className="tool-swagger-endpoints-actions">
                  <button className="tool-swagger-cancel" onClick={() => setShowSwagger(false)}>取消</button>
                  <button className="tool-swagger-import" onClick={handleBatchImport}>导入选中</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showConceptBind && bindingTool && (
        <div className="tool-form-overlay" onClick={() => setShowConceptBind(false)}>
          <div className="tool-form" onClick={(e) => e.stopPropagation()}>
            <h3 className="tool-form-title">概念绑定 - {bindingTool.displayName}</h3>
            <div className="tool-form-field">
              <label className="tool-form-label">已绑定的概念</label>
              {conceptBindings.length === 0 ? (
                <div style={{ color: '#999', fontSize: 13, padding: '8px 0' }}>暂无绑定</div>
              ) : (
                conceptBindings.map((tb) => {
                    const conceptName = allConcepts.find((c) => c.id === tb.conceptId)?.name || `ID:${tb.conceptId}`;
                    return (
                  <div key={tb.id} className="tool-concept-bind-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', border: '1px solid #f0f0f0', borderRadius: 4, marginBottom: 6 }}>
                    <div>
                      <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 3, marginRight: 8, color: '#fff', background: tb.relation === 'PRODUCES' ? '#52c41a' : '#1677ff' }}>
                        {tb.relation === 'PRODUCES' ? '生产' : '消费'}
                      </span>
                      <span style={{ fontSize: 13, color: '#333' }}>{conceptName}</span>
                    </div>
                    <button className="tool-list-row-btn danger" onClick={() => handleUnbindConcept(tb.id)}>解绑</button>
                  </div>
                    );
                  })
              )}
            </div>
            <div className="tool-form-field" style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
              <label className="tool-form-label">添加绑定</label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select className="tool-form-select" value={selectedConceptId ?? ''} onChange={(e) => setSelectedConceptId(e.target.value ? Number(e.target.value) : null)} style={{ flex: 1 }}>
                  <option value="">选择概念</option>
                  {allConcepts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <select className="tool-form-select" value={selectedBindRelation} onChange={(e) => setSelectedBindRelation(e.target.value)} style={{ width: 120 }}>
                  <option value="PRODUCES">生产</option>
                  <option value="CONSUMES">消费</option>
                </select>
                <button className="tool-list-add-btn" onClick={handleBindConcept} disabled={!selectedConceptId}>绑定</button>
              </div>
            </div>
            <div className="tool-swagger-endpoints-actions">
              <button className="tool-swagger-cancel" onClick={() => setShowConceptBind(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}