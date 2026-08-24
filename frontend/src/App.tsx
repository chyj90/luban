import { useEffect, useRef } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/router';
import { Toast } from '@/components/Toast';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useAuthStore } from '@/stores/authStore';
import { usePermissionStore } from '@/stores/permissionStore';
import { getMyPermissions } from '@/api';

function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const loaded = usePermissionStore((s) => s.loaded);
  const setPermissions = usePermissionStore((s) => s.setPermissions);
  const fetching = useRef(false);

  useEffect(() => {
    if (isAuthenticated && !loaded && !fetching.current) {
      fetching.current = true;
      getMyPermissions()
        .then((res) => setPermissions(res.data as string[]))
        .catch(() => setPermissions([]));
    }
  }, [isAuthenticated, loaded, setPermissions]);

  return (
    <>
      <RouterProvider router={router} />
      <Toast />
      <ConfirmDialog />
    </>
  );
}

export default App;