import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { usePermissionStore } from '@/stores/permissionStore';

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
    return <Navigate to="/apps" replace />;
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
    return <Navigate to="/apps" replace />;
  }

  return <Outlet />;
}