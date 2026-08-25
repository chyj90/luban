import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, LayoutGrid } from 'lucide-react';
import { usePermissionStore } from '@/stores/permissionStore';
import { listAccessibleApplications, type AccessibleApp } from '@/api/application';
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
  const [apps, setApps] = useState<AccessibleApp[]>([]);
  const [expandedApps, setExpandedApps] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!loaded) return;
    listAccessibleApplications().then((res) => {
      setApps(res.data || []);
    }).catch(() => {
      setApps([]);
    });
  }, [loaded]);

  const filteredItems = loaded
    ? MENU_ITEMS.filter((item) => hasPermission(item.permission))
    : MENU_ITEMS;

  const isWorkAppPage = location.pathname.startsWith('/work/app/');

  const toggleApp = (appId: number) => {
    setExpandedApps((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) next.delete(appId);
      else next.add(appId);
      return next;
    });
  };

  return (
    <div className="sidebar-layout">
      <aside className="sidebar-layout-sidebar">
        <nav className="sidebar-layout-menu">
          {apps.length > 0 && (
            <div className="sidebar-layout-section">
              <div className="sidebar-layout-section-label">
                <LayoutGrid size={14} />
                可用应用
              </div>
              {apps.map((app) => {
                const isExpanded = expandedApps.has(app.id);
                const accessiblePages = app.pages.filter((p) => p.accessible !== false);
                return (
                  <div key={app.id} className="sidebar-app-group">
                    <button
                      className={`sidebar-app-name ${isExpanded ? 'expanded' : ''}`}
                      onClick={() => toggleApp(app.id)}
                    >
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span>{app.name}</span>
                    </button>
                    {isExpanded && (
                      <div className="sidebar-app-pages">
                        {accessiblePages.length === 0 ? (
                          <div className="sidebar-app-empty">暂无可用页面</div>
                        ) : (
                          accessiblePages.map((page) => {
                            const pagePath = `/work/app/${app.id}/page/${page.id}`;
                            return (
                              <button
                                key={page.id}
                                className={`sidebar-page-item ${location.pathname === pagePath ? 'active' : ''}`}
                                onClick={() => navigate(pagePath)}
                              >
                                {page.name}
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {filteredItems.map((item) => (
            <button
              key={item.key}
              className={`sidebar-layout-menu-item ${!isWorkAppPage && location.pathname === item.path ? 'active' : ''}`}
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