import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { usePermissionStore } from '@/stores/permissionStore';
import './SidebarLayout.css';

const MENU_ITEMS = [
  { key: '/work', label: '我的工作', path: '/work', permission: 'workbench:read' },
  { key: '/work/approvals', label: '平台审核', path: '/work/approvals', permission: 'workbench:read' },
];

export function WorkLayout() {
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