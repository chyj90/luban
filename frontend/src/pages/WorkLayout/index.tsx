import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import './SidebarLayout.css';

const MENU_ITEMS = [
  { key: '/work', label: '我的工作', path: '/work' },
  { key: '/work/approvals', label: '平台审核', path: '/work/approvals' },
];

export function WorkLayout() {
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