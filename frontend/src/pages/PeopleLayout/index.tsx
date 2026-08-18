import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import './SidebarLayout.css';

const MENU_ITEMS = [
  { key: '/people/users', label: '用户管理', path: '/people/users' },
  { key: '/people/org', label: '组织架构', path: '/people/org' },
  { key: '/people/members', label: '成员管理', path: '/people/members' },
  { key: '/people/roles', label: '平台角色', path: '/people/roles' },
];

export function PeopleLayout() {
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