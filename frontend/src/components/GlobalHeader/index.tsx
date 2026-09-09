import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { usePermissionStore } from '@/stores/permissionStore';
import { getApplication } from '@/api/application';
import { ChangePasswordModal } from '@/components/ChangePasswordModal';
import './GlobalHeader.css';

const NAV_ITEMS = [
  { path: '/work', label: '工作中心', permission: 'workbench:read' },
  { path: '/agent-chat', label: '智能洞察', permission: 'ask:read' },
  { path: '/apps', label: '应用开发', permission: 'apps:read' },
  { path: '/concept', label: '概念图谱', permission: 'connect:concepts' },
  { path: '/connect', label: '系统配置', permission: 'connect:systems' },
  { path: '/people', label: '人员管理', permission: 'people:users' },
];

export function GlobalHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const hasPermission = usePermissionStore((s) => s.hasPermission);
  const loaded = usePermissionStore((s) => s.loaded);
  const resetPermissions = usePermissionStore((s) => s.reset);
  const [appName, setAppName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredNav = loaded
    ? NAV_ITEMS.filter((item) => hasPermission(item.permission))
    : NAV_ITEMS;

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
    if (path === '/apps') return location.pathname === '/apps' || location.pathname.startsWith('/apps/');
    if (path === '/connect') return location.pathname.startsWith('/connect');
    if (path === '/concept') return location.pathname.startsWith('/concept');
    if (path === '/people') return location.pathname.startsWith('/people');
    if (path === '/work') return location.pathname.startsWith('/work');
    if (path === '/agent-chat') return location.pathname === '/agent-chat';
    return false;
  };

  const handleLogout = () => {
    logout();
    resetPermissions();
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
              {filteredNav.map((item) => (
                <button
                  key={item.path}
                  className={`global-header-nav-link ${isActive(item.path) ? 'active' : ''}`}
                  onClick={() => navigate(item.path)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </>
        )}
      </div>
      <div className="global-header-right">
        {user && (
          <div className="global-header-user" ref={menuRef}>
            <div
              className="global-header-user-trigger"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <span className="global-header-user-name">{user.account}</span>
              <div className="global-header-user-avatar">
                {user.account?.charAt(0)?.toUpperCase() || 'U'}
              </div>
              <svg
                className={`global-header-user-arrow ${menuOpen ? 'open' : ''}`}
                width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </div>
            {menuOpen && (
              <div className="global-header-user-menu">
                <button
                  className="global-header-user-menu-item"
                  onClick={() => { setMenuOpen(false); setChangePwdOpen(true); }}
                >
                  修改密码
                </button>
                <button
                  className="global-header-user-menu-item"
                  onClick={handleLogout}
                >
                  退出登录
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <ChangePasswordModal open={changePwdOpen} onClose={() => setChangePwdOpen(false)} />
    </header>
  );
}