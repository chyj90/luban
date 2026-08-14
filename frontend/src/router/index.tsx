import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute, GuestRoute } from './guards';
import { LoginPage } from '@/pages/Login/LoginPage';
import { RegisterPage } from '@/pages/Login/RegisterPage';
import { WorkspacePage } from '@/pages/Workspace/WorkspacePage';
import { AppEditorPage } from '@/pages/AppEditor/AppEditorPage';
import ProcessList from '@/pages/workflow/ProcessList';
import WorkflowDesigner from '@/pages/workflow/WorkflowDesigner';
import MyWorkflow from '@/pages/workflow/MyWorkflow';
import InstanceDetail from '@/pages/workflow/InstanceDetail';
import FormList from '@/pages/workflow/FormList';
import FormPreview from '@/pages/workflow/FormPreview';
import Organization from '@/pages/workflow/Organization';

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
      {
        path: '/workflow/processes',
        element: <ProcessList />,
      },
      {
        path: '/workflow/designer/:id',
        element: <WorkflowDesigner />,
      },
      {
        path: '/workflow/designer',
        element: <WorkflowDesigner />,
      },
      {
        path: '/workflow/tasks',
        element: <MyWorkflow />,
      },
      {
        path: '/workflow/instances/:id',
        element: <InstanceDetail />,
      },
      {
        path: '/workflow/forms',
        element: <FormList />,
      },
      {
        path: '/workflow/forms/:id/preview',
        element: <FormPreview />,
      },
      {
        path: '/workflow/my-workflow',
        element: <MyWorkflow />,
      },
      {
        path: '/workflow/organization',
        element: <Organization />,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/workspace" replace />,
  },
]);