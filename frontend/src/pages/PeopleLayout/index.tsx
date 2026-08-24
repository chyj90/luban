import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { usePermissionStore } from '@/stores/permissionStore';
import './SidebarLayout.css';

const MENU_ITEMS = [
  { key: '/people/users', label: '用户管理', path: '/people/users', permission: 'people:users' },
  { key: '/people/org', label: '组织架构', path: '/people/org', permission: 'people:org' },
  { key: '/people/roles', label: '平台角色', path: '/people/roles', permission: 'people:roles' },
];

export function PeopleLayout() {
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