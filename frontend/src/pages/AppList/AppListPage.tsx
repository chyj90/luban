import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApplicationStore } from '@/stores/applicationStore';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { confirm } from '@/stores/confirmStore';
import './AppListPage.css';

const APP_COLORS = ['#6B8F71', '#E07B39', '#4A90D9', '#9B59B6', '#E74C3C', '#2ECC71', '#1ABC9C', '#3498DB'];

export function AppListPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { applications, loading, fetchApplications, addApplication, removeApplication } = useApplicationStore();
  const [newAppName, setNewAppName] = useState('');
  const [showCreateApp, setShowCreateApp] = useState(false);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const handleCreateApp = async () => {
    if (!newAppName.trim()) return;
    const app = await addApplication(newAppName.trim());
    setNewAppName('');
    setShowCreateApp(false);
    navigate(`/app/${app.id}`);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
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

  const getInitials = (name: string) => {
    return name?.charAt(0)?.toUpperCase() || '?';
  };

  const getAppColor = (appId: number) => {
    return APP_COLORS[appId % APP_COLORS.length];
  };

  if (loading) {
    return <div className="applist-loading">加载中...</div>;
  }

  return (
    <div className="applist-page">
      <header className="applist-header">
        <div className="applist-header-left">
          <div className="applist-logo">
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path d="M12 2L2 7l10 5 10-5-10-5Z" stroke="#1677ff" fill="#e6f4ff" />
              <path d="M2 17l10 5 10-5" stroke="#1677ff" strokeWidth="2" />
              <path d="M2 12l10 5 10-5" stroke="#1677ff" strokeWidth="2" />
            </svg>
            <span className="applist-logo-text">鲁班</span>
          </div>
        </div>
        <div className="applist-spacer" />
        {user && (
          <div className="applist-user">
            <span className="applist-user-name">{user.name}</span>
            <div className="applist-user-avatar">
              {getInitials(user.name || '')}
            </div>
          </div>
        )}
        <button className="applist-logout" onClick={handleLogout}>退出</button>
      </header>

      <div className="applist-content">
        <div className="applist-section-header">
          <h2 className="applist-section-title">我的应用</h2>
          <button className="applist-create-btn" onClick={() => setShowCreateApp(true)}>
            + 新建应用
          </button>
        </div>

        {showCreateApp && (
          <div className="applist-create-form">
            <input
              value={newAppName}
              onChange={(e) => setNewAppName(e.target.value)}
              placeholder="输入应用名称"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreateApp()}
            />
            <button className="btn-confirm" onClick={handleCreateApp}>创建</button>
            <button className="btn-cancel" onClick={() => { setShowCreateApp(false); setNewAppName(''); }}>取消</button>
          </div>
        )}

        <div className="app-grid">
          {applications.map((app) => (
            <div
              key={app.id}
              className="app-card"
              onClick={() => navigate(`/app/${app.id}`)}
            >
              <div
                className="app-card-header"
                style={{ background: app.color || getAppColor(app.id) }}
              >
                <div className="app-card-icon">
                  {app.name?.charAt(0)?.toUpperCase() || 'A'}
                </div>
                <button
                  className="app-card-delete"
                  onClick={(e) => handleDeleteApp(e, app.id, app.name)}
                  title="删除"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              </div>
              <div className="app-card-body">
                <div className="app-card-name">{app.name}</div>
                <div className="app-card-meta">{app.slug}</div>
              </div>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="applist-loading-inline">
            <div className="applist-loading-spinner" />
            <span>加载中...</span>
          </div>
        ) : applications.length === 0 && !showCreateApp && (
          <div className="applist-empty">
            <div className="applist-empty-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div className="applist-empty-text">暂无应用</div>
            <div className="applist-empty-hint">点击"新建应用"开始创建你的第一个应用</div>
          </div>
        )}
      </div>
    </div>
  );
}