import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import './SidebarLayout.css';

const MENU_ITEMS = [
  { key: '/connect/systems', label: '系统管理', path: '/connect/systems' },
  { key: '/connect/tools', label: '工具注册表', path: '/connect/tools' },
  { key: '/connect/concepts', label: '概念本体', path: '/connect/concepts' },
  { key: '/connect/gateway', label: 'MCP 网关', path: '/connect/gateway' },
  { key: '/connect/keys', label: '我的 Key', path: '/connect/keys' },
];

export function ConnectLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="sidebar-layout">
      <aside className="sidebar-layout-sidebar">
        <nav className="sidebar-layout-menu">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.key}
              className={`sidebar-layout-menu-item ${location.pathname === item.path ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="sidebar-layout-content">
        <Outlet />
      </main>
    </div>
  );
}