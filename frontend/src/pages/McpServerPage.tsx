import { useState, useEffect, useCallback } from 'react';
import { listMcpServers, createMcpServer, updateMcpServer, deleteMcpServer, testMcpConnection, discoverMcpTools, syncMcpTools, listToolGroups } from '@/api/tool';
import { useToastStore } from '@/stores/toastStore';
import { useConfirmStore } from '@/stores/confirmStore';
import type { McpServer, McpToolDiscovery, ToolGroup } from '@/types/tool';
import './McpServerPage.css';

export default function McpServerPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [groups, setGroups] = useState<ToolGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [form, setForm] = useState({ name: '', description: '', serverUrl: '', authType: 'BEARER', authConfig: '' });
  const [discoveredTools, setDiscoveredTools] = useState<McpToolDiscovery[]>([]);
  const [discovering, setDiscovering] = useState<number | null>(null);
  const [syncGroupId, setSyncGroupId] = useState<number>(0);
  const [showSync, setShowSync] = useState<number | null>(null);
  const toast = useToastStore((s) => s.add);
  const confirm = useConfirmStore((s) => s.show);

  const fetchData = useCallback(async () => {
    try {
      const [serversRes, groupsRes] = await Promise.all([
        listMcpServers(),
        listToolGroups(),
      ]);
      setServers(serversRes.data);
      setGroups(groupsRes.data);
      if (groupsRes.data.length > 0) {
        setSyncGroupId(groupsRes.data[0].id);
      }
    } catch {
      toast('加载数据失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSubmit = async () => {
    if (!form.name || !form.serverUrl) {
      toast('名称和地址为必填项', 'error');
      return;
    }
    try {
      if (editing) {
        await updateMcpServer(editing.id, form);
        toast('更新成功', 'success');
      } else {
        await createMcpServer(form);
        toast('创建成功', 'success');
      }
      setShowForm(false);
      setEditing(null);
      fetchData();
    } catch {
      toast('操作失败', 'error');
    }
  };

  const handleDelete = async (server: McpServer) => {
    confirm({
      title: '确认删除',
      message: `确定要删除 MCP 服务「${server.name}」吗？`,
      onConfirm: async () => {
        try {
          await deleteMcpServer(server.id);
          toast('删除成功', 'success');
          fetchData();
        } catch {
          toast('删除失败', 'error');
        }
      },
    });
  };

  const handleTest = async (id: number) => {
    try {
      const res = await testMcpConnection(id);
      const data = res.data as Record<string, unknown>;
      if (data.connected) {
        toast(`连接成功 (${data.elapsedMs}ms)`, 'success');
      } else {
        toast(`连接失败: ${data.error ?? '未知错误'}`, 'error');
      }
    } catch {
      toast('测试失败', 'error');
    }
  };

  const handleDiscover = async (id: number) => {
    setDiscovering(id);
    try {
      const res = await discoverMcpTools(id);
      const data = res.data as { tools: McpToolDiscovery[]; toolCount: number };
      setDiscoveredTools(data.tools);
      if (data.toolCount === 0) {
        toast('未发现远程工具', 'error');
      }
    } catch {
      toast('发现工具失败', 'error');
    } finally {
      setDiscovering(null);
    }
  };

  const handleSync = async (serverId: number) => {
    if (!syncGroupId) {
      toast('请选择同步目标工具组', 'error');
      return;
    }
    try {
      const res = await syncMcpTools(serverId, syncGroupId);
      const data = res.data as { created: number; updated: number };
      toast(`同步完成，新建 ${data.created} 个工具，更新 ${data.updated} 个工具`, 'success');
      setShowSync(null);
      setDiscoveredTools([]);
      fetchData();
    } catch {
      toast('同步失败', 'error');
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '', serverUrl: '', authType: 'BEARER', authConfig: '' });
    setShowForm(true);
  };

  const openEdit = (server: McpServer) => {
    setEditing(server);
    setForm({
      name: server.name,
      description: server.description || '',
      serverUrl: server.serverUrl,
      authType: server.authType || 'BEARER',
      authConfig: server.authConfig || '',
    });
    setShowForm(true);
  };

  if (loading) {
    return <div className="mcp-server-loading">加载中...</div>;
  }

  return (
    <div className="mcp-server">
      <div className="mcp-server-header">
        <h2 className="mcp-server-title">MCP 服务管理</h2>
        <button className="mcp-server-add-btn" onClick={openCreate}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          注册服务
        </button>
      </div>

      <div className="mcp-server-grid">
        {servers.map((server) => (
          <div key={server.id} className="mcp-server-card">
            <div className="mcp-server-card-header">
              <h3 className="mcp-server-card-name">{server.name}</h3>
              <span className={`mcp-server-card-status ${server.status === 'ENABLED' ? 'enabled' : 'disabled'}`}>
                {server.status === 'ENABLED' ? '启用' : '禁用'}
              </span>
            </div>
            <p className="mcp-server-card-desc">{server.description || '暂无描述'}</p>
            <div className="mcp-server-card-url">
              <span className="mcp-server-card-label">地址</span>
              <code className="mcp-server-card-url-value">{server.serverUrl}</code>
            </div>
            {server.lastSyncAt && (
              <div className="mcp-server-card-sync">
                <span className="mcp-server-card-label">上次同步</span>
                <span>{new Date(server.lastSyncAt).toLocaleString()}</span>
                <span className={`mcp-server-card-sync-status ${server.lastSyncStatus === 'SUCCESS' ? 'success' : 'failed'}`}>
                  {server.lastSyncStatus === 'SUCCESS' ? '成功' : '失败'}
                </span>
              </div>
            )}
            <div className="mcp-server-card-actions">
              <button className="mcp-server-card-btn" onClick={() => handleTest(server.id)}>测试连接</button>
              <button
                className="mcp-server-card-btn"
                onClick={() => { handleDiscover(server.id); }}
                disabled={discovering === server.id}
              >
                {discovering === server.id ? '发现中...' : '发现工具'}
              </button>
              <button className="mcp-server-card-btn" onClick={() => { setShowSync(server.id); }}>同步</button>
              <button className="mcp-server-card-btn" onClick={() => openEdit(server)}>编辑</button>
              <button className="mcp-server-card-btn danger" onClick={() => handleDelete(server)}>删除</button>
            </div>

            {discoveredTools.length > 0 && (
              <div className="mcp-server-card-tools">
                <h4 className="mcp-server-card-tools-title">远程工具 ({discoveredTools.length})</h4>
                <div className="mcp-server-card-tools-list">
                  {discoveredTools.map((tool) => (
                    <div key={tool.name} className="mcp-server-card-tool-item">
                      <span className="mcp-server-card-tool-name">{tool.name}</span>
                      <span className="mcp-server-card-tool-desc">{tool.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showSync === server.id && (
              <div className="mcp-server-sync-panel">
                <select
                  className="mcp-server-sync-select"
                  value={syncGroupId}
                  onChange={(e) => setSyncGroupId(Number(e.target.value))}
                >
                  <option value={0}>选择目标工具组</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <button className="mcp-server-sync-btn" onClick={() => handleSync(server.id)}>执行同步</button>
                <button className="mcp-server-sync-cancel" onClick={() => setShowSync(null)}>取消</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {showForm && (
        <div className="mcp-form-overlay" onClick={() => setShowForm(false)}>
          <div className="mcp-form" onClick={(e) => e.stopPropagation()}>
            <h3 className="mcp-form-title">{editing ? '编辑 MCP 服务' : '注册 MCP 服务'}</h3>
            <div className="mcp-form-field">
              <label className="mcp-form-label">服务名称</label>
              <input className="mcp-form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：企业MES MCP" />
            </div>
            <div className="mcp-form-field">
              <label className="mcp-form-label">描述</label>
              <input className="mcp-form-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="简要描述" />
            </div>
            <div className="mcp-form-field">
              <label className="mcp-form-label">服务地址</label>
              <input className="mcp-form-input" value={form.serverUrl} onChange={(e) => setForm({ ...form, serverUrl: e.target.value })} placeholder="http://host:port/sse" />
            </div>
            <div className="mcp-form-field">
              <label className="mcp-form-label">认证方式</label>
              <select className="mcp-form-select" value={form.authType} onChange={(e) => setForm({ ...form, authType: e.target.value })}>
                <option value="NONE">无认证</option>
                <option value="BEARER">Bearer Token</option>
                <option value="API_KEY">API Key</option>
              </select>
            </div>
            <div className="mcp-form-field">
              <label className="mcp-form-label">认证配置</label>
              <input className="mcp-form-input" value={form.authConfig} onChange={(e) => setForm({ ...form, authConfig: e.target.value })} placeholder="Token 或 API Key 值" />
            </div>
            <div className="mcp-form-actions">
              <button className="mcp-form-cancel" onClick={() => setShowForm(false)}>取消</button>
              <button className="mcp-form-submit" onClick={handleSubmit}>{editing ? '保存' : '注册'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}