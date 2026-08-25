import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { usePermissionStore } from '@/stores/permissionStore';
import { listAccessibleApplications } from '@/api/application';
import styles from './guards.module.css';

export function ProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}

export function GuestRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (isAuthenticated) {
    return <Navigate to="/work" replace />;
  }

  return <Outlet />;
}

export function PermissionGate({ permission }: { permission: string }) {
  const hasPermission = usePermissionStore((s) => s.hasPermission);
  const loaded = usePermissionStore((s) => s.loaded);

  if (!loaded) {
    return null;
  }

  if (!hasPermission(permission)) {
    return <Navigate to="/work" replace />;
  }

  return <Outlet />;
}

export function AppAccessGate() {
  const location = useLocation();
  const match = location.pathname.match(/\/(?:apps|work\/app)\/(\d+)(?:\/page\/(\d+))?/);
  const appId = match?.[1];
  const pageId = match?.[2];
  const [state, setState] = useState<'loading' | 'allowed' | 'forbidden'>('loading');

  useEffect(() => {
    if (!appId) {
      setState('forbidden');
      return;
    }
    listAccessibleApplications()
      .then((res) => {
        const app = res.data.find((a) => a.id === Number(appId));
        if (!app) {
          setState('forbidden');
          return;
        }
        if (pageId) {
          const page = app.pages.find((p) => p.id === Number(pageId));
          if (!page || !page.accessible) {
            setState('forbidden');
            return;
          }
        }
        setState('allowed');
      })
      .catch(() => setState('forbidden'));
  }, [appId, pageId]);

  if (state === 'loading') {
    return (
      <div className={styles.gateLoading}>
        <div className={styles.gateSpinner} />
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className={styles.gateForbidden}>
        <h1 className={styles.gateCode}>403</h1>
        <p className={styles.gateMessage}>无权访问此应用</p>
        <button className={styles.gateBackBtn} onClick={() => window.history.back()}>
          返回
        </button>
      </div>
    );
  }

  return <Outlet />;
}