import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApplicationStore } from '@/stores/applicationStore';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { useLoadingStore } from '@/stores/loadingStore';
import type { Application } from '@/types/application';
import './AppHubPage.css';

const APP_COLORS = ['#6B8F71', '#E07B39', '#4A90D9', '#9B59B6', '#E74C3C', '#2ECC71', '#1ABC9C', '#3498DB'];

export function AppHubPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { applications, loading, fetchApplications, addApplication, removeApplication } = useApplicationStore();
  const setGlobalLoading = useLoadingStore((s) => s.setLoading);
  const [newAppName, setNewAppName] = useState('');

  useEffect(() => {
    setGlobalLoading(loading);
  }, [loading, setGlobalLoading]);
  const [showCreateApp, setShowCreateApp] = useState(false);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const myApps = applications.filter((app) => app.createdBy === user?.id);
  const otherApps = applications.filter((app) => app.createdBy !== user?.id);

  const handleCreateApp = async () => {
    if (!newAppName.trim()) return;
    const app = await addApplication(newAppName.trim());
    setNewAppName('');
    setShowCreateApp(false);
    navigate(`/apps/${app.id}`);
  };

  const handleDeleteApp = (e: React.MouseEvent, appId: number, appName: string) => {
    e.stopPropagation();
    if (window.confirm(`确定要删除应用「${appName}」吗？此操作不可撤销。`)) {
      removeApplication(appId);
      toast.success(`应用「${appName}」已删除`);
    }
  };

  const handleEnterApp = (app: Application) => {
    if (app.createdBy === user?.id) {
      navigate(`/apps/${app.id}`);
    } else {
      navigate(`/apps/${app.id}`);
    }
  };

  const getAppColor = (appId: number) => {
    return APP_COLORS[appId % APP_COLORS.length];
  };

  const renderAppCard = (app: Application, isOwner: boolean) => (
    <div
      key={app.id}
      className="apphub-card"
      onClick={() => handleEnterApp(app)}
    >
      {isOwner && (
        <button
          className="apphub-card-delete"
          onClick={(e) => handleDeleteApp(e, app.id, app.name)}
          title="删除应用"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      )}
      <div
        className="apphub-card-icon"
        style={{ background: getAppColor(app.id) }}
      >
        {app.icon || app.name.charAt(0).toUpperCase()}
      </div>
      <div className="apphub-card-info">
        <div className="apphub-card-name">{app.name}</div>
        <div className="apphub-card-meta">
          {app.slug && <span className="apphub-card-slug">{app.slug}</span>}
          {isOwner && (app.publishedWorkflowCount ?? 0) === 0 && (
            <span className="apphub-card-tag-unpublished">未发布</span>
          )}
        </div>
      </div>
      {!isOwner && (
        <button
          className="apphub-btn apphub-btn-enter"
          onClick={(e) => { e.stopPropagation(); navigate(`/apps/${app.id}`); }}
        >
          进入
        </button>
      )}
    </div>
  );

  if (loading) return null;

  return (
    <div className="apphub-page">
      <div className="apphub-content">
        {myApps.length > 0 && (
          <section className="apphub-section">
            <div className="apphub-section-header">
              <h2 className="apphub-section-title">我的应用</h2>
              <button className="apphub-create-btn" onClick={() => setShowCreateApp(true)}>
                + 新建应用
              </button>
            </div>
            {showCreateApp && (
              <div className="apphub-create-form">
                <input
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  placeholder="输入应用名称"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateApp()}
                />
                <button className="apphub-btn-confirm" onClick={handleCreateApp}>创建</button>
                <button className="apphub-btn-cancel" onClick={() => { setShowCreateApp(false); setNewAppName(''); }}>取消</button>
              </div>
            )}
            <div className="apphub-grid">
              {myApps.map((app) => renderAppCard(app, true))}
            </div>
          </section>
        )}

        {myApps.length === 0 && (
          <section className="apphub-section">
            <div className="apphub-section-header">
              <h2 className="apphub-section-title">开始使用</h2>
              <button className="apphub-create-btn" onClick={() => setShowCreateApp(true)}>
                + 新建应用
              </button>
            </div>
            {showCreateApp && (
              <div className="apphub-create-form">
                <input
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  placeholder="输入应用名称"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateApp()}
                />
                <button className="apphub-btn-confirm" onClick={handleCreateApp}>创建</button>
                <button className="apphub-btn-cancel" onClick={() => { setShowCreateApp(false); setNewAppName(''); }}>取消</button>
              </div>
            )}
            <p className="apphub-empty-hint">创建你的第一个应用，开始搭建工作流</p>
          </section>
        )}

        {otherApps.length > 0 && (
          <section className="apphub-section">
            <div className="apphub-section-header">
              <h2 className="apphub-section-title">可用应用</h2>
            </div>
            <div className="apphub-grid">
              {otherApps.map((app) => renderAppCard(app, false))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}