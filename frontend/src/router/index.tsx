import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute, GuestRoute } from './guards';
import { LoginPage } from '@/pages/Login/LoginPage';
import { RegisterPage } from '@/pages/Login/RegisterPage';
import { WorkspacePage } from '@/pages/Workspace/WorkspacePage';
import { AppEditorPage } from '@/pages/AppEditor/AppEditorPage';

export const router = createBrowserRouter([
  {
    element: <GuestRoute />,
    children: [
      {
        path: '/login',
        element: <LoginPage />,
      },
      {
        path: '/register',
        element: <RegisterPage />,
      },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: '/workspace',
        element: <WorkspacePage />,
      },
      {
        path: '/app/:appId',
        element: <AppEditorPage />,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/workspace" replace />,
  },
]);