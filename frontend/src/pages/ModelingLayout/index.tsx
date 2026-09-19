import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { usePermissionStore } from '@/stores/permissionStore';
import { MODELING_MENU_GROUPS } from './menuGroups';
import './SidebarLayout.css';

/**
 * 建模中心：数据接入（系统/监控，工具管理从系统页进入）+ 概念图谱 + 凭据与大模型配置。
 * 平台的语义底座入口——洞察问数与应用开发共同依赖这里的建模成果。
 */
export function ModelingLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const hasPermission = usePermissionStore((s) => s.hasPermission);
  const loaded = usePermissionStore((s) => s.loaded);

  const visibleGroups = loaded
    ? MODELING_MENU_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.permission || hasPermission(item.permission)),
      })).filter((group) => group.items.length > 0)
    : MODELING_MENU_GROUPS;

  // 权限未加载前不渲染内容，避免短暂闪现无权页面
  useEffect(() => {
    if (loaded && visibleGroups.length === 0) {
      navigate('/work', { replace: true });
    }
  }, [loaded, visibleGroups.length, navigate]);

  if (loaded && visibleGroups.length === 0) {
    return null;
  }

  return (
    <div className="sidebar-layout">
      <aside className="sidebar-layout-sidebar">
        <nav className="sidebar-layout-menu">
          {visibleGroups.map((group) => (
            <div key={group.title} className="sidebar-layout-menu-group">
              <div className="sidebar-layout-menu-group-title">{group.title}</div>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  className={`sidebar-layout-menu-item ${location.pathname === item.path ? 'active' : ''}`}
                  onClick={() => navigate(item.path)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <main className="sidebar-layout-content">
        <Outlet />
      </main>
    </div>
  );
}
