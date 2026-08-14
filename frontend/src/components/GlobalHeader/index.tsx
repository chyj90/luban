import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { getApplication } from '@/api/application';
import './GlobalHeader.css';

export function GlobalHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [appName, setAppName] = useState('');

  const appIdMatch = location.pathname.match(/^\/apps\/(\d+)/);
  const appId = appIdMatch ? Number(appIdMatch[1]) : null;
  const isInsideApp = appId !== null;

  useEffect(() => {
    if (appId) {
      getApplication(appId).then((res) => {
        setAppName(res.data.name);
      }).catch(() => {
        setAppName('');
      });
    } else {
      setAppName('');
    }
  }, [appId]);

  const isActive = (path: string) => {
    if (path === '/apps') return location.pathname === '/apps';
    if (path === '/work') return location.pathname.startsWith('/work');
    return false;
  };

  const handleLogout = () => {
    logout();
    localStorage.removeItem('impersonate_user_id');
    localStorage.removeItem('impersonate_app_id');
    navigate('/login');
  };

  return (
    <header className="global-header">
      <div className="global-header-left">
        {isInsideApp ? (
          <>
            <button className="global-header-back" onClick={() => navigate('/apps')} title="返回应用列表">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="global-header-logo" onClick={() => navigate('/apps')}>
              <svg width="22" height="22" viewBox="0 0 24 24">
                <path d="M12 2L2 7l10 5 10-5-10-5Z" stroke="#1677ff" fill="#e6f4ff" />
                <path d="M2 17l10 5 10-5" stroke="#1677ff" strokeWidth="2" />
                <path d="M2 12l10 5 10-5" stroke="#1677ff" strokeWidth="2" />
              </svg>
              <span className="global-header-logo-text">鲁班</span>
            </div>
            <span className="global-header-breadcrumb-sep">/</span>
            <span className="global-header-app-name">{appName}</span>
          </>
        ) : (
          <>
            <div className="global-header-logo" onClick={() => navigate('/apps')}>
              <svg width="22" height="22" viewBox="0 0 24 24">
                <path d="M12 2L2 7l10 5 10-5-10-5Z" stroke="#1677ff" fill="#e6f4ff" />
                <path d="M2 17l10 5 10-5" stroke="#1677ff" strokeWidth="2" />
                <path d="M2 12l10 5 10-5" stroke="#1677ff" strokeWidth="2" />
              </svg>
              <span className="global-header-logo-text">鲁班</span>
            </div>
            <nav className="global-header-nav">
              <button
                className={`global-header-nav-link ${isActive('/apps') ? 'active' : ''}`}
                onClick={() => navigate('/apps')}
              >
                应用中心
              </button>
              <button
                className={`global-header-nav-link ${isActive('/work') ? 'active' : ''}`}
                onClick={() => navigate('/work')}
              >
                我的工作
              </button>
            </nav>
          </>
        )}
      </div>
      <div className="global-header-right">
        {user && (
          <div className="global-header-user">
            <span className="global-header-user-name">{user.name}</span>
            <div className="global-header-user-avatar">
              {user.name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
          </div>
        )}
        <button className="global-header-logout" onClick={handleLogout} title="退出登录">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#5f6b7a">
            <path d="M16 13v-2H7V8l-5 4 5 4v-3z" />
            <path d="M20 3H9c-1.1 0-2 .9-2 2v4h2V5h11v14H9v-4H7v4c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
          </svg>
        </button>
      </div>
    </header>
  );
}