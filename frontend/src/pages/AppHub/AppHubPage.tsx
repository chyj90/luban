import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, Key, Link, Unlink, Plus, ArrowRight, Clock, Layers, Globe } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import { useApplicationStore } from '@/stores/applicationStore';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { confirm } from '@/stores/confirmStore';
import { useLoadingStore } from '@/stores/loadingStore';
import { listApiKeys, listKeysByApplication, bindApplicationToKey, unbindApplicationFromKey } from '@/api/tool';
import type { Application } from '@/types/application';
import './AppHubPage.css';

const APP_COLORS = [
  '#6B8F71', '#E07B39', '#4A90D9', '#9B59B6',
  '#E74C3C', '#2ECC71', '#1ABC9C', '#3498DB',
  '#F39C12', '#E91E63', '#00BCD4', '#8BC34A',
];

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 30) return `${days} 天前`;
  return d.toLocaleDateString('zh-CN');
}

export function AppHubPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { applications, loading, fetchApplications, addApplication, removeApplication } = useApplicationStore();
  const setGlobalLoading = useLoadingStore((s) => s.setLoading);
  const [newAppName, setNewAppName] = useState('');
  const [showCreateApp, setShowCreateApp] = useState(false);
  const [keyModalAppId, setKeyModalAppId] = useState<number | null>(null);
  const [keyModalAppName, setKeyModalAppName] = useState('');
  const [boundKeys, setBoundKeys] = useState<{ id: number; name: string }[]>([]);
  const [allKeys, setAllKeys] = useState<{ id: number; name: string }[]>([]);
  const [keyModalLoading, setKeyModalLoading] = useState(false);

  useEffect(() => {
    setGlobalLoading(loading);
  }, [loading, setGlobalLoading]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const myApps = applications.filter((app) => app.createdBy === user?.id);
  const hasAnyApps = myApps.length > 0;

  const handleCreateApp = async () => {
    if (!newAppName.trim()) return;
    const app = await addApplication(newAppName.trim());
    setNewAppName('');
    setShowCreateApp(false);
    navigate(`/apps/${app.id}`);
  };

  const handleDeleteApp = async (e: React.MouseEvent, appId: number, appName: string) => {
    e.stopPropagation();
    const confirmed = await confirm({
      title: '删除应用',
      message: `确定要删除应用「${appName}」吗？此操作不可撤销，所有页面和数据将被永久删除。`,
      confirmText: '删除',
      variant: 'danger',
    });
    if (confirmed) {
      removeApplication(appId);
      toast.success(`应用「${appName}」已删除`);
    }
  };

  const openKeyModal = async (e: React.MouseEvent, app: Application) => {
    e.stopPropagation();
    setKeyModalAppId(app.id);
    setKeyModalAppName(app.name);
    setKeyModalLoading(true);
    try {
      const [keysRes, boundRes] = await Promise.all([
        listApiKeys(),
        listKeysByApplication(app.id),
      ]);
      const keys = (keysRes.data as { id: number; name: string }[]) || [];
      setAllKeys(keys);
      const bound = (boundRes.data as { id: number; name: string }[]) || [];
      setBoundKeys(bound);
    } catch {
      toast.error('加载 KEY 失败');
    } finally {
      setKeyModalLoading(false);
    }
  };

  const handleBindKey = async (keyId: number) => {
    if (!keyModalAppId) return;
    try {
      await bindApplicationToKey(keyId, keyModalAppId);
      toast.success('绑定成功');
      const boundRes = await listKeysByApplication(keyModalAppId);
      const bound = (boundRes.data as { id: number; name: string }[]) || [];
      setBoundKeys(bound);
    } catch {
      toast.error('绑定失败');
    }
  };

  const handleUnbindKey = async (keyId: number) => {
    if (!keyModalAppId) return;
    try {
      await unbindApplicationFromKey(keyId, keyModalAppId);
      toast.success('解绑成功');
      const boundRes = await listKeysByApplication(keyModalAppId);
      const bound = (boundRes.data as { id: number; name: string }[]) || [];
      setBoundKeys(bound);
    } catch {
      toast.error('解绑失败');
    }
  };

  const getAppColor = (appId: number) => {
    return APP_COLORS[appId % APP_COLORS.length];
  };

  const renderCreateBar = () => (
    <div className="apphub-create-bar">
      <input
        value={newAppName}
        onChange={(e) => setNewAppName(e.target.value)}
        placeholder="输入应用名称，按 Enter 创建"
        autoFocus
        onKeyDown={(e) => e.key === 'Enter' && handleCreateApp()}
      />
      <button className="apphub-btn-cancel" onClick={() => { setShowCreateApp(false); setNewAppName(''); }}>
        取消
      </button>
      <button className="apphub-btn-confirm" onClick={handleCreateApp}>
        创建应用
      </button>
    </div>
  );

  const renderAppCard = (app: Application, isOwner: boolean) => (
    <div
      key={app.id}
      className="apphub-card"
      onClick={() => navigate(`/apps/${app.id}`)}
    >
      {isOwner && (
        <>
          <button
            className="apphub-card-action apphub-card-delete"
            onClick={(e) => handleDeleteApp(e, app.id, app.name)}
            title="删除应用"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
          <button
            className="apphub-card-action apphub-card-key"
            onClick={(e) => openKeyModal(e, app)}
            title="管理 KEY"
          >
            <Key size={14} />
          </button>
        </>
      )}

      <div className="apphub-card-body">
        <div
          className="apphub-card-icon"
          style={{ background: getAppColor(app.id) }}
        >
          {app.icon || app.name.charAt(0).toUpperCase()}
        </div>
        <div className="apphub-card-info">
          <div className="apphub-card-name">{app.name}</div>
          <div className="apphub-card-meta">
            {app.slug && (
              <span className="apphub-card-meta-item">
                <Globe size={12} />
                {app.slug}
              </span>
            )}
            {app.publishedWorkflowCount != null && app.publishedWorkflowCount > 0 && (
              <span className="apphub-card-meta-item">
                <Layers size={12} />
                {app.publishedWorkflowCount} 个流程
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="apphub-card-footer">
        <div className="apphub-card-footer-left">
          <Clock size={12} />
          <span>{formatTime(app.createdAt)}</span>
        </div>
        <div className="apphub-card-footer-right">
          {!isOwner && (
            <button
              className="apphub-btn-enter"
              onClick={(e) => { e.stopPropagation(); navigate(`/apps/${app.id}`); }}
            >
              进入
              <ArrowRight size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (loading) return null;

  return (
    <div className="apphub-page">
      <PageTopbar
        icon={<LayoutGrid size={22} />}
        title="应用开发"
        subtitle="创建和管理应用，构建工作流与表单，实现业务自动化"
        actions={
          !showCreateApp && (
            <button className="apphub-hero-btn" onClick={() => setShowCreateApp(true)} style={{ padding: '8px 20px', fontSize: '13px' }}>
              <Plus size={16} />
              新建应用
            </button>
          )
        }
      />

      <div className="apphub-content">
        {!hasAnyApps && !showCreateApp ? (
          <div className="apphub-hero">
            <div className="apphub-hero-icon">
              <LayoutGrid size={36} color="#fff" />
            </div>
            <h2>开始构建你的第一个应用</h2>
            <p>
              应用是业务功能的集合，你可以在这里创建页面、设计工作流、
              配置表单，将复杂的业务流程转化为简单的操作体验。
            </p>
            <button className="apphub-hero-btn" onClick={() => setShowCreateApp(true)}>
              <Plus size={20} />
              创建第一个应用
            </button>
          </div>
        ) : (
          <>
            {myApps.length > 0 && (
              <section className="apphub-section">
                <div className="apphub-section-header">
                  <div className="apphub-section-icon my">
                    <LayoutGrid size={18} />
                  </div>
                  <h2 className="apphub-section-title">我的应用</h2>
                  <span className="apphub-section-count">{myApps.length}</span>
                </div>
                {showCreateApp && renderCreateBar()}
                <div className="apphub-grid">
                  {myApps.map((app) => renderAppCard(app, true))}
                </div>
              </section>
            )}

            {myApps.length === 0 && (
              <section className="apphub-section">
                <div className="apphub-section-header">
                  <div className="apphub-section-icon my">
                    <LayoutGrid size={18} />
                  </div>
                  <h2 className="apphub-section-title">我的应用</h2>
                  <span className="apphub-section-count">0</span>
                </div>
                {showCreateApp && renderCreateBar()}
                <div className="apphub-other-empty">
                  <p>你还没有创建应用，点击上方按钮开始</p>
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {keyModalAppId !== null && (
        <div className="apphub-modal-overlay" onClick={() => setKeyModalAppId(null)}>
          <div className="apphub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="apphub-modal-header">
              <h3>管理 KEY - {keyModalAppName}</h3>
              <button className="apphub-modal-close" onClick={() => setKeyModalAppId(null)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="apphub-modal-body">
              {keyModalLoading ? (
                <p className="apphub-modal-loading">加载中...</p>
              ) : (
                <>
                  <div className="apphub-modal-section">
                    <h4>已绑定 KEY</h4>
                    {boundKeys.length === 0 ? (
                      <p className="apphub-modal-empty">暂无绑定 KEY</p>
                    ) : (
                      <ul className="apphub-key-list">
                        {boundKeys.map((key) => (
                          <li key={key.id} className="apphub-key-item">
                            <span className="apphub-key-name">{key.name}</span>
                            <button
                              className="apphub-key-unbind"
                              onClick={() => handleUnbindKey(key.id)}
                            >
                              <Unlink size={14} />
                              解绑
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="apphub-modal-section">
                    <h4>可用 KEY</h4>
                    {allKeys.filter((k) => !boundKeys.some((b) => b.id === k.id)).length === 0 ? (
                      <p className="apphub-modal-empty">所有 KEY 已绑定</p>
                    ) : (
                      <ul className="apphub-key-list">
                        {allKeys.filter((k) => !boundKeys.some((b) => b.id === k.id)).map((key) => (
                          <li key={key.id} className="apphub-key-item">
                            <span className="apphub-key-name">{key.name}</span>
                            <button
                              className="apphub-key-bind"
                              onClick={() => handleBindKey(key.id)}
                            >
                              <Link size={14} />
                              绑定
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}