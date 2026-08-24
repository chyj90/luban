import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { listToolGroups, listToolDefinitions, createToolDefinition, updateToolDefinition, deleteToolDefinition, searchTools, testTool, parseSwagger, batchImportSwagger, listMcpServers } from '@/api/tool';
import { listDatasources, createDatasource, updateDatasource, testDatasource, getDatasourceStructure, deleteDatasource } from '@/api/datasource';
import { getToolConcepts, listConcepts, bindToolConcept, unbindToolConcept } from '@/api/concept';
import { useToastStore } from '@/stores/toastStore';
import { confirm } from '@/stores/confirmStore';
import Select from '@/components/Select';
import type { ToolDefinition, ToolSearchResult, SwaggerEndpoint, McpServer } from '@/types/tool';
import type { Datasource, DatasourceType, DatasourceStructure } from '@/types/datasource';
import type { ToolConcept, Concept } from '@/types/concept';
import './ToolListPage.css';

const TOOL_TYPE_LABELS: Record<string, string> = {
  HTTP: 'HTTP 接口',
  MCP_PASSTHROUGH: 'MCP 透传',
};

export default function ToolListPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const groupId = searchParams.get('groupId') ? Number(searchParams.get('groupId')) : null;
  const [groupName, setGroupName] = useState('');
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ToolSearchResult[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ToolDefinition | null>(null);
  const [form, setForm] = useState<{ name: string; displayName: string; toolType: 'HTTP' | 'MCP_PASSTHROUGH'; description: string; inputSchema: string; config: string }>({ name: '', displayName: '', toolType: 'HTTP', description: '', inputSchema: '{}', config: '{}' });
  const [httpUrl, setHttpUrl] = useState('');
  const [httpMethod, setHttpMethod] = useState('GET');
  const [httpTimeout, setHttpTimeout] = useState(10);
  const [httpHeadersList, setHttpHeadersList] = useState<{ key: string; value: string }[]>([]);
  const [httpRetry, setHttpRetry] = useState(3);
  const [httpParamsList, setHttpParamsList] = useState<{ key: string; type: string; description: string; required: boolean }[]>([]);
  const [httpBodySample, setHttpBodySample] = useState('{}');
  const [configStep, setConfigStep] = useState(0);
  const [mcpServerId, setMcpServerId] = useState('');
  const [mcpToolName, setMcpToolName] = useState('');
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [testResult, setTestResult] = useState<string | null>(null);
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
  const [activeTab, setActiveTab] = useState<'tools' | 'datasources'>('tools');
  const [dsList, setDsList] = useState<Datasource[]>([]);
  const [dsShowForm, setDsShowForm] = useState(false);
  const [dsEditingId, setDsEditingId] = useState<number | null>(null);
  const [dsForm, setDsForm] = useState({ name: '', type: 'MySQL' as DatasourceType, host: '', port: '3306', database: '', username: '', password: '', baseUrl: '' });
  const [dsStructure, setDsStructure] = useState<DatasourceStructure | null>(null);
  const [collapsedTables, setCollapsedTables] = useState<Set<string>>(new Set());
  const [dsTesting, setDsTesting] = useState<number | null>(null);
  const toast = useToastStore((s) => s.show);
  const activeInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [headerParamMenuIndex, setHeaderParamMenuIndex] = useState<number | null>(null);
  const headerParamMenuRef = useRef<HTMLDivElement | null>(null);
  const initialized = useRef(false);
  const prevActiveTab = useRef(activeTab);

  const toggleTableCollapse = (tableName: string) => {
    setCollapsedTables((prev) => {
      const next = new Set(prev);
      if (next.has(tableName)) {
        next.delete(tableName);
      } else {
        next.add(tableName);
      }
      return next;
    });
  };

  const buildInputSchema = () => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const p of httpParamsList) {
      if (!p.key) continue;
      properties[p.key] = { type: p.type || 'string', description: p.description || '' };
      if (p.required) required.push(p.key);
    }
    if (httpBodySample.trim() && httpBodySample.trim() !== '{}') {
      try {
        const body = JSON.parse(httpBodySample);
        if (typeof body === 'object' && body !== null) {
          properties.body = { type: 'object', description: '请求体', example: body };
          if (httpMethod === 'POST' || httpMethod === 'PUT' || httpMethod === 'PATCH') {
            required.push('body');
          }
        }
      } catch {
        // ignore invalid JSON
      }
    }
    const schema: Record<string, unknown> = { type: 'object', properties };
    if (required.length > 0) schema.required = required;
    return JSON.stringify(schema);
  };

  const buildConfig = (type: string) => {
    if (type === 'HTTP') {
      const headers: Record<string, string> = {};
      for (const h of httpHeadersList) {
        if (h.key) headers[h.key] = h.value;
      }
      return JSON.stringify({ method: httpMethod, url: httpUrl, timeout: httpTimeout, retry: httpRetry, headers });
    }
    if (type === 'MCP_PASSTHROUGH') {
      return JSON.stringify({ mcpServerId: Number(mcpServerId), originalToolName: mcpToolName });
    }
    return '{}';
  };

  const insertParamAtCursor = (paramName: string) => {
    const el = activeInputRef.current;
    if (!el) return;
    const tag = `{${paramName}}`;
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const newValue = el.value.slice(0, start) + tag + el.value.slice(end);
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value'
      )?.set ?? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, newValue);
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      const cursorPos = start + tag.length;
      el.setSelectionRange(cursorPos, cursorPos);
      el.focus();
    }
  };

  const insertParamIntoHeaderValue = (headerIndex: number, paramName: string) => {
    const tag = `{${paramName}}`;
    const next = [...httpHeadersList];
    const current = next[headerIndex].value;
    const nextValue = current + tag;
    next[headerIndex] = { ...next[headerIndex], value: nextValue };
    setHttpHeadersList(next);
    setHeaderParamMenuIndex(null);
  };

  const renderParamHighlighted = (text: string, paramsList?: { key: string }[]) => {
    if (!text) return null;
    const parts = text.split(/(#?\{[^}]+\})/g);
    return parts.map((part, i) => {
      const match = part.match(/^#?\{([^}]+)\}$/);
      if (match) {
        const paramName = match[1];
        const list = paramsList || httpParamsList;
        const defined = list.some((p) => p.key === paramName);
        return (
          <span key={i} className={`param-tag ${defined ? 'defined' : 'undefined'}`}>
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  const getHeaderValueType = (value: string) => {
    if (!value) return null;
    const hasParam = /\{[^}]+\}/.test(value);
    if (!hasParam) return 'fixed';
    const pureParam = /^\{[^}]+\}$/.test(value.trim());
    return pureParam ? 'param' : 'mixed';
  };

  const HEADER_TYPE_LABELS: Record<string, string> = {
    fixed: '固定值',
    param: '参数引用',
    mixed: '混合',
  };

  const parseConfig = (tool: ToolDefinition) => {
    try {
      const cfg = JSON.parse(tool.config || '{}');
      if (tool.toolType === 'HTTP') {
        setHttpUrl(cfg.url || '');
        setHttpMethod(cfg.method || 'GET');
        setHttpTimeout(cfg.timeout || 10);
        setHttpRetry(cfg.retry || 3);
        const headers = cfg.headers as Record<string, string> | undefined;
        if (headers && typeof headers === 'object') {
          setHttpHeadersList(Object.entries(headers).map(([k, v]) => ({ key: k, value: v })));
        } else {
          setHttpHeadersList([]);
        }
      } else if (tool.toolType === 'MCP_PASSTHROUGH') {
        setMcpServerId(cfg.mcpServerId ? String(cfg.mcpServerId) : '');
        setMcpToolName(cfg.originalToolName || '');
      }
      parseInputSchema(tool);
    } catch {
      // ignore
    }
  };

  const parseInputSchema = (tool: ToolDefinition) => {
    try {
      const schema = JSON.parse(tool.inputSchema || '{}');
      const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
      const req = (schema.required as string[]) || [];
      if (props) {
        const params: typeof httpParamsList = [];
        const bodyKeys = new Set(['body']);
        for (const [key, def] of Object.entries(props)) {
          if (bodyKeys.has(key)) {
            const example = def.example;
            setHttpBodySample(example ? JSON.stringify(example, null, 2) : '{}');
          } else {
            params.push({
              key,
              type: String(def.type || 'string'),
              description: String(def.description || ''),
              required: req.includes(key),
            });
          }
        }
        setHttpParamsList(params);
      }
    } catch {
      setHttpParamsList([]);
      setHttpBodySample('{}');
    }
  };

  const resetConfigFields = () => {
    setHttpUrl('');
    setHttpMethod('GET');
    setHttpTimeout(10);
    setHttpHeadersList([]);
    setHttpRetry(3);
    setHttpParamsList([]);
    setHttpBodySample('{}');
    setConfigStep(0);
    setMcpServerId('');
    setMcpToolName('');
  };

  const fetchMcpServers = useCallback(async () => {
    try {
      const res = await listMcpServers();
      setMcpServers(res.data);
    } catch {
      // ignore
    }
  }, []);

  const fetchGroupName = useCallback(async () => {
    if (!groupId) return;
    try {
      const res = await listToolGroups();
      const group = res.data.find((g) => g.id === groupId);
      if (group) {
        setGroupName(group.name);
      }
    } catch {
      // ignore
    }
  }, [groupId]);

  const fetchTools = useCallback(async () => {
    if (!groupId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const res = await listToolDefinitions(groupId ? { groupId: String(groupId) } : undefined);
      setTools(res.data);
    } catch {
      toast('加载工具列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [groupId, toast]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    fetchGroupName();
    fetchTools();
    fetchMcpServers();
  }, [fetchGroupName, fetchTools, fetchMcpServers]);

  const fetchDatasources = useCallback(async () => {
    if (!groupId) return;
    try {
      const res = await listDatasources('PLATFORM', groupId);
      setDsList(res.data);
    } catch {
      // ignore
    }
  }, [groupId]);

  const buildDsConfig = () => {
    return { host: dsForm.host, port: Number(dsForm.port) || 3306, database: dsForm.database, username: dsForm.username, password: dsForm.password };
  };

  const handleDsSubmit = async () => {
    if (!dsForm.name || !groupId) {
      toast('名称和所属系统为必填项', 'error');
      return;
    }
    try {
      const payload = { name: dsForm.name, type: dsForm.type, config: buildDsConfig(), ownerId: groupId, slug: 'PLATFORM' as const };
      if (dsEditingId) {
        await updateDatasource(dsEditingId, payload);
        toast('更新成功', 'success');
      } else {
        await createDatasource(payload);
        toast('创建成功', 'success');
      }
      setDsShowForm(false);
      setDsEditingId(null);
      fetchDatasources();
    } catch {
      toast('操作失败', 'error');
    }
  };

  const handleDsTest = async (id: number) => {
    setDsTesting(id);
    try {
      const res = await testDatasource(id);
      if (res.data.success) {
        toast('连接成功', 'success');
      } else {
        toast(res.data.message || '连接失败', 'error');
      }
      fetchDatasources();
    } catch {
      toast('连接失败', 'error');
    } finally {
      setDsTesting(null);
    }
  };

  const handleDsGetStructure = async (id: number) => {
    try {
      const res = await getDatasourceStructure(id);
      setDsStructure(res.data);
      setCollapsedTables(new Set(res.data.tables.map((t) => t.name)));
    } catch {
      toast('获取结构失败', 'error');
    }
  };

  const handleDsDelete = async (ds: Datasource) => {
    const confirmed = await confirm({ title: '确认删除', message: `确定要删除数据源「${ds.name}」吗？` });
    if (!confirmed) return;
    try {
      await deleteDatasource(ds.id);
      toast('删除成功', 'success');
      fetchDatasources();
    } catch {
      toast('删除失败', 'error');
    }
  };

  const openDsCreate = () => {
    setDsEditingId(null);
    setDsForm({ name: '', type: 'MySQL', host: '', port: '3306', database: '', username: '', password: '', baseUrl: '' });
    setDsShowForm(true);
  };

  const openDsEdit = (ds: Datasource) => {
    setDsEditingId(ds.id);
    const cfg = ds.config as Record<string, unknown>;
    setDsForm({ name: ds.name, type: ds.type as DatasourceType, host: String(cfg.host || ''), port: String(cfg.port || '3306'), database: String(cfg.database || ''), username: String(cfg.username || ''), password: '', baseUrl: '' });
    setDsShowForm(true);
  };

  useEffect(() => {
    if (activeTab === 'datasources' && prevActiveTab.current !== 'datasources') {
      fetchDatasources();
    }
    prevActiveTab.current = activeTab;
  }, [activeTab, fetchDatasources]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (headerParamMenuRef.current && !headerParamMenuRef.current.contains(e.target as Node)) {
        setHeaderParamMenuIndex(null);
      }
    }
    if (headerParamMenuIndex !== null) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [headerParamMenuIndex]);

  const handleSearch = async () => {
    if (!groupId || !searchQuery.trim()) return;
    try {
      const res = await searchTools(groupId, searchQuery);
      setSearchResults(res.data);
    } catch {
      toast('搜索失败', 'error');
    }
  };

  const handleSubmit = async () => {
    if (!form.name || !groupId) {
      toast('名称和所属系统为必填项', 'error');
      return;
    }
    const config = buildConfig(form.toolType);
    const autoInputSchema = form.toolType === 'HTTP' ? buildInputSchema() : form.inputSchema;
    try {
      const payload = { ...form, groupId, config, inputSchema: autoInputSchema, toolType: form.toolType as 'HTTP' | 'MCP_PASSTHROUGH' };
      if (editing) {
        await updateToolDefinition(editing.id, payload);
        toast('更新成功', 'success');
      } else {
        await createToolDefinition(payload);
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
    const confirmed = await confirm({
      title: '确认删除',
      message: `确定要删除工具「${tool.displayName}」吗？`,
      confirmText: '删除',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteToolDefinition(tool.id);
      toast('删除成功', 'success');
      fetchTools();
    } catch {
      toast('删除失败', 'error');
    }
  };

  const handleTest = async (tool: ToolDefinition) => {
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
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', displayName: '', toolType: 'HTTP', description: '', inputSchema: '{}', config: '{}' });
    resetConfigFields();
    fetchDatasources();
    setShowForm(true);
  };

  const openEdit = (tool: ToolDefinition) => {
    setEditing(tool);
    setForm({
      name: tool.name,
      displayName: tool.displayName,
      toolType: tool.toolType as 'HTTP' | 'MCP_PASSTHROUGH',
      description: tool.description || '',
      inputSchema: tool.inputSchema || '{}',
      config: tool.config || '{}',
    });
    parseConfig(tool);
    fetchDatasources();
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
    if (!groupId) {
      toast('请先选择所属系统', 'error');
      return;
    }
    const endpoints = swaggerEndpoints.filter((ep) => selectedEndpoints.has(ep.name));
    try {
      const res = await batchImportSwagger(groupId, endpoints);
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

  if (!groupId) {
    return (
      <div className="tool-list">
        <div className="tool-list-loading">请从系统管理页面进入</div>
      </div>
    );
  }

  return (
    <div className="tool-list">
      <div className="tool-list-system-header">
        <button className="tool-list-back-btn" onClick={() => navigate('/connect/systems')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          返回系统列表
        </button>
        <div className="tool-list-system-badge">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
            <circle cx="12" cy="10" r="1" />
          </svg>
          <span>{groupName || '加载中...'}</span>
        </div>
      </div>

      <div className="tool-list-tabs">
        <button className={`tool-list-tab ${activeTab === 'tools' ? 'active' : ''}`} onClick={() => setActiveTab('tools')}>工具</button>
        <button className={`tool-list-tab ${activeTab === 'datasources' ? 'active' : ''}`} onClick={() => setActiveTab('datasources')}>数据源</button>
      </div>

      {activeTab === 'tools' && (
        <>
          <div className="tool-list-header">
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
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {displayTools.length === 0 ? (
                <tr>
                  <td colSpan={4} className="tool-list-empty">暂无工具</td>
                </tr>
              ) : (
                displayTools.map((tool) => (
                  <tr key={tool.id}>
                    <td>
                      <div className="tool-list-tool-name">{tool.displayName}</div>
                      <div className="tool-list-tool-desc">{tool.description}</div>
                    </td>
                    <td>
                      <span className="tool-list-type-badge">{TOOL_TYPE_LABELS[tool.toolType] ?? tool.toolType}</span>
                    </td>
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
                ))
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
            <button className="tool-form-close" onClick={() => setShowForm(false)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <div className="tool-form-field">
              <label className="tool-form-label">工具名称（英文标识）</label>
              <input className="tool-form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：get_device_status" />
            </div>
            <div className="tool-form-field">
              <label className="tool-form-label">显示名称</label>
              <input className="tool-form-input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="如：查询设备状态" />
            </div>
            <div className="tool-form-field">
              <label className="tool-form-label">描述</label>
              <textarea className="tool-form-textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="工具功能描述" rows={3} />
            </div>
            <div className="tool-form-field">
              <label className="tool-form-label">工具类型</label>
              <div className="tool-form-type-cards">
                {([
                  { value: 'HTTP', label: 'HTTP 接口', desc: '调用外部 REST API', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> },
                  { value: 'MCP_PASSTHROUGH', label: 'MCP 透传', desc: '透传 MCP Server 工具', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> },
                ] as const).map((t) => (
                  <button key={t.value} type="button" className={`tool-form-type-card ${form.toolType === t.value ? 'active' : ''}`} onClick={() => setForm({ ...form, toolType: t.value })}>
                    <span className="tool-form-type-card-icon">{t.icon}</span>
                    <span className="tool-form-type-card-info">
                      <span className="tool-form-type-card-label">{t.label}</span>
                      <span className="tool-form-type-card-desc">{t.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="tool-form-divider" />
            <div className="tool-form-config-card">
            <h4 className="tool-form-config-card-title">配置</h4>
            {form.toolType === 'HTTP' ? (
              <>
                <div className="tool-form-steps">
                  <button type="button" className={`tool-form-step ${configStep >= 0 ? 'active' : ''} ${configStep > 0 ? 'done' : ''}`} onClick={() => setConfigStep(0)}>
                    <span className="tool-form-step-num">1</span>
                    <span className="tool-form-step-label">录入参数</span>
                  </button>
                  <span className="tool-form-step-line" />
                  <button type="button" className={`tool-form-step ${configStep >= 1 ? 'active' : ''} ${configStep > 1 ? 'done' : ''}`} onClick={() => setConfigStep(1)}>
                    <span className="tool-form-step-num">2</span>
                    <span className="tool-form-step-label">HTTP 配置</span>
                  </button>
                  {httpMethod !== 'GET' && (
                    <>
                      <span className="tool-form-step-line" />
                      <button type="button" className={`tool-form-step ${configStep >= 2 ? 'active' : ''} ${configStep > 2 ? 'done' : ''}`} onClick={() => setConfigStep(2)}>
                        <span className="tool-form-step-num">3</span>
                        <span className="tool-form-step-label">录入请求体</span>
                      </button>
                    </>
                  )}
                  <span className="tool-form-step-line" />
                  <button type="button" className={`tool-form-step ${configStep >= (httpMethod === 'GET' ? 2 : 3) ? 'active' : ''}`} onClick={() => setConfigStep(httpMethod === 'GET' ? 2 : 3)}>
                    <span className="tool-form-step-num">{httpMethod === 'GET' ? '3' : '4'}</span>
                    <span className="tool-form-step-label">生成 Schema</span>
                  </button>
                </div>
                {configStep === 0 && (
                  <div className="tool-form-config-section">
                    <div className="tool-form-kv-list">
                      {httpParamsList.map((p, i) => (
                        <div key={i} className="tool-form-kv-row">
                          <input className="tool-form-input kv-key" placeholder="参数名" value={p.key} onChange={(e) => {
                            const next = [...httpParamsList];
                            next[i] = { ...next[i], key: e.target.value };
                            setHttpParamsList(next);
                          }} />
                          <Select className="tool-form-param-type" value={p.type} options={[{ value: 'string', label: 'string' }, { value: 'number', label: 'number' }, { value: 'boolean', label: 'boolean' }, { value: 'integer', label: 'integer' }]} onChange={(v) => {
                            const next = [...httpParamsList];
                            next[i] = { ...next[i], type: v };
                            setHttpParamsList(next);
                          }} />
                          <input className="tool-form-input kv-desc" placeholder="描述" value={p.description} onChange={(e) => {
                            const next = [...httpParamsList];
                            next[i] = { ...next[i], description: e.target.value };
                            setHttpParamsList(next);
                          }} />
                          <label className="tool-form-kv-required">
                            <input type="checkbox" checked={p.required} onChange={(e) => {
                              const next = [...httpParamsList];
                              next[i] = { ...next[i], required: e.target.checked };
                              setHttpParamsList(next);
                            }} />
                            <span>必填</span>
                          </label>
                          <button type="button" className="tool-form-kv-remove" onClick={() => setHttpParamsList(httpParamsList.filter((_, idx) => idx !== i))}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </div>
                      ))}
                      <button type="button" className="tool-form-kv-add" onClick={() => setHttpParamsList([...httpParamsList, { key: '', type: 'string', description: '', required: false }])}>
                        + 添加参数
                      </button>
                    </div>
                    <div className="tool-form-step-actions">
                      <button type="button" className="tool-form-step-next" onClick={() => setConfigStep(1)}>下一步</button>
                    </div>
                  </div>
                )}
                {configStep === 1 && (
                  <div className="tool-form-config-section">
                    {httpParamsList.filter((p) => p.key).length > 0 && (
                      <div className="param-chip-bar">
                        <span className="param-chip-bar-label">可用参数：</span>
                        {httpParamsList.filter((p) => p.key).map((p) => (
                          <button
                            key={p.key}
                            type="button"
                            className="param-chip"
                            onClick={() => insertParamAtCursor(p.key)}
                            title={`类型: ${p.type}${p.description ? `, 描述: ${p.description}` : ''}`}
                          >
                            {`{${p.key}}`}
                          </button>
                        ))}
                        <span className="param-chip-bar-hint">点击插入到光标位置</span>
                      </div>
                    )}
                    <div className="tool-form-field">
                      <label className="tool-form-label">URL</label>
                      <div className="url-input-wrap">
                        <input
                          className="tool-form-input"
                          value={httpUrl}
                          onChange={(e) => setHttpUrl(e.target.value)}
                          onFocus={(e) => { activeInputRef.current = e.target; }}
                          placeholder="https://api.example.com/{param}/endpoint"
                        />
                        <div className="header-param-menu-wrap" ref={headerParamMenuIndex === -1 ? headerParamMenuRef : undefined}>
                          <button
                            type="button"
                            className="header-param-menu-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setHeaderParamMenuIndex(headerParamMenuIndex === -1 ? null : -1);
                            }}
                            title="插入变量"
                          >
                            {'{x}'}
                          </button>
                          {headerParamMenuIndex === -1 && (
                            <div className="header-param-menu-dropdown">
                              {httpParamsList.filter((p) => p.key).length === 0 ? (
                                <div className="header-param-menu-empty">暂无参数，请先在步骤 1 录入参数</div>
                              ) : (
                                httpParamsList.filter((p) => p.key).map((p) => (
                                  <button
                                    key={p.key}
                                    type="button"
                                    className="header-param-menu-item"
                                    onClick={() => insertParamAtCursor(p.key)}
                                  >
                                    {`{${p.key}}`}
                                    <span className="header-param-menu-item-desc">{p.description || p.type}</span>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {httpUrl && /\{[^}]+\}/.test(httpUrl) && (
                        <div className="param-preview">{renderParamHighlighted(httpUrl)}</div>
                      )}
                    </div>
                    <div className="tool-form-row">
                      <div className="tool-form-field" style={{ flex: 1 }}>
                        <label className="tool-form-label">请求方法</label>
                        <Select value={httpMethod} options={[{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }, { value: 'PUT', label: 'PUT' }, { value: 'DELETE', label: 'DELETE' }]} onChange={setHttpMethod} />
                      </div>
                      <div className="tool-form-field" style={{ flex: 1 }}>
                        <label className="tool-form-label">超时（秒）</label>
                        <input className="tool-form-input" type="number" value={httpTimeout} onChange={(e) => setHttpTimeout(Number(e.target.value))} min={1} max={60} />
                      </div>
                      <div className="tool-form-field" style={{ flex: 1 }}>
                        <label className="tool-form-label">重试次数</label>
                        <input className="tool-form-input" type="number" value={httpRetry} onChange={(e) => setHttpRetry(Number(e.target.value))} min={0} max={5} />
                      </div>
                    </div>
                    <div className="tool-form-field">
                      <label className="tool-form-label">请求头</label>
                      <div className="tool-form-kv-list">
                        {httpHeadersList.map((h, i) => (
                          <div key={i} className="tool-form-kv-row">
                            <input className="tool-form-input kv-key" placeholder="Key" value={h.key} onChange={(e) => {
                              const next = [...httpHeadersList];
                              next[i] = { ...next[i], key: e.target.value };
                              setHttpHeadersList(next);
                            }} />
                            <div className="tool-form-kv-value-wrap">
                              <input
                                className="tool-form-input kv-value"
                                placeholder="Value"
                                value={h.value}
                                onFocus={(e) => { activeInputRef.current = e.target; }}
                                onChange={(e) => {
                                  const next = [...httpHeadersList];
                                  next[i] = { ...next[i], value: e.target.value };
                                  setHttpHeadersList(next);
                                }}
                              />
                              <div className="header-param-menu-wrap" ref={headerParamMenuIndex === i ? headerParamMenuRef : undefined}>
                                <button
                                  type="button"
                                  className="header-param-menu-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setHeaderParamMenuIndex(headerParamMenuIndex === i ? null : i);
                                  }}
                                  title="插入变量"
                                >
                                  {'{x}'}
                                </button>
                                {headerParamMenuIndex === i && (
                                  <div className="header-param-menu-dropdown">
                                    {httpParamsList.filter((p) => p.key).length === 0 ? (
                                      <div className="header-param-menu-empty">暂无参数，请先在步骤 1 录入参数</div>
                                    ) : (
                                      httpParamsList.filter((p) => p.key).map((p) => (
                                        <button
                                          key={p.key}
                                          type="button"
                                          className="header-param-menu-item"
                                          onClick={() => insertParamIntoHeaderValue(i, p.key)}
                                        >
                                          {`{${p.key}}`}
                                          <span className="header-param-menu-item-desc">{p.description || p.type}</span>
                                        </button>
                                      ))
                                    )}
                                  </div>
                                )}
                              </div>
                              {getHeaderValueType(h.value) && (
                                <span className={`header-type-badge ${getHeaderValueType(h.value)}`}>
                                  {HEADER_TYPE_LABELS[getHeaderValueType(h.value)!]}
                                </span>
                              )}
                            </div>
                            <button type="button" className="tool-form-kv-remove" onClick={() => setHttpHeadersList(httpHeadersList.filter((_, idx) => idx !== i))}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          </div>
                        ))}
                        <button type="button" className="tool-form-kv-add" onClick={() => setHttpHeadersList([...httpHeadersList, { key: '', value: '' }])}>
                          + 添加 Header
                        </button>
                      </div>
                    </div>
                    <div className="tool-form-step-actions">
                      <button type="button" className="tool-form-step-prev" onClick={() => setConfigStep(0)}>上一步</button>
                      <button type="button" className="tool-form-step-next" onClick={() => setConfigStep(2)}>下一步</button>
                    </div>
                  </div>
                )}
                {httpMethod !== 'GET' && configStep === 2 && (
                  <div className="tool-form-config-section">
                    {httpParamsList.filter((p) => p.key).length > 0 && (
                      <div className="param-chip-bar">
                        <span className="param-chip-bar-label">可用参数：</span>
                        {httpParamsList.filter((p) => p.key).map((p) => (
                          <button
                            key={p.key}
                            type="button"
                            className="param-chip"
                            onClick={() => insertParamAtCursor(p.key)}
                            title={`类型: ${p.type}${p.description ? `, 描述: ${p.description}` : ''}`}
                          >
                            {`{${p.key}}`}
                          </button>
                        ))}
                        <span className="param-chip-bar-hint">点击插入到光标位置</span>
                      </div>
                    )}
                    <textarea
                      className="tool-form-textarea code"
                      value={httpBodySample}
                      onChange={(e) => setHttpBodySample(e.target.value)}
                      onFocus={(e) => { activeInputRef.current = e.target; }}
                      rows={8}
                      placeholder='{"name": "张三", "age": 25}'
                    />
                    {httpBodySample && /\{[^}]+\}/.test(httpBodySample) && (
                      <div className="param-preview">{renderParamHighlighted(httpBodySample)}</div>
                    )}
                    <div className="tool-form-step-actions">
                      <button type="button" className="tool-form-step-prev" onClick={() => setConfigStep(1)}>上一步</button>
                      <button type="button" className="tool-form-step-next" onClick={() => setConfigStep(3)}>下一步</button>
                    </div>
                  </div>
                )}
              </>
            ) : null}
            {form.toolType === 'MCP_PASSTHROUGH' && (
              <div className="tool-form-config-section">
                <h4 className="tool-form-config-title">MCP 透传配置</h4>
                <div className="tool-form-field">
                  <label className="tool-form-label">MCP 服务器</label>
                  <Select value={mcpServerId} options={[{ value: '', label: '请选择' }, ...mcpServers.map((s) => ({ value: String(s.id), label: s.name }))]} onChange={setMcpServerId} />
                </div>
                <div className="tool-form-field">
                  <label className="tool-form-label">工具名称</label>
                  <input className="tool-form-input" value={mcpToolName} onChange={(e) => setMcpToolName(e.target.value)} placeholder="MCP Server 中的工具名称" />
                </div>
              </div>
            )}
            </div>
            {form.toolType !== 'MCP_PASSTHROUGH' && (
            <div className="tool-form-schema-section">
              <h4 className="tool-form-config-card-title">生成 Schema</h4>
              {form.toolType === 'HTTP' ? (
                configStep === (httpMethod === 'GET' ? 2 : 3) ? (
                  <div className="tool-form-config-section">
                    <pre className="tool-form-schema-preview">{buildInputSchema()}</pre>
                    <button type="button" className="tool-form-schema-copy" onClick={() => { navigator.clipboard.writeText(buildInputSchema()); toast('已复制到剪贴板', 'success'); }}>复制 Schema</button>
                    <div className="tool-form-step-actions">
                      <button type="button" className="tool-form-step-prev" onClick={() => setConfigStep(httpMethod === 'GET' ? 1 : 2)}>上一步</button>
                    </div>
                  </div>
                ) : (
                  <p className="tool-form-schema-hint">请先完成上方参数和 HTTP 配置，然后点击步骤 {httpMethod === 'GET' ? '3' : '4'} 查看生成的 Schema</p>
                )
              ) : (
                <div className="tool-form-field">
                  <label className="tool-form-label">输入 Schema (JSON)</label>
                  <textarea className="tool-form-textarea code" value={form.inputSchema} onChange={(e) => setForm({ ...form, inputSchema: e.target.value })} rows={5} />
                </div>
              )}
            </div>
            )}
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
        </>
      )}

      {activeTab === 'datasources' && (
        <div className="tool-list-datasource-panel">
          <div className="tool-list-header">
            <div className="tool-list-header-actions">
              <button className="tool-list-add-btn" onClick={openDsCreate}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                新建数据源
              </button>
            </div>
          </div>

          {dsStructure && (
            <div className="tool-list-ds-structure">
              <div className="tool-list-ds-structure-header">
                <span>数据源结构</span>
                <button className="tool-list-ds-structure-close" onClick={() => setDsStructure(null)}>关闭</button>
              </div>
              <div className="tool-list-ds-structure-body">
                {dsStructure.tables.map((table) => {
                    const isCollapsed = collapsedTables.has(table.name);
                    return (
                  <div key={table.name} className="ds-structure-table">
                    <div className="ds-structure-table-header" onClick={() => toggleTableCollapse(table.name)}>
                      <svg className={`ds-structure-chevron ${isCollapsed ? '' : 'open'}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <line x1="3" y1="9" x2="21" y2="9" />
                      </svg>
                      <span>{table.name}</span>
                      <span className="ds-structure-table-count">{table.columns.length} 列</span>
                    </div>
                    {!isCollapsed && (
                    <div className="ds-structure-columns">
                      {table.columns.map((col) => (
                        <div key={col.name} className="ds-structure-column">
                          <div className="ds-structure-column-name">
                            {col.primaryKey && (
                              <span className="ds-structure-pk">PK</span>
                            )}
                            <span>{col.name}</span>
                          </div>
                          <span className="ds-structure-column-type">{col.type}</span>
                          <span className={`ds-structure-column-nullable ${col.nullable ? '' : 'required'}`}>
                            {col.nullable ? 'NULL' : 'NOT NULL'}
                          </span>
                        </div>
                      ))}
                    </div>
                    )}
                  </div>
                    );
                  })}
              </div>
            </div>
          )}

          <div className="tool-list-table-wrap">
            <table className="tool-list-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {dsList.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="tool-list-empty">暂无数据源</td>
                  </tr>
                ) : (
                  dsList.map((ds) => (
                    <tr key={ds.id}>
                      <td className="tool-list-name-cell">{ds.name}</td>
                      <td>
                        <span className={`tool-list-ds-type-badge ds-type-${ds.type.toLowerCase()}`}>{ds.type}</span>
                      </td>
                      <td>
                        <span className={`tool-list-ds-status ${ds.status === 'connected' ? 'connected' : ds.status === 'error' ? 'error' : ''}`}>
                          {ds.status === 'connected' ? '已连接' : ds.status === 'error' ? '异常' : '待测试'}
                        </span>
                      </td>
                      <td className="tool-list-date-cell">{new Date(ds.createdAt).toLocaleDateString('zh-CN')}</td>
                      <td>
                        <div className="tool-list-row-actions">
                          <button className="tool-list-row-btn" onClick={() => handleDsTest(ds.id)} disabled={dsTesting === ds.id}>
                            {dsTesting === ds.id ? '测试中...' : '测试'}
                          </button>
                          <button className="tool-list-row-btn" onClick={() => handleDsGetStructure(ds.id)}>结构</button>
                          <button className="tool-list-row-btn" onClick={() => openDsEdit(ds)}>编辑</button>
                          <button className="tool-list-row-btn danger" onClick={() => handleDsDelete(ds)}>删除</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {dsShowForm && (
            <div className="tool-form-overlay" onClick={() => { setDsShowForm(false); setDsEditingId(null); }}>
              <div className="tool-form" onClick={(e) => e.stopPropagation()}>
                <h3 className="tool-form-title">{dsEditingId ? '编辑数据源' : '新建数据源'}</h3>
                <div className="tool-form-field">
                  <label className="tool-form-label">名称</label>
                  <input className="tool-form-input" value={dsForm.name} onChange={(e) => setDsForm({ ...dsForm, name: e.target.value })} placeholder="如：生产数据库" />
                </div>
                <div className="tool-form-field">
                  <label className="tool-form-label">类型</label>
                  <Select value={dsForm.type} options={[{ value: 'MySQL', label: 'MySQL' }, { value: 'PostgreSQL', label: 'PostgreSQL' }]} onChange={(v) => setDsForm({ ...dsForm, type: v as DatasourceType })} />
                </div>
                {(dsForm.type === 'MySQL' || dsForm.type === 'PostgreSQL') && (
                  <div className="tool-form-config-section">
                    <h4 className="tool-form-config-title">连接信息</h4>
                    <div className="tool-form-row">
                      <div className="tool-form-field" style={{ flex: 2 }}>
                        <label className="tool-form-label">主机</label>
                        <input className="tool-form-input" value={dsForm.host} onChange={(e) => setDsForm({ ...dsForm, host: e.target.value })} placeholder="localhost" />
                      </div>
                      <div className="tool-form-field" style={{ flex: 1 }}>
                        <label className="tool-form-label">端口</label>
                        <input className="tool-form-input" value={dsForm.port} onChange={(e) => setDsForm({ ...dsForm, port: e.target.value })} placeholder="3306" />
                      </div>
                    </div>
                    <div className="tool-form-field">
                      <label className="tool-form-label">数据库名</label>
                      <input className="tool-form-input" value={dsForm.database} onChange={(e) => setDsForm({ ...dsForm, database: e.target.value })} placeholder="mydb" />
                    </div>
                    <div className="tool-form-row">
                      <div className="tool-form-field" style={{ flex: 1 }}>
                        <label className="tool-form-label">用户名</label>
                        <input className="tool-form-input" value={dsForm.username} onChange={(e) => setDsForm({ ...dsForm, username: e.target.value })} placeholder="root" />
                      </div>
                      <div className="tool-form-field" style={{ flex: 1 }}>
                        <label className="tool-form-label">密码</label>
                        <input className="tool-form-input" type="password" value={dsForm.password} onChange={(e) => setDsForm({ ...dsForm, password: e.target.value })} placeholder="输入密码" />
                      </div>
                    </div>
                  </div>
                )}
                <div className="tool-form-divider" />
                <div className="tool-form-actions">
                  <button className="tool-form-cancel" onClick={() => { setDsShowForm(false); setDsEditingId(null); }}>取消</button>
                  <button className="tool-form-submit" onClick={handleDsSubmit}>{dsEditingId ? '保存' : '创建'}</button>
                </div>
              </div>
            </div>
          )}
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
                    <div key={tb.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', border: '1px solid #f0f0f0', borderRadius: 4, marginBottom: 6 }}>
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
                <div style={{ flex: 1 }}><Select value={selectedConceptId ? String(selectedConceptId) : ''} options={[{ value: '', label: '选择概念' }, ...allConcepts.map((c) => ({ value: String(c.id), label: c.name }))]} onChange={(v) => setSelectedConceptId(v ? Number(v) : null)} /></div>
                <div style={{ width: 120 }}><Select value={selectedBindRelation} options={[{ value: 'PRODUCES', label: '生产' }, { value: 'CONSUMES', label: '消费' }]} onChange={setSelectedBindRelation} /></div>
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