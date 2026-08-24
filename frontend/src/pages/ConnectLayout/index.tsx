import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { usePermissionStore } from '@/stores/permissionStore';
import './SidebarLayout.css';

const MENU_ITEMS = [
  { key: '/connect/systems', label: '系统管理', path: '/connect/systems', permission: 'connect:systems' },
  { key: '/connect/gateway', label: '运行监控', path: '/connect/gateway', permission: 'connect:gateway' },
  { key: '/connect/keys', label: '我的 KEY', path: '/connect/keys', permission: 'connect:keys' },
  { key: '/connect/agent', label: '大模型配置', path: '/connect/agent', permission: 'connect:agent' },
];

export function ConnectLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const hasPermission = usePermissionStore((s) => s.hasPermission);
  const loaded = usePermissionStore((s) => s.loaded);

  const filteredItems = loaded
    ? MENU_ITEMS.filter((item) => hasPermission(item.permission))
    : MENU_ITEMS;

  return (
    <div className="sidebar-layout">
      <aside className="sidebar-layout-sidebar">
        <nav className="sidebar-layout-menu">
          {filteredItems.map((item) => (
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