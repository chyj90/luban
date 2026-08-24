import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { usePermissionStore } from '@/stores/permissionStore';
import './SidebarLayout.css';

interface MenuGroup {
  title: string;
  items: { key: string; label: string; path: string; permission: string }[];
}

const MENU_GROUPS: MenuGroup[] = [
  {
    title: '概念建模',
    items: [
      { key: '/concept/ontology-groups', label: '概念域管理', path: '/concept/ontology-groups', permission: 'connect:ontology-groups' },
      { key: '/concept/concepts', label: '概念编辑器', path: '/concept/concepts', permission: 'connect:concepts' },
    ],
  },
  {
    title: '数据运维',
    items: [
      { key: '/concept/concept-feedback', label: '概念反馈', path: '/concept/concept-feedback', permission: 'connect:concept-feedback' },
      { key: '/concept/concept-snapshots', label: '版本快照', path: '/concept/concept-snapshots', permission: 'connect:concept-snapshots' },
      { key: '/concept/concept-embeddings', label: '异步任务', path: '/concept/concept-embeddings', permission: 'connect:concept-embeddings' },
    ],
  },
];

export function ConceptLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const hasPermission = usePermissionStore((s) => s.hasPermission);
  const loaded = usePermissionStore((s) => s.loaded);

  return (
    <div className="sidebar-layout">
      <aside className="sidebar-layout-sidebar">
        <nav className="sidebar-layout-menu">
          {MENU_GROUPS.map((group) => {
            const visibleItems = loaded
              ? group.items.filter((item) => hasPermission(item.permission))
              : group.items;
            if (visibleItems.length === 0) return null;
            return (
              <div key={group.title} className="sidebar-layout-menu-group">
                <div className="sidebar-layout-menu-group-title">{group.title}</div>
                {visibleItems.map((item) => (
                  <button
                    key={item.key}
                    className={`sidebar-layout-menu-item ${location.pathname === item.path ? 'active' : ''}`}
                    onClick={() => navigate(item.path)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <main className="sidebar-layout-content">
        <Outlet />
      </main>
    </div>
  );
}