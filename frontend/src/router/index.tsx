import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute, GuestRoute } from './guards';
import { AppLayout } from '@/pages/AppLayout';
import { LoginPage } from '@/pages/Login/LoginPage';
import { RegisterPage } from '@/pages/Login/RegisterPage';
import { AppHubPage } from '@/pages/AppHub/AppHubPage';
import { AppEntryPage } from '@/pages/AppEntry';
import WorkflowDesigner from '@/pages/workflow/WorkflowDesigner';
import MyWorkflow from '@/pages/workflow/MyWorkflow';
import InstanceDetail from '@/pages/workflow/InstanceDetail';
import FormPreview from '@/pages/workflow/FormPreview';

export const router = createBrowserRouter([
  {
    element: <GuestRoute />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/apps', element: <AppHubPage /> },
          { path: '/apps/:appId', element: <AppEntryPage /> },
          { path: '/apps/:appId/designer/:id', element: <WorkflowDesigner /> },
          { path: '/apps/:appId/designer', element: <WorkflowDesigner /> },
          { path: '/apps/:appId/instances/:id', element: <InstanceDetail /> },
          { path: '/apps/:appId/forms/:id/preview', element: <FormPreview /> },
          { path: '/work', element: <MyWorkflow /> },
        ],
      },
      { path: '/workspace', element: <Navigate to="/apps" replace /> },
      { path: '/workflow/tasks', element: <Navigate to="/work" replace /> },
      { path: '/workflow/my-workflow', element: <Navigate to="/work" replace /> },
      { path: '/workflow/*', element: <Navigate to="/apps" replace /> },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/apps" replace />,
  },
]);